import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStore } from "../src/store/store.ts";

function freshDatabasePath(): string {
	return join(mkdtempSync(join(tmpdir(), "khata-store-")), "nested", "khata.db");
}

describe("openStore", () => {
	test("creates an empty ledger at the latest schema version", () => {
		const store = openStore(freshDatabasePath());
		expect(store.status()).toEqual({ schemaVersion: 1, documentCount: 0, transactionCount: 0 });
		store.close();
	});

	test("reopening an existing ledger keeps its schema and contents", () => {
		const databasePath = freshDatabasePath();
		openStore(databasePath).close();
		const reopened = openStore(databasePath);
		expect(reopened.status()).toEqual({ schemaVersion: 1, documentCount: 0, transactionCount: 0 });
		reopened.close();
	});

	test("runs the ledger in WAL mode so readers never block", () => {
		const databasePath = freshDatabasePath();
		openStore(databasePath).close();
		const database = new Database(databasePath, { readonly: true });
		expect(database.query("pragma journal_mode").get()).toEqual({ journal_mode: "wal" });
		database.close();
	});

	test("rejects a transaction without a positive amount", () => {
		const databasePath = freshDatabasePath();
		openStore(databasePath).close();
		const database = new Database(databasePath);
		database.run(
			"insert into documents values ('d1', 'google_pay', 'statement_pdf', '2026-04-01', '2026-04-30', '[]', 'test', '2026-05-01T00:00:00+05:30')",
		);
		expect(() =>
			database.run(
				"insert into transactions (id, document_id, upi_app, occurred_at, direction, amount_paise, counterparty_name, parser_version) values ('t1', 'd1', 'google_pay', '2026-04-02T10:00:00+05:30', 'sent', 0, 'Someone', '1')",
			),
		).toThrow("CHECK constraint failed");
		database.close();
	});
});
