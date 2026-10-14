import { formatPaiseAsRupees } from "../money.ts";
import type { TextItem, TextLayer, TextPage } from "../text-layer.ts";
import { readGooglePayStatementLayout, type StatementRowItems } from "./statement-pdf.ts";

export type AnonymizationOutcome =
	| { readonly kind: "anonymized"; readonly textLayer: TextLayer }
	| { readonly kind: "rejected"; readonly reason: string };

const yearShift = 8;
const pageFooter = /^Page \d+ of \d+$/;
const fourDigitYear = /\b(\d{4})\b/g;

function shiftYears(text: string): string {
	return text.replace(fourDigitYear, (year) => String(Number(year) - yearShift));
}

function syntheticAmountPaise(rowIndex: number): number {
	const paise = (((rowIndex + 1) * 7919) % 900_000) + 1_000;
	return rowIndex % 4 === 0 ? paise : Math.round(paise / 100) * 100;
}

function syntheticReference(rowIndex: number): string {
	return String(900_000_000_000 + rowIndex + 1);
}

function labeler(prefix: string, width: number): (original: string) => string {
	const labels = new Map<string, string>();
	return (original) => {
		const known = labels.get(original);
		if (known !== undefined) return known;
		const label = `${prefix} ${String(labels.size + 1).padStart(width, "0")}`;
		labels.set(original, label);
		return label;
	};
}

function verbOf(text: string): string {
	return text.startsWith("Received from") ? "Received from" : text.startsWith("Paid by") ? "Paid by" : "Paid to";
}

function originalsOf(rows: readonly StatementRowItems[], contact: TextItem | null): string[] {
	const values = rows.flatMap(({ counterparty, reference, funding }) => [
		counterparty.text.replace(/^(Paid to|Received from) /, ""),
		reference.text.replace(/^UPI Transaction ID: /, ""),
		funding.text.replace(/^(Paid by|Paid to) /, ""),
	]);
	return contact === null ? values : [...values, ...contact.text.split(", ")];
}

export function anonymizeGooglePayStatement(textLayer: TextLayer, pageLimit: number): AnonymizationOutcome {
	const keptLayer = { pages: textLayer.pages.slice(0, pageLimit) };
	const reading = readGooglePayStatementLayout(keptLayer);
	if (reading.kind === "rejected") return reading;
	const { header, rowsByPage } = reading.layout;
	const rows = [...rowsByPage.values()].flat();
	const counterpartyLabel = labeler("Counterparty", 3);
	const fundingLabel = labeler("Example Bank", 4);
	const replacements = new Map<TextItem, string>();
	let sentPaise = 0;
	let receivedPaise = 0;

	for (const [rowIndex, row] of rows.entries()) {
		const amountPaise = syntheticAmountPaise(rowIndex);
		const verb = verbOf(row.counterparty.text);
		if (verb === "Received from") receivedPaise += amountPaise;
		else sentPaise += amountPaise;
		const counterpartyName = row.counterparty.text.slice(verb.length + 1);
		const fundingVerb = verbOf(row.funding.text);
		replacements.set(row.date, shiftYears(row.date.text));
		replacements.set(row.counterparty, `${verb} ${counterpartyLabel(counterpartyName)}`);
		replacements.set(row.reference, `UPI Transaction ID: ${syntheticReference(rowIndex)}`);
		replacements.set(row.funding, `${fundingVerb} ${fundingLabel(row.funding.text.slice(fundingVerb.length + 1))}`);
		replacements.set(row.amount, formatPaiseAsRupees(amountPaise));
	}
	replacements.set(header.period, shiftYears(header.period.text));
	replacements.set(header.sentTotal, formatPaiseAsRupees(sentPaise));
	replacements.set(header.receivedTotal, formatPaiseAsRupees(receivedPaise));
	const contactText = header.contact?.text;
	const anonymizedText = (item: TextItem, pageNumber: number): string => {
		if (item.text === contactText) return "9999999999, someone@example.com";
		if (pageFooter.test(item.text)) return `Page ${pageNumber} of ${keptLayer.pages.length}`;
		return replacements.get(item) ?? item.text;
	};

	const pages: TextPage[] = keptLayer.pages.map((page) => ({
		pageNumber: page.pageNumber,
		items: page.items.map((item) => ({ ...item, text: anonymizedText(item, page.pageNumber) })),
	}));
	const anonymized = { pages };
	const serialized = JSON.stringify(anonymized).toLowerCase();
	const leaks = originalsOf(rows, header.contact).filter((original) => serialized.includes(original.toLowerCase()));
	if (leaks.length > 0) {
		return { kind: "rejected", reason: `${leaks.length} original identifiers survived anonymization.` };
	}
	return { kind: "anonymized", textLayer: anonymized };
}
