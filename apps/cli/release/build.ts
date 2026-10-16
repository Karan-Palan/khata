import { chmodSync, copyFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import cliPackage from "../package.json" with { type: "json" };
import {
	binaryFileName,
	binaryPackageManifest,
	binaryPackageName,
	launcherPackageManifest,
	type ReleaseTarget,
	releaseTargets,
} from "./npm-packages.ts";

const cliDirectory = join(import.meta.dir, "..");
const repositoryRoot = join(cliDirectory, "..", "..");
const npmOutputDirectory = join(cliDirectory, "dist", "npm");

export async function buildLauncher(outputDirectory: string): Promise<string> {
	const result = await Bun.build({
		entrypoints: [join(import.meta.dir, "launcher.ts")],
		outdir: outputDirectory,
		naming: "khata.js",
		target: "node",
		format: "esm",
		minify: true,
		banner: "#!/usr/bin/env node",
	});
	if (!result.success) throw new AggregateError(result.logs, "The khata launcher did not build.");
	const launcherPath = join(outputDirectory, "khata.js");
	chmodSync(launcherPath, 0o755);
	return launcherPath;
}

function compileBinary(target: ReleaseTarget, outfile: string): void {
	const entrypoint = join(cliDirectory, "src", "main.ts");
	const compiled = Bun.spawnSync(
		[
			process.execPath,
			"build",
			"--compile",
			"--minify",
			`--target=${target.bunTarget}`,
			entrypoint,
			"--outfile",
			outfile,
		],
		{ stdout: "inherit", stderr: "inherit" },
	);
	if (compiled.exitCode !== 0) throw new Error(`Compiling khata for ${target.bunTarget} failed.`);
}

async function writePackage(directory: string, manifest: object, readme: string): Promise<void> {
	await Bun.write(join(directory, "package.json"), `${JSON.stringify(manifest, null, "\t")}\n`);
	await Bun.write(join(directory, "README.md"), readme);
	copyFileSync(join(repositoryRoot, "LICENSE"), join(directory, "LICENSE"));
}

async function buildNpmPackages(targets: readonly ReleaseTarget[]): Promise<string[]> {
	rmSync(npmOutputDirectory, { recursive: true, force: true });
	const directories: string[] = [];
	for (const target of targets) {
		const name = binaryPackageName(target);
		const directory = join(npmOutputDirectory, name.replace("@khata/", ""));
		mkdirSync(join(directory, "bin"), { recursive: true });
		compileBinary(target, join(directory, "bin", binaryFileName(target)));
		await writePackage(
			directory,
			binaryPackageManifest(cliPackage, target),
			`# ${name}\n\nThe khata executable for ${target.platform} ${target.arch}. Install [khata](https://www.npmjs.com/package/khata) instead; it picks the right executable for you.\n`,
		);
		directories.push(directory);
	}
	const launcherDirectory = join(npmOutputDirectory, "khata");
	await buildLauncher(join(launcherDirectory, "bin"));
	await writePackage(
		launcherDirectory,
		launcherPackageManifest(cliPackage),
		await Bun.file(join(repositoryRoot, "README.md")).text(),
	);
	return [...directories, launcherDirectory];
}

if (import.meta.main) {
	const { values } = parseArgs({ options: { host: { type: "boolean", default: false } } });
	const targets = values.host
		? releaseTargets.filter(({ platform, arch }) => platform === process.platform && arch === process.arch)
		: releaseTargets;
	if (targets.length === 0) {
		console.error(`khata has no release target for ${process.platform} ${process.arch}.`);
		process.exit(1);
	}
	for (const directory of await buildNpmPackages(targets)) console.log(directory);
}
