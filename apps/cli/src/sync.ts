import { type KhataConfig, sourceKey } from "./config.ts";
import type { IngestResult } from "./ingest.ts";
import { syncFolder } from "./sources/folder.ts";
import { type GoogleDependencies, syncGoogle } from "./sources/google.ts";
import type { Store } from "./store/store.ts";

export type SourceSyncReport = {
	readonly source: string;
	readonly ingested: number;
	readonly alreadyIngested: number;
	readonly rejected: number;
	readonly unchanged: number;
	readonly failure: string | null;
	readonly results: readonly IngestResult[];
};

const notAStatement = /^(Unrecognized statement|Not a Google Pay activity export|Unreadable PDF|No statement PDF)/;

function report(
	source: string,
	results: readonly IngestResult[],
	unchanged: number,
	failure: string | null,
): SourceSyncReport {
	const count = (outcome: IngestResult["outcome"]) => results.filter((result) => result.outcome === outcome).length;
	return {
		source,
		ingested: count("ingested"),
		alreadyIngested: count("already_ingested"),
		rejected: count("rejected"),
		unchanged,
		failure,
		results,
	};
}

export async function syncSources(
	store: Store,
	config: KhataConfig,
	google: GoogleDependencies,
): Promise<SourceSyncReport[]> {
	const reports: SourceSyncReport[] = [];
	for (const source of config.sources) {
		const key = sourceKey(source);
		if (source.kind === "folder") {
			const { results, unchanged } = await syncFolder(store, key, source.path);
			reports.push(report(key, results, unchanged, null));
		} else {
			const { results, unchanged, failure } = await syncGoogle(store, key, source, google);
			reports.push(report(key, results, unchanged, failure));
		}
	}
	return reports;
}

export function formatSyncReports(reports: readonly SourceSyncReport[]): string {
	if (reports.length === 0)
		return "No sources configured. Add one with khata sources add-folder <path> or khata auth google.";
	return reports
		.flatMap((sourceReport) => {
			const summary = `${sourceReport.source}: ${sourceReport.ingested} ingested, ${sourceReport.alreadyIngested} already ingested, ${sourceReport.rejected} not statements or unreadable, ${sourceReport.unchanged} unchanged`;
			const ingested = sourceReport.results.flatMap((result) =>
				result.outcome === "ingested"
					? [
							`  + ${result.path} (${result.periodStart} to ${result.periodEnd}, ledger now ${result.ledgerTransactionsAfter})`,
						]
					: [],
			);
			const problems = sourceReport.results.flatMap((result) =>
				result.outcome === "rejected" && !notAStatement.test(result.reason)
					? [`  ! ${result.path}: ${result.reason}`]
					: [],
			);
			const failure = sourceReport.failure === null ? [] : [`  ! ${sourceReport.failure}`];
			return [summary, ...ingested, ...problems, ...failure];
		})
		.join("\n");
}
