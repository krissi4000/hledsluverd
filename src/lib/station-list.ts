// Homepage station list: text search, "near me" coordinates and sort order.
// All of it lives in the URL like the other filters, so the list renders on the
// server, works without JS and can be shared.

import type { LatLng } from './geo';

/** URL param for the free-text station search (name or town). */
export const SEARCH_PARAM = 'leit';
/** URL param for the visitor's position, "lat,lng" rounded to NEAR_DECIMALS. */
export const NEAR_PARAM = 'nalaegt';
/** 3 decimals ≈ 110 m north–south and ~50 m east–west in Iceland: plenty to sort
 * stations by distance, too coarse to pin down a house. */
export const NEAR_DECIMALS = 3;
/** Longest search we bother with: the box is for a station name or a town. */
export const SEARCH_MAX_LENGTH = 80;

/** Lower-case, accent-free form, so "reykjavik" finds "Reykjavík" and "blonduos" "Blönduósi". */
export function normalizeSearch(s: string): string {
	return s
		.toLowerCase()
		.replace(/ð/g, 'd')
		.replace(/þ/g, 'th')
		.replace(/æ/g, 'ae')
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/** The search from the URL, trimmed and capped; '' = no search. */
export function parseSearch(raw: string | null): string {
	return (raw ?? '').trim().slice(0, SEARCH_MAX_LENGTH);
}

/** Every word of the query must appear somewhere in the fields (name, address). */
export function matchesSearch(query: string, fields: (string | null)[]): boolean {
	const words = normalizeSearch(query).split(' ').filter(Boolean);
	if (words.length === 0) return true;
	const hay = normalizeSearch(fields.filter(Boolean).join(' '));
	return words.every((w) => hay.includes(w));
}

const roundCoord = (n: number) => Number(n.toFixed(NEAR_DECIMALS));

/** "64.146,-21.942" → a position (rounded again, whatever the URL says); else null. */
export function parseNear(raw: string | null): LatLng | null {
	if (!raw) return null;
	const parts = raw.split(',');
	if (parts.length !== 2) return null;
	const [lat, lng] = parts.map((p) => (/^\s*-?\d+(\.\d+)?\s*$/.test(p) ? Number(p) : NaN));
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
	if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
	return { lat: roundCoord(lat), lng: roundCoord(lng) };
}

/** The URL value for a position, rounded before it ever leaves the browser. */
export function formatNear(p: LatLng): string {
	return `${p.lat.toFixed(NEAR_DECIMALS)},${p.lng.toFixed(NEAR_DECIMALS)}`;
}

export interface SortableStation {
	name: string;
	price: number | null;
	/** price with per-minute fees folded in for the chosen car (null = unknown) */
	effectivePrice?: number | null;
	distanceKm?: number | null;
}

const byNullable = (a: number | null | undefined, b: number | null | undefined) =>
	(a ?? Infinity) - (b ?? Infinity);

/**
 * Sort order: by distance when the visitor shared a position; else by the chosen car's
 * effective price (a station whose effective price can't be worked out comes after
 * those that can, by raw price); else by raw price. Unknown prices last, then name.
 */
export function sortStations<T extends SortableStation>(
	rows: T[],
	by: 'distance' | 'effective' | 'price'
): T[] {
	const name = (a: T, b: T) => a.name.localeCompare(b.name, 'is');
	const price = (a: T, b: T) => byNullable(a.price, b.price);
	const effective = (s: T) => (s.price === null ? null : (s.effectivePrice ?? null));
	const cmp =
		by === 'distance'
			? (a: T, b: T) => byNullable(a.distanceKm, b.distanceKm) || price(a, b) || name(a, b)
			: by === 'effective'
				? (a: T, b: T) => byNullable(effective(a), effective(b)) || price(a, b) || name(a, b)
				: (a: T, b: T) => price(a, b) || name(a, b);
	return [...rows].sort(cmp);
}
