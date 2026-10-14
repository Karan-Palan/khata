import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { freshKhataHome, runKhata, seededKhataHome } from "./run-khata.ts";

describe("khata CLI", () => {
	test("prints its version", () => {
		expect(runKhata(["--version"], freshKhataHome())).toEqual({ exitCode: 0, stdout: "0.0.0\n", stderr: "" });
	});

	test("reports the ledger as JSON", async () => {
		const khataHome = await seededKhataHome();
		const run = runKhata(["status", "--json"], khataHome);
		expect(run.exitCode).toBe(0);
		expect(JSON.parse(run.stdout)).toEqual({
			version: "0.0.0",
			databasePath: join(khataHome, "khata.db"),
			schemaVersion: 1,
			documentCount: 1,
			transactionCount: 18,
			firstOccurredAt: "2018-04-01T09:11:00+05:30",
			lastOccurredAt: "2018-04-05T13:07:00+05:30",
		});
	});

	test("rejects files it cannot read and exits with failure", async () => {
		const khataHome = freshKhataHome();
		const notAPdf = join(khataHome, "notes.pdf");
		await Bun.write(notAPdf, "these are notes, not a statement");
		const missing = join(khataHome, "missing.pdf");
		const run = runKhata(["ingest", notAPdf, missing, "--json"], khataHome);
		expect(run.exitCode).toBe(1);
		expect(
			JSON.parse(run.stdout).map(({ outcome, reason }: { outcome: string; reason: string }) => ({
				outcome,
				reason: reason.split(":")[0],
			})),
		).toEqual([
			{ outcome: "rejected", reason: "Unreadable PDF" },
			{ outcome: "rejected", reason: "File not found." },
		]);
	});

	test("rejects an unknown command with a usage error", () => {
		const run = runKhata(["frobnicate"], freshKhataHome());
		expect(run.exitCode).toBe(64);
		expect(run.stdout).toBe("");
		expect(run.stderr.startsWith("Unknown command: frobnicate\n")).toBe(true);
	});
});
