import { openStore, type Store, type StoredDocument, type StoreLocation } from "../store/store.ts";
import { type ParsedDocument, type ProjectionReport, projectLedger } from "./projection.ts";

export type RejectedDocument = {
	readonly documentId: string;
	readonly source: string;
	readonly reason: string;
};

export type RebuildReport = ProjectionReport & {
	readonly transactionCount: number;
	readonly rejectedDocuments: readonly RejectedDocument[];
};

type DocumentParse = ParsedDocument | { readonly kind: "rejected"; readonly reason: string };

async function parseStoredDocument(document: StoredDocument): Promise<DocumentParse> {
	const { parseStatement, parseGooglePayTakeoutActivity } = await import("@khata/parsers");
	if (document.content.kind === "text_layer") {
		const outcome = parseStatement(document.content.textLayer);
		return outcome.kind === "parsed"
			? { kind: "statement", documentId: document.id, statement: outcome.statement }
			: outcome;
	}
	const outcome = parseGooglePayTakeoutActivity(document.content.entries);
	return outcome.kind === "parsed"
		? { kind: "activity", documentId: document.id, activity: outcome.activity }
		: outcome;
}

export async function rebuildLedger(store: Store): Promise<RebuildReport> {
	const parses = await Promise.all(
		(await store.listDocuments()).map(async (document) => ({ document, parse: await parseStoredDocument(document) })),
	);
	const parsedDocuments = parses.flatMap(({ parse }) => (parse.kind === "rejected" ? [] : [parse]));
	const rejectedDocuments = parses.flatMap(({ document, parse }) =>
		parse.kind === "rejected" ? [{ documentId: document.id, source: document.source, reason: parse.reason }] : [],
	);
	const { rows, report } = projectLedger(parsedDocuments);
	await store.replaceTransactions(rows);
	return { ...report, transactionCount: rows.length, rejectedDocuments };
}

export async function openLedger(location: StoreLocation): Promise<Store> {
	const store = await openStore(location);
	const { documentCount, transactionCount } = await store.status();
	if (documentCount > 0 && transactionCount === 0) await rebuildLedger(store);
	return store;
}
