import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { type Migration, migrations } from "./migrations.ts";

export type StoreStatus = {
	readonly schemaVersion: number;
	readonly documentCount: number;
	readonly transactionCount: number;
};

export type Store = {
	readonly databasePath: string;
	status(): StoreStatus;
	close(): void;
};

export function openStore(databasePath: string): Store {
	mkdirSync(dirname(databasePath), { recursive: true });
	const database = new Database(databasePath, { create: true, strict: true });
	database.run("pragma journal_mode = wal");
	database.run("pragma synchronous = normal");
	database.run("pragma foreign_keys = on");
	database.run("pragma busy_timeout = 5000");
	applyPendingMigrations(database, migrations);

	const countDocuments = database.query<{ count: number }, []>("select count(*) as count from documents");
	const countTransactions = database.query<{ count: number }, []>("select count(*) as count from transactions");

	return {
		databasePath,
		status: () => ({
			schemaVersion: readSchemaVersion(database),
			documentCount: countDocuments.get()?.count ?? 0,
			transactionCount: countTransactions.get()?.count ?? 0,
		}),
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
