import { parseArgs } from "node:util";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import cliPackage from "../package.json" with { type: "json" };

function exitWithUsage(): never {
	console.error(
		"Usage: KHATA_SERVER_TOKEN=... bun release/server-smoke-test.ts <base URL> [--transactions <expected count>]",
	);
	process.exit(64);
}

const { positionals, values } = parseArgs({
	args: Bun.argv.slice(2),
	allowPositionals: true,
	options: { transactions: { type: "string" } },
});
const baseUrl = positionals[0] ?? exitWithUsage();
const serverToken = process.env["KHATA_SERVER_TOKEN"] ?? exitWithUsage();

async function mcpTransactionCount(): Promise<unknown> {
	const client = new Client({ name: "khata-server-smoke-test", version: cliPackage.version });
	await client.connect(
		new StreamableHTTPClientTransport(new URL("/mcp", baseUrl), {
			requestInit: { headers: { authorization: `Bearer ${serverToken}` } },
		}),
	);
	try {
		const status = await client.callTool({ name: "status", arguments: {} });
		return (status.structuredContent as { transactionCount?: unknown } | undefined)?.transactionCount;
	} finally {
		await client.close();
	}
}

const health = await fetch(new URL("/health", baseUrl));
const healthBody = (await health.json()) as { version?: unknown };
const unauthorized = await fetch(new URL("/mcp", baseUrl), { method: "POST", body: "{}" });
const transactionCount = await mcpTransactionCount();
const checks = [
	{
		name: "health",
		expected: `200 ${cliPackage.version}`,
		actual: `${health.status} ${healthBody.version}`,
	},
	{ name: "MCP without the token", expected: 401, actual: unauthorized.status },
	{
		name: "transactions over MCP",
		expected: values.transactions === undefined ? "a count" : Number(values.transactions),
		actual: values.transactions === undefined && typeof transactionCount === "number" ? "a count" : transactionCount,
	},
];
for (const { name, expected, actual } of checks) {
	console.log(`${actual === expected ? "ok  " : "FAIL"} ${name}: expected ${expected}, got ${actual}`);
}
if (typeof transactionCount === "number") console.log(`     the ledger holds ${transactionCount} transactions`);
if (checks.some(({ expected, actual }) => actual !== expected)) process.exit(1);
