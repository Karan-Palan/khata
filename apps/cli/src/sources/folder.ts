import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { type IngestResult, ingestPaths } from "../ingest.ts";
import type { Store } from "../store/store.ts";

const maximumDepth = 4;
const maximumBytes: Readonly<Record<string, number>> = {
	pdf: 20 * 1024 * 1024,
	zip: 500 * 1024 * 1024,
	json: 100 * 1024 * 1024,
};
const skippedDirectories = new Set(["node_modules", "Library"]);

function kindOf(name: string): keyof typeof maximumBytes | null {
	const lower = name.toLowerCase();
	if (lower.endsWith(".pdf")) return "pdf";
	if (lower.endsWith(".zip")) return "zip";
	if (name === "MyActivity.json") return "json";
	return null;
}

async function* candidateFiles(directory: string, depth: number): AsyncGenerator<string> {
	const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue;
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			if (depth < maximumDepth && !skippedDirectories.has(entry.name) && !entry.name.endsWith(".app")) {
				yield* candidateFiles(path, depth + 1);
			}
			continue;
		}
		if (entry.isFile() && kindOf(entry.name) !== null) yield path;
	}
}

export type FolderSyncOutcome = {
	readonly results: readonly IngestResult[];
	readonly unchanged: number;
};

export async function syncFolder(store: Store, sourceKey: string, folder: string): Promise<FolderSyncOutcome> {
	const results: IngestResult[] = [];
	let unchanged = 0;
	for await (const path of candidateFiles(folder, 1)) {
		const details = await stat(path);
		const kind = kindOf(basename(path));
		if (kind === null || details.size > (maximumBytes[kind] ?? 0)) continue;
		const itemKey = `${path}|${details.size}|${Math.trunc(details.mtimeMs)}`;
		if (await store.hasSyncItem(sourceKey, itemKey)) {
			unchanged += 1;
			continue;
		}
		const fileResults = await ingestPaths(store, [path]);
		results.push(...fileResults);
		const outcomes = new Set(fileResults.map(({ outcome }) => outcome));
		await store.recordSyncItem(sourceKey, itemKey, outcomes.size === 1 ? [...outcomes].join("") : "mixed");
	}
	return { results, unchanged };
}
