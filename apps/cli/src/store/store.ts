import type { TakeoutActivityEntry, TextLayer, Transaction, UpiApp } from "@khata/parsers";
import type { SqlDialect, SummaryQuery, SummaryReport, TransactionPage, TransactionQuery } from "./queries.ts";
import type { SqlResult } from "./read-only-sql.ts";
import { openSqliteStore } from "./sqlite-store.ts";

export type StoreStatus = {
	readonly schemaVersion: number;
	readonly documentCount: number;
	readonly transactionCount: number;
	readonly firstOccurredAt: string | null;
	readonly lastOccurredAt: string | null;
};

export type DocumentContent =
	| { readonly kind: "text_layer"; readonly textLayer: TextLayer }
	| { readonly kind: "activity_json"; readonly entries: readonly TakeoutActivityEntry[] };

export type DocumentRecord = {
	readonly id: string;
	readonly upiApp: UpiApp;
	readonly layout: string;
	readonly periodStart: string;
	readonly periodEnd: string;
	readonly content: DocumentContent;
	readonly source: string;
};

export type StoredDocument = DocumentRecord & { readonly ingestedAt: string };

export type LedgerRow = Transaction & {
	readonly id: string;
	readonly documentId: string;
	readonly upiApp: UpiApp;
	readonly parserVersion: string;
};

export type StoreLocation =
	| { readonly kind: "sqlite"; readonly path: string }
	| { readonly kind: "postgres"; readonly url: string };

export type Store = {
	readonly dialect: SqlDialect;
	readonly address: string;
	status(): Promise<StoreStatus>;
	hasDocument(documentId: string): Promise<boolean>;
	recordDocument(document: DocumentRecord): Promise<void>;
	listDocuments(): Promise<readonly StoredDocument[]>;
	replaceTransactions(rows: readonly LedgerRow[]): Promise<void>;
	hasSyncItem(sourceKey: string, itemKey: string): Promise<boolean>;
	recordSyncItem(sourceKey: string, itemKey: string, outcome: string): Promise<void>;
	searchTransactions(query: TransactionQuery): Promise<TransactionPage>;
	summarizeTransactions(query: SummaryQuery): Promise<SummaryReport>;
	runReadOnlySql(sql: string, rowLimit: number): Promise<SqlResult>;
	close(): Promise<void>;
};

export async function openStore(location: StoreLocation): Promise<Store> {
	if (location.kind === "sqlite") return openSqliteStore(location.path);
	const { openPostgresStore } = await import("./postgres-store.ts");
	return openPostgresStore(location.url);
}
