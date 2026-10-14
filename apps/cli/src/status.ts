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
});

export type LedgerStatus = z.infer<typeof ledgerStatusSchema>;

export function readLedgerStatus(store: Store): LedgerStatus {
	return { version: khataVersion, databasePath: store.databasePath, ...store.status() };
}

export function formatLedgerStatus(status: LedgerStatus): string {
	return [
		`khata ${status.version}`,
		`database      ${status.databasePath}`,
		`schema        ${status.schemaVersion}`,
		`documents     ${status.documentCount}`,
		`transactions  ${status.transactionCount}`,
	].join("\n");
}
