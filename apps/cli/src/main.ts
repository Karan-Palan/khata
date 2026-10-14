#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createMcpServer } from "./mcp/server.ts";
import { resolveKhataPaths } from "./paths.ts";
import { formatLedgerStatus, khataVersion, readLedgerStatus } from "./status.ts";
import { openStore } from "./store/store.ts";

const usage = `Usage: khata <command>

Commands:
  status [--json]   Show where the ledger is stored and what it holds
  mcp               Serve the ledger to AI agents over MCP (stdio)
  version           Print the khata version`;

const exitUsage = 64;

function runStatus(json: boolean): void {
	const store = openStore(resolveKhataPaths(process.env).databasePath);
	const status = readLedgerStatus(store);
	store.close();
	console.log(json ? JSON.stringify(status) : formatLedgerStatus(status));
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

function main(argv: readonly string[]): void {
	const { positionals, values } = parseArgs({
		args: [...argv],
		allowPositionals: true,
		options: { json: { type: "boolean", default: false }, version: { type: "boolean", default: false } },
	});
	const [command] = positionals;

	if (values.version || command === "version") {
		console.log(khataVersion);
		return;
	}
	if (command === "status") {
		runStatus(values.json);
		return;
	}
	if (command === "mcp") {
		runMcp();
		return;
	}
	if (command === undefined || command === "help") {
		console.log(usage);
		return;
	}
	console.error(`Unknown command: ${command}\n\n${usage}`);
	process.exit(exitUsage);
}

main(Bun.argv.slice(2));
