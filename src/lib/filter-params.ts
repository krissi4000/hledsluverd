// Multi-select filters kept in the URL (so they work without JS and can be shared).
// A missing param means "the defaults"; a present one lists exactly what is shown,
// comma-separated, in the options' own order. An empty value shows nothing.

import { ownBrandPriceOnly } from './networks';

/** URL param for the networks shown (homepage list and /kort). */
export const NETWORK_PARAM = 'fyrirtaeki';

/** Shown by default: every network except ones whose price only applies to their own
 * brand's cars (Tesla) — that price would mislead everyone else. A chosen car of that
 * brand brings its network back. */
export function defaultNetworks(slugs: readonly string[], carMake?: string | null): string[] {
	const make = carMake?.toLowerCase();
	return slugs.filter((s) => !ownBrandPriceOnly(s) || s === make);
}

/** The shown options. Unknown values are dropped; an old single-value link still works. */
export function parseShown(
	raw: string | null,
	options: readonly string[],
	defaults: readonly string[]
): string[] {
	if (raw === null) return [...defaults];
	const want = new Set(raw.split(','));
	return options.filter((o) => want.has(o));
}

/** The param value after toggling `item`, or null when that lands on the defaults
 * (the caller then drops the param, so the default URL stays clean). */
export function toggleParam(
	shown: readonly string[],
	item: string,
	options: readonly string[],
	defaults: readonly string[]
): string | null {
	const next = new Set(shown);
	if (next.has(item)) next.delete(item);
	else next.add(item);
	const ordered = options.filter((o) => next.has(o));
	return sameSet(ordered, defaults) ? null : ordered.join(',');
}

export function isDefault(shown: readonly string[], defaults: readonly string[]): boolean {
	return sameSet(shown, defaults);
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
	const sa = new Set(a);
	const sb = new Set(b);
	return sa.size === sb.size && [...sa].every((x) => sb.has(x));
}
