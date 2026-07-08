import type { Db } from './db/client';
import { upsertAvailability } from './db/availability';
import { fetchChargingAvailability } from './tomtom';

export const STALE_AFTER_MS = 5 * 60 * 1000;
// TomTom freemium: 2 500 free requests/day, hard-capped (no card, cannot bill).
// We stop well short so the match script and manual testing always have headroom.
const DAILY_BUDGET = 2000;

let budgetDay = '';
let budgetUsed = 0;

function underBudget(now: Date): boolean {
	const day = now.toISOString().slice(0, 10);
	if (day !== budgetDay) {
		budgetDay = day;
		budgetUsed = 0;
	}
	return budgetUsed < DAILY_BUDGET;
}

/** Test hook. */
export function resetBudget(): void {
	budgetDay = '';
	budgetUsed = 0;
}

export interface RefreshTarget {
	stationId: number;
	tomtomId: string;
	/** current cache timestamp; null = never fetched */
	fetchedAt: Date | null;
}

export interface RefreshOptions {
	key: string;
	fetchFn?: typeof fetch;
	now?: Date;
	maxCalls?: number;
}

/**
 * Refresh the availability cache for the stale subset of targets (oldest first).
 * Best-effort by design: failures are logged and skipped, the budget stops calls,
 * and this NEVER throws — pages serve whatever the cache holds, with age labels.
 * Returns the number of stations actually refreshed.
 */
export async function refreshAvailability(
	db: Db,
	targets: RefreshTarget[],
	opts: RefreshOptions
): Promise<number> {
	const now = opts.now ?? new Date();
	const fetchFn = opts.fetchFn ?? fetch;
	const stale = targets
		.filter((t) => !t.fetchedAt || now.getTime() - t.fetchedAt.getTime() > STALE_AFTER_MS)
		.sort((a, b) => (a.fetchedAt?.getTime() ?? 0) - (b.fetchedAt?.getTime() ?? 0))
		.slice(0, opts.maxCalls ?? 25);
	let refreshed = 0;
	for (const t of stale) {
		if (!underBudget(now)) break;
		budgetUsed++;
		try {
			const parsed = await fetchChargingAvailability(opts.key, t.tomtomId, fetchFn);
			if (parsed === null) continue; // id unknown to TomTom — leave the cache alone
			await upsertAvailability(db, {
				stationId: t.stationId,
				...parsed,
				source: 'tomtom',
				fetchedAt: now
			});
			refreshed++;
		} catch (e) {
			console.error(
				`availability refresh failed for station ${t.stationId}:`,
				e instanceof Error ? e.message : e
			);
		}
	}
	return refreshed;
}
