import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { TakeoutActivityEntry, TextLayer, Transaction, UpiApp } from "@khata/parsers";
import { type Migration, migrations } from "./migrations.ts";
import {
	type SummaryQuery,
	type SummaryReport,
	searchTransactions,
	summarizeTransactions,
	type TransactionPage,
	type TransactionQuery,
} from "./queries.ts";

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

export type Store = {
	readonly databasePath: string;
	status(): StoreStatus;
	hasDocument(documentId: string): boolean;
	recordDocument(document: DocumentRecord): void;
	listDocuments(): readonly StoredDocument[];
	replaceTransactions(rows: readonly LedgerRow[]): void;
	searchTransactions(query: TransactionQuery): TransactionPage;
	summarizeTransactions(query: SummaryQuery): SummaryReport;
	close(): void;
};

type DocumentRow = {
	readonly id: string;
	readonly upiApp: UpiApp;
	readonly layout: string;
	readonly periodStart: string;
	readonly periodEnd: string;
	readonly contentKind: DocumentContent["kind"];
	readonly content: string;
	readonly source: string;
	readonly ingestedAt: string;
};

function serializeContent(content: DocumentContent): string {
	return JSON.stringify(content.kind === "text_layer" ? content.textLayer : content.entries);
}

function deserializeContent(kind: DocumentContent["kind"], serialized: string): DocumentContent {
	return kind === "text_layer"
		? { kind, textLayer: JSON.parse(serialized) }
		: { kind, entries: JSON.parse(serialized) };
}

export function openStore(databasePath: string): Store {
	mkdirSync(dirname(databasePath), { recursive: true });
	const database = new Database(databasePath, { create: true, strict: true });
	database.run("pragma journal_mode = wal");
	database.run("pragma synchronous = normal");
	database.run("pragma foreign_keys = on");
	database.run("pragma busy_timeout = 5000");
	applyPendingMigrations(database, migrations);

	const statusQuery = database.query<Omit<StoreStatus, "schemaVersion">, []>(`
		select
			(select count(*) from documents) as documentCount,
			count(*) as transactionCount,
			min(occurred_at) as firstOccurredAt,
			max(occurred_at) as lastOccurredAt
		from transactions
	`);
	const documentExists = database.query<{ found: number }, [string]>("select 1 as found from documents where id = ?");
	const insertDocument = database.query(`
		insert into documents (id, upi_app, layout, period_start, period_end, content_kind, content, source, ingested_at)
		values ($id, $upiApp, $layout, $periodStart, $periodEnd, $contentKind, $content, $source, $ingestedAt)
	`);
	const selectDocuments = database.query<DocumentRow, []>(`
		select id, upi_app as upiApp, layout, period_start as periodStart, period_end as periodEnd,
			content_kind as contentKind, content, source, ingested_at as ingestedAt
		from documents
		order by ingested_at, rowid
	`);
	const insertTransaction = database.query(`
		insert into transactions (
			id, document_id, upi_app, occurred_at, direction, amount_paise, counterparty_name, counterparty_upi_id,
			upi_reference, app_transaction_id, funding_account, note, parser_version
		) values (
			$id, $documentId, $upiApp, $occurredAt, $direction, $amountPaise, $counterpartyName, $counterpartyUpiId,
			$upiReference, $appTransactionId, $fundingAccount, $note, $parserVersion
		)
	`);

	const replaceTransactions = database.transaction((rows: readonly LedgerRow[]) => {
		database.run("delete from transactions");
		for (const row of rows) insertTransaction.run(row);
	});

	return {
		databasePath,
		status: () => ({
			schemaVersion: readSchemaVersion(database),
			...(statusQuery.get() ?? {
				documentCount: 0,
				transactionCount: 0,
				firstOccurredAt: null,
				lastOccurredAt: null,
			}),
		}),
		hasDocument: (documentId) => documentExists.get(documentId) !== null,
		recordDocument: ({ content, ...document }) => {
			insertDocument.run({
				...document,
				contentKind: content.kind,
				content: serializeContent(content),
				ingestedAt: new Date().toISOString(),
			});
		},
		listDocuments: () =>
			selectDocuments.all().map(({ contentKind, content, ...document }) => ({
				...document,
				content: deserializeContent(contentKind, content),
			})),
		replaceTransactions: (rows) => replaceTransactions(rows),
		searchTransactions: (query) => searchTransactions(database, query),
		summarizeTransactions: (query) => summarizeTransactions(database, query),
		close: () => database.close(),
	};
}

function applyPendingMigrations(database: Database, available: readonly Migration[]): void {
	const current = readSchemaVersion(database);
	for (const migration of available.filter(({ version }) => version > current)) {
		database.transaction(() => {
			database.run(migration.sql);
			database.run(`pragma user_version = ${migration.version}`);
		})();
	}
}

function readSchemaVersion(database: Database): number {
	return database.query<{ user_version: number }, []>("pragma user_version").get()?.user_version ?? 0;
}
