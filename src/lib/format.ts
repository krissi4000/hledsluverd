export function formatNumber(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1).replace('.', ',');
}

export function formatIsk(value: number): string {
	return `${formatNumber(value)} kr`;
}

/** A per-kWh price in plain text (titles, tooltips): "49 kr/kWh". */
export function formatIskPerKwh(value: number): string {
	return `${formatIsk(value)}/kWh`;
}

export function formatDate(d: Date): string {
	return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}`;
}

const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** Honesty rule: a price unverified for >30 days is still shown, but amber-flagged. */
export function isStale(verifiedAt: Date, now = new Date()): boolean {
	return now.getTime() - verifiedAt.getTime() > STALE_AFTER_MS;
}

/** Coarse age of a cache entry, for "as of N min ago" labels. */
export function ageParts(from: Date, now = new Date()): { n: number; unit: 'min' | 'h' | 'd' } {
	const min = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60000));
	if (min < 60) return { n: min, unit: 'min' };
	const h = Math.round(min / 60);
	if (h < 24) return { n: h, unit: 'h' };
	return { n: Math.round(h / 24), unit: 'd' };
}

/** An estimated amount: rounded to 10 kr (no false precision), "." thousands separator — "2.480 kr". */
export function formatEstimateIsk(value: number): string {
	const rounded = Math.round(value / 10) * 10;
	return `${String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} kr`;
}

/** "15:05" — UTC, which is Iceland's time all year (no daylight saving). */
export function formatTime(d: Date): string {
	return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** A relative age stops meaning much after a few days; older verifications show the date. */
export const RELATIVE_AGE_MAX_MS = 3 * 24 * 60 * 60 * 1000;

export function showRelativeAge(at: Date, now = new Date()): boolean {
	return now.getTime() - at.getTime() < RELATIVE_AGE_MAX_MS;
}

/** The text with its spaces made non-breaking, so a narrow column wraps around it whole:
 * "48 kr/kWh" never splits into "48" / "kr/kWh". */
export function noBreak(s: string): string {
	return s.replace(/ /g, '\u00a0');
}
