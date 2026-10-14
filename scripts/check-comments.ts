import { parseSync } from "oxc-parser";

export type CommentFinding = {
	readonly path: string;
	readonly line: number;
	readonly text: string;
};

const toolDirective = /^\s*(biome-ignore\S*\s+\S+:\s*\S|@ts-expect-error\s+\S)/;
const sourceFiles = new Bun.Glob("{apps,packages,scripts}/**/*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}");

export function findComments(path: string, source: string): CommentFinding[] {
	return parseSync(path, source)
		.comments.filter(({ value }) => !toolDirective.test(value))
		.map(({ start, value }) => ({
			path,
			line: source.slice(0, start).split("\n").length,
			text: value.trim(),
		}));
}

async function listSourceFiles(explicitPaths: readonly string[]): Promise<string[]> {
	if (explicitPaths.length > 0) return [...explicitPaths];
	const paths: string[] = [];
	for await (const path of sourceFiles.scan({ onlyFiles: true })) {
		if (!path.split("/").includes("node_modules")) paths.push(path);
	}
	return paths;
}

async function main(explicitPaths: readonly string[]): Promise<void> {
	const paths = await listSourceFiles(explicitPaths);
	const findings = (
		await Promise.all(paths.map(async (path) => findComments(path, await Bun.file(path).text())))
	).flat();
	for (const { path, line, text } of findings) console.error(`${path}:${line}  ${text}`);
	if (findings.length > 0) {
		console.error(
			`\n${findings.length} comment(s) found. khata code carries no comments; encode intent in names, types, and tests.`,
		);
		process.exit(1);
	}
}

if (import.meta.main) await main(Bun.argv.slice(2));
