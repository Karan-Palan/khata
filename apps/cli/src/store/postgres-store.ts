import type { UpiApp } from "@khata/parsers";
import { SQL } from "bun";
import { deserializeContent, serializeContent } from "./content.ts";
import { postgresMigrations } from "./postgres-migrations.ts";
import { type QueryRows, searchTransactions, summarizeTransactions } from "./queries.ts";
import type { SqlValue } from "./read-only-sql.ts";
import type { DocumentContent, LedgerRow, Store } from "./store.ts";

const migrationLockKey = 7_316_829_041;
const insertBatchSize = 1000;
const readOnlyStatementTimeout = "10s";

export function passwordlessAddress(url: string): string {
	const address = new URL(url);
	address.password = "";
	address.search = "";
	return address.toString();
}

function toSqlValue(value: unknown): SqlValue {
	if (value === null || value === undefined) return null;
	if (typeof value === "string" || typeof value === "number") return value;
	if (typeof value === "bigint") return Number.isSafeInteger(Number(value)) ? Number(value) : String(value);
	if (typeof value === "boolean") return String(value);
	if (value instanceof Date) return value.toISOString();
	if (value instanceof Uint8Array) return `<${value.byteLength} bytes>`;
	return JSON.stringify(value);
}

function ledgerRowColumns(row: LedgerRow) {
	return {
		id: row.id,
		document_id: row.documentId,
		upi_app: row.upiApp,
		occurred_at: row.occurredAt,
		direction: row.direction,
		amount_paise: row.amountPaise,
		counterparty_name: row.counterpartyName,
		counterparty_upi_id: row.counterpartyUpiId,
		upi_reference: row.upiReference,
		app_transaction_id: row.appTransactionId,
		funding_account: row.fundingAccount,
		note: row.note,
		parser_version: row.parserVersion,
	};
}

async function applyPendingMigrations(sql: SQL): Promise<void> {
	await sql.begin(async (transaction) => {
		await transaction`select pg_advisory_xact_lock(${migrationLockKey})`;
		await transaction`create table if not exists khata_schema (version integer primary key)`;
		const [current] = await transaction`select coalesce(max(version), 0) as version from khata_schema`;
		for (const migration of postgresMigrations.filter(({ version }) => version > Number(current?.version ?? 0))) {
			await transaction.unsafe(migration.sql);
			await transaction`insert into khata_schema (version) values (${migration.version})`;
		}
	});
}

export async function openPostgresStore(url: string): Promise<Store> {
	const sql = new SQL(url, { bigint: true });
	await applyPendingMigrations(sql);
	const rows: QueryRows = async ({ text, bindings }) => sql.unsafe(text, [...bindings]);

	return {
		dialect: "postgres",
		address: passwordlessAddress(url),
		status: async () => {
			const [schema] = await sql`select coalesce(max(version), 0) as version from khata_schema`;
			const [counts] = await sql`
				select
					(select count(*) from documents) as "documentCount",
					count(*) as "transactionCount",
					min(occurred_at) as "firstOccurredAt",
					max(occurred_at) as "lastOccurredAt"
				from transactions
			`;
			return {
				schemaVersion: Number(schema?.version ?? 0),
				documentCount: Number(counts?.documentCount ?? 0),
				transactionCount: Number(counts?.transactionCount ?? 0),
				firstOccurredAt: counts?.firstOccurredAt ?? null,
				lastOccurredAt: counts?.lastOccurredAt ?? null,
			};
		},
		hasDocument: async (documentId) => (await sql`select 1 from documents where id = ${documentId}`).length > 0,
		recordDocument: async ({ content, ...document }) => {
			await sql`
				insert into documents (id, upi_app, layout, period_start, period_end, content_kind, content, source, ingested_at)
				values (
					${document.id}, ${document.upiApp}, ${document.layout}, ${document.periodStart}, ${document.periodEnd},
					${content.kind}, ${serializeContent(content)}, ${document.source}, ${new Date().toISOString()}
				)
			`;
		},
		listDocuments: async () => {
			const documents = await sql`
				select id, upi_app, layout, period_start, period_end, content_kind, content, source, ingested_at
				from documents
				order by ingested_at, id
			`;
			return documents.map((document: Record<string, string>) => ({
				id: String(document["id"]),
				upiApp: document["upi_app"] as UpiApp,
				layout: String(document["layout"]),
				periodStart: String(document["period_start"]),
				periodEnd: String(document["period_end"]),
				content: deserializeContent(document["content_kind"] as DocumentContent["kind"], String(document["content"])),
				source: String(document["source"]),
				ingestedAt: String(document["ingested_at"]),
			}));
		},
		replaceTransactions: async (ledgerRows) => {
			await sql.begin(async (transaction) => {
				await transaction`delete from transactions`;
				for (let start = 0; start < ledgerRows.length; start += insertBatchSize) {
					const batch = ledgerRows.slice(start, start + insertBatchSize).map(ledgerRowColumns);
					await transaction`insert into transactions ${transaction(batch)}`;
				}
			});
		},
		hasSyncItem: async (sourceKey, itemKey) =>
			(await sql`select 1 from sync_items where source_key = ${sourceKey} and item_key = ${itemKey}`).length > 0,
		recordSyncItem: async (sourceKey, itemKey, outcome) => {
			await sql`
				insert into sync_items (source_key, item_key, outcome, seen_at)
				values (${sourceKey}, ${itemKey}, ${outcome}, ${new Date().toISOString()})
				on conflict (source_key, item_key) do update set outcome = excluded.outcome, seen_at = excluded.seen_at
			`;
		},
		searchTransactions: (query) => searchTransactions(rows, "postgres", query),
		summarizeTransactions: (query) => summarizeTransactions(rows, "postgres", query),
		runReadOnlySql: async (text, rowLimit) => {
			try {
				const result = await sql.begin(async (transaction) => {
					await transaction.unsafe("set transaction read only");
					await transaction.unsafe(`set local statement_timeout = '${readOnlyStatementTimeout}'`);
					return transaction.unsafe(text, []);
				});
				const records = result as Record<string, unknown>[];
				const columns = Object.keys(records[0] ?? {});
				return {
					kind: "rows",
					columns,
					rows: records.slice(0, rowLimit).map((record) => columns.map((column) => toSqlValue(record[column]))),
					truncated: records.length > rowLimit,
				};
			} catch (error) {
				return { kind: "failed", reason: error instanceof Error ? error.message : String(error) };
			}
		},
		close: async () => sql.close(),
	};
}
