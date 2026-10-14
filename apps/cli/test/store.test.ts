import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store/store.ts";
import { loadGooglePayFixture } from "./run-khata.ts";

const emptyStatus = {
	schemaVersion: 1,
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
});

describe("recordStatement", () => {
	test("stores a statement and reports what it covers", async () => {
		const { textLayer, statement } = await loadGooglePayFixture();
		const store = openStore(freshDatabasePath());
		expect(store.recordStatement({ documentId: "first", source: "fixture", textLayer, statement })).toEqual({
			transactionsAdded: 18,
			transactionsAlreadyKnown: 0,
		});
		expect(store.hasDocument("first")).toBe(true);
		expect(store.status()).toEqual({
			schemaVersion: 1,
			documentCount: 1,
			transactionCount: 18,
			firstOccurredAt: "2018-04-01T09:11:00+05:30",
			lastOccurredAt: "2018-04-05T13:07:00+05:30",
		});
		store.close();
	});

	test("groups a counterparty's spellings together under the most recent one", async () => {
		const { textLayer, statement } = await loadGooglePayFixture();
		const store = openStore(freshDatabasePath());
		store.recordStatement({ documentId: "first", source: "fixture", textLayer, statement });
		const respelled = statement.transactions.slice(0, 1).map((transaction) => ({
			...transaction,
			counterpartyName: "COUNTERPARTY 001",
			upiReference: "900000000099",
			occurredAt: "2018-04-06T10:00:00+05:30",
		}));
		store.recordStatement({
			documentId: "second",
			source: "fixture",
			textLayer,
			statement: { ...statement, transactions: respelled },
		});
		expect(
			store.summarizeTransactions({ groupBy: "counterparty", counterparty: "counterparty 001", limit: 10 }).groups,
		).toEqual([{ group: "COUNTERPARTY 001", sentPaise: 17838, sentCount: 2, receivedPaise: 96000, receivedCount: 1 }]);
		store.close();
	});

	test("counts a payment once when two statements contain the same UPI reference", async () => {
		const { textLayer, statement } = await loadGooglePayFixture();
		const store = openStore(freshDatabasePath());
		store.recordStatement({ documentId: "first", source: "fixture", textLayer, statement });
		expect(store.recordStatement({ documentId: "overlapping", source: "fixture", textLayer, statement })).toEqual({
			transactionsAdded: 0,
			transactionsAlreadyKnown: 18,
		});
		expect(store.status().transactionCount).toBe(18);
		store.close();
	});
});
