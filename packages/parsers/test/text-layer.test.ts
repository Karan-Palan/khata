import { expect, test } from "bun:test";
import { extractTextLayer } from "../src/text-layer.ts";

function minimalPdf(lines: readonly { text: string; x: number; y: number }[]): Uint8Array {
	const stream = lines.map(({ text, x, y }) => `BT /F1 10 Tf ${x} ${y} Td (${text}) Tj ET`).join("\n");
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	];
	let body = "%PDF-1.4\n";
	const offsets = objects.map((object, index) => {
		const offset = body.length;
		body += `${index + 1} 0 obj\n${object}\nendobj\n`;
		return offset;
	});
	const xrefOffset = body.length;
	const xrefEntries = offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
	body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${xrefEntries}`;
	body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
	return new TextEncoder().encode(body);
}

test("extracts each run of text with its position on the page", async () => {
	const pdf = minimalPdf([
		{ text: "Transaction statement", x: 24, y: 250 },
		{ text: "Paid to Someone", x: 136.4, y: 200 },
	]);
	expect(await extractTextLayer(pdf)).toEqual({
		pages: [
			{
				pageNumber: 1,
				items: [
					{ text: "Transaction statement", x: 24, y: 250 },
					{ text: "Paid to Someone", x: 136.4, y: 200 },
				],
			},
		],
	});
});
