import { formatPaiseAsInternationalRupees } from "../money.ts";
import { isPaymentTitle, splitFunding, type TakeoutActivityEntry } from "./takeout-activity.ts";

export type ActivityAnonymizationOutcome =
	| { readonly kind: "anonymized"; readonly entries: readonly TakeoutActivityEntry[] }
	| { readonly kind: "rejected"; readonly reason: string };

const yearShift = 8;
const paymentHead = /^(Paid|Sent|Received) ₹[\d,]+(?:\.\d{1,2})?(?: (to|from) (.+))?$/;
const keptNonPaymentTitles = new Set(["Displayed Google Pay ads"]);

function shapeOf(entry: TakeoutActivityEntry): string {
	const { head, fundingAccount } = splitFunding(entry.title);
	const [, verb = "", preposition = ""] = paymentHead.exec(head) ?? [];
	return [verb, preposition, fundingAccount === null ? "" : "funded", entry.details?.[1]?.name ?? "none"].join("|");
}

function representativeEntries(entries: readonly TakeoutActivityEntry[], perShape: number): TakeoutActivityEntry[] {
	const taken = new Map<string, number>();
	return entries.filter((entry) => {
		if (!isPaymentTitle(entry.title)) return keptNonPaymentTitles.has(entry.title);
		const shape = shapeOf(entry);
		const count = taken.get(shape) ?? 0;
		taken.set(shape, count + 1);
		return count < perShape;
	});
}

function shiftYear(isoTime: string): string {
	return `${Number(isoTime.slice(0, 4)) - yearShift}${isoTime.slice(4)}`;
}

export function anonymizeGooglePayTakeoutActivity(
	entries: readonly TakeoutActivityEntry[],
	perShape: number,
): ActivityAnonymizationOutcome {
	const selected = representativeEntries(entries, perShape);
	const counterpartyLabels = new Map<string, string>();
	const originals = new Set<string>();
	const anonymized = selected.map((entry, index): TakeoutActivityEntry => {
		const identifier = `anonymized${String(index + 1).padStart(6, "0")}`;
		const time = shiftYear(entry.time);
		const details = [{ name: identifier }, ...(entry.details?.slice(1) ?? [])];
		const products = entry.products ?? [];
		if (!isPaymentTitle(entry.title))
			return { header: entry.header ?? "", title: entry.title, time, products, details };
		const { head, fundingAccount } = splitFunding(entry.title);
		const [, verb = "", preposition, counterpartyName] = paymentHead.exec(head) ?? [];
		const originalIdentifier = entry.details?.[0]?.name;
		if (originalIdentifier !== undefined) originals.add(originalIdentifier);
		if (fundingAccount !== null) originals.add(fundingAccount);
		let counterpartyPart = "";
		if (preposition !== undefined && counterpartyName !== undefined) {
			originals.add(counterpartyName);
			const label =
				counterpartyLabels.get(counterpartyName) ??
				`Counterparty ${String(counterpartyLabels.size + 1).padStart(3, "0")}`;
			counterpartyLabels.set(counterpartyName, label);
			counterpartyPart = ` ${preposition} ${label}`;
		}
		const amountPaise = (((index + 1) * 7919) % 900_000) + 1_000;
		const fundingPart = fundingAccount === null ? "" : " using Bank Account XXXXXX0000";
		const title = `${verb} ${formatPaiseAsInternationalRupees(amountPaise)}${counterpartyPart}${fundingPart}`;
		return { header: entry.header ?? "Google Pay", title, time, products, details };
	});
	const serialized = JSON.stringify(
		anonymized.filter(({ title }) => isPaymentTitle(title)).map(({ title, time, details }) => [title, time, details]),
	).toLowerCase();
	const leaks = [...originals].filter((original) => serialized.includes(original.toLowerCase()));
	if (leaks.length > 0) {
		return { kind: "rejected", reason: `${leaks.length} original identifiers survived anonymization.` };
	}
	return { kind: "anonymized", entries: anonymized };
}
