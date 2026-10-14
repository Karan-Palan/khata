import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Statement, TextLayer, Transaction, UpiApp } from "@khata/parsers";
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

export type StatementRecord = {
	readonly documentId: string;
	readonly source: string;
	readonly textLayer: TextLayer;
	readonly statement: Statement;
};

export type RecordedStatement = {
	readonly transactionsAdded: number;
	readonly transactionsAlreadyKnown: number;
};

export type Store = {
	readonly databasePath: string;
	status(): StoreStatus;
	hasDocument(documentId: string): boolean;
	recordStatement(record: StatementRecord): RecordedStatement;
	searchTransactions(query: TransactionQuery): TransactionPage;
	summarizeTransactions(query: SummaryQuery): SummaryReport;
	close(): void;
};

export function transactionIdentity(upiApp: UpiApp, transaction: Transaction): string {
	if (transaction.upiReference !== null) return `upi:${transaction.upiReference}`;
	if (transaction.appTransactionId !== null) return `app:${upiApp}:${transaction.appTransactionId}`;
	const fingerprint = [
		upiApp,
		transaction.occurredAt,
		transaction.direction,
		transaction.amountPaise,
		transaction.counterpartyName,
	].join("|");
	return `content:${new Bun.CryptoHasher("sha256").update(fingerprint).digest("hex")}`;
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
		insert into documents (id, upi_app, layout, period_start, period_end, text_layer, source, ingested_at)
		values ($id, $upiApp, $layout, $periodStart, $periodEnd, $textLayer, $source, $ingestedAt)
	`);
	const insertTransaction = database.query(`
		insert or ignore into transactions (
			id, document_id, upi_app, occurred_at, direction, amount_paise, counterparty_name, counterparty_upi_id,
			upi_reference, app_transaction_id, funding_account, note, parser_version
		) values (
			$id, $documentId, $upiApp, $occurredAt, $direction, $amountPaise, $counterpartyName, $counterpartyUpiId,
			$upiReference, $appTransactionId, $fundingAccount, $note, $parserVersion
		)
	`);

	const recordStatement = database.transaction(({ documentId, source, textLayer, statement }: StatementRecord) => {
		insertDocument.run({
			id: documentId,
			upiApp: statement.upiApp,
			layout: statement.layout,
			periodStart: statement.periodStart,
			periodEnd: statement.periodEnd,
			textLayer: JSON.stringify(textLayer),
			source,
			ingestedAt: new Date().toISOString(),
		});
		let transactionsAdded = 0;
		for (const transaction of statement.transactions) {
			const { changes } = insertTransaction.run({
				id: transactionIdentity(statement.upiApp, transaction),
				documentId,
				upiApp: statement.upiApp,
				parserVersion: statement.parserVersion,
				...transaction,
			});
			transactionsAdded += changes;
		}
		return { transactionsAdded, transactionsAlreadyKnown: statement.transactions.length - transactionsAdded };
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
		recordStatement: (record) => recordStatement(record),
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
