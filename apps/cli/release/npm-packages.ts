export type BinaryTarget = {
	readonly platform: string;
	readonly arch: string;
};

export type ReleaseTarget = BinaryTarget & { readonly bunTarget: string };

export type PackageIdentity = {
	readonly version: string;
	readonly description: string;
	readonly license: string;
};

export const releaseTargets: readonly ReleaseTarget[] = [
	{ platform: "darwin", arch: "arm64", bunTarget: "bun-darwin-arm64" },
	{ platform: "darwin", arch: "x64", bunTarget: "bun-darwin-x64-baseline" },
	{ platform: "linux", arch: "arm64", bunTarget: "bun-linux-arm64" },
	{ platform: "linux", arch: "x64", bunTarget: "bun-linux-x64-baseline" },
	{ platform: "win32", arch: "x64", bunTarget: "bun-windows-x64-baseline" },
];

const repositoryUrl = "git+https://github.com/Karan-Palan/khata.git";

export function binaryPackageName({ platform, arch }: BinaryTarget): string {
	return `@khata/cli-${platform}-${arch}`;
}

export function binaryFileName({ platform }: BinaryTarget): string {
	return platform === "win32" ? "khata.exe" : "khata";
}

export function binaryPackageManifest(identity: PackageIdentity, target: BinaryTarget) {
	return {
		name: binaryPackageName(target),
		version: identity.version,
		description: `The khata executable for ${target.platform} ${target.arch}. Install the khata package instead.`,
		license: identity.license,
		repository: { type: "git", url: repositoryUrl, directory: "apps/cli" },
		os: [target.platform],
		cpu: [target.arch],
		...(target.platform === "linux" ? { libc: ["glibc"] } : {}),
		files: ["bin"],
	};
}

export function launcherPackageManifest(identity: PackageIdentity) {
	return {
		name: "khata",
		version: identity.version,
		description: identity.description,
		license: identity.license,
		keywords: ["upi", "google-pay", "ledger", "mcp", "claude-code", "codex", "india"],
		homepage: "https://github.com/Karan-Palan/khata#readme",
		bugs: "https://github.com/Karan-Palan/khata/issues",
		repository: { type: "git", url: repositoryUrl, directory: "apps/cli" },
		type: "module",
		bin: { khata: "bin/khata.js" },
		files: ["bin"],
		engines: { node: ">=18" },
		optionalDependencies: Object.fromEntries(
			releaseTargets.map((target) => [binaryPackageName(target), identity.version]),
		),
	};
}
