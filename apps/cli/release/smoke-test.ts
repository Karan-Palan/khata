import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import cliPackage from "../package.json" with { type: "json" };

const fixtureTransactionCount = 15;
const activityFixturePath = join(
	import.meta.dir,
	"..",
	"..",
	"..",
	"packages",
	"parsers",
	"test",
	"fixtures",
	"google-pay",
	"takeout-activity.activity.json",
);

function exitWithUsage(): never {
	console.error("Usage: bun release/smoke-test.ts <installed khata/bin/khata.js>");
	process.exit(64);
}

const launcherPath = Bun.argv[2] ?? exitWithUsage();

const khataHome = mkdtempSync(join(tmpdir(), "khata-smoke-"));
const environment = Object.fromEntries(
	Object.entries({ ...process.env, KHATA_HOME: khataHome }).filter(
		(entry): entry is [string, string] => entry[1] !== undefined,
	),
);

function runKhata(...args: string[]): { exitCode: number; stdout: string } {
	const launched = Bun.spawnSync(["node", launcherPath, ...args], { env: environment, stderr: "inherit" });
	return { exitCode: launched.exitCode, stdout: launched.stdout.toString().trim() };
}

async function mcpTransactionCount(): Promise<unknown> {
	const client = new Client({ name: "khata-smoke-test", version: cliPackage.version });
	await client.connect(new StdioClientTransport({ command: "node", args: [launcherPath, "mcp"], env: environment }));
	try {
		const status = await client.callTool({ name: "status", arguments: {} });
		return (status.structuredContent as { transactionCount?: unknown } | undefined)?.transactionCount;
	} finally {
		await client.close();
	}
}

const version = runKhata("version");
const ingest = runKhata("ingest", activityFixturePath);
const checks = [
	{ name: "version", expected: cliPackage.version, actual: version.stdout },
	{ name: "ingest exit code", expected: 0, actual: ingest.exitCode },
	{ name: "transactions over MCP", expected: fixtureTransactionCount, actual: await mcpTransactionCount() },
];
for (const { name, expected, actual } of checks) {
	console.log(`${actual === expected ? "ok  " : "FAIL"} ${name}: expected ${expected}, got ${actual}`);
}
if (checks.some(({ expected, actual }) => actual !== expected)) process.exit(1);
