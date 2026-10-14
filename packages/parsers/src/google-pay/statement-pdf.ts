import { parseRupeesToPaise } from "../money.ts";
import { type ParseOutcome, rejected, type Transaction } from "../statement.ts";
import type { TextItem, TextLayer, TextPage } from "../text-layer.ts";

export const googlePayStatementPdfParserVersion = "google-pay/statement-pdf@1";

const monthNumbers: Readonly<Record<string, string>> = {
	Jan: "01",
	Feb: "02",
	Mar: "03",
	Apr: "04",
	May: "05",
	Jun: "06",
	Jul: "07",
	Aug: "08",
	Sep: "09",
	Oct: "10",
	Nov: "11",
	Dec: "12",
};

const rowDate = /^(\d{2}) ([A-Z][a-z]{2}), (\d{4})$/;
const rowTime = /^(\d{1,2}):(\d{2}) (AM|PM)$/;
const counterpartyLine = /^(Paid to|Received from) (.+)$/;
const referenceLine = /^UPI Transaction ID: (\d{12})$/;
const fundingLine = /^(?:Paid by|Paid to) (.+)$/;
const amountText = /^₹[\d,]+(?:\.\d{1,2})?$/;
const periodLine = /^(\d{2}) ([A-Z][a-z]+) (\d{4}) - (\d{2}) ([A-Z][a-z]+) (\d{4})$/;
const contactLine = /^\d{10}, \S+@\S+$/;

const sameLineTolerance = 2;
const dateColumnLimit = 100;

export type StatementRowItems = {
	readonly date: TextItem;
	readonly time: TextItem;
	readonly counterparty: TextItem;
	readonly reference: TextItem;
	readonly funding: TextItem;
	readonly amount: TextItem;
};

export type StatementHeaderItems = {
	readonly period: TextItem;
	readonly sentTotal: TextItem;
	readonly receivedTotal: TextItem;
	readonly contact: TextItem | null;
};

export type StatementLayoutItems = {
	readonly header: StatementHeaderItems;
	readonly rowsByPage: ReadonlyMap<number, readonly StatementRowItems[]>;
};

export type LayoutReading =
	| { readonly kind: "read"; readonly layout: StatementLayoutItems }
	| { readonly kind: "rejected"; readonly reason: string };

export function isGooglePayStatementPdf(textLayer: TextLayer): boolean {
	const firstPageTexts = new Set(textLayer.pages[0]?.items.map(({ text }) => text));
	return (
		firstPageTexts.has("Transaction statement") &&
		firstPageTexts.has("Transaction statement period") &&
		[...firstPageTexts].some((text) => text.includes("payments made by you on the Google Pay app"))
	);
}

function readHeader(firstPage: TextPage): StatementHeaderItems | null {
	const label = firstPage.items.find(({ text }) => text === "Transaction statement period");
	const period = firstPage.items.find(({ text }) => periodLine.test(text));
	if (label === undefined || period === undefined) return null;
	const totals = firstPage.items
		.filter(({ text, y }) => amountText.test(text) && Math.abs(y - period.y) <= sameLineTolerance)
		.toSorted((left, right) => left.x - right.x);
	const [sentTotal, receivedTotal] = totals;
	if (totals.length !== 2 || sentTotal === undefined || receivedTotal === undefined) return null;
	const contact = firstPage.items.find(({ text }) => contactLine.test(text)) ?? null;
	return { period, sentTotal, receivedTotal, contact };
}

function readRows(page: TextPage): readonly StatementRowItems[] | string {
	const anchors = page.items
		.filter(({ text, x }) => x < dateColumnLimit && rowDate.test(text))
		.toSorted((upper, lower) => lower.y - upper.y);
	const rows: StatementRowItems[] = [];
	for (const [index, date] of anchors.entries()) {
		const floor = anchors[index + 1]?.y ?? Number.NEGATIVE_INFINITY;
		const block = page.items.filter(({ y }) => y <= date.y + sameLineTolerance && y > floor + sameLineTolerance);
		const onDateLine = block.filter(({ y }) => Math.abs(y - date.y) <= sameLineTolerance);
		const belowDateLine = block.filter(({ y }) => date.y - y > sameLineTolerance);
		const counterparty = onDateLine.find(({ text }) => counterpartyLine.test(text));
		const amount = onDateLine.find(({ text }) => amountText.test(text));
		const time = belowDateLine.find(({ text, x }) => x < dateColumnLimit && rowTime.test(text));
		const reference = belowDateLine.find(({ text }) => referenceLine.test(text));
		const funding = belowDateLine.find(({ text }) => fundingLine.test(text));
		if (
			counterparty === undefined ||
			amount === undefined ||
			time === undefined ||
			reference === undefined ||
			funding === undefined
		) {
			const lines = block.map(({ text }) => text).join(" | ");
			return `Unsupported transaction on page ${page.pageNumber} dated ${date.text}: ${lines}`;
		}
		rows.push({ date, time, counterparty, reference, funding, amount });
	}
	return rows;
}

