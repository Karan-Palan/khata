import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Statement, TextLayer } from "@khata/parsers";
import { openStore } from "../src/store/store.ts";

export const mainScriptPath = join(import.meta.dir, "..", "src", "main.ts");

const googlePayFixturePrefix = join(
	import.meta.dir,
	"..",
	"..",
	"..",
	"packages",
	"parsers",
	"test",
	"fixtures",
	"google-pay",
	"statement-pdf",
);

export function freshKhataHome(): string {
	return mkdtempSync(join(tmpdir(), "khata-home-"));
}

export async function loadGooglePayFixture(): Promise<{ textLayer: TextLayer; statement: Statement }> {
	return {
		textLayer: await Bun.file(`${googlePayFixturePrefix}.text-layer.json`).json(),
		statement: await Bun.file(`${googlePayFixturePrefix}.expected.json`).json(),
	};
}

export async function seededKhataHome(): Promise<string> {
	const khataHome = freshKhataHome();
	const { textLayer, statement } = await loadGooglePayFixture();
	const store = openStore(join(khataHome, "khata.db"));
	store.recordStatement({ documentId: "fixture-statement", source: "fixture", textLayer, statement });
	store.close();
	return khataHome;
}

export type KhataRun = {
	readonly exitCode: number;
	readonly stdout: string;
	readonly stderr: string;
};

export function runKhata(args: readonly string[], khataHome: string): KhataRun {
	const result = Bun.spawnSync(["bun", mainScriptPath, ...args], {
		env: { ...process.env, KHATA_HOME: khataHome },
	});
	return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}
