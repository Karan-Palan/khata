import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import cliPackage from "../package.json" with { type: "json" };

describe("plugin", () => {
	test("runs and documents the khata version the CLI is released as", async () => {
		const pluginDirectory = join(import.meta.dir, "..", "..", "..", "plugin");
		const readJson = (path: string) => Bun.file(join(pluginDirectory, path)).json();
		const documentedVersions = new Set<string>();
		for (const path of new Bun.Glob("**/*.md").scanSync(pluginDirectory)) {
			const text = await Bun.file(join(pluginDirectory, path)).text();
			for (const [, version] of text.matchAll(/khata@(\d+\.\d+\.\d+)/g)) documentedVersions.add(String(version));
		}
		expect({
			claude: (await readJson(".claude-plugin/plugin.json")).version,
			codex: (await readJson(".codex-plugin/plugin.json")).version,
			server: (await readJson(".mcp.json")).mcpServers.khata,
			documented: [...documentedVersions],
		}).toEqual({
			claude: cliPackage.version,
			codex: cliPackage.version,
			server: { command: "npx", args: ["-y", `khata@${cliPackage.version}`, "mcp"] },
			documented: [cliPackage.version],
		});
	});
});
