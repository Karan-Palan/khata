import type { Transaction, UpiApp } from "./statement.ts";

export type PaymentStatus = "completed" | "failed" | "pending" | "cancelled" | "unknown";

export type ActivityPayment = {
	readonly status: PaymentStatus;
	readonly transaction: Transaction;
};

export type ActivityExport = {
	readonly upiApp: UpiApp;
	readonly layout: string;
	readonly parserVersion: string;
	readonly coveredFrom: string;
	readonly coveredTo: string;
	readonly payments: readonly ActivityPayment[];
	readonly otherEntryCount: number;
};

export type ActivityParseOutcome =
	| { readonly kind: "parsed"; readonly activity: ActivityExport }
	| { readonly kind: "rejected"; readonly reason: string };

const indiaOffsetMilliseconds = 330 * 60_000;

export function toIndiaTime(epochMilliseconds: number): string {
	return `${new Date(epochMilliseconds + indiaOffsetMilliseconds).toISOString().slice(0, 19)}+05:30`;
}
