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
import { authorizeGoogle, keychain, readClientFile, storedClient } from "./google/oauth.ts";
import { formatIngestResult, ingestPaths } from "./ingest.ts";
import { openLedger, type RebuildReport, rebuildLedger } from "./ledger/ledger.ts";
import { createMcpServer } from "./mcp/server.ts";
import { resolveKhataPaths } from "./paths.ts";
import {
	disableSchedule,
	enableSchedule,
	installBinary,
	launchAgentPath,
	runningAsCompiledBinary,
	scheduleIsLoaded,
} from "./schedule.ts";
import { createKhataServer, minimumServerTokenLength } from "./server.ts";
import { formatLedgerStatus, khataVersion, readLedgerStatus } from "./status.ts";
import type { Store, StoreLocation } from "./store/store.ts";
import { formatSyncReports, type SourceSyncReport, syncSources } from "./sync.ts";

process.umask(0o077);

const usage = `Usage: khata <command>

Commands:
  ingest <path...> [--json]          Add statement PDFs, Google Takeout exports (folders, zips, MyActivity.json),
                                     or every document of another khata ledger (.db)
  sync [--json]                      Collect and ingest anything new from every configured source
  sources                            List configured sources
  sources add-folder <path>          Watch a folder, such as Downloads, for statements and Takeout exports
  sources remove <source>            Stop syncing a source
  auth google [--client-file <path>] Connect Gmail and Drive (read-only); the client file is needed only the first time [--no-open]
  schedule enable [--every-minutes 360] | disable | status
                                     Run sync automatically on this Mac
  status [--json]                    Show where the ledger is stored and what it holds
  database                           Show which database holds the ledger
  database connect                   Keep the ledger in Postgres; reads the connection URL from stdin
  database disconnect                Go back to the SQLite ledger in KHATA_HOME
  reparse [--json]                   Rebuild every transaction from the stored documents with the current parsers
  mcp                                Serve the ledger to AI agents over MCP (stdio)
  serve                              Serve read-only MCP over HTTP on $PORT (default 8080), behind KHATA_SERVER_TOKEN
  server token [--rotate]            Create the server's bearer token in your Keychain
  server secrets | fly secrets import
                                     Send the token and the Postgres URL to a hosted server
  server header                      Print the Authorization header, for agents that run a headers helper
  fixture <source> <prefix>          Write an anonymized test fixture from a statement PDF [--pages 2]
                                     or a Takeout MyActivity.json [--per-shape 3]
  version                            Print the khata version`;

const exitUsage = 64;
const exitFailure = 1;
const paths = resolveKhataPaths(process.env);
const googleDependencies = { fetch: (input: string, init?: RequestInit) => fetch(input, init), secrets: keychain };
const databaseUrlSecretName = "postgres:database-url";
const serverTokenSecretName = "server:token";

type Options = {
	readonly json: boolean;
	readonly pages: string | undefined;
	readonly perShape: string | undefined;
	readonly clientFile: string | undefined;
	readonly open: boolean;
	readonly everyMinutes: string | undefined;
	readonly rotate: boolean;
};

function fail(message: string, exitCode: number): never {
	console.error(message);
	process.exit(exitCode);
}

async function storeLocation(): Promise<StoreLocation> {
	const fromEnvironment = process.env["KHATA_DATABASE_URL"];
	if (fromEnvironment !== undefined && fromEnvironment !== "") return { kind: "postgres", url: fromEnvironment };
	const { database } = await loadConfig(paths.configPath);
	if (database === undefined) return { kind: "sqlite", path: paths.databasePath };
	const url = await keychain.get(databaseUrlSecretName);
	if (url === null)
		fail(
			`khata keeps the ledger in ${database.address}, but its connection URL is missing from the keychain. Run khata database connect again.`,
			exitFailure,
		);
	return { kind: "postgres", url };
}

async function withLedger<T>(run: (store: Store) => Promise<T> | T): Promise<T> {
	const store = await openLedger(await storeLocation());
	try {
		return await run(store);
	} finally {
		await store.close();
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
	if (provider !== "google") fail("Usage: khata auth google [--client-file <path>]", exitUsage);
	const existing = (await loadConfig(paths.configPath)).sources.find((source) => source.kind === "google");
	if (clientFile === undefined && existing === undefined)
		fail("The first sign-in needs --client-file <path>.", exitUsage);
	const clientOutcome =
		clientFile === undefined && existing?.kind === "google"
			? await storedClient(existing.clientId, keychain)
			: await readClientFile(clientFile ?? "");
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
			gmailQuery: defaultGmailQuery,
			driveQuery: defaultDriveQuery,
			...(existing?.kind === "google" && existing.account === authorization.account ? existing : {}),
			kind: "google",
			account: authorization.account,
			clientId: client.clientId,
		}),
	);
	console.log(`Connected ${authorization.account}. Gmail and Drive are read-only; the token is in your Keychain.`);
}

