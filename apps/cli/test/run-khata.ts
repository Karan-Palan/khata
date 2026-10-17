import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActivityExport, Statement, TakeoutActivityEntry, TextLayer } from "@khata/parsers";
import { rebuildLedger } from "../src/ledger/ledger.ts";
import { openStore } from "../src/store/store.ts";

export const mainScriptPath = join(import.meta.dir, "..", "src", "main.ts");

const fixturesDirectory = join(
	import.meta.dir,
	"..",
	"..",
	"..",
	"packages",
	"parsers",
	"test",
	"fixtures",
	"google-pay",
);

export function freshKhataHome(): string {
	return mkdtempSync(join(tmpdir(), "khata-home-"));
}

export async function loadStatementFixture(): Promise<{ textLayer: TextLayer; statement: Statement }> {
	return {
		textLayer: await Bun.file(join(fixturesDirectory, "statement-pdf.text-layer.json")).json(),
		statement: await Bun.file(join(fixturesDirectory, "statement-pdf.expected.json")).json(),
	};
}

export async function loadActivityFixture(): Promise<{ entries: TakeoutActivityEntry[]; activity: ActivityExport }> {
	return {
		entries: await Bun.file(join(fixturesDirectory, "takeout-activity.activity.json")).json(),
		activity: await Bun.file(join(fixturesDirectory, "takeout-activity.expected.json")).json(),
	};
}

export async function writeTakeoutFolder(parent: string): Promise<string> {
	const takeout = join(parent, "Takeout");
	const activityDirectory = join(takeout, "My Activity", "Google Pay");
	mkdirSync(activityDirectory, { recursive: true });
	const { entries } = await loadActivityFixture();
	await Bun.write(join(activityDirectory, "MyActivity.json"), JSON.stringify(entries));
	return takeout;
}

export async function seededKhataHome(): Promise<string> {
	const khataHome = freshKhataHome();
	const { textLayer, statement } = await loadStatementFixture();
	const store = await openStore({ kind: "sqlite", path: join(khataHome, "khata.db") });
	await store.recordDocument({
		id: "fixture-statement",
		upiApp: statement.upiApp,
		layout: statement.layout,
		periodStart: statement.periodStart,
		periodEnd: statement.periodEnd,
		content: { kind: "text_layer", textLayer },
		source: "fixture",
	});
	await rebuildLedger(store);
	await store.close();
	return khataHome;
}

export type KhataRun = {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
};

export function runKhata(
	args: readonly string[],
	khataHome: string,
	environment: Readonly<Record<string, string>> = {},
): KhataRun {
	const result = Bun.spawnSync(["bun", mainScriptPath, ...args], {
		env: { ...process.env, KHATA_HOME: khataHome, ...environment },
	});
	return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}
