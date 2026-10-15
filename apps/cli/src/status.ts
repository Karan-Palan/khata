import * as z from "zod";
import packageJson from "../package.json" with { type: "json" };
import type { Store } from "./store/store.ts";

export const khataVersion = packageJson.version;

export const ledgerStatusSchema = z.object({
	version: z.string(),
	databasePath: z.string(),
	schemaVersion: z.number().int(),
	documentCount: z.number().int(),
	transactionCount: z.number().int(),
	firstOccurredAt: z.string().nullable(),
	lastOccurredAt: z.string().nullable(),
});

export type LedgerStatus = z.infer<typeof ledgerStatusSchema>;

export function readLedgerStatus(store: Store): LedgerStatus {
	return { version: khataVersion, databasePath: store.databasePath, ...store.status() };
}

export function formatLedgerStatus(status: LedgerStatus): string {
	const coverage =
		status.firstOccurredAt === null || status.lastOccurredAt === null
			? "empty"
			: `${status.firstOccurredAt.slice(0, 10)} to ${status.lastOccurredAt.slice(0, 10)}`;
	return [
		`khata ${status.version}`,
		`database      ${status.databasePath}`,
		`schema        ${status.schemaVersion}`,
		`documents     ${status.documentCount}`,
		`transactions  ${status.transactionCount}`,
		`covers        ${coverage}`,
	].join("\n");
}