export function readGooglePayStatementLayout(textLayer: TextLayer): LayoutReading {
	const [firstPage] = textLayer.pages;
	const header = firstPage === undefined ? null : readHeader(firstPage);
	if (header === null)
		return { kind: "rejected", reason: "Google Pay statement header is missing its period or totals." };
	const rowsByPage = new Map<number, readonly StatementRowItems[]>();
	for (const page of textLayer.pages) {
		const rows = readRows(page);
		if (typeof rows === "string") return { kind: "rejected", reason: rows };
		rowsByPage.set(page.pageNumber, rows);
	}
	return { kind: "read", layout: { header, rowsByPage } };
}

function isoDate(day: string, month: string, year: string): string | null {
	const monthNumber = monthNumbers[month.slice(0, 3)];
	return monthNumber === undefined ? null : `${year}-${monthNumber}-${day}`;
}

function isoInstant(dateText: string, timeText: string): string | null {
	const [, day = "", month = "", year = ""] = rowDate.exec(dateText) ?? [];
	const [, hour = "", minute = "", meridiem = ""] = rowTime.exec(timeText) ?? [];
	const date = isoDate(day, month, year);
	if (date === null || hour === "") return null;
	const hour24 = (Number(hour) % 12) + (meridiem === "PM" ? 12 : 0);
	return `${date}T${String(hour24).padStart(2, "0")}:${minute}:00+05:30`;
}

function toTransaction(row: StatementRowItems): Transaction | string {
	const [, verb = "", counterpartyName = ""] = counterpartyLine.exec(row.counterparty.text) ?? [];
	const [, upiReference = ""] = referenceLine.exec(row.reference.text) ?? [];
	const [, fundingAccount = ""] = fundingLine.exec(row.funding.text) ?? [];
	const occurredAt = isoInstant(row.date.text, row.time.text);
	const amountPaise = parseRupeesToPaise(row.amount.text);
	if (occurredAt === null || amountPaise === null || amountPaise <= 0) {
		return `Unreadable date, time, or amount in "${row.date.text} ${row.time.text} ${row.amount.text}".`;
	}
	return {
		occurredAt,
		direction: verb === "Paid to" ? "sent" : "received",
		amountPaise,
		counterpartyName: counterpartyName.trim(),
		counterpartyUpiId: null,
		upiReference,
		appTransactionId: null,
		fundingAccount: fundingAccount.trim(),
		note: null,
	};
}

export function parseGooglePayStatementPdf(textLayer: TextLayer): ParseOutcome {
	const reading = readGooglePayStatementLayout(textLayer);
	if (reading.kind === "rejected") return rejected(reading.reason);
	const { header, rowsByPage } = reading.layout;
	const [, startDay = "", startMonth = "", startYear = "", endDay = "", endMonth = "", endYear = ""] =
		periodLine.exec(header.period.text) ?? [];
	const periodStart = isoDate(startDay, startMonth, startYear);
	const periodEnd = isoDate(endDay, endMonth, endYear);
	const sentPaise = parseRupeesToPaise(header.sentTotal.text);
	const receivedPaise = parseRupeesToPaise(header.receivedTotal.text);
	if (periodStart === null || periodEnd === null || sentPaise === null || receivedPaise === null) {
		return rejected("Google Pay statement header has an unreadable period or totals.");
	}
	const transactions: Transaction[] = [];
	for (const row of [...rowsByPage.values()].flat()) {
		const transaction = toTransaction(row);
		if (typeof transaction === "string") return rejected(transaction);
		transactions.push(transaction);
	}
	return {
		kind: "parsed",
		statement: {
			upiApp: "google_pay",
			layout: "statement_pdf",
			parserVersion: googlePayStatementPdfParserVersion,
			periodStart,
			periodEnd,
			declaredTotals: { sentPaise, receivedPaise },
			transactions,
		},
	};
}
