#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { writeFixture } from "./fixture.ts";
import { formatIngestResult, ingestPaths } from "./ingest.ts";
import { createMcpServer } from "./mcp/server.ts";
import { resolveKhataPaths } from "./paths.ts";
import { formatLedgerStatus, khataVersion, readLedgerStatus } from "./status.ts";
import { openStore, type Store } from "./store/store.ts";

const usage = `Usage: khata <command>

Commands:
  ingest <path...> [--json]          Add statement PDFs, or folders of them, to the ledger
  status [--json]                    Show where the ledger is stored and what it holds
  mcp                                Serve the ledger to AI agents over MCP (stdio)
  fixture <statement.pdf> <prefix>   Write an anonymized test fixture [--pages 2]
  version                            Print the khata version`;

const exitUsage = 64;
const exitFailure = 1;

type Options = { readonly json: boolean; readonly pages: string | undefined };

function withStore<T>(run: (store: Store) => T): T {
	const store = openStore(resolveKhataPaths(process.env).databasePath);
	try {
		return run(store);
	} finally {
		store.close();
	}
}

function fail(message: string, exitCode: number): never {
	console.error(message);
	process.exit(exitCode);
}

async function runIngest(paths: readonly string[], { json }: Options): Promise<void> {
	if (paths.length === 0) fail(`Missing statement path.\n\n${usage}`, exitUsage);
	const store = openStore(resolveKhataPaths(process.env).databasePath);
	const results = await ingestPaths(store, paths);
	store.close();
	console.log(json ? JSON.stringify(results) : results.map(formatIngestResult).join("\n"));
	if (results.some(({ outcome }) => outcome === "rejected")) process.exit(exitFailure);
}

async function runFixture([statementPath, outputPrefix]: readonly string[], { pages }: Options): Promise<void> {
	if (statementPath === undefined || outputPrefix === undefined) fail(`Missing arguments.\n\n${usage}`, exitUsage);
	const pageLimit = Number(pages ?? "2");
	if (!Number.isInteger(pageLimit) || pageLimit < 1) fail("--pages must be a positive whole number.", exitUsage);
	const fixture = await writeFixture(statementPath, outputPrefix, pageLimit);
	if (fixture.kind === "rejected") fail(fixture.reason, exitFailure);
	console.log(
		`wrote ${fixture.textLayerPath}\nwrote ${fixture.expectedPath}\n${fixture.transactionCount} anonymized transactions`,
	);
}

function runMcp(): void {
	const store = openStore(resolveKhataPaths(process.env).databasePath);
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
		},
	});
	const [command, ...operands] = positionals;
	const options: Options = { json: values.json, pages: values.pages };

	if (values.version || command === "version") return console.log(khataVersion);
	if (command === "status") {
		const status = withStore(readLedgerStatus);
		return console.log(options.json ? JSON.stringify(status) : formatLedgerStatus(status));
	}
	if (command === "ingest") return runIngest(operands, options);
	if (command === "fixture") return runFixture(operands, options);
	if (command === "mcp") return runMcp();
	if (command === undefined || command === "help") return console.log(usage);
	fail(`Unknown command: ${command}\n\n${usage}`, exitUsage);
}

await main(Bun.argv.slice(2));
