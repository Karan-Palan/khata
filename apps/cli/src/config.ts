import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as z from "zod";

export const defaultGmailQuery = "has:attachment filename:pdf filename:gpay_statement";
export const defaultDriveQuery =
	"name contains 'takeout-' and (mimeType = 'application/x-zip' or mimeType = 'application/zip' or mimeType = 'application/x-zip-compressed') and trashed = false";

const folderSourceSchema = z.object({ kind: z.literal("folder"), path: z.string().min(1) });

const googleSourceSchema = z.object({
	kind: z.literal("google"),
	account: z.string().min(1),
	clientId: z.string().min(1),
	gmailQuery: z.string().min(1).default(defaultGmailQuery),
	driveQuery: z.string().min(1).default(defaultDriveQuery),
});

const sourceSchema = z.discriminatedUnion("kind", [folderSourceSchema, googleSourceSchema]);

const configSchema = z.object({ sources: z.array(sourceSchema).default([]) });

export type FolderSource = z.infer<typeof folderSourceSchema>;
export type GoogleSource = z.infer<typeof googleSourceSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type KhataConfig = z.infer<typeof configSchema>;

export function sourceKey(source: Source): string {
	return source.kind === "folder" ? `folder:${source.path}` : `google:${source.account}`;
}

export async function loadConfig(configPath: string): Promise<KhataConfig> {
	const file = Bun.file(configPath);
	if (!(await file.exists())) return { sources: [] };
	return configSchema.parse(await file.json());
}

function withoutDefaultQueries(source: Source): z.input<typeof sourceSchema> {
	if (source.kind === "folder") return source;
	const { gmailQuery, driveQuery, ...identity } = source;
	return {
		...identity,
		...(gmailQuery === defaultGmailQuery ? {} : { gmailQuery }),
		...(driveQuery === defaultDriveQuery ? {} : { driveQuery }),
	};
}

export async function saveConfig(configPath: string, config: KhataConfig): Promise<void> {
	mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
	const stored = { sources: config.sources.map(withoutDefaultQueries) };
	await Bun.write(configPath, `${JSON.stringify(stored, null, "\t")}\n`);
}

export function withSource(config: KhataConfig, source: Source): KhataConfig {
	const key = sourceKey(source);
	return { sources: [...config.sources.filter((existing) => sourceKey(existing) !== key), source] };
}

export function withoutSource(config: KhataConfig, key: string): KhataConfig {
	return { sources: config.sources.filter((existing) => sourceKey(existing) !== key) };
}
