// TomTom's live status doesn't always cover a whole site: at Tesla Superchargers it
// reports e.g. 6 of 20 stalls. Showing "3/6" there would claim the whole site's
// status with confidence, so the stalls TomTom doesn't report are shown separately
// as unknown ("?/14").

/**
 * Stalls with no live status: the site's stall count minus TomTom's total, or 0.
 * `stallCount` is only set where our count is per stall (supercharge.info) — elsewhere
 * TomTom counts charge points and we count plugs, so the numbers don't compare.
 */
export function unknownStalls(stallCount: number | null, totalCount: number | null): number {
	if (stallCount === null || totalCount === null) return 0;
	return Math.max(0, stallCount - totalCount);
}
