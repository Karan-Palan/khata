import { describe, expect, test } from "bun:test";
import type { ActivityExport, ActivityPayment, PaymentStatus, Statement, Transaction } from "@khata/parsers";
import { projectLedger } from "../src/ledger/projection.ts";
import { loadActivityFixture, loadStatementFixture } from "./run-khata.ts";

function transaction(overrides: Partial<Transaction>): Transaction {
	return {
		occurredAt: "2026-05-10T10:00:00+05:30",
		direction: "sent",
		amountPaise: 10000,
		counterpartyName: "Asha Store",
		counterpartyUpiId: null,
		upiReference: null,
		appTransactionId: null,
		fundingAccount: null,
		note: null,
		...overrides,
	};
}

function statement(periodStart: string, periodEnd: string, transactions: readonly Transaction[]): Statement {
	return {
		upiApp: "google_pay",
		layout: "statement_pdf",
		parserVersion: "test-statement@1",
		periodStart,
		periodEnd,
		declaredTotals: { sentPaise: 0, receivedPaise: 0 },
		transactions,
	};
}

function payment(status: PaymentStatus, appTransactionId: string, occurredAt: string): ActivityPayment {
	return { status, transaction: transaction({ appTransactionId, occurredAt }) };
}

function activity(coveredTo: string, payments: readonly ActivityPayment[]): ActivityExport {
	return {
		upiApp: "google_pay",
		layout: "takeout_my_activity_json",
		parserVersion: "test-activity@1",
		coveredFrom: "2026-01-01",
		coveredTo,
		payments,
		otherEntryCount: 0,
	};
}

describe("projectLedger", () => {
	test("keeps the statement's transactions for its period and fills other periods from completed activity", () => {
		const projection = projectLedger([
			{
				kind: "statement",
				documentId: "may-statement",
				statement: statement("2026-05-01", "2026-05-31", [transaction({ upiReference: "612345678901" })]),
			},
			{
				kind: "activity",
				documentId: "takeout",
				activity: activity("2026-06-30", [
					payment("completed", "inside-may", "2026-05-10T10:00:41+05:30"),
					payment("completed", "in-june", "2026-06-02T09:15:00+05:30"),
					payment("failed", "failed-in-june", "2026-06-03T09:15:00+05:30"),
				]),
			},
		]);
		expect(projection.rows.map(({ id, documentId }) => [id, documentId])).toEqual([
			["upi:612345678901", "may-statement"],
			["app:google_pay:in-june", "takeout"],
		]);
		expect(projection.report).toEqual({ fromStatements: 1, fromActivity: 1, coveredByStatement: 1, notCompleted: 1 });
	});

	test("lets the most recent activity export decide a payment's status", () => {
		const projection = projectLedger([
			{
				kind: "activity",
				documentId: "later",
				activity: activity("2026-07-31", [
					payment("completed", "settled-later", "2026-06-02T09:15:00+05:30"),
					payment("failed", "reversed-later", "2026-06-03T09:15:00+05:30"),
				]),
			},
			{
				kind: "activity",
				documentId: "earlier",
				activity: activity("2026-06-30", [
					payment("pending", "settled-later", "2026-06-02T09:15:00+05:30"),
					payment("completed", "reversed-later", "2026-06-03T09:15:00+05:30"),
				]),
			},
		]);
		expect(projection.rows.map(({ id }) => id)).toEqual(["app:google_pay:settled-later"]);
		expect(projection.report).toEqual({ fromStatements: 0, fromActivity: 1, coveredByStatement: 0, notCompleted: 1 });
	});

	test("combines the Google Pay statement and Takeout fixtures without counting a payment twice", async () => {
		const { statement: statementFixture } = await loadStatementFixture();
		const { activity: activityFixture } = await loadActivityFixture();
		const projection = projectLedger([
			{ kind: "statement", documentId: "statement", statement: statementFixture },
			{ kind: "activity", documentId: "takeout", activity: activityFixture },
		]);
		expect(projection.rows.length).toBe(31);
		expect(projection.report).toEqual({
			fromStatements: 18,
			fromActivity: 13,
			coveredByStatement: 2,
			notCompleted: 40,
		});
	});
});
