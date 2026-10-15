import {
	anonymizeGooglePayStatement,
	anonymizeGooglePayTakeoutActivity,
	extractTextLayer,
	isGooglePayTakeoutActivity,
	parseGooglePayTakeoutActivity,
	parseStatement,
} from "@khata/parsers";

export type FixtureResult =
	| { readonly kind: "written"; readonly paths: readonly string[]; readonly transactionCount: number }
	| { readonly kind: "rejected"; readonly reason: string };

async function writeJson(path: string, value: unknown): Promise<string> {
	await Bun.write(path, `${JSON.stringify(value, null, "\t")}\n`);
	return path;
}

async function writeStatementFixture(
	sourcePath: string,
	outputPrefix: string,
	pageLimit: number,
): Promise<FixtureResult> {
	const textLayer = await extractTextLayer(new Uint8Array(await Bun.file(sourcePath).arrayBuffer()));
	const anonymized = anonymizeGooglePayStatement(textLayer, pageLimit);
	if (anonymized.kind === "rejected") return anonymized;
	const parsed = parseStatement(anonymized.textLayer);
	if (parsed.kind === "rejected")
		return { kind: "rejected", reason: `Anonymized fixture does not parse: ${parsed.reason}` };
	return {
		kind: "written",
		paths: [
			await writeJson(`${outputPrefix}.text-layer.json`, anonymized.textLayer),
			await writeJson(`${outputPrefix}.expected.json`, parsed.statement),
		],
		transactionCount: parsed.statement.transactions.length,
	};
}

async function writeActivityFixture(
	sourcePath: string,
	outputPrefix: string,
	perShape: number,
): Promise<FixtureResult> {
	const entries: unknown = await Bun.file(sourcePath).json();
	if (!isGooglePayTakeoutActivity(entries)) return { kind: "rejected", reason: "Not a Google Pay activity export." };
	const anonymized = anonymizeGooglePayTakeoutActivity(entries, perShape);
	if (anonymized.kind === "rejected") return anonymized;
	const parsed = parseGooglePayTakeoutActivity(anonymized.entries);
	if (parsed.kind === "rejected")
		return { kind: "rejected", reason: `Anonymized fixture does not parse: ${parsed.reason}` };
	return {
		kind: "written",
		paths: [
			await writeJson(`${outputPrefix}.activity.json`, anonymized.entries),
			await writeJson(`${outputPrefix}.expected.json`, parsed.activity),
		],
		transactionCount: parsed.activity.payments.length,
	};
}

export function writeFixture(sourcePath: string, outputPrefix: string, sampleSize: number): Promise<FixtureResult> {
	return sourcePath.toLowerCase().endsWith(".json")
		? writeActivityFixture(sourcePath, outputPrefix, sampleSize)
		: writeStatementFixture(sourcePath, outputPrefix, sampleSize);
}
