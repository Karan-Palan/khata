import { isGooglePayStatementPdf, parseGooglePayStatementPdf } from "./google-pay/statement-pdf.ts";
import { checkDeclaredTotals, type ParseOutcome, rejected } from "./statement.ts";
import type { TextLayer } from "./text-layer.ts";

export function parseStatement(textLayer: TextLayer): ParseOutcome {
	if (!isGooglePayStatementPdf(textLayer)) {
		return rejected("Unrecognized statement. khata currently reads Google Pay statement PDFs.");
	}
	const outcome = parseGooglePayStatementPdf(textLayer);
	return outcome.kind === "parsed" ? checkDeclaredTotals(outcome.statement) : outcome;
}
