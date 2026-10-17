import { Database } from "bun:sqlite";
import { readdir, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { unzipSync } from "fflate";
import { rebuildLedger } from "./ledger/ledger.ts";
import { deserializeContent } from "./store/content.ts";
import type { DocumentContent, DocumentRecord, Store } from "./store/store.ts";

export type DocumentKind = "statement" | "activity_export";

export type IngestResult =
	| {
			readonly path: string;
			readonly outcome: "ingested";
			readonly documentKind: DocumentKind;
			readonly upiApp: string;
			readonly periodStart: string;
			readonly periodEnd: string;
			readonly ledgerTransactionsBefore: number;
			readonly ledgerTransactionsAfter: number;
	  }
	| { readonly path: string; readonly outcome: "already_ingested" }
	| { readonly path: string; readonly outcome: "rejected"; readonly reason: string };

export type Candidate = { readonly path: string; readonly bytes: Uint8Array; readonly format: "pdf" | "json" };

export type Discovery = Candidate | Extract<IngestResult, { outcome: "rejected" }>;

type LedgerDocument = { readonly path: string; readonly document: DocumentRecord };

type PathDiscovery = Discovery | LedgerDocument;

const activityFileName = "MyActivity.json";
const htmlOnlyActivity = /Google Pay\/My Activity\/My Activity\.html$/;
const htmlOnlyReason =
	"This Takeout has Google Pay activity only as HTML. Export it again with My Activity set to JSON and only Google Pay selected.";

function formatOf(name: string): Candidate["format"] | null {
	if (name.toLowerCase().endsWith(".pdf")) return "pdf";
	if (basename(name) === activityFileName) return "json";
	return null;
}

function rejectedAt(path: string, reason: string): Discovery {
	return { path, outcome: "rejected", reason };
}

export function discoverInZip(zipPath: string, bytes: Uint8Array): Discovery[] {
	const entries = unzipSync(bytes, { filter: ({ name }) => formatOf(name) !== null || htmlOnlyActivity.test(name) });
	const candidates = Object.entries(entries).flatMap(([name, content]): Candidate[] => {
		const format = formatOf(name);
		return format === null ? [] : [{ path: `${zipPath}!/${name}`, bytes: content, format }];
	});
	const htmlOnly = Object.keys(entries).some((name) => htmlOnlyActivity.test(name));
	if (htmlOnly && !candidates.some(({ format }) => format === "json")) return [rejectedAt(zipPath, htmlOnlyReason)];
	return candidates.length > 0
		? candidates
		: [rejectedAt(zipPath, "No statement PDF or Google Pay activity in this zip.")];
}

async function discoverInDirectory(directory: string): Promise<Discovery[]> {
	const names = (await readdir(directory, { recursive: true })).toSorted();
	const discoveries: Discovery[] = [];
	for (const name of names) {
		const path = join(directory, name);
		if (name.toLowerCase().endsWith(".zip")) discoveries.push(...discoverInZip(path, await readBytes(path)));
		const format = formatOf(name);
		if (format !== null) discoveries.push({ path, bytes: await readBytes(path), format });
	}
	const htmlOnly =
		names.some((name) => htmlOnlyActivity.test(name)) && !names.some((name) => formatOf(name) === "json");
	if (htmlOnly) discoveries.push(rejectedAt(directory, htmlOnlyReason));
	return discoveries.length > 0
		? discoveries
		: [rejectedAt(directory, "No statement PDF or Google Takeout export found.")];
}

async function readBytes(path: string): Promise<Uint8Array> {
	return new Uint8Array(await Bun.file(path).arrayBuffer());
}

type LedgerDocumentRow = Omit<DocumentRecord, "content"> & {
	readonly contentKind: DocumentContent["kind"];
	readonly content: string;
};

function discoverInLedger(ledgerPath: string): PathDiscovery[] {
	let ledger: Database;
	try {
		ledger = new Database(ledgerPath, { readonly: true });
	} catch {
		return [rejectedAt(ledgerPath, "Unreadable khata ledger.")];
	}
	try {
		const schemaVersion = ledger.query<{ user_version: number }, []>("pragma user_version").get()?.user_version ?? 0;
		if (schemaVersion < 2)
			return [rejectedAt(ledgerPath, "Not a khata ledger, or one too old to copy. Run khata status on it first.")];
		const rows = ledger
			.query<LedgerDocumentRow, []>(`
				select id, upi_app as upiApp, layout, period_start as periodStart, period_end as periodEnd,
					content_kind as contentKind, content, source
				from documents
				order by ingested_at, rowid
			`)
			.all();
		if (rows.length === 0) return [rejectedAt(ledgerPath, "This khata ledger holds no documents.")];
		return rows.map(({ contentKind, content, ...document }) => ({
			path: `${ledgerPath}#${document.id.slice(0, 12)}`,
			document: { ...document, content: deserializeContent(contentKind, content) },
		}));
	} catch {
		return [rejectedAt(ledgerPath, "Not a khata ledger.")];
	} finally {
		ledger.close();
	}
}

async function discover(path: string): Promise<PathDiscovery[]> {
	const absolutePath = resolve(path);
	const details = await stat(absolutePath).catch(() => null);
	if (details === null) return [rejectedAt(absolutePath, "File not found.")];
	if (details.isDirectory()) return discoverInDirectory(absolutePath);
	if (absolutePath.toLowerCase().endsWith(".zip")) return discoverInZip(absolutePath, await readBytes(absolutePath));
	if (absolutePath.toLowerCase().endsWith(".db")) return discoverInLedger(absolutePath);
	const format = absolutePath.toLowerCase().endsWith(".json") ? "json" : formatOf(absolutePath);
	if (format === null) {
		return [
			rejectedAt(
				absolutePath,
				"Unsupported file. khata reads statement PDFs, Google Takeout exports, and khata ledgers.",
			),
		];
	}
	return [{ path: absolutePath, bytes: await readBytes(absolutePath), format }];
}

async function documentFor(candidate: Candidate, documentId: string): Promise<DocumentRecord | string> {
	const parsers = await import("@khata/parsers");
	if (candidate.format === "pdf") {
		let textLayer: Awaited<ReturnType<typeof parsers.extractTextLayer>>;
		try {
			textLayer = await parsers.extractTextLayer(candidate.bytes);
		} catch (error) {
			return `Unreadable PDF: ${error instanceof Error ? error.message : error}`;
		}
		const parsed = parsers.parseStatement(textLayer);
		if (parsed.kind === "rejected") return parsed.reason;
		const { statement } = parsed;
		return {
			id: documentId,
			upiApp: statement.upiApp,
			layout: statement.layout,
			periodStart: statement.periodStart,
			periodEnd: statement.periodEnd,
			content: { kind: "text_layer", textLayer },
			source: candidate.path,
		};
	}
	let entries: unknown;
	try {
		entries = JSON.parse(new TextDecoder().decode(candidate.bytes));
	} catch {
		return "Unreadable JSON.";
	}
	if (!parsers.isGooglePayTakeoutActivity(entries)) return "Not a Google Pay activity export from Google Takeout.";
	const parsed = parsers.parseGooglePayTakeoutActivity(entries);
	if (parsed.kind === "rejected") return parsed.reason;
	const { activity } = parsed;
	return {
		id: documentId,
		upiApp: activity.upiApp,
		layout: activity.layout,
		periodStart: activity.coveredFrom,
		periodEnd: activity.coveredTo,
		content: { kind: "activity_json", entries },
		source: candidate.path,
	};
}

export async function ingestCandidate(store: Store, candidate: Candidate): Promise<IngestResult> {
	const documentId = new Bun.CryptoHasher("sha256").update(candidate.bytes).digest("hex");
	if (await store.hasDocument(documentId)) return { path: candidate.path, outcome: "already_ingested" };
	const document = await documentFor(candidate, documentId);
	if (typeof document === "string") return { path: candidate.path, outcome: "rejected", reason: document };
	return recordAndRebuild(store, candidate.path, document);
}

async function ingestLedgerDocument(store: Store, { path, document }: LedgerDocument): Promise<IngestResult> {
	if (await store.hasDocument(document.id)) return { path, outcome: "already_ingested" };
	return recordAndRebuild(store, path, document);
}

async function recordAndRebuild(store: Store, path: string, document: DocumentRecord): Promise<IngestResult> {
	const ledgerTransactionsBefore = (await store.status()).transactionCount;
	await store.recordDocument(document);
	const { transactionCount } = await rebuildLedger(store);
	return {
		path,
		outcome: "ingested",
		documentKind: document.content.kind === "text_layer" ? "statement" : "activity_export",
		upiApp: document.upiApp,
		periodStart: document.periodStart,
		periodEnd: document.periodEnd,
		ledgerTransactionsBefore,
		ledgerTransactionsAfter: transactionCount,
	};
}

export async function ingestPaths(store: Store, paths: readonly string[]): Promise<IngestResult[]> {
	const results: IngestResult[] = [];
	for (const path of paths) {
		for (const discovery of await discover(path)) {
			if ("outcome" in discovery) results.push(discovery);
			else if ("document" in discovery) results.push(await ingestLedgerDocument(store, discovery));
			else results.push(await ingestCandidate(store, discovery));
		}
	}
	return results;
}

export function formatIngestResult(result: IngestResult): string {
	switch (result.outcome) {
		case "ingested": {
			const kind = result.documentKind === "statement" ? "statement" : "activity export";
			return `ingested  ${result.path}\n          ${result.upiApp} ${kind} ${result.periodStart} to ${result.periodEnd}\n          ledger ${result.ledgerTransactionsBefore} -> ${result.ledgerTransactionsAfter} transactions`;
		}
		case "already_ingested":
			return `skipped   ${result.path}\n          already ingested`;
		case "rejected":
			return `rejected  ${result.path}\n          ${result.reason}`;
	}
}
