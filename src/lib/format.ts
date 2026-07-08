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

/** Coarse age of a cache entry, for "as of N min ago" labels. */
export function ageParts(from: Date, now = new Date()): { n: number; unit: 'min' | 'h' | 'd' } {
	const min = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60000));
	if (min < 60) return { n: min, unit: 'min' };
	const h = Math.round(min / 60);
	if (h < 24) return { n: h, unit: 'h' };
	return { n: Math.round(h / 24), unit: 'd' };
}
