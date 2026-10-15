import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { ActivityExport } from "../src/activity.ts";
import { anonymizeGooglePayTakeoutActivity } from "../src/google-pay/anonymize-takeout-activity.ts";
import {
	isGooglePayTakeoutActivity,
	parseGooglePayTakeoutActivity,
	type TakeoutActivityEntry,
} from "../src/google-pay/takeout-activity.ts";

const fixturePrefix = join(import.meta.dir, "fixtures", "google-pay", "takeout-activity");
const entries: TakeoutActivityEntry[] = await Bun.file(`${fixturePrefix}.activity.json`).json();
const expected: ActivityExport = await Bun.file(`${fixturePrefix}.expected.json`).json();

function entry(title: string, status: string): TakeoutActivityEntry {
	return {
		header: "Google Pay",
		title,
		time: "2026-05-01T04:30:15.250Z",
		products: ["Google Pay"],
		details: [{ name: "aB3dE5gH7jK9mN1p" }, { name: status }],
	};
}

describe("parseGooglePayTakeoutActivity", () => {
	test("reads every payment with its status, in time order", () => {
		expect(parseGooglePayTakeoutActivity(entries)).toEqual({ kind: "parsed", activity: expected });
	});

	test("reads each title shape into direction, amount, counterparty, and funding account", () => {
		const outcome = parseGooglePayTakeoutActivity([
			entry("Paid ₹1,234.50 to Asha Store using Bank Account XXXXXX4321", "Completed"),
			entry("Sent ₹500.00 using Bank Account XXXXXX4321", "Failed"),
			entry("Received ₹2,000.00 from Ravi Kumar", "Pending"),
			entry("Received ₹75.00", "Cancelled"),
		]);
		expect(
			outcome.kind === "parsed" &&
				outcome.activity.payments.map(({ status, transaction }) => [
					status,
					transaction.occurredAt,
					transaction.direction,
					transaction.amountPaise,
					transaction.counterpartyName,
					transaction.fundingAccount,
				]),
		).toEqual([
			["completed", "2026-05-01T10:00:15+05:30", "sent", 123450, "Asha Store", "Bank Account XXXXXX4321"],
			["failed", "2026-05-01T10:00:15+05:30", "sent", 50000, null, "Bank Account XXXXXX4321"],
			["pending", "2026-05-01T10:00:15+05:30", "received", 200000, "Ravi Kumar", null],
			["cancelled", "2026-05-01T10:00:15+05:30", "received", 7500, null, null],
		]);
	});

	test("rejects the export when a payment amount cannot be read", () => {
		expect(parseGooglePayTakeoutActivity([entry("Paid ₹1,2,3 to Asha Store", "Completed")])).toEqual({
			kind: "rejected",
			reason: 'Unreadable amount in "Paid ₹1,2,3 to Asha Store".',
		});
	});

	test("recognizes only Google Pay activity", () => {
		expect([
			isGooglePayTakeoutActivity(entries),
			isGooglePayTakeoutActivity([{ title: "Searched for upi", time: "2026-05-01T04:30:15Z", products: ["Search"] }]),
			isGooglePayTakeoutActivity({ entries }),
		]).toEqual([true, false, false]);
	});
});

describe("anonymizeGooglePayTakeoutActivity", () => {
	test("replaces names, identifiers, accounts, and amounts and keeps every shape parseable", () => {
		const realistic = [
			entry("Paid ₹1,234.50 to Asha Store using Bank Account XXXXXX4321", "Completed"),
			entry("Received ₹2,000.00 from Ravi Kumar", "Completed"),
			entry("Sent ₹500.00 using Bank Account XXXXXX4321", "Failed"),
		];
		const outcome = anonymizeGooglePayTakeoutActivity(realistic, 3);
		expect(outcome.kind).toBe("anonymized");
		if (outcome.kind !== "anonymized") return;
		const serialized = JSON.stringify(outcome.entries);
		expect(
			["Asha", "Ravi", "4321", "aB3dE5gH7jK9mN1p", "1,234.50", "2026-"].filter((leak) => serialized.includes(leak)),
		).toEqual([]);
		const parsed = parseGooglePayTakeoutActivity(outcome.entries);
		expect(parsed.kind === "parsed" && parsed.activity.payments.map(({ status }) => status)).toEqual([
			"completed",
			"completed",
			"failed",
		]);
	});
});
