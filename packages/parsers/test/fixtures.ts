import { join } from "node:path";
import type { Statement } from "../src/statement.ts";
import type { TextLayer } from "../src/text-layer.ts";

const fixturesDirectory = join(import.meta.dir, "fixtures");

export async function loadFixture(name: string): Promise<{ textLayer: TextLayer; expected: Statement }> {
	const prefix = join(fixturesDirectory, name);
	return {
		textLayer: await Bun.file(`${prefix}.text-layer.json`).json(),
		expected: await Bun.file(`${prefix}.expected.json`).json(),
	};
}

export function replaceTexts(textLayer: TextLayer, replace: (text: string) => string): TextLayer {
	return {
		pages: textLayer.pages.map((page) => ({
			pageNumber: page.pageNumber,
			items: page.items.map((item) => ({ ...item, text: replace(item.text) })),
		})),
	};
}
