import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
	defaultDriveQuery,
	defaultGmailQuery,
	loadConfig,
	saveConfig,
	sourceKey,
	withoutSource,
	withSource,
} from "../src/config.ts";
import { installBinary, launchAgentPlist } from "../src/schedule.ts";
import { freshKhataHome, runKhata, writeTakeoutFolder } from "./run-khata.ts";

type SyncOutput = { source: string; ingested: number; rejected: number; unchanged: number; failure: string | null };

describe("config", () => {
	test("keeps one entry per source and fills Google defaults when loading", async () => {
		const configPath = join(freshKhataHome(), "config.json");
		const folder = { kind: "folder" as const, path: "/tmp/statements" };
		const config = withSource(withSource({ sources: [] }, folder), folder);
		await saveConfig(configPath, withSource(config, { kind: "folder", path: "/tmp/other" }));
		await Bun.write(
			configPath,
			JSON.stringify({ sources: [folder, { kind: "google", account: "someone@example.com", clientId: "client-123" }] }),
		);
		const loaded = await loadConfig(configPath);
		expect(loaded.sources.map(sourceKey)).toEqual(["folder:/tmp/statements", "google:someone@example.com"]);
		expect(withoutSource(loaded, "folder:/tmp/statements").sources.map(sourceKey)).toEqual([
			"google:someone@example.com",
		]);
	});

	test("saves only the Google queries a user changed, so later defaults reach saved configs", async () => {
		const configPath = join(freshKhataHome(), "config.json");
		const google = { kind: "google" as const, account: "someone@example.com", clientId: "client-123" };
		const other = { ...google, account: "other@example.com" };
		await saveConfig(configPath, {
			sources: [
				{ ...google, gmailQuery: defaultGmailQuery, driveQuery: defaultDriveQuery },
				{ ...other, gmailQuery: "from:statements@example.com", driveQuery: defaultDriveQuery },
			],
		});
		expect(await Bun.file(configPath).json()).toEqual({
			sources: [google, { ...other, gmailQuery: "from:statements@example.com" }],
		});
	});
});

describe("khata sync", () => {
	test("ingests new files in a watched folder once and remembers files that are not statements", async () => {
		const khataHome = freshKhataHome();
		const watched = join(khataHome, "Downloads");
		mkdirSync(watched);
		await writeTakeoutFolder(watched);
		await Bun.write(join(watched, "receipt.pdf"), "a receipt, not a statement");
		expect(runKhata(["sources", "add-folder", watched], khataHome).stdout).toBe(`Watching ${watched}\n`);

		const summarize = (stdout: string) =>
			JSON.parse(stdout).map(({ ingested, rejected, unchanged, failure }: SyncOutput) => ({
				ingested,
				rejected,
				unchanged,
				failure,
			}));
		expect(summarize(runKhata(["sync", "--json"], khataHome).stdout)).toEqual([
			{ ingested: 1, rejected: 1, unchanged: 0, failure: null },
		]);
		expect(summarize(runKhata(["sync", "--json"], khataHome).stdout)).toEqual([
			{ ingested: 0, rejected: 0, unchanged: 2, failure: null },
		]);
		expect(JSON.parse(runKhata(["status", "--json"], khataHome).stdout).transactionCount).toBe(15);
	});

	test("says how to add a source when none is configured", () => {
		expect(
			runKhata(["sync"], freshKhataHome()).stdout.endsWith(
				"No sources configured. Add one with khata sources add-folder <path> or khata auth google.\n",
			),
		).toBe(true);
	});
});

describe("launchAgentPlist", () => {
	test("runs khata sync at load and on the requested interval with the ledger's home", () => {
		const plist = launchAgentPlist({
			khataCommand: ["/Users/someone/.bun/bin/bun", "/Users/someone/khata & co/apps/cli/src/main.ts"],
			khataHome: "/Users/someone/.khata",
			logPath: "/Users/someone/.khata/sync.log",
			intervalMinutes: 360,
		});
		expect(
			[
				"<key>Label</key><string>app.khata.sync</string>",
				"<array><string>/Users/someone/.bun/bin/bun</string><string>/Users/someone/khata &amp; co/apps/cli/src/main.ts</string><string>sync</string></array>",
				"<key>KHATA_HOME</key><string>/Users/someone/.khata</string>",
				"<key>StartInterval</key><integer>21600</integer>",
				"<key>RunAtLoad</key><true/>",
			].filter((fragment) => !plist.includes(fragment)),
		).toEqual([]);
	});
});

describe("installBinary", () => {
	test("copies the running binary into the ledger's home, readable only by its owner, and reuses it there", async () => {
		const khataHome = freshKhataHome();
		const downloadedPath = join(khataHome, "downloaded-khata");
		await Bun.write(downloadedPath, "khata binary bytes");
		const installedPath = await installBinary(downloadedPath, khataHome);
		expect(installedPath).toBe(join(khataHome, "bin", "khata"));
		expect(await Bun.file(installedPath).text()).toBe("khata binary bytes");
		expect((statSync(installedPath).mode & 0o777).toString(8)).toBe("700");
		expect(await installBinary(installedPath, khataHome)).toBe(installedPath);
		expect(readdirSync(join(khataHome, "bin"))).toEqual(["khata"]);
	});
});
