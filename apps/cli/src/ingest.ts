import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { TextLayer } from "@khata/parsers";
import type { Store } from "./store/store.ts";

export type IngestResult =
	| {
			readonly path: string;
			readonly outcome: "ingested";
			readonly upiApp: string;
			readonly periodStart: string;
			readonly periodEnd: string;
			readonly transactionsAdded: number;
			readonly transactionsAlreadyKnown: number;
	  }
	| { readonly path: string; readonly outcome: "already_ingested" }
	| { readonly path: string; readonly outcome: "rejected"; readonly reason: string };

async function statementFilesUnder(path: string): Promise<string[]> {
	const absolutePath = resolve(path);
	const details = await stat(absolutePath).catch(() => null);
	if (details === null) return [absolutePath];
	if (!details.isDirectory()) return [absolutePath];
	const entries = await readdir(absolutePath, { recursive: true });
	return entries
		.filter((entry) => entry.toLowerCase().endsWith(".pdf"))
		.map((entry) => join(absolutePath, entry))
		.toSorted();
}

export async function ingestStatementFile(store: Store, path: string): Promise<IngestResult> {
	const file = Bun.file(path);
	if (!(await file.exists())) return { path, outcome: "rejected", reason: "File not found." };
	const bytes = new Uint8Array(await file.arrayBuffer());
	const documentId = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
	if (store.hasDocument(documentId)) return { path, outcome: "already_ingested" };

	const { extractTextLayer, parseStatement } = await import("@khata/parsers");
	let textLayer: TextLayer;
	try {
		textLayer = await extractTextLayer(bytes);
	} catch (error) {
		return { path, outcome: "rejected", reason: `Unreadable PDF: ${error instanceof Error ? error.message : error}` };
	}
	const parsed = parseStatement(textLayer);
	if (parsed.kind === "rejected") return { path, outcome: "rejected", reason: parsed.reason };

	const { statement } = parsed;
	const recorded = store.recordStatement({ documentId, source: path, textLayer, statement });
	return {
		path,
		outcome: "ingested",
		upiApp: statement.upiApp,
		periodStart: statement.periodStart,
		periodEnd: statement.periodEnd,
		...recorded,
	};
}

export async function ingestPaths(store: Store, paths: readonly string[]): Promise<IngestResult[]> {
	const results: IngestResult[] = [];
	for (const path of paths) {
		for (const file of await statementFilesUnder(path)) results.push(await ingestStatementFile(store, file));
	}
	return results;
}

export function formatIngestResult(result: IngestResult): string {
	switch (result.outcome) {
		case "ingested":
			return `ingested  ${result.path}\n          ${result.upiApp} ${result.periodStart} to ${result.periodEnd}: ${result.transactionsAdded} new, ${result.transactionsAlreadyKnown} already known`;
		case "already_ingested":
			return `skipped   ${result.path}\n          already ingested`;
		case "rejected":
			return `rejected  ${result.path}\n          ${result.reason}`;
	}
}
