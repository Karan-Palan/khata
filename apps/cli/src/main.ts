#!/usr/bin/env bun
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import {
	defaultDriveQuery,
	defaultGmailQuery,
	loadConfig,
	saveConfig,
	sourceKey,
	withoutSource,
	withSource,
} from "./config.ts";
import { writeFixture } from "./fixture.ts";
import { authorizeGoogle, keychain, readClientFile } from "./google/oauth.ts";
import { formatIngestResult, ingestPaths } from "./ingest.ts";
import { openLedger, type RebuildReport, rebuildLedger } from "./ledger/ledger.ts";
import { createMcpServer } from "./mcp/server.ts";
import { resolveKhataPaths } from "./paths.ts";
import { disableSchedule, enableSchedule, launchAgentPath, scheduleIsLoaded } from "./schedule.ts";
import { formatLedgerStatus, khataVersion, readLedgerStatus } from "./status.ts";
import type { Store } from "./store/store.ts";
import { formatSyncReports, type SourceSyncReport, syncSources } from "./sync.ts";

process.umask(0o077);

const usage = `Usage: khata <command>

Commands:
  ingest <path...> [--json]          Add statement PDFs or Google Takeout exports (folders, zips, MyActivity.json)
  sync [--json]                      Collect and ingest anything new from every configured source
  sources                            List configured sources
  sources add-folder <path>          Watch a folder, such as Downloads, for statements and Takeout exports
  sources remove <source>            Stop syncing a source
  auth google --client-file <path>   Connect Gmail and Drive (read-only) with your Google OAuth desktop client [--no-open]
  schedule enable [--every-minutes 360] | disable | status
                                     Run sync automatically on this Mac
  status [--json]                    Show where the ledger is stored and what it holds
  reparse [--json]                   Rebuild every transaction from the stored documents with the current parsers
  mcp                                Serve the ledger to AI agents over MCP (stdio)
  fixture <source> <prefix>          Write an anonymized test fixture from a statement PDF [--pages 2]
                                     or a Takeout MyActivity.json [--per-shape 3]
  version                            Print the khata version`;

const exitUsage = 64;
const exitFailure = 1;
const paths = resolveKhataPaths(process.env);
const googleDependencies = { fetch: (input: string, init?: RequestInit) => fetch(input, init), secrets: keychain };

type Options = {
	readonly json: boolean;
	readonly pages: string | undefined;
	readonly perShape: string | undefined;
	readonly clientFile: string | undefined;
	readonly open: boolean;
	readonly everyMinutes: string | undefined;
};

function fail(message: string, exitCode: number): never {
	console.error(message);
	process.exit(exitCode);
}

