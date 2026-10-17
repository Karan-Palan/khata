import type { Direction, UpiApp } from "@khata/parsers";

export type SqlDialect = "sqlite" | "postgres";

export type SqlBinding = string | number;

export type SqlStatement = { readonly text: string; readonly bindings: readonly SqlBinding[] };

export type QueryRows = (statement: SqlStatement) => Promise<readonly Record<string, unknown>[]>;

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

const counterpartyLabel = `coalesce(counterparty_name, '${unnamedCounterpartyLabel}')`;

function groupingSql(groupBy: SummaryGrouping, dialect: SqlDialect): { readonly key: string; readonly label: string } {
	switch (groupBy) {
		case "month":
			return { key: "substr(occurred_at, 1, 7)", label: "substr(occurred_at, 1, 7)" };
		case "counterparty":
			return {
				key: "coalesce(lower(trim(counterparty_name)), '')",
				label:
					dialect === "sqlite"
						? counterpartyLabel
						: `(array_agg(${counterpartyLabel} order by occurred_at desc, id desc))[1]`,
			};
		case "funding_account":
			return { key: "coalesce(funding_account, 'unknown')", label: "coalesce(funding_account, 'unknown')" };
		case "upi_app":
			return { key: "upi_app", label: "upi_app" };
	}
}

const latestRowForSqliteLabels = "max(occurred_at) as latest,";

const aggregates = `
	cast(coalesce(sum(case when direction = 'sent' then amount_paise end), 0) as bigint) as "sentPaise",
	count(case when direction = 'sent' then 1 end) as "sentCount",
	cast(coalesce(sum(case when direction = 'received' then amount_paise end), 0) as bigint) as "receivedPaise",
	count(case when direction = 'received' then 1 end) as "receivedCount"
`;

class StatementBuilder {
	readonly #dialect: SqlDialect;
	readonly #bindings: SqlBinding[] = [];

	constructor(dialect: SqlDialect) {
		this.#dialect = dialect;
	}

	get caseInsensitiveLike(): string {
		return this.#dialect === "sqlite" ? "like" : "ilike";
	}

	bind(value: SqlBinding): string {
		this.#bindings.push(value);
		return this.#dialect === "sqlite" ? "?" : `$${this.#bindings.length}`;
	}

	build(text: string): SqlStatement {
		return { text, bindings: [...this.#bindings] };
	}
}

function dayAfter(isoDate: string): string {
	const date = new Date(`${isoDate}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + 1);
	return date.toISOString().slice(0, 10);
}

function escapeLike(text: string): string {
	return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function whereClause(filter: TransactionFilter, statement: StatementBuilder): string {
	const conditions: string[] = [];
	if (filter.from !== undefined) conditions.push(`occurred_at >= ${statement.bind(filter.from)}`);
	if (filter.to !== undefined) conditions.push(`occurred_at < ${statement.bind(dayAfter(filter.to))}`);
	if (filter.direction !== undefined) conditions.push(`direction = ${statement.bind(filter.direction)}`);
	if (filter.counterparty !== undefined) {
		conditions.push(
			`counterparty_name ${statement.caseInsensitiveLike} ${statement.bind(`%${escapeLike(filter.counterparty)}%`)} escape '\\'`,
		);
	}
	if (filter.minAmountPaise !== undefined) conditions.push(`amount_paise >= ${statement.bind(filter.minAmountPaise)}`);
	if (filter.maxAmountPaise !== undefined) conditions.push(`amount_paise <= ${statement.bind(filter.maxAmountPaise)}`);
	return conditions.length === 0 ? "" : `where ${conditions.join(" and ")}`;
}

function textOrNull(value: unknown): string | null {
	return value === null || value === undefined ? null : String(value);
}

function amounts(row: Record<string, unknown>): Omit<SummaryRow, "group"> {
	return {
		sentPaise: Number(row["sentPaise"] ?? 0),
		sentCount: Number(row["sentCount"] ?? 0),
		receivedPaise: Number(row["receivedPaise"] ?? 0),
		receivedCount: Number(row["receivedCount"] ?? 0),
	};
}

export async function searchTransactions(
	rows: QueryRows,
	dialect: SqlDialect,
	query: TransactionQuery,
): Promise<TransactionPage> {
	const page = new StatementBuilder(dialect);
	const pageWhere = whereClause(query, page);
	const pageRows = await rows(
		page.build(`
			select occurred_at as "occurredAt", direction, amount_paise as "amountPaise",
				counterparty_name as "counterpartyName", upi_reference as "upiReference",
				funding_account as "fundingAccount", upi_app as "upiApp"
			from transactions ${pageWhere}
			order by occurred_at desc, id desc
			limit ${page.bind(query.limit)} offset ${page.bind(query.offset)}
		`),
	);
	const count = new StatementBuilder(dialect);
	const countWhere = whereClause(query, count);
	const [counted] = await rows(count.build(`select count(*) as "count" from transactions ${countWhere}`));
	const totalMatching = Number(counted?.["count"] ?? 0);
	const transactions = pageRows.map((row) => ({
		occurredAt: String(row["occurredAt"]),
		direction: row["direction"] as Direction,
		amountPaise: Number(row["amountPaise"]),
		counterpartyName: textOrNull(row["counterpartyName"]),
		upiReference: textOrNull(row["upiReference"]),
		fundingAccount: textOrNull(row["fundingAccount"]),
		upiApp: row["upiApp"] as UpiApp,
	}));
	const nextOffset = query.offset + transactions.length < totalMatching ? query.offset + transactions.length : null;
	return { transactions, totalMatching, nextOffset };
}

export async function summarizeTransactions(
	rows: QueryRows,
	dialect: SqlDialect,
	query: SummaryQuery,
): Promise<SummaryReport> {
	const grouping = groupingSql(query.groupBy, dialect);
	const ordering = query.groupBy === "month" ? "grouping_key asc" : `"sentPaise" desc, "receivedPaise" desc`;
	const groups = new StatementBuilder(dialect);
	const groupsWhere = whereClause(query, groups);
	const groupRows = await rows(
		groups.build(`
			select ${grouping.key} as grouping_key, ${grouping.label} as "group",
				${dialect === "sqlite" ? latestRowForSqliteLabels : ""} ${aggregates}
			from transactions ${groupsWhere}
			group by grouping_key
			order by ${ordering}
			limit ${groups.bind(query.limit)}
		`),
	);
	const totals = new StatementBuilder(dialect);
	const totalsWhere = whereClause(query, totals);
	const [totalsRow] = await rows(
		totals.build(
			`select ${aggregates}, count(distinct ${grouping.key}) as "groupCount" from transactions ${totalsWhere}`,
		),
	);
	return {
		groups: groupRows.map((row) => ({ group: String(row["group"]), ...amounts(row) })),
		totals: totalsRow === undefined ? amounts({}) : amounts(totalsRow),
		groupCount: Number(totalsRow?.["groupCount"] ?? 0),
	};
}
