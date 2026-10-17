import type { DocumentContent } from "./store.ts";

export function serializeContent(content: DocumentContent): string {
	return JSON.stringify(content.kind === "text_layer" ? content.textLayer : content.entries);
}

export function deserializeContent(kind: DocumentContent["kind"], serialized: string): DocumentContent {
	return kind === "text_layer"
		? { kind, textLayer: JSON.parse(serialized) }
		: { kind, entries: JSON.parse(serialized) };
}
