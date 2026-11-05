// Colour scale for map pins: how a station's price ranks against comparable
// stations. AC and DC prices are ranked separately, since AC is cheaper almost
// everywhere and would otherwise always look like a bargain next to DC.

export interface RankablePrice {
	id: number;
	price: number | null;
	mode?: 'AC' | 'DC';
}

/**
 * Percentile rank per station id: 0 = cheapest, 1 = most expensive, ties share
 * a rank. Stations with no price, or in a group with fewer than two distinct
 * prices, are left out (nothing to compare against → no colour).
 */
export function priceRanks(stations: RankablePrice[]): Map<number, number> {
	const groups = new Map<string, number[]>();
	for (const s of stations) {
		if (s.price === null) continue;
		const key = s.mode ?? 'all';
		let arr = groups.get(key);
		if (!arr) groups.set(key, (arr = []));
		arr.push(s.price);
	}
	const sortedByGroup = new Map<string, number[]>();
	for (const [key, prices] of groups) {
		const sorted = [...prices].sort((a, b) => a - b);
		if (sorted[0] !== sorted[sorted.length - 1]) sortedByGroup.set(key, sorted);
	}
	const ranks = new Map<number, number>();
	for (const s of stations) {
		if (s.price === null) continue;
		const sorted = sortedByGroup.get(s.mode ?? 'all');
		if (!sorted) continue;
		const below = sorted.filter((p) => p < s.price!).length;
		const equal = sorted.filter((p) => p === s.price).length;
		ranks.set(s.id, (below + (equal - 1) / 2) / (sorted.length - 1));
	}
	return ranks;
}

/** Green (cheap) → yellow → red (expensive), as light tints that keep dark text readable. */
export function rankColors(rank: number): { background: string; border: string } {
	const hue = Math.round(120 * (1 - Math.min(1, Math.max(0, rank))));
	return { background: `hsl(${hue} 75% 84%)`, border: `hsl(${hue} 55% 55%)` };
}
