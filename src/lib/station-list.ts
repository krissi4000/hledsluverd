// Homepage station list: sort order (and, with it, the filters that live in the URL so
// the list renders on the server, works without JS and can be shared).

export interface SortableStation {
	name: string;
	price: number | null;
	/** price with per-minute fees folded in for the chosen car (null = unknown) */
	effectivePrice?: number | null;
}

const byNullable = (a: number | null | undefined, b: number | null | undefined) =>
	(a ?? Infinity) - (b ?? Infinity);

/**
 * Sort order: by the chosen car's effective price (a station whose effective price
 * can't be worked out comes after those that can, by raw price); else by raw price.
 * Unknown prices last, then name.
 */
export function sortStations<T extends SortableStation>(rows: T[], by: 'effective' | 'price'): T[] {
	const name = (a: T, b: T) => a.name.localeCompare(b.name, 'is');
	const price = (a: T, b: T) => byNullable(a.price, b.price);
	const effective = (s: T) => (s.price === null ? null : (s.effectivePrice ?? null));
	const cmp =
		by === 'effective'
			? (a: T, b: T) => byNullable(effective(a), effective(b)) || price(a, b) || name(a, b)
			: (a: T, b: T) => price(a, b) || name(a, b);
	return [...rows].sort(cmp);
}
