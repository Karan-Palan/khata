import { type ActivityParseOutcome, type ActivityPayment, type PaymentStatus, toIndiaTime } from "../activity.ts";
import { parseRupeesToPaise } from "../money.ts";

export const googlePayTakeoutActivityParserVersion = "google-pay/takeout-activity@1";

export type TakeoutActivityEntry = {
	readonly header?: string;
	readonly title: string;
	readonly time: string;
	readonly products?: readonly string[];
	readonly details?: readonly { readonly name?: string }[];
};

const paymentTitle = /^(Paid|Sent|Received) (₹[\d,]+(?:\.\d{1,2})?)(?: (?:to|from) (.+))?$/;
const fundingSeparator = " using ";

const statuses: Readonly<Record<string, PaymentStatus>> = {
	Completed: "completed",
	Failed: "failed",
	Pending: "pending",
	Cancelled: "cancelled",
};

function isTakeoutActivityEntry(value: unknown): value is TakeoutActivityEntry {
	return (
		typeof value === "object" &&
		value !== null &&
		"title" in value &&
		typeof value.title === "string" &&
		"time" in value &&
		typeof value.time === "string"
	);
}

function isGooglePayEntry(entry: TakeoutActivityEntry): boolean {
	return entry.products?.includes("Google Pay") ?? entry.header === "Google Pay";
}

export function isGooglePayTakeoutActivity(value: unknown): value is readonly TakeoutActivityEntry[] {
	return Array.isArray(value) && value.every(isTakeoutActivityEntry) && value.some(isGooglePayEntry);
}

export function splitFunding(title: string): { readonly head: string; readonly fundingAccount: string | null } {
	const separatorAt = title.lastIndexOf(fundingSeparator);
	if (separatorAt === -1) return { head: title, fundingAccount: null };
	return { head: title.slice(0, separatorAt), fundingAccount: title.slice(separatorAt + fundingSeparator.length) };
}

export function isPaymentTitle(title: string): boolean {
	return paymentTitle.test(splitFunding(title).head);
}

function toPayment(entry: TakeoutActivityEntry): ActivityPayment | string {
	const { head, fundingAccount } = splitFunding(entry.title);
	const [, verb = "", amountText = "", counterpartyName] = paymentTitle.exec(head) ?? [];
	const amountPaise = parseRupeesToPaise(amountText, "international");
	const occurredAtMilliseconds = Date.parse(entry.time);
	const appTransactionId = entry.details?.[0]?.name;
	if (amountPaise === null || amountPaise <= 0) return `Unreadable amount in "${entry.title}".`;
	if (Number.isNaN(occurredAtMilliseconds)) return `Unreadable time "${entry.time}".`;
	if (appTransactionId === undefined || appTransactionId === "")
		return `Payment without an identifier: "${entry.title}".`;
	return {
		status: statuses[entry.details?.[1]?.name ?? ""] ?? "unknown",
		transaction: {
			occurredAt: toIndiaTime(occurredAtMilliseconds),
			direction: verb === "Received" ? "received" : "sent",
			amountPaise,
			counterpartyName: counterpartyName?.trim() ?? null,
			counterpartyUpiId: null,
			upiReference: null,
			appTransactionId,
			fundingAccount,
			note: null,
		},
	};
}

export function parseGooglePayTakeoutActivity(entries: readonly TakeoutActivityEntry[]): ActivityParseOutcome {
	const payments: ActivityPayment[] = [];
	let otherEntryCount = 0;
	for (const entry of entries) {
		if (!isGooglePayEntry(entry) || !isPaymentTitle(entry.title)) {
			otherEntryCount += 1;
			continue;
		}
		const payment = toPayment(entry);
		if (typeof payment === "string") return { kind: "rejected", reason: payment };
		payments.push(payment);
	}
	const days = payments.map(({ transaction }) => transaction.occurredAt.slice(0, 10)).toSorted();
	const [coveredFrom] = days;
	const coveredTo = days.at(-1);
	if (coveredFrom === undefined || coveredTo === undefined) {
		return { kind: "rejected", reason: "The export contains no Google Pay payments." };
	}
	return {
		kind: "parsed",
		activity: {
			upiApp: "google_pay",
			layout: "takeout_my_activity_json",
			parserVersion: googlePayTakeoutActivityParserVersion,
			coveredFrom,
			coveredTo,
			payments: payments.toSorted((left, right) =>
				left.transaction.occurredAt.localeCompare(right.transaction.occurredAt),
			),
			otherEntryCount,
		},
	};
}
