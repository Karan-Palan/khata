import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { constants } from "node:os";
import { dirname, join } from "node:path";
import { binaryFileName, binaryPackageName, releaseTargets } from "./npm-packages.ts";

const host = { platform: process.platform, arch: process.arch };

function installedBinaryPath(): string | null {
	try {
		const manifestPath = createRequire(import.meta.url).resolve(`${binaryPackageName(host)}/package.json`);
		return join(dirname(manifestPath), "bin", binaryFileName(host));
	} catch {
		return null;
	}
}

const binaryPath = installedBinaryPath();
if (binaryPath === null) {
	const supported = releaseTargets.map(({ platform, arch }) => `${platform} ${arch}`).join(", ");
	console.error(
		`khata could not find ${binaryPackageName(host)}. khata runs on ${supported}. If this is one of them, reinstall khata without omitting optional dependencies.`,
	);
	process.exit(1);
}

const child = spawn(binaryPath, process.argv.slice(2), { stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => child.kill(signal));
child.on("error", (error) => {
	console.error(`khata could not start ${binaryPath}: ${error.message}`);
	process.exit(1);
});
child.on("exit", (code, signal) => process.exit(code ?? 128 + (signal === null ? 0 : constants.signals[signal])));
