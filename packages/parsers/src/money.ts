export type DigitGrouping = "indian" | "international";

const rupeeAmounts: Readonly<Record<DigitGrouping, RegExp>> = {
	indian: /^₹(\d+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.(\d{1,2}))?$/,
	international: /^₹(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/,
};

export function parseRupeesToPaise(text: string, grouping: DigitGrouping = "indian"): number | null {
	const match = rupeeAmounts[grouping].exec(text.trim());
	if (match === null) return null;
	const [, rupees = "", fraction = ""] = match;
	return Number(rupees.replaceAll(",", "")) * 100 + Number(fraction.padEnd(2, "0"));
}

export function formatPaiseAsRupees(paise: number): string {
	const sign = paise < 0 ? "-" : "";
	const absolute = Math.abs(paise);
	const rupees = String(Math.trunc(absolute / 100));
	const remainder = absolute % 100;
	const lastThree = rupees.slice(-3);
	const leading = rupees.slice(0, -3).replace(/\B(?=(\d{2})+$)/g, ",");
	const grouped = leading === "" ? lastThree : `${leading},${lastThree}`;
	return `${sign}₹${grouped}${remainder === 0 ? "" : `.${String(remainder).padStart(2, "0")}`}`;
}

export function formatPaiseAsInternationalRupees(paise: number): string {
	const rupees = Math.trunc(Math.abs(paise) / 100).toLocaleString("en-US");
	return `${paise < 0 ? "-" : ""}₹${rupees}.${String(Math.abs(paise) % 100).padStart(2, "0")}`;
}
