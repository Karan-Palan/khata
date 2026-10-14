import { describe, expect, test } from "bun:test";
import { formatPaiseAsRupees, parseRupeesToPaise } from "../src/money.ts";

describe("parseRupeesToPaise", () => {
	test("reads Indian digit grouping and paise exactly", () => {
		expect(
			["₹18,04,718.46", "₹5,09,386", "₹45,000", "₹59", "₹1,234.5", "₹0.07", "₹12345"].map(parseRupeesToPaise),
		).toEqual([180471846, 50938600, 4500000, 5900, 123450, 7, 1234500]);
	});

	test("rejects text that is not a rupee amount", () => {
		expect(["45,000", "₹", "₹1,23", "₹12.345", "Rs. 59"].map(parseRupeesToPaise)).toEqual([
			null,
			null,
			null,
			null,
			null,
		]);
	});
});

describe("formatPaiseAsRupees", () => {
	test("writes Indian digit grouping and drops zero paise", () => {
		expect([180471846, 50938600, 4500000, 5900, 123450, 7, 0, -12345].map(formatPaiseAsRupees)).toEqual([
			"₹18,04,718.46",
			"₹5,09,386",
			"₹45,000",
			"₹59",
			"₹1,234.50",
			"₹0.07",
			"₹0",
			"-₹123.45",
		]);
	});
});
