import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const mainScriptPath = join(import.meta.dir, "..", "src", "main.ts");

export function freshKhataHome(): string {
	return mkdtempSync(join(tmpdir(), "khata-home-"));
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
