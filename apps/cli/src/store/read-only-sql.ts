import { Database } from "bun:sqlite";

export type SqlValue = string | number | null;

export type SqlResult =
	| {
			readonly kind: "rows";
			readonly columns: readonly string[];
			readonly rows: readonly (readonly SqlValue[])[];
			readonly truncated: boolean;
	  }
	| { readonly kind: "failed"; readonly reason: string };

function toSqlValue(value: unknown): SqlValue {
	if (value === null || typeof value === "string" || typeof value === "number") return value;
	if (typeof value === "bigint" || typeof value === "boolean") return String(value);
	return `<${value instanceof Uint8Array ? `${value.byteLength} bytes` : typeof value}>`;
}

export function runReadOnlySql(databasePath: string, sql: string, rowLimit: number): SqlResult {
	const database = new Database(databasePath, { readonly: true });
	try {
		database.run("pragma query_only = on");
		const statement = database.query(sql);
		const columns = statement.columnNames;
		const rows: SqlValue[][] = [];
		let truncated = false;
		for (const row of statement.iterate() as Iterable<Record<string, unknown>>) {
			if (rows.length === rowLimit) {
				truncated = true;
				break;
			}
			rows.push(columns.map((column) => toSqlValue(row[column])));
		}
		return { kind: "rows", columns, rows, truncated };
	} catch (error) {
		return { kind: "failed", reason: error instanceof Error ? error.message : String(error) };
	} finally {
		database.close();
	}
}
