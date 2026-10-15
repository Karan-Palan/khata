import type { GoogleSource } from "../config.ts";
import { type Fetch, refreshAccessToken, type SecretStore } from "../google/oauth.ts";
import { discoverInZip, type IngestResult, ingestCandidate } from "../ingest.ts";
import type { Store } from "../store/store.ts";

const gmailMessages = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
const driveFiles = "https://www.googleapis.com/drive/v3/files";
const maximumGmailPages = 5;
const maximumDriveFileBytes = 500 * 1024 * 1024;

export type GoogleDependencies = { readonly fetch: Fetch; readonly secrets: SecretStore };

export type GoogleSyncOutcome = {
	readonly results: readonly IngestResult[];
	readonly unchanged: number;
	readonly failure: string | null;
};

type MessagePart = {
	readonly filename?: string;
	readonly body?: { readonly attachmentId?: string };
	readonly parts?: readonly MessagePart[];
};

type MessageList = { readonly messages?: readonly { readonly id: string }[]; readonly nextPageToken?: string };
type DriveFileList = {
	readonly files?: readonly {
		readonly id: string;
		readonly name: string;
		readonly modifiedTime: string;
		readonly size?: string;
	}[];
};

function pdfAttachments(part: MessagePart | undefined): { filename: string; attachmentId: string }[] {
	if (part === undefined) return [];
	const own =
		part.filename?.toLowerCase().endsWith(".pdf") && part.body?.attachmentId !== undefined
			? [{ filename: part.filename, attachmentId: part.body.attachmentId }]
			: [];
	return [...own, ...(part.parts ?? []).flatMap(pdfAttachments)];
}

export async function syncGoogle(
	store: Store,
	sourceKey: string,
	source: GoogleSource,
	dependencies: GoogleDependencies,
): Promise<GoogleSyncOutcome> {
	const token = await refreshAccessToken(source.account, source.clientId, dependencies);
	if (token.kind === "failed") return { results: [], unchanged: 0, failure: token.reason };
	const get = async <T>(url: string): Promise<T> => {
		const response = await dependencies.fetch(url, { headers: { authorization: `Bearer ${token.accessToken}` } });
		if (!response.ok) throw new Error(`Google returned ${response.status} for ${new URL(url).pathname}.`);
		return (await response.json()) as T;
	};
	const download = async (url: string): Promise<Uint8Array> => {
		const response = await dependencies.fetch(url, { headers: { authorization: `Bearer ${token.accessToken}` } });
		if (!response.ok) throw new Error(`Google returned ${response.status} for ${new URL(url).pathname}.`);
		return new Uint8Array(await response.arrayBuffer());
	};

	const results: IngestResult[] = [];
	let unchanged = 0;
	try {
		let pageToken: string | undefined;
		for (let page = 0; page < maximumGmailPages; page++) {
			const listUrl = new URL(gmailMessages);
			listUrl.searchParams.set("q", source.gmailQuery);
			listUrl.searchParams.set("maxResults", "100");
			if (pageToken !== undefined) listUrl.searchParams.set("pageToken", pageToken);
			const list = await get<MessageList>(listUrl.toString());
			for (const { id } of list.messages ?? []) {
				const itemKey = `gmail:${id}`;
				if (store.hasSyncItem(sourceKey, itemKey)) {
					unchanged += 1;
					continue;
				}
				const message = await get<{ payload?: MessagePart }>(`${gmailMessages}/${id}?format=full`);
				const outcomes: string[] = [];
				for (const { filename, attachmentId } of pdfAttachments(message.payload)) {
					const attachment = await get<{ data: string }>(`${gmailMessages}/${id}/attachments/${attachmentId}`);
					const bytes = new Uint8Array(Buffer.from(attachment.data, "base64url"));
					const result = await ingestCandidate(store, { path: `gmail:${id}/${filename}`, bytes, format: "pdf" });
					results.push(result);
					outcomes.push(result.outcome);
				}
				store.recordSyncItem(sourceKey, itemKey, outcomes.join(",") || "no_pdf");
			}
			pageToken = list.nextPageToken;
			if (pageToken === undefined) break;
		}

		const driveUrl = new URL(driveFiles);
		driveUrl.searchParams.set("q", source.driveQuery);
		driveUrl.searchParams.set("fields", "files(id,name,modifiedTime,size)");
		driveUrl.searchParams.set("orderBy", "modifiedTime desc");
		driveUrl.searchParams.set("pageSize", "50");
		for (const file of (await get<DriveFileList>(driveUrl.toString())).files ?? []) {
			const itemKey = `drive:${file.id}:${file.modifiedTime}`;
			if (store.hasSyncItem(sourceKey, itemKey)) {
				unchanged += 1;
				continue;
			}
			if (Number(file.size ?? 0) > maximumDriveFileBytes) {
				store.recordSyncItem(sourceKey, itemKey, "too_large");
				continue;
			}
			const bytes = await download(`${driveFiles}/${file.id}?alt=media`);
			const outcomes: string[] = [];
			for (const discovery of discoverInZip(`drive:${file.name}`, bytes)) {
				const result = "outcome" in discovery ? discovery : await ingestCandidate(store, discovery);
				results.push(result);
				outcomes.push(result.outcome);
			}
			store.recordSyncItem(sourceKey, itemKey, outcomes.join(","));
		}
		return { results, unchanged, failure: null };
	} catch (error) {
		return { results, unchanged, failure: error instanceof Error ? error.message : String(error) };
	}
}