async function runSchedule([action]: readonly string[], { everyMinutes }: Options): Promise<void> {
	if (action === "enable") {
		const outcome = await enableSchedule({
			khataCommand: runningAsCompiledBinary()
				? [await installBinary(process.execPath, paths.home)]
				: [process.execPath, resolve(import.meta.dir, "main.ts")],
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

async function runDatabase([action]: readonly string[]): Promise<void> {
	if (action === undefined) {
		const location = await storeLocation();
		return console.log(
			location.kind === "sqlite"
				? location.path
				: (await import("./store/postgres-store.ts")).passwordlessAddress(location.url),
		);
	}
	const config = await loadConfig(paths.configPath);
	if (action === "connect") {
		const url = (await Bun.stdin.text()).trim();
		if (!/^postgres(ql)?:\/\//.test(url))
			fail(
				"Pipe a postgres:// connection URL into khata database connect, for example from your password manager.",
				exitUsage,
			);
		const store = await openLedger({ kind: "postgres", url });
		const { documentCount } = await store.status();
		await store.close();
		await keychain.set(databaseUrlSecretName, url);
		await saveConfig(paths.configPath, { ...config, database: { kind: "postgres", address: store.address } });
		return console.log(
			`khata now keeps the ledger in ${store.address}, which holds ${documentCount} documents. The connection URL is in your Keychain. Copy a local ledger into it with khata ingest ${paths.databasePath}.`,
		);
	}
	if (action === "disconnect") {
		const { database: _database, ...rest } = config;
		await saveConfig(paths.configPath, rest);
		await keychain.delete(databaseUrlSecretName);
		return console.log(`khata now keeps the ledger in ${paths.databasePath}.`);
	}
	fail(`Unknown database command.\n\n${usage}`, exitUsage);
}

async function runServe(): Promise<void> {
	const serverToken = process.env["KHATA_SERVER_TOKEN"] ?? "";
	if (serverToken.length < minimumServerTokenLength)
		fail(
			`khata serve needs KHATA_SERVER_TOKEN of at least ${minimumServerTokenLength} characters. Create one with khata server token.`,
			exitUsage,
		);
	const port = positiveWholeNumber(process.env["PORT"], 8080, "PORT");
	const store = await openLedger(await storeLocation());
	const khataServer = createKhataServer(store, serverToken);
	const listener = Bun.serve({ hostname: "0.0.0.0", port, fetch: khataServer.fetch });
	console.error(`khata ${khataVersion} serves ${store.address} on port ${listener.port}`);
	const shutDown = async () => {
		await listener.stop();
		await khataServer.close();
		await store.close();
		process.exit(0);
	};
	process.on("SIGINT", shutDown);
	process.on("SIGTERM", shutDown);
}

async function runServer([action]: readonly string[], { rotate }: Options): Promise<void> {
	if (action === "token") {
		if ((await keychain.get(serverTokenSecretName)) !== null && !rotate)
			fail("A server token is already in your Keychain. Replace it with khata server token --rotate.", exitFailure);
		const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
		await keychain.set(serverTokenSecretName, token);
		return console.log(
			"Stored a new server token in your Keychain. Send it to your server with: khata server secrets | fly secrets import",
		);
	}
	if (action !== "secrets" && action !== "header") fail(`Unknown server command.\n\n${usage}`, exitUsage);
	if (process.stdout.isTTY)
		fail(
			`khata server ${action} prints secrets, so it writes only to a pipe, for example: khata server secrets | fly secrets import`,
			exitUsage,
		);
	const token = await keychain.get(serverTokenSecretName);
	if (token === null) fail("No server token yet. Create one with khata server token.", exitFailure);
	if (action === "header")
		return void process.stdout.write(`${JSON.stringify({ Authorization: `Bearer ${token}` })}\n`);
	const location = await storeLocation();
	if (location.kind !== "postgres")
		fail("A hosted server needs a Postgres ledger. Run khata database connect first.", exitFailure);
	process.stdout.write(`KHATA_SERVER_TOKEN=${token}\nKHATA_DATABASE_URL=${location.url}\n`);
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
	const store = await openLedger(await storeLocation());
	const handle = serveStdio(() => createMcpServer(store, { kind: "local", sync: () => syncNow(store) }));
	const shutDown = async () => {
		await handle.close();
		await store.close();
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
			rotate: { type: "boolean", default: false },
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
		rotate: values.rotate,
	};

	if (values.version || command === "version") return console.log(khataVersion);
	if (command === "status") {
		const status = await withLedger(readLedgerStatus);
		return console.log(options.json ? JSON.stringify(status) : formatLedgerStatus(status));
	}
	if (command === "database") return runDatabase(operands);
	if (command === "ingest") return runIngest(operands, options);
	if (command === "sync") return runSync(options);
	if (command === "sources") return runSources(operands);
	if (command === "auth") return runAuth(operands, options);
	if (command === "schedule") return runSchedule(operands, options);
	if (command === "reparse") return runReparse(options);
	if (command === "fixture") return runFixture(operands, options);
	if (command === "mcp") return runMcp();
	if (command === "serve") return runServe();
	if (command === "server") return runServer(operands, options);
	if (command === undefined || command === "help") return console.log(usage);
	fail(`Unknown command: ${command}\n\n${usage}`, exitUsage);
}

await main(Bun.argv.slice(2));
