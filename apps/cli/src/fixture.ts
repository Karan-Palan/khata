import { anonymizeGooglePayStatement, extractTextLayer, parseStatement } from "@khata/parsers";

export type FixtureResult =
	| {
			readonly kind: "written";
			readonly textLayerPath: string;
			readonly expectedPath: string;
			readonly transactionCount: number;
	  }
	| { readonly kind: "rejected"; readonly reason: string };

export async function writeFixture(
	statementPath: string,
	outputPrefix: string,
	pageLimit: number,
): Promise<FixtureResult> {
	const textLayer = await extractTextLayer(new Uint8Array(await Bun.file(statementPath).arrayBuffer()));
	const anonymized = anonymizeGooglePayStatement(textLayer, pageLimit);
	if (anonymized.kind === "rejected") return anonymized;
	const parsed = parseStatement(anonymized.textLayer);
	if (parsed.kind === "rejected")
		return { kind: "rejected", reason: `Anonymized fixture does not parse: ${parsed.reason}` };
	const textLayerPath = `${outputPrefix}.text-layer.json`;
	const expectedPath = `${outputPrefix}.expected.json`;
	await Bun.write(textLayerPath, `${JSON.stringify(anonymized.textLayer, null, "\t")}\n`);
	await Bun.write(expectedPath, `${JSON.stringify(parsed.statement, null, "\t")}\n`);
	return { kind: "written", textLayerPath, expectedPath, transactionCount: parsed.statement.transactions.length };
}
