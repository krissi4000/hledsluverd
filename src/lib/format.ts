export function formatNumber(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1).replace('.', ',');
}

export function formatIsk(value: number): string {
	return `${formatNumber(value)} kr`;
}

export function formatDate(d: Date): string {
	return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}`;
}

const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** Honesty rule: a price unverified for >30 days is still shown, but amber-flagged. */
export function isStale(verifiedAt: Date, now = new Date()): boolean {
	return now.getTime() - verifiedAt.getTime() > STALE_AFTER_MS;
}