async function withLedger<T>(run: (store: Store) => Promise<T> | T): Promise<T> {
	const store = await openLedger(paths.databasePath);
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

async function syncNow(store: Store): Promise<SourceSyncReport[]> {
	return syncSources(store, await loadConfig(paths.configPath), googleDependencies);
}

async function runIngest(operands: readonly string[], { json }: Options): Promise<void> {
	if (operands.length === 0) fail(`Missing path.\n\n${usage}`, exitUsage);
	const results = await withLedger((store) => ingestPaths(store, operands));
	console.log(json ? JSON.stringify(results) : results.map(formatIngestResult).join("\n"));
	if (results.some(({ outcome }) => outcome === "rejected")) process.exit(exitFailure);
}

async function runSync({ json }: Options): Promise<void> {
	const reports = await withLedger(syncNow);
	console.log(json ? JSON.stringify(reports) : `${new Date().toISOString()} ${formatSyncReports(reports)}`);
	if (reports.some(({ failure }) => failure !== null)) process.exit(exitFailure);
}

async function runSources([action, argument]: readonly string[]): Promise<void> {
	const config = await loadConfig(paths.configPath);
	if (action === undefined) {
		const lines = config.sources.map((source) => sourceKey(source));
		return console.log(lines.length === 0 ? "No sources configured." : lines.join("\n"));
	}
	if (action === "add-folder" && argument !== undefined) {
		const source = { kind: "folder" as const, path: resolve(argument) };
		await saveConfig(paths.configPath, withSource(config, source));
		return console.log(`Watching ${source.path}`);
	}
	if (action === "remove" && argument !== undefined) {
		await saveConfig(paths.configPath, withoutSource(config, argument));
		return console.log(`Removed ${argument}`);
	}
	fail(`Unknown sources command.\n\n${usage}`, exitUsage);
}

async function runAuth([provider]: readonly string[], { clientFile, open }: Options): Promise<void> {
	if (provider !== "google" || clientFile === undefined)
		fail("Usage: khata auth google --client-file <path>", exitUsage);
	const clientOutcome = await readClientFile(clientFile);
	if (clientOutcome.kind === "failed") fail(clientOutcome.reason, exitFailure);
	const { client } = clientOutcome;
	const authorization = await authorizeGoogle(client, {
		...googleDependencies,
		openUrl: (url) => {
			console.error(`Sign in to Google to connect khata:\n${url}`);
			if (open && process.platform === "darwin") Bun.spawn(["open", url]);
		},
	});
	if (authorization.kind === "failed") fail(authorization.reason, exitFailure);
	const config = await loadConfig(paths.configPath);
	await saveConfig(
		paths.configPath,
		withSource(config, {
			kind: "google",
			account: authorization.account,
			clientId: client.clientId,
			gmailQuery: defaultGmailQuery,
			driveQuery: defaultDriveQuery,
		}),
	);
	console.log(`Connected ${authorization.account}. Gmail and Drive are read-only; the token is in your Keychain.`);
}

async function runSchedule([action]: readonly string[], { everyMinutes }: Options): Promise<void> {
	if (action === "enable") {
		const outcome = await enableSchedule({
			bunPath: process.execPath,
			mainScriptPath: resolve(import.meta.dir, "main.ts"),
			khataHome: paths.home,
			logPath: paths.syncLogPath,
			intervalMinutes: positiveWholeNumber(everyMinutes, 360, "--every-minutes"),
		});
		if (outcome.kind === "failed") fail(outcome.reason, exitFailure);
		return console.log(outcome.message);
	}
	if (action === "disable") {
		const outcome = disableSchedule();
		if (outcome.kind === "failed") fail(outcome.reason, exitFailure);
		return console.log(outcome.message);
	}
	if (action === "status") {
		return console.log(scheduleIsLoaded() ? `Scheduled sync is on (${launchAgentPath()}).` : "Scheduled sync is off.");
	}
	fail(`Unknown schedule command.\n\n${usage}`, exitUsage);
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
	console.log = console.error;
	const store = await openLedger(paths.databasePath);
	const handle = serveStdio(() => createMcpServer(store, { sync: () => syncNow(store) }));
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
			"client-file": { type: "string" },
			"no-open": { type: "boolean", default: false },
			"every-minutes": { type: "string" },
		},
	});
	const [command, ...operands] = positionals;
	const options: Options = {
		json: values.json,
		pages: values.pages,
		perShape: values["per-shape"],
		clientFile: values["client-file"],
		open: !values["no-open"],
		everyMinutes: values["every-minutes"],
	};

	if (values.version || command === "version") return console.log(khataVersion);
	if (command === "status") {
		const status = await withLedger(readLedgerStatus);
		return console.log(options.json ? JSON.stringify(status) : formatLedgerStatus(status));
	}
	if (command === "ingest") return runIngest(operands, options);
	if (command === "sync") return runSync(options);
	if (command === "sources") return runSources(operands);
	if (command === "auth") return runAuth(operands, options);
	if (command === "schedule") return runSchedule(operands, options);
	if (command === "reparse") return runReparse(options);
	if (command === "fixture") return runFixture(operands, options);
	if (command === "mcp") return runMcp();
	if (command === undefined || command === "help") return console.log(usage);
	fail(`Unknown command: ${command}\n\n${usage}`, exitUsage);
}

await main(Bun.argv.slice(2));
