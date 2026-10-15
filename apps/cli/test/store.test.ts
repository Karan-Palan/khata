import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { openLedger } from "../src/ledger/ledger.ts";
import { migrations } from "../src/store/migrations.ts";
import { openStore } from "../src/store/store.ts";
import { loadStatementFixture } from "./run-khata.ts";

const emptyStatus = {
	schemaVersion: 2,
	documentCount: 0,
	transactionCount: 0,
	firstOccurredAt: null,
	lastOccurredAt: null,
};

function freshDatabasePath(): string {
	return join(mkdtempSync(join(tmpdir(), "khata-store-")), "nested", "khata.db");
}

describe("openStore", () => {
	test("creates an empty ledger at the latest schema version", () => {
		const store = openStore(freshDatabasePath());
		expect(store.status()).toEqual(emptyStatus);
		store.close();
	});

	test("reopening an existing ledger keeps its schema and contents", () => {
		const databasePath = freshDatabasePath();
		openStore(databasePath).close();
		const reopened = openStore(databasePath);
		expect(reopened.status()).toEqual(emptyStatus);
		reopened.close();
	});

	test("runs the ledger in WAL mode so readers never block", () => {
		const databasePath = freshDatabasePath();
		openStore(databasePath).close();
		const database = new Database(databasePath, { readonly: true });
		expect(database.query("pragma journal_mode").get()).toEqual({ journal_mode: "wal" });
		database.close();
	});

	test("keeps a document's content exactly as recorded", async () => {
		const { textLayer, statement } = await loadStatementFixture();
		const store = openStore(freshDatabasePath());
		const document = {
			id: "statement",
			upiApp: statement.upiApp,
			layout: statement.layout,
			periodStart: statement.periodStart,
			periodEnd: statement.periodEnd,
			content: { kind: "text_layer" as const, textLayer },
			source: "fixture",
		};
		store.recordDocument(document);
		expect(store.listDocuments().map(({ ingestedAt: _ingestedAt, ...stored }) => stored)).toEqual([document]);
		store.close();
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

		const store = await openLedger(databasePath);
		expect(store.status()).toEqual({
			schemaVersion: 2,
			documentCount: 1,
			transactionCount: 18,
			firstOccurredAt: "2018-04-01T09:11:00+05:30",
			lastOccurredAt: "2018-04-05T13:07:00+05:30",
		});
		store.close();
	});
});

describe("summarizeTransactions", () => {
	test("groups a counterparty's spellings under the most recent one and keeps unnamed payments apart", async () => {
		const { textLayer, statement } = await loadStatementFixture();
		const store = openStore(freshDatabasePath());
		store.recordDocument({
			id: "statement",
			upiApp: statement.upiApp,
			layout: statement.layout,
			periodStart: statement.periodStart,
			periodEnd: statement.periodEnd,
			content: { kind: "text_layer", textLayer },
			source: "fixture",
		});
		const row = (id: string, counterpartyName: string | null, occurredAt: string, amountPaise: number) => ({
			id,
			documentId: "statement",
			upiApp: "google_pay" as const,
			parserVersion: "test@1",
			occurredAt,
			direction: "sent" as const,
			amountPaise,
			counterpartyName,
			counterpartyUpiId: null,
			upiReference: null,
			appTransactionId: id,
			fundingAccount: null,
			note: null,
		});
		store.replaceTransactions([
			row("a", "corner store", "2026-05-01T10:00:00+05:30", 10000),
			row("b", "CORNER STORE", "2026-05-03T10:00:00+05:30", 20000),
			row("c", null, "2026-05-02T10:00:00+05:30", 5000),
		]);
		expect(store.summarizeTransactions({ groupBy: "counterparty", limit: 10 }).groups).toEqual([
			{ group: "CORNER STORE", sentPaise: 30000, sentCount: 2, receivedPaise: 0, receivedCount: 0 },
			{ group: "(no counterparty name)", sentPaise: 5000, sentCount: 1, receivedPaise: 0, receivedCount: 0 },
		]);
		store.close();
	});
});
