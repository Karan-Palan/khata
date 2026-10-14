import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { freshKhataHome, runKhata } from "./run-khata.ts";

describe("khata CLI", () => {
	test("prints its version", () => {
		expect(runKhata(["--version"], freshKhataHome())).toEqual({ exitCode: 0, stdout: "0.0.0\n", stderr: "" });
	});

	test("reports an empty ledger as JSON", () => {
		const khataHome = freshKhataHome();
		const run = runKhata(["status", "--json"], khataHome);
		expect(run.exitCode).toBe(0);
		expect(JSON.parse(run.stdout)).toEqual({
			version: "0.0.0",
			databasePath: join(khataHome, "khata.db"),
			schemaVersion: 1,
			documentCount: 0,
			transactionCount: 0,
		});
	});

	test("rejects an unknown command with a usage error", () => {
		const run = runKhata(["frobnicate"], freshKhataHome());
		expect(run.exitCode).toBe(64);
		expect(run.stdout).toBe("");
		expect(run.stderr.startsWith("Unknown command: frobnicate\n")).toBe(true);
	});
});
