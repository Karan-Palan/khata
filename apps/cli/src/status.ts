import * as z from "zod";
import packageJson from "../package.json" with { type: "json" };
import type { Store } from "./store/store.ts";

export const khataVersion = packageJson.version;

export const ledgerStatusSchema = z.object({
	version: z.string(),
	database: z.string(),
	schemaVersion: z.number().int(),
	documentCount: z.number().int(),
	transactionCount: z.number().int(),
	firstOccurredAt: z.string().nullable(),
	lastOccurredAt: z.string().nullable(),
});

export type LedgerStatus = z.infer<typeof ledgerStatusSchema>;

export async function readLedgerStatus(store: Store): Promise<LedgerStatus> {
	return { version: khataVersion, database: store.address, ...(await store.status()) };
}

export function formatLedgerStatus(status: LedgerStatus): string {
	const coverage =
		status.firstOccurredAt === null || status.lastOccurredAt === null
			? "empty"
			: `${status.firstOccurredAt.slice(0, 10)} to ${status.lastOccurredAt.slice(0, 10)}`;
	return [
		`khata ${status.version}`,
		`database      ${status.database}`,
		`schema        ${status.schemaVersion}`,
		`documents     ${status.documentCount}`,
		`transactions  ${status.transactionCount}`,
		`covers        ${coverage}`,
	].join("\n");
}
