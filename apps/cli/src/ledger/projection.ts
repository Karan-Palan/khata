import type { ActivityExport, ActivityPayment, Statement, Transaction, UpiApp } from "@khata/parsers";
import type { LedgerRow } from "../store/store.ts";

export type ParsedDocument =
	| { readonly kind: "statement"; readonly documentId: string; readonly statement: Statement }
	| { readonly kind: "activity"; readonly documentId: string; readonly activity: ActivityExport };

export type ProjectionReport = {
	readonly fromStatements: number;
	readonly fromActivity: number;
	readonly coveredByStatement: number;
	readonly notCompleted: number;
};

export type Projection = {
	readonly rows: readonly LedgerRow[];
	readonly report: ProjectionReport;
};

type Coverage = { readonly upiApp: UpiApp; readonly firstDay: string; readonly lastDay: string };

type LatestPayment = {
	readonly payment: ActivityPayment;
	readonly documentId: string;
	readonly upiApp: UpiApp;
	readonly parserVersion: string;
};

export function transactionIdentity(upiApp: UpiApp, transaction: Transaction): string {
	if (transaction.upiReference !== null) return `upi:${transaction.upiReference}`;
	if (transaction.appTransactionId !== null) return `app:${upiApp}:${transaction.appTransactionId}`;
	const fingerprint = [
		upiApp,
		transaction.occurredAt,
		transaction.direction,
		transaction.amountPaise,
		transaction.counterpartyName,
	].join("|");
	return `content:${new Bun.CryptoHasher("sha256").update(fingerprint).digest("hex")}`;
}

function isCovered(coverage: readonly Coverage[], upiApp: UpiApp, occurredAt: string): boolean {
	const day = occurredAt.slice(0, 10);
	return coverage.some((period) => period.upiApp === upiApp && period.firstDay <= day && day <= period.lastDay);
}

export function projectLedger(documents: readonly ParsedDocument[]): Projection {
	const rows = new Map<string, LedgerRow>();
	const coverage: Coverage[] = [];

	for (const document of documents) {
		if (document.kind !== "statement") continue;
		const { statement } = document;
		coverage.push({ upiApp: statement.upiApp, firstDay: statement.periodStart, lastDay: statement.periodEnd });
		for (const transaction of statement.transactions) {
			const id = transactionIdentity(statement.upiApp, transaction);
			if (rows.has(id)) continue;
			rows.set(id, {
				...transaction,
				id,
				documentId: document.documentId,
				upiApp: statement.upiApp,
				parserVersion: statement.parserVersion,
			});
		}
	}
	const fromStatements = rows.size;

	const latestPayments = new Map<string, LatestPayment>();
	const activityDocuments = documents
		.flatMap((document) => (document.kind === "activity" ? [document] : []))
		.toSorted((earlier, later) => earlier.activity.coveredTo.localeCompare(later.activity.coveredTo));
	for (const { documentId, activity } of activityDocuments) {
		for (const payment of activity.payments) {
			latestPayments.set(transactionIdentity(activity.upiApp, payment.transaction), {
				payment,
				documentId,
				upiApp: activity.upiApp,
				parserVersion: activity.parserVersion,
			});
		}
	}

	let coveredByStatement = 0;
	let notCompleted = 0;
	let fromActivity = 0;
	for (const [id, { payment, documentId, upiApp, parserVersion }] of latestPayments) {
		if (payment.status !== "completed") {
			notCompleted += 1;
			continue;
		}
		if (isCovered(coverage, upiApp, payment.transaction.occurredAt)) {
			coveredByStatement += 1;
			continue;
		}
		rows.set(id, { ...payment.transaction, id, documentId, upiApp, parserVersion });
		fromActivity += 1;
	}

	return { rows: [...rows.values()], report: { fromStatements, fromActivity, coveredByStatement, notCompleted } };
}
