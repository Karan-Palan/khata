import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { Direction, UpiApp } from "@khata/parsers";

export type TransactionFilter = {
	readonly from?: string | undefined;
	readonly to?: string | undefined;
	readonly direction?: Direction | undefined;
	readonly counterparty?: string | undefined;
	readonly minAmountPaise?: number | undefined;
	readonly maxAmountPaise?: number | undefined;
};

export type TransactionQuery = TransactionFilter & {
	readonly limit: number;
	readonly offset: number;
};

export type StoredTransaction = {
	readonly occurredAt: string;
	readonly direction: Direction;
	readonly amountPaise: number;
	readonly counterpartyName: string | null;
	readonly upiReference: string | null;
	readonly fundingAccount: string | null;
	readonly upiApp: UpiApp;
};

export type TransactionPage = {
	readonly transactions: readonly StoredTransaction[];
	readonly totalMatching: number;
	readonly nextOffset: number | null;
};

export type SummaryGrouping = "month" | "counterparty" | "funding_account" | "upi_app";

export type SummaryQuery = TransactionFilter & {
	readonly groupBy: SummaryGrouping;
	readonly limit: number;
};

export type SummaryRow = {
	readonly group: string;
	readonly sentPaise: number;
	readonly sentCount: number;
	readonly receivedPaise: number;
	readonly receivedCount: number;
};

export type SummaryReport = {
	readonly groups: readonly SummaryRow[];
	readonly totals: Omit<SummaryRow, "group">;
	readonly groupCount: number;
};

export const unnamedCounterpartyLabel = "(no counterparty name)";

type GroupingSql = { readonly key: string; readonly label: string };

const groupings: Readonly<Record<SummaryGrouping, GroupingSql>> = {
	month: { key: "substr(occurred_at, 1, 7)", label: "substr(occurred_at, 1, 7)" },
	counterparty: {
		key: "coalesce(lower(trim(counterparty_name)), '')",
		label: `coalesce(counterparty_name, '${unnamedCounterpartyLabel}')`,
	},
	funding_account: { key: "coalesce(funding_account, 'unknown')", label: "coalesce(funding_account, 'unknown')" },
	upi_app: { key: "upi_app", label: "upi_app" },
};

function dayAfter(isoDate: string): string {
	const date = new Date(`${isoDate}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + 1);
	return date.toISOString().slice(0, 10);
}

function whereClause(filter: TransactionFilter): { readonly sql: string; readonly bindings: SQLQueryBindings[] } {
	const conditions: string[] = [];
	const bindings: SQLQueryBindings[] = [];
	const add = (condition: string, binding: SQLQueryBindings) => {
		conditions.push(condition);
		bindings.push(binding);
	};
	if (filter.from !== undefined) add("occurred_at >= ?", filter.from);
	if (filter.to !== undefined) add("occurred_at < ?", dayAfter(filter.to));
	if (filter.direction !== undefined) add("direction = ?", filter.direction);
	if (filter.counterparty !== undefined)
		add("counterparty_name like ? escape '\\'", `%${escapeLike(filter.counterparty)}%`);
	if (filter.minAmountPaise !== undefined) add("amount_paise >= ?", filter.minAmountPaise);
	if (filter.maxAmountPaise !== undefined) add("amount_paise <= ?", filter.maxAmountPaise);
	return { sql: conditions.length === 0 ? "" : `where ${conditions.join(" and ")}`, bindings };
}

function escapeLike(text: string): string {
	return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export function searchTransactions(database: Database, query: TransactionQuery): TransactionPage {
	const where = whereClause(query);
	const transactions = database
		.query<StoredTransaction, SQLQueryBindings[]>(`
			select occurred_at as occurredAt, direction, amount_paise as amountPaise, counterparty_name as counterpartyName,
				upi_reference as upiReference, funding_account as fundingAccount, upi_app as upiApp
			from transactions ${where.sql}
			order by occurred_at desc, id desc
			limit ? offset ?
		`)
		.all(...where.bindings, query.limit, query.offset);
	const totalMatching =
		database
			.query<{ count: number }, SQLQueryBindings[]>(`select count(*) as count from transactions ${where.sql}`)
			.get(...where.bindings)?.count ?? 0;
	const nextOffset = query.offset + transactions.length < totalMatching ? query.offset + transactions.length : null;
	return { transactions, totalMatching, nextOffset };
}

export function summarizeTransactions(database: Database, query: SummaryQuery): SummaryReport {
	const where = whereClause(query);
	const grouping = groupings[query.groupBy];
	const ordering = query.groupBy === "month" ? "grouping_key asc" : "sentPaise desc, receivedPaise desc";
	const aggregates = `
		coalesce(sum(case when direction = 'sent' then amount_paise end), 0) as sentPaise,
		count(case when direction = 'sent' then 1 end) as sentCount,
		coalesce(sum(case when direction = 'received' then amount_paise end), 0) as receivedPaise,
		count(case when direction = 'received' then 1 end) as receivedCount
	`;
	const groups = database
		.query<SummaryRow, SQLQueryBindings[]>(`
			select ${grouping.key} as grouping_key, ${grouping.label} as "group", max(occurred_at) as latest, ${aggregates}
			from transactions ${where.sql}
			group by grouping_key
			order by ${ordering}
			limit ?
		`)
		.all(...where.bindings, query.limit)
		.map(({ group, sentPaise, sentCount, receivedPaise, receivedCount }) => ({
			group,
			sentPaise,
			sentCount,
			receivedPaise,
			receivedCount,
		}));
	const totals = database
		.query<Omit<SummaryRow, "group"> & { groupCount: number }, SQLQueryBindings[]>(`
			select ${aggregates}, count(distinct ${grouping.key}) as groupCount from transactions ${where.sql}
		`)
		.get(...where.bindings) ?? { sentPaise: 0, sentCount: 0, receivedPaise: 0, receivedCount: 0, groupCount: 0 };
	const { groupCount, ...totalAmounts } = totals;
	return { groups, totals: totalAmounts, groupCount };
}
