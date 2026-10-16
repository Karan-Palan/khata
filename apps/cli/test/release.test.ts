import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildLauncher } from "../release/build.ts";
import { binaryPackageManifest, launcherPackageManifest } from "../release/npm-packages.ts";
import { freshKhataHome } from "./run-khata.ts";

const identity = { version: "1.2.3", description: "A ledger.", license: "MIT" };
const repository = { type: "git", url: "git+https://github.com/Karan-Palan/khata.git", directory: "apps/cli" };

describe("npm packages", () => {
	test("the khata package runs a launcher and depends on every platform's executable at its own version", () => {
		expect(launcherPackageManifest(identity)).toEqual({
			name: "khata",
			version: "1.2.3",
			description: "A ledger.",
			license: "MIT",
			keywords: ["upi", "google-pay", "ledger", "mcp", "claude-code", "codex", "india"],
			homepage: "https://github.com/Karan-Palan/khata#readme",
			bugs: "https://github.com/Karan-Palan/khata/issues",
			repository,
			type: "module",
			bin: { khata: "bin/khata.js" },
			files: ["bin"],
			engines: { node: ">=18" },
			optionalDependencies: {
				"@khata/cli-darwin-arm64": "1.2.3",
				"@khata/cli-darwin-x64": "1.2.3",
				"@khata/cli-linux-arm64": "1.2.3",
				"@khata/cli-linux-x64": "1.2.3",
				"@khata/cli-win32-x64": "1.2.3",
			},
		});
	});

	test("each executable package installs only on its own platform", () => {
		expect(binaryPackageManifest(identity, { platform: "linux", arch: "arm64" })).toEqual({
			name: "@khata/cli-linux-arm64",
			version: "1.2.3",
			description: "The khata executable for linux arm64. Install the khata package instead.",
			license: "MIT",
			repository,
			os: ["linux"],
			cpu: ["arm64"],
			libc: ["glibc"],
			files: ["bin"],
		});
		expect(binaryPackageManifest(identity, { platform: "darwin", arch: "x64" })).toEqual({
			name: "@khata/cli-darwin-x64",
			version: "1.2.3",
			description: "The khata executable for darwin x64. Install the khata package instead.",
			license: "MIT",
			repository,
			os: ["darwin"],
			cpu: ["x64"],
			files: ["bin"],
		});
	});
});

describe.skipIf(process.platform === "win32")("khata launcher", () => {
	async function installedLauncher(withExecutablePackage: boolean): Promise<string> {
		const prefix = freshKhataHome();
		if (withExecutablePackage) {
			const packageDirectory = join(prefix, "node_modules", `@khata/cli-${process.platform}-${process.arch}`);
			mkdirSync(join(packageDirectory, "bin"), { recursive: true });
			await Bun.write(join(packageDirectory, "package.json"), "{}");
			const executable = join(packageDirectory, "bin", "khata");
			await Bun.write(executable, '#!/bin/sh\necho "khata got: $1 | $2"\nexit 3\n');
			chmodSync(executable, 0o755);
		}
		return buildLauncher(join(prefix, "node_modules", "khata", "bin"));
	}

	test("runs the platform's executable under Node with the same arguments and exit code", async () => {
		const launched = Bun.spawnSync(["node", await installedLauncher(true), "status", "two words"]);
		expect([launched.stdout.toString(), launched.exitCode]).toEqual(["khata got: status | two words\n", 3]);
	});

	test("explains which platforms khata supports when the executable package is missing", async () => {
		const launched = Bun.spawnSync(["node", await installedLauncher(false), "status"]);
		expect([launched.stderr.toString(), launched.exitCode]).toEqual([
			`khata could not find @khata/cli-${process.platform}-${process.arch}. khata runs on darwin arm64, darwin x64, linux arm64, linux x64, win32 x64. If this is one of them, reinstall khata without omitting optional dependencies.\n`,
			1,
		]);
	});
});
