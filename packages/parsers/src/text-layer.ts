export type TextItem = {
	readonly text: string;
	readonly x: number;
	readonly y: number;
};

export type TextPage = {
	readonly pageNumber: number;
	readonly items: readonly TextItem[];
};

export type TextLayer = {
	readonly pages: readonly TextPage[];
};

function roundCoordinate(value: number | undefined): number {
	return Math.round((value ?? 0) * 10) / 10;
}

export async function extractTextLayer(pdfBytes: Uint8Array): Promise<TextLayer> {
	const { getDocumentProxy } = await import("unpdf");
	const pdf = await getDocumentProxy(pdfBytes);
	const pages: TextPage[] = [];
	for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
		const content = await (await pdf.getPage(pageNumber)).getTextContent();
		const items = content.items.flatMap((item) =>
			"str" in item && item.str.trim() !== ""
				? [{ text: item.str, x: roundCoordinate(item.transform[4]), y: roundCoordinate(item.transform[5]) }]
				: [],
		);
		pages.push({ pageNumber, items });
	}
	await pdf.loadingTask.destroy();
	return { pages };
}
