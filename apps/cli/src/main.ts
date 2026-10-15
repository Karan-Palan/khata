#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { writeFixture } from "./fixture.ts";
import { formatIngestResult, ingestPaths } from "./ingest.ts";
import { openLedger, type RebuildReport, rebuildLedger } from "./ledger/ledger.ts";
import { createMcpServer } from "./mcp/server.ts";
import { resolveKhataPaths } from "./paths.ts";
import { formatLedgerStatus, khataVersion, readLedgerStatus } from "./status.ts";
import type { Store } from "./store/store.ts";

const usage = `Usage: khata <command>

Commands:
  ingest <path...> [--json]          Add statement PDFs or Google Takeout exports (folders, zips, MyActivity.json)
  status [--json]                    Show where the ledger is stored and what it holds
  reparse [--json]                   Rebuild every transaction from the stored documents with the current parsers
  mcp                                Serve the ledger to AI agents over MCP (stdio)
  fixture <source> <prefix>          Write an anonymized test fixture from a statement PDF [--pages 2]
                                     or a Takeout MyActivity.json [--per-shape 3]
  version                            Print the khata version`;

const exitUsage = 64;
const exitFailure = 1;

type Options = {
	readonly json: boolean;
	readonly pages: string | undefined;
	readonly perShape: string | undefined;
};

function fail(message: string, exitCode: number): never {
	console.error(message);
	process.exit(exitCode);
}

async function withLedger<T>(run: (store: Store) => Promise<T> | T): Promise<T> {
	const store = await openLedger(resolveKhataPaths(process.env).databasePath);
	try {
		return await run(store);
	} finally {
		store.close();
	}
}

function positiveWholeNumber(text: string | undefined, fallback: number, flag: string): number {
	const value = Number(text ?? fallback);
	if (!Number.isInteger(value) || value < 1) fail(`${flag} must be a positive whole number.`, exitUsage);
	return value;
}

function formatRebuildReport(report: RebuildReport): string {
	const lines = [
		`${report.transactionCount} transactions`,
		`  ${report.fromStatements} from statements`,
		`  ${report.fromActivity} from activity exports, outside statement periods`,
		`  ${report.coveredByStatement} activity payments left to the statement covering their dates`,
		`  ${report.notCompleted} activity payments not completed (failed, pending, cancelled, or without a status)`,
	];
	return [...lines, ...report.rejectedDocuments.map(({ source, reason }) => `rejected ${source}: ${reason}`)].join(
		"\n",
	);
}

async function runIngest(paths: readonly string[], { json }: Options): Promise<void> {
	if (paths.length === 0) fail(`Missing path.\n\n${usage}`, exitUsage);
	const results = await withLedger((store) => ingestPaths(store, paths));
	console.log(json ? JSON.stringify(results) : results.map(formatIngestResult).join("\n"));
	if (results.some(({ outcome }) => outcome === "rejected")) process.exit(exitFailure);
}

async function runReparse({ json }: Options): Promise<void> {
	const report = await withLedger(rebuildLedger);
	console.log(json ? JSON.stringify(report) : formatRebuildReport(report));
	if (report.rejectedDocuments.length > 0) process.exit(exitFailure);
}

async function runFixture([sourcePath, outputPrefix]: readonly string[], options: Options): Promise<void> {
	if (sourcePath === undefined || outputPrefix === undefined) fail(`Missing arguments.\n\n${usage}`, exitUsage);
	const sampleSize = sourcePath.toLowerCase().endsWith(".json")
		? positiveWholeNumber(options.perShape, 3, "--per-shape")
		: positiveWholeNumber(options.pages, 2, "--pages");
	const fixture = await writeFixture(sourcePath, outputPrefix, sampleSize);
	if (fixture.kind === "rejected") fail(fixture.reason, exitFailure);
	console.log(
		[...fixture.paths.map((path) => `wrote ${path}`), `${fixture.transactionCount} anonymized transactions`].join("\n"),
	);
}

async function runMcp(): Promise<void> {
	const store = await openLedger(resolveKhataPaths(process.env).databasePath);
	const handle = serveStdio(() => createMcpServer(store));
	const shutDown = async () => {
		await handle.close();
		store.close();
		process.exit(0);
	};
	process.on("SIGINT", shutDown);
	process.on("SIGTERM", shutDown);
}

async function main(argv: readonly string[]): Promise<void> {
	const { positionals, values } = parseArgs({
		args: [...argv],
		allowPositionals: true,
		options: {
			json: { type: "boolean", default: false },
			version: { type: "boolean", default: false },
			pages: { type: "string" },
			"per-shape": { type: "string" },
		},
	});
	const [command, ...operands] = positionals;
	const options: Options = { json: values.json, pages: values.pages, perShape: values["per-shape"] };

	if (values.version || command === "version") return console.log(khataVersion);
	if (command === "status") {
		const status = await withLedger(readLedgerStatus);
		return console.log(options.json ? JSON.stringify(status) : formatLedgerStatus(status));
	}
	if (command === "ingest") return runIngest(operands, options);
	if (command === "reparse") return runReparse(options);
	if (command === "fixture") return runFixture(operands, options);
	if (command === "mcp") return runMcp();
	if (command === undefined || command === "help") return console.log(usage);
	fail(`Unknown command: ${command}\n\n${usage}`, exitUsage);
}

await main(Bun.argv.slice(2));
