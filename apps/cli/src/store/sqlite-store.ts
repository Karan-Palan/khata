import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { UpiApp } from "@khata/parsers";
import { deserializeContent, serializeContent } from "./content.ts";
import { type Migration, migrations } from "./migrations.ts";
import { type QueryRows, searchTransactions, summarizeTransactions } from "./queries.ts";
import { runReadOnlySql } from "./read-only-sql.ts";
import type { DocumentContent, LedgerRow, Store, StoreStatus } from "./store.ts";

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

export function openSqliteStore(databasePath: string): Store {
	mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
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
	const syncItemExists = database.query<{ found: number }, [string, string]>(
		"select 1 as found from sync_items where source_key = ? and item_key = ?",
	);
	const upsertSyncItem = database.query(`
		insert into sync_items (source_key, item_key, outcome, seen_at) values (?, ?, ?, ?)
		on conflict (source_key, item_key) do update set outcome = excluded.outcome, seen_at = excluded.seen_at
	`);
	const replaceTransactions = database.transaction((rows: readonly LedgerRow[]) => {
		database.run("delete from transactions");
		for (const row of rows) insertTransaction.run(row);
	});
	const rows: QueryRows = async ({ text, bindings }) =>
		database.query<Record<string, unknown>, (string | number)[]>(text).all(...bindings);

	return {
		dialect: "sqlite",
		address: databasePath,
		status: async () => ({
			schemaVersion: readSchemaVersion(database),
			...(statusQuery.get() ?? {
				documentCount: 0,
				transactionCount: 0,
				firstOccurredAt: null,
				lastOccurredAt: null,
			}),
		}),
		hasDocument: async (documentId) => documentExists.get(documentId) !== null,
		recordDocument: async ({ content, ...document }) => {
			insertDocument.run({
				...document,
				contentKind: content.kind,
				content: serializeContent(content),
				ingestedAt: new Date().toISOString(),
			});
		},
		listDocuments: async () =>
			selectDocuments.all().map(({ contentKind, content, ...document }) => ({
				...document,
				content: deserializeContent(contentKind, content),
			})),
		replaceTransactions: async (ledgerRows) => replaceTransactions(ledgerRows),
		hasSyncItem: async (sourceKey, itemKey) => syncItemExists.get(sourceKey, itemKey) !== null,
		recordSyncItem: async (sourceKey, itemKey, outcome) => {
			upsertSyncItem.run(sourceKey, itemKey, outcome, new Date().toISOString());
		},
		searchTransactions: (query) => searchTransactions(rows, "sqlite", query),
		summarizeTransactions: (query) => summarizeTransactions(rows, "sqlite", query),
		runReadOnlySql: async (sql, rowLimit) => runReadOnlySql(databasePath, sql, rowLimit),
		close: async () => database.close(),
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
