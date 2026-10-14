import { formatPaiseAsRupees } from "@khata/parsers";
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import { ingestPaths } from "../ingest.ts";
import { khataVersion, ledgerStatusSchema, readLedgerStatus } from "../status.ts";
import type { SummaryRow, TransactionFilter } from "../store/queries.ts";
import { runReadOnlySql } from "../store/read-only-sql.ts";
import type { Store } from "../store/store.ts";

const sqlRowLimit = 200;

const instructions = `khata is the user's UPI payment ledger, built from statements their UPI apps export.
Amounts are Indian rupees: "amount" is formatted for reading and "amountPaise" is the exact integer value.
Times are India Standard Time (+05:30). "sent" means money left the user; "received" means it arrived.
Prefer summarize_transactions for totals and breakdowns, search_transactions for individual payments, and run_sql only for questions the other tools cannot answer.`;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

const filterShape = {
	from: isoDate.optional().describe("First day to include, YYYY-MM-DD"),
	to: isoDate.optional().describe("Last day to include, YYYY-MM-DD"),
	direction: z.enum(["sent", "received"]).optional(),
	counterparty: z.string().min(1).optional().describe("Case-insensitive part of the counterparty name"),
	minRupees: z.number().nonnegative().optional(),
	maxRupees: z.number().nonnegative().optional(),
};

type FilterInput = {
	from?: string | undefined;
	to?: string | undefined;
	direction?: "sent" | "received" | undefined;
	counterparty?: string | undefined;
	minRupees?: number | undefined;
	maxRupees?: number | undefined;
};

function toFilter({ minRupees, maxRupees, ...rest }: FilterInput): TransactionFilter {
	return {
		...rest,
		minAmountPaise: minRupees === undefined ? undefined : Math.round(minRupees * 100),
		maxAmountPaise: maxRupees === undefined ? undefined : Math.round(maxRupees * 100),
	};
}

const transactionSchema = z.object({
	occurredAt: z.string(),
	direction: z.enum(["sent", "received"]),
	amount: z.string(),
	amountPaise: z.number().int(),
	counterparty: z.string(),
	upiReference: z.string().nullable(),
	fundingAccount: z.string().nullable(),
	upiApp: z.string(),
});

const amountsSchema = z.object({
	sent: z.string(),
	sentPaise: z.number().int(),
	sentCount: z.number().int(),
	received: z.string(),
	receivedPaise: z.number().int(),
	receivedCount: z.number().int(),
});

function withFormattedAmounts({ sentPaise, sentCount, receivedPaise, receivedCount }: Omit<SummaryRow, "group">) {
	return {
		sent: formatPaiseAsRupees(sentPaise),
		sentPaise,
		sentCount,
		received: formatPaiseAsRupees(receivedPaise),
		receivedPaise,
		receivedCount,
	};
}

function result<T extends Record<string, unknown>>(structuredContent: T) {
	return { content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }], structuredContent };
}

function failure(message: string) {
	return { content: [{ type: "text" as const, text: message }], isError: true };
}

export function createMcpServer(store: Store): McpServer {
	const server = new McpServer({ name: "khata", version: khataVersion }, { capabilities: { tools: {} }, instructions });
	const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

	server.registerTool(
		"status",
		{
			title: "Ledger status",
			description:
				"Where the ledger is stored, how many statements and transactions it holds, and the dates it covers.",
			outputSchema: ledgerStatusSchema,
			annotations: readOnly,
		},
		async () => result(readLedgerStatus(store)),
	);

	server.registerTool(
		"search_transactions",
		{
			title: "Search transactions",
			description: "List individual payments, newest first, filtered by date, direction, counterparty, or amount.",
			inputSchema: z.object({
				...filterShape,
				limit: z.number().int().min(1).max(200).default(50),
				cursor: z.string().regex(/^\d+$/).optional().describe("nextCursor from the previous page"),
			}),
			outputSchema: z.object({
				transactions: z.array(transactionSchema),
				totalMatching: z.number().int(),
				nextCursor: z.string().nullable(),
			}),
			annotations: readOnly,
		},
		async ({ limit, cursor, ...filter }) => {
			const page = store.searchTransactions({ ...toFilter(filter), limit, offset: Number(cursor ?? 0) });
			return result({
				transactions: page.transactions.map(({ amountPaise, counterpartyName, ...transaction }) => ({
					...transaction,
					amount: formatPaiseAsRupees(amountPaise),
					amountPaise,
					counterparty: counterpartyName,
				})),
				totalMatching: page.totalMatching,
				nextCursor: page.nextOffset === null ? null : String(page.nextOffset),
			});
		},
	);

	server.registerTool(
		"summarize_transactions",
		{
			title: "Summarize transactions",
			description:
				"Totals of money sent and received, grouped by month, counterparty, funding account, or UPI app, with the same filters as search_transactions.",
			inputSchema: z.object({
				...filterShape,
				groupBy: z.enum(["month", "counterparty", "funding_account", "upi_app"]),
				limit: z.number().int().min(1).max(500).default(50),
			}),
			outputSchema: z.object({
				groups: z.array(amountsSchema.extend({ group: z.string() })),
				totals: amountsSchema,
				groupCount: z.number().int(),
			}),
			annotations: readOnly,
		},
		async ({ groupBy, limit, ...filter }) => {
			const report = store.summarizeTransactions({ ...toFilter(filter), groupBy, limit });
			return result({
				groups: report.groups.map(({ group, ...amounts }) => ({ group, ...withFormattedAmounts(amounts) })),
				totals: withFormattedAmounts(report.totals),
				groupCount: report.groupCount,
			});
		},
	);

	server.registerTool(
		"run_sql",
		{
			title: "Run read-only SQL",
			description: `Run one read-only SQLite query against the ledger and get up to ${sqlRowLimit} rows. Table transactions(id, document_id, upi_app, occurred_at TEXT ISO 8601 +05:30, direction 'sent'|'received', amount_paise INTEGER, counterparty_name, counterparty_upi_id, upi_reference, app_transaction_id, funding_account, note, parser_version). Table documents(id, upi_app, layout, period_start, period_end, source, ingested_at).`,
			inputSchema: z.object({ sql: z.string().min(1) }),
			outputSchema: z.object({
				columns: z.array(z.string()),
				rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
				truncated: z.boolean(),
			}),
			annotations: readOnly,
		},
		async ({ sql }) => {
			const outcome = runReadOnlySql(store.databasePath, sql, sqlRowLimit);
			if (outcome.kind === "failed") return failure(`SQL failed: ${outcome.reason}`);
			return result({
				columns: [...outcome.columns],
				rows: outcome.rows.map((row) => [...row]),
				truncated: outcome.truncated,
			});
		},
	);

	server.registerTool(
		"ingest_statements",
		{
			title: "Ingest statements",
			description:
				"Add UPI app statement PDFs to the ledger. Accepts absolute paths to PDF files or folders. Re-ingesting a statement changes nothing.",
			inputSchema: z.object({ paths: z.array(z.string().min(1)).min(1) }),
			outputSchema: z.object({
				results: z.array(
					z.object({
						path: z.string(),
						outcome: z.enum(["ingested", "already_ingested", "rejected"]),
						upiApp: z.string().optional(),
						periodStart: z.string().optional(),
						periodEnd: z.string().optional(),
						transactionsAdded: z.number().int().optional(),
						transactionsAlreadyKnown: z.number().int().optional(),
						reason: z.string().optional(),
					}),
				),
			}),
			annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		},
		async ({ paths }) => result({ results: await ingestPaths(store, paths) }),
	);

	return server;
}
