import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openLedger } from "../src/ledger/ledger.ts";
import { migrations } from "../src/store/migrations.ts";
import { type DocumentRecord, type LedgerRow, openStore, type StoreLocation } from "../src/store/store.ts";
import { freshPostgresUrl, testPostgresUrl } from "./postgres.ts";
import { loadStatementFixture } from "./run-khata.ts";

const emptyStatus = {
	schemaVersion: 3,
	documentCount: 0,
	transactionCount: 0,
	firstOccurredAt: null,
	lastOccurredAt: null,
};

function freshDatabasePath(): string {
	return join(mkdtempSync(join(tmpdir(), "khata-store-")), "nested", "khata.db");
}

function postgresDialect(baseUrl: string) {
	return {
		name: "Postgres",
		freshLocation: async (): Promise<StoreLocation> => ({ kind: "postgres", url: await freshPostgresUrl(baseUrl) }),
	};
}

const dialects: { readonly name: string; readonly freshLocation: () => Promise<StoreLocation> }[] = [
	{ name: "SQLite", freshLocation: async () => ({ kind: "sqlite", path: freshDatabasePath() }) },
	...(testPostgresUrl === undefined ? [] : [postgresDialect(testPostgresUrl)]),
];

async function statementDocument(): Promise<DocumentRecord> {
	const { textLayer, statement } = await loadStatementFixture();
	return {
		id: "statement",
		upiApp: statement.upiApp,
		layout: statement.layout,
		periodStart: statement.periodStart,
		periodEnd: statement.periodEnd,
		content: { kind: "text_layer", textLayer },
		source: "fixture",
	};
}

function sentRow(id: string, counterpartyName: string | null, occurredAt: string, amountPaise: number): LedgerRow {
	return {
		id,
		documentId: "statement",
		upiApp: "google_pay",
		parserVersion: "test@1",
		occurredAt,
		direction: "sent",
		amountPaise,
		counterpartyName,
		counterpartyUpiId: null,
		upiReference: null,
		appTransactionId: id,
		fundingAccount: null,
		note: null,
	};
}

describe.each(dialects)("$name store", ({ freshLocation }) => {
	test("creates an empty ledger at the latest schema version, and reopening keeps it", async () => {
		const location = await freshLocation();
		const store = await openStore(location);
		expect(await store.status()).toEqual(emptyStatus);
		await store.close();
		const reopened = await openStore(location);
		expect(await reopened.status()).toEqual(emptyStatus);
		await reopened.close();
	});

	test("keeps a document's content exactly as recorded", async () => {
		const document = await statementDocument();
		const store = await openStore(await freshLocation());
		await store.recordDocument(document);
		expect([await store.hasDocument("statement"), await store.hasDocument("other")]).toEqual([true, false]);
		expect((await store.listDocuments()).map(({ ingestedAt: _ingestedAt, ...stored }) => stored)).toEqual([document]);
		await store.close();
	});

	test("groups a counterparty's spellings under the most recent one and keeps unnamed payments apart", async () => {
		const store = await openStore(await freshLocation());
		await store.recordDocument(await statementDocument());
		await store.replaceTransactions([
			sentRow("a", "corner store", "2026-05-01T10:00:00+05:30", 10000),
			sentRow("b", "CORNER STORE", "2026-05-03T10:00:00+05:30", 20000),
			sentRow("c", null, "2026-05-02T10:00:00+05:30", 5000),
		]);
		expect(await store.summarizeTransactions({ groupBy: "counterparty", limit: 10 })).toEqual({
			groups: [
				{ group: "CORNER STORE", sentPaise: 30000, sentCount: 2, receivedPaise: 0, receivedCount: 0 },
				{ group: "(no counterparty name)", sentPaise: 5000, sentCount: 1, receivedPaise: 0, receivedCount: 0 },
			],
			totals: { sentPaise: 35000, sentCount: 3, receivedPaise: 0, receivedCount: 0 },
			groupCount: 2,
		});
		await store.close();
	});

	test("finds payments by any case of the counterparty and by date, newest first, a page at a time", async () => {
		const store = await openStore(await freshLocation());
		await store.recordDocument(await statementDocument());
		await store.replaceTransactions([
			sentRow("a", "Corner Store", "2026-05-01T10:00:00+05:30", 10000),
			sentRow("b", "corner store", "2026-05-03T10:00:00+05:30", 20000),
			sentRow("c", "Bakery", "2026-05-02T10:00:00+05:30", 5000),
			sentRow("d", "CORNER STORE", "2026-06-01T10:00:00+05:30", 7000),
		]);
		const page = await store.searchTransactions({
			counterparty: "corner",
			from: "2026-05-01",
			to: "2026-05-31",
			limit: 1,
			offset: 0,
		});
		expect(page).toEqual({
			transactions: [
				{
					occurredAt: "2026-05-03T10:00:00+05:30",
					direction: "sent",
					amountPaise: 20000,
					counterpartyName: "corner store",
					upiReference: null,
					fundingAccount: null,
					upiApp: "google_pay",
				},
			],
			totalMatching: 2,
			nextOffset: 1,
		});
		await store.close();
	});

	test("answers read-only SQL and never writes, even through a second statement", async () => {
		const store = await openStore(await freshLocation());
		await store.recordDocument(await statementDocument());
		await store.replaceTransactions([sentRow("a", "Bakery", "2026-05-02T10:00:00+05:30", 5000)]);
		expect(
			await store.runReadOnlySql("select counterparty_name, amount_paise from transactions order by id", 10),
		).toEqual({
			kind: "rows",
			columns: ["counterparty_name", "amount_paise"],
			rows: [["Bakery", 5000]],
			truncated: false,
		});
		expect((await store.runReadOnlySql("delete from transactions", 10)).kind).toBe("failed");
		await store.runReadOnlySql("select 1; delete from transactions", 10);
		expect((await store.status()).transactionCount).toBe(1);
		await store.close();
	});
});

describe("SQLite store", () => {
	test("runs the ledger in WAL mode so readers never block", async () => {
		const databasePath = freshDatabasePath();
		await (await openStore({ kind: "sqlite", path: databasePath })).close();
		const database = new Database(databasePath, { readonly: true });
		expect(database.query("pragma journal_mode").get()).toEqual({ journal_mode: "wal" });
		database.close();
	});
});

describe("openLedger", () => {
	test("upgrades a schema 1 ledger and rebuilds its transactions from the stored statement", async () => {
		const databasePath = freshDatabasePath();
		mkdirSync(dirname(databasePath), { recursive: true });
		const { textLayer } = await loadStatementFixture();
		const legacy = new Database(databasePath, { create: true });
		legacy.run(migrations[0]?.sql ?? "");
		legacy.run("pragma user_version = 1");
		legacy
			.query(
				"insert into documents (id, upi_app, layout, period_start, period_end, text_layer, source, ingested_at) values (?, 'google_pay', 'statement_pdf', '2018-04-01', '2018-09-30', ?, 'fixture', '2026-10-14T00:00:00.000Z')",
			)
			.run("legacy-statement", JSON.stringify(textLayer));
		legacy.close();

		const store = await openLedger({ kind: "sqlite", path: databasePath });
		expect(await store.status()).toEqual({
			schemaVersion: 3,
			documentCount: 1,
			transactionCount: 18,
			firstOccurredAt: "2018-04-01T09:11:00+05:30",
			lastOccurredAt: "2018-04-05T13:07:00+05:30",
		});
		await store.close();
	});
});
