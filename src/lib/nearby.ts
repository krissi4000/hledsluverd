// "Nálægt mér": which stations the card list shows and in what order.
//
// The order comes from a small fuzzy-logic system (zero-order Sugeno). Distance and
// price each belong, to some degree, to three fuzzy sets (low / mid / high). Every
// pair of sets is a rule with a fixed "how good is this" output. A rule's firing
// strength is the product of the two memberships, and a station's score is the
// strength-weighted average of the rule outputs. Distance weighs more than price
// because the rule table drops faster down its rows than across its columns.
//
// The memberships of each input always add up to 1, so the score is a smooth blend of
// the table, and a station that is both nearer and cheaper never ranks below another.

/** URL param for a battery size typed in by hand (no car chosen), in kWh. */
export const BATTERY_PARAM = 'rafhlada';
export const BATTERY_MIN_KWH = 5;
export const BATTERY_MAX_KWH = 250;

/** How many of the nearest stations the card list ranks and shows. */
export const NEARBY_COUNT = 20;

/**
 * Distance is compared on a log scale, so 1 vs 3 km in town matters about as much as
 * 10 vs 30 km in the country. DISTANCE_SCALE_KM sets where the scale bends.
 */
export const DISTANCE_SCALE_KM = 5;
/** The far end of the distance scale is the farthest candidate, but never under this,
 * so in town a station 3 km off does not count as "far". */
export const DISTANCE_FLOOR_KM = 10;
/** The price scale spans the candidates' prices, but at least this share of the
 * cheapest one: a 2 kr difference is not "cheap vs expensive". */
export const PRICE_MIN_SPREAD = 0.2;
/** A station with no known price is scored as the most expensive one, then this much
 * lower again, so it sinks well down the list without disappearing. */
export const UNKNOWN_PRICE_FACTOR = 0.5;

/**
 * The rule table: rows are distance (near, mid, far), columns price (cheap, mid,
 * expensive), each cell how good that combination is (0–1). The near → far drop
 * (1.00 → 0.25) is much bigger than the cheap → expensive one (1.00 → 0.70).
 */
export const RULES: readonly (readonly [number, number, number])[] = [
	[1.0, 0.85, 0.7],
	[0.6, 0.45, 0.3],
	[0.25, 0.12, 0.0]
];

/** "60" → 60; anything outside 5–250 kWh or not a number → null. */
export function parseBattery(raw: string | null): number | null {
	if (!raw || !/^\s*\d+([.,]\d+)?\s*$/.test(raw)) return null;
	const v = Number(raw.replace(',', '.'));
	if (!(v >= BATTERY_MIN_KWH && v <= BATTERY_MAX_KWH)) return null;
	return Math.round(v * 10) / 10;
}

/** Memberships of x ∈ [0, 1] in the low / mid / high sets (triangles that sum to 1). */
export function memberships(x: number): [number, number, number] {
	const v = Math.min(Math.max(x, 0), 1);
	return v <= 0.5 ? [1 - 2 * v, 2 * v, 0] : [0, 2 - 2 * v, 2 * v - 1];
}

/** Score in [0, 1] from a distance and a price, each already scaled to [0, 1]. */
export function fuzzyScore(xDistance: number, xPrice: number): number {
	const d = memberships(xDistance);
	const p = memberships(xPrice);
	let weighted = 0;
	let strength = 0;
	for (let i = 0; i < 3; i++) {
		for (let j = 0; j < 3; j++) {
			const w = d[i] * p[j];
			weighted += w * RULES[i][j];
			strength += w;
		}
	}
	return strength > 0 ? weighted / strength : 0;
}

export interface Rankable {
	name: string;
	distanceKm: number;
	/** kr/kWh the ranking compares: what every visit pays (visitPricePerKwh, $lib/ev);
	 * null = unknown price */
	rankPrice: number | null;
}

/**
 * The NEARBY_COUNT nearest stations, best first. Distance and price are scaled against
 * the candidates themselves, so the same rules work in Reykjavík and in the Westfjords.
 */
export function rankNearby<T extends Rankable>(
	rows: T[],
	count = NEARBY_COUNT
): (T & { score: number })[] {
	const nearest = [...rows].sort((a, b) => a.distanceKm - b.distanceKm).slice(0, count);
	if (nearest.length === 0) return [];

	const far = Math.max(DISTANCE_FLOOR_KM, ...nearest.map((r) => r.distanceKm));
	const logKm = (d: number) => Math.log(1 + Math.max(d, 0) / DISTANCE_SCALE_KM);
	const xDistance = (d: number) => logKm(d) / logKm(far);

	const prices = nearest.map((r) => r.rankPrice).filter((p): p is number => p !== null);
	const cheapest = prices.length ? Math.min(...prices) : 0;
	const spread = prices.length
		? Math.max(Math.max(...prices) - cheapest, PRICE_MIN_SPREAD * cheapest)
		: 0;
	const xPrice = (p: number | null) =>
		p === null ? 1 : spread > 0 ? Math.min((p - cheapest) / spread, 1) : 0;

	return nearest
		.map((r) => {
			const s = fuzzyScore(xDistance(r.distanceKm), xPrice(r.rankPrice));
			return { ...r, score: r.rankPrice === null ? s * UNKNOWN_PRICE_FACTOR : s };
		})
		.sort(
			(a, b) =>
				b.score - a.score || a.distanceKm - b.distanceKm || a.name.localeCompare(b.name, 'is')
		);
}
