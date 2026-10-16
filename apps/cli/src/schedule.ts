import { chmodSync, existsSync, mkdirSync, realpathSync, renameSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const launchAgentLabel = "app.khata.sync";

export type ScheduleSettings = {
	readonly khataCommand: readonly string[];
	readonly khataHome: string;
	readonly logPath: string;
	readonly intervalMinutes: number;
};

export type ScheduleOutcome =
	| { readonly kind: "done"; readonly message: string }
	| { readonly kind: "failed"; readonly reason: string };

export function runningAsCompiledBinary(): boolean {
	return Bun.main.startsWith("/$bunfs/");
}

export async function installBinary(binaryPath: string, khataHome: string): Promise<string> {
	const installedPath = join(khataHome, "bin", "khata");
	if (existsSync(installedPath) && realpathSync(installedPath) === realpathSync(binaryPath)) return installedPath;
	mkdirSync(dirname(installedPath), { recursive: true, mode: 0o700 });
	const stagingPath = `${installedPath}.${process.pid}.partial`;
	await Bun.write(stagingPath, Bun.file(binaryPath));
	chmodSync(stagingPath, 0o700);
	renameSync(stagingPath, installedPath);
	return installedPath;
}

export function launchAgentPath(): string {
	return join(homedir(), "Library", "LaunchAgents", `${launchAgentLabel}.plist`);
}

function xmlEscape(text: string): string {
	return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function launchAgentPlist(settings: ScheduleSettings): string {
	const string = (value: string) => `<string>${xmlEscape(value)}</string>`;
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
		'<plist version="1.0">',
		"<dict>",
		`\t<key>Label</key>${string(launchAgentLabel)}`,
		`\t<key>ProgramArguments</key><array>${[...settings.khataCommand, "sync"].map(string).join("")}</array>`,
		`\t<key>EnvironmentVariables</key><dict><key>KHATA_HOME</key>${string(settings.khataHome)}</dict>`,
		`\t<key>StartInterval</key><integer>${settings.intervalMinutes * 60}</integer>`,
		"\t<key>RunAtLoad</key><true/>",
		`\t<key>StandardOutPath</key>${string(settings.logPath)}`,
		`\t<key>StandardErrorPath</key>${string(settings.logPath)}`,
		"</dict>",
		"</plist>",
		"",
	].join("\n");
}

function launchctl(...args: string[]): { readonly exitCode: number; readonly output: string } {
	const result = Bun.spawnSync(["launchctl", ...args]);
	return { exitCode: result.exitCode, output: `${result.stdout}${result.stderr}`.trim() };
}

function guiDomain(): string {
	return `gui/${process.getuid?.() ?? 0}`;
}

export async function enableSchedule(settings: ScheduleSettings): Promise<ScheduleOutcome> {
	if (process.platform !== "darwin") return { kind: "failed", reason: "Scheduling is available on macOS only." };
	const path = launchAgentPath();
	if (!(await Bun.file(settings.logPath).exists())) await Bun.write(settings.logPath, "");
	await Bun.write(path, launchAgentPlist(settings));
	launchctl("bootout", `${guiDomain()}/${launchAgentLabel}`);
	const loaded = launchctl("bootstrap", guiDomain(), path);
	if (loaded.exitCode !== 0)
		return { kind: "failed", reason: `launchctl could not load the schedule: ${loaded.output}` };
	return {
		kind: "done",
		message: `khata sync runs now and every ${settings.intervalMinutes} minutes from ${settings.khataCommand.at(-1)}. Log: ${settings.logPath}`,
	};
}

export function disableSchedule(): ScheduleOutcome {
	if (process.platform !== "darwin") return { kind: "failed", reason: "Scheduling is available on macOS only." };
	launchctl("bootout", `${guiDomain()}/${launchAgentLabel}`);
	try {
		unlinkSync(launchAgentPath());
	} catch {
		return { kind: "done", message: "No schedule was enabled." };
	}
	return { kind: "done", message: "Scheduled sync is off." };
}

export function scheduleIsLoaded(): boolean {
	return process.platform === "darwin" && launchctl("print", `${guiDomain()}/${launchAgentLabel}`).exitCode === 0;
}
