import { describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { zipSync } from "fflate";
import { freshKhataHome, loadActivityFixture, runKhata, seededKhataHome, writeTakeoutFolder } from "./run-khata.ts";

type IngestOutput = { outcome: string; documentKind?: string; ledgerTransactionsAfter?: number; reason?: string };

describe("khata CLI", () => {
	test("prints its version", () => {
		expect(runKhata(["--version"], freshKhataHome())).toEqual({ exitCode: 0, stdout: "0.1.0\n", stderr: "" });
	});

	test("reports the ledger as JSON", async () => {
		const khataHome = await seededKhataHome();
		const run = runKhata(["status", "--json"], khataHome);
		expect(run.exitCode).toBe(0);
		expect(JSON.parse(run.stdout)).toEqual({
			version: "0.1.0",
			databasePath: join(khataHome, "khata.db"),
			schemaVersion: 3,
			documentCount: 1,
			transactionCount: 18,
			firstOccurredAt: "2018-04-01T09:11:00+05:30",
			lastOccurredAt: "2018-04-05T13:07:00+05:30",
		});
	});

	test("adds a Takeout folder's completed payments outside the statement's period", async () => {
		const khataHome = await seededKhataHome();
		const takeout = await writeTakeoutFolder(khataHome);
		const first = runKhata(["ingest", takeout, "--json"], khataHome);
		const second = runKhata(["ingest", takeout, "--json"], khataHome);
		expect(first.exitCode).toBe(0);
		expect(
			JSON.parse(first.stdout).map(({ outcome, documentKind, ledgerTransactionsAfter }: IngestOutput) => [
				outcome,
				documentKind,
				ledgerTransactionsAfter,
			]),
		).toEqual([["ingested", "activity_export", 31]]);
		expect(JSON.parse(second.stdout).map(({ outcome }: IngestOutput) => outcome)).toEqual(["already_ingested"]);
	});

	test("reads a Takeout zip the same way as the folder", async () => {
		const khataHome = freshKhataHome();
		const { entries } = await loadActivityFixture();
		const zipPath = join(khataHome, "takeout-20261015T085928Z-1-001.zip");
		await Bun.write(
			zipPath,
			zipSync({ "Takeout/My Activity/Google Pay/MyActivity.json": new TextEncoder().encode(JSON.stringify(entries)) }),
		);
		const run = runKhata(["ingest", zipPath, "--json"], khataHome);
		expect(
			JSON.parse(run.stdout).map(({ outcome, ledgerTransactionsAfter }: IngestOutput) => [
				outcome,
				ledgerTransactionsAfter,
			]),
		).toEqual([["ingested", 15]]);
	});

	test("explains how to re-export a Takeout that has Google Pay activity only as HTML", async () => {
		const khataHome = freshKhataHome();
		const htmlDirectory = join(khataHome, "Takeout", "Google Pay", "My Activity");
		mkdirSync(htmlDirectory, { recursive: true });
		await Bun.write(join(htmlDirectory, "My Activity.html"), "<html></html>");
		const run = runKhata(["ingest", join(khataHome, "Takeout"), "--json"], khataHome);
		expect(run.exitCode).toBe(1);
		expect(JSON.parse(run.stdout).map(({ reason }: IngestOutput) => reason)).toEqual([
			"This Takeout has Google Pay activity only as HTML. Export it again with My Activity set to JSON and only Google Pay selected.",
		]);
	});

	test("rejects files it cannot read and exits with failure", async () => {
		const khataHome = freshKhataHome();
		const notAPdf = join(khataHome, "notes.pdf");
		await Bun.write(notAPdf, "these are notes, not a statement");
		const missing = join(khataHome, "missing.pdf");
		const run = runKhata(["ingest", notAPdf, missing, "--json"], khataHome);
		expect(run.exitCode).toBe(1);
		expect(JSON.parse(run.stdout).map(({ outcome, reason }: IngestOutput) => [outcome, reason?.split(":")[0]])).toEqual(
			[
				["rejected", "Unreadable PDF"],
				["rejected", "File not found."],
			],
		);
	});

	test("rebuilds the ledger from stored documents on reparse", async () => {
		const khataHome = await seededKhataHome();
		runKhata(["ingest", await writeTakeoutFolder(khataHome)], khataHome);
		const run = runKhata(["reparse", "--json"], khataHome);
		expect(run.exitCode).toBe(0);
		expect(JSON.parse(run.stdout)).toEqual({
			fromStatements: 18,
			fromActivity: 13,
			coveredByStatement: 2,
			notCompleted: 40,
			transactionCount: 31,
			rejectedDocuments: [],
		});
	});

	test("rejects an unknown command with a usage error", () => {
		const run = runKhata(["frobnicate"], freshKhataHome());
		expect(run.exitCode).toBe(64);
		expect(run.stdout).toBe("");
		expect(run.stderr.startsWith("Unknown command: frobnicate\n")).toBe(true);
	});
});
