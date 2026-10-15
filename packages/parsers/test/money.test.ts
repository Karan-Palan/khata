import { describe, expect, test } from "bun:test";
import { formatPaiseAsRupees, parseRupeesToPaise } from "../src/money.ts";

describe("parseRupeesToPaise", () => {
	test("reads Indian digit grouping and paise exactly", () => {
		expect(
			["₹18,04,718.46", "₹5,09,386", "₹45,000", "₹59", "₹1,234.5", "₹0.07", "₹12345"].map((text) =>
				parseRupeesToPaise(text),
			),
		).toEqual([180471846, 50938600, 4500000, 5900, 123450, 7, 1234500]);
	});

	test("reads international digit grouping when asked", () => {
		expect(
			["₹180,471.46", "₹45,000.00", "₹9999.99", "₹59.00"].map((text) => parseRupeesToPaise(text, "international")),
		).toEqual([18047146, 4500000, 999999, 5900]);
	});

	test("rejects text that is not a rupee amount in the requested grouping", () => {
		expect(["45,000", "₹", "₹1,23", "₹12.345", "Rs. 59"].map((text) => parseRupeesToPaise(text))).toEqual([
			null,
			null,
			null,
			null,
			null,
		]);
		expect(["₹18,04,718.46", "₹1,23"].map((text) => parseRupeesToPaise(text, "international"))).toEqual([null, null]);
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
