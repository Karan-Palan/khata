import { formatPaiseAsRupees } from "./money.ts";

export type UpiApp = "google_pay";

export type Direction = "sent" | "received";

export type Transaction = {
	readonly occurredAt: string;
	readonly direction: Direction;
	readonly amountPaise: number;
	readonly counterpartyName: string | null;
	readonly counterpartyUpiId: string | null;
	readonly upiReference: string | null;
	readonly appTransactionId: string | null;
	readonly fundingAccount: string | null;
	readonly note: string | null;
};

export type DeclaredTotals = {
	readonly sentPaise: number;
	readonly receivedPaise: number;
};

export type Statement = {
	readonly upiApp: UpiApp;
	readonly layout: string;
	readonly parserVersion: string;
	readonly periodStart: string;
	readonly periodEnd: string;
	readonly declaredTotals: DeclaredTotals;
	readonly transactions: readonly Transaction[];
};

export type ParseOutcome =
	| { readonly kind: "parsed"; readonly statement: Statement }
	| { readonly kind: "rejected"; readonly reason: string };

export function rejected(reason: string): ParseOutcome {
	return { kind: "rejected", reason };
}

function sumPaise(transactions: readonly Transaction[], direction: Direction): number {
	return transactions
		.filter((transaction) => transaction.direction === direction)
		.reduce((total, { amountPaise }) => total + amountPaise, 0);
}

export function checkDeclaredTotals(statement: Statement): ParseOutcome {
	const mismatches = (["sent", "received"] as const)
		.map((direction) => ({
			direction,
			parsed: sumPaise(statement.transactions, direction),
			declared: direction === "sent" ? statement.declaredTotals.sentPaise : statement.declaredTotals.receivedPaise,
		}))
		.filter(({ parsed, declared }) => parsed !== declared)
		.map(
			({ direction, parsed, declared }) =>
				`${direction} total ${formatPaiseAsRupees(parsed)} differs from the declared ${formatPaiseAsRupees(declared)}`,
		);
	if (mismatches.length > 0) return rejected(`Statement totals do not match: ${mismatches.join("; ")}.`);
	return { kind: "parsed", statement };
}
