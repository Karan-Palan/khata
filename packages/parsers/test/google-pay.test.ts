import { describe, expect, test } from "bun:test";
import { anonymizeGooglePayStatement } from "../src/google-pay/anonymize.ts";
import { parseStatement } from "../src/parse-statement.ts";
import { loadFixture, replaceTexts } from "./fixtures.ts";

const { textLayer, expected } = await loadFixture("google-pay/statement-pdf");

describe("parseStatement on a Google Pay statement PDF", () => {
	test("reads every transaction and the declared totals", () => {
		expect(parseStatement(textLayer)).toEqual({ kind: "parsed", statement: expected });
	});

	test("rejects the statement when a transaction amount disagrees with the declared totals", () => {
		const tampered = replaceTexts(textLayer, (text) => (text === "₹89.19" ? "₹89.20" : text));
		expect(parseStatement(tampered)).toEqual({
			kind: "rejected",
			reason: "Statement totals do not match: sent total ₹12,761.56 differs from the declared ₹12,761.55.",
		});
	});

	test("rejects a transaction line it does not understand instead of guessing", () => {
		const tampered = replaceTexts(textLayer, (text) =>
			text === "Paid to Counterparty 001" ? "Self transfer to Counterparty 001" : text,
		);
		const outcome = parseStatement(tampered);
		expect(outcome.kind).toBe("rejected");
		expect(
			outcome.kind === "rejected" && outcome.reason.startsWith("Unsupported transaction on page 1 dated 01 Apr, 2018:"),
		).toBe(true);
	});

	test("rejects documents that are not a known statement", () => {
		expect(parseStatement({ pages: [{ pageNumber: 1, items: [{ text: "Hello", x: 10, y: 10 }] }] })).toEqual({
			kind: "rejected",
			reason: "Unrecognized statement. khata currently reads Google Pay statement PDFs.",
		});
	});
});

describe("anonymizeGooglePayStatement", () => {
	const realistic = replaceTexts(textLayer, (text) =>
		text
			.replace(/Counterparty (\d+)/, "Asha Sharma $1")
			.replace(/Example Bank 0001/, "Sample Bank 4321")
			.replace(/\b9000000000(\d\d)\b/, "4000000000$1")
			.replace("9999999999, someone@example.com", "9876543210, asha@example.org"),
	);

	test("replaces every identifier and keeps the statement parseable with matching totals", () => {
		const outcome = anonymizeGooglePayStatement(realistic, 1);
		expect(outcome.kind).toBe("anonymized");
		if (outcome.kind !== "anonymized") return;
		const serialized = JSON.stringify(outcome.textLayer);
		expect(
			["Asha", "Sharma", "Sample Bank", "4321", "4000000000", "9876543210", "asha@"].filter((leak) =>
				serialized.includes(leak),
			),
		).toEqual([]);
		const parsed = parseStatement(outcome.textLayer);
		expect(parsed.kind === "parsed" && parsed.statement.periodStart).toBe("2010-04-01");
		expect(parsed.kind === "parsed" && parsed.statement.transactions.length).toBe(8);
	});
});
