// Plate lookups against the public registry, kept polite: results are cached (a car's
// registration rarely changes), each visitor gets a handful of lookups per hour, and the
// whole site stops for the day at a fixed budget. Plates are never logged.

import { fetchRegistryVehicle, type RegistryVehicle } from './vehicle-registry';

const FOUND_TTL_MS = 24 * 60 * 60 * 1000;
const NOT_FOUND_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 2000;
const DAILY_BUDGET = 1000;
const PER_CLIENT_PER_HOUR = 20;

const cache = new Map<string, { at: number; vehicle: RegistryVehicle | null }>();
const clients = new Map<string, number[]>();
let budgetDay = '';
let budgetUsed = 0;

/** Test hook. */
export function resetPlateLookup(): void {
	cache.clear();
	clients.clear();
	budgetDay = '';
	budgetUsed = 0;
}

export type PlateLookup = { status: 'ok'; vehicle: RegistryVehicle | null } | { status: 'busy' };

export interface PlateLookupOptions {
	/** who is asking, for the per-visitor limit */
	client: string;
	now?: Date;
	fetchFn?: typeof fetch;
}

/** Throws when the registry fails; the caller reports it. */
export async function lookupPlate(plate: string, opts: PlateLookupOptions): Promise<PlateLookup> {
	const now = (opts.now ?? new Date()).getTime();

	const hit = cache.get(plate);
	if (hit && now - hit.at < (hit.vehicle ? FOUND_TTL_MS : NOT_FOUND_TTL_MS)) {
		return { status: 'ok', vehicle: hit.vehicle };
	}

	const recent = (clients.get(opts.client) ?? []).filter((t) => now - t < 60 * 60 * 1000);
	const day = new Date(now).toISOString().slice(0, 10);
	if (day !== budgetDay) {
		budgetDay = day;
		budgetUsed = 0;
	}
	if (recent.length >= PER_CLIENT_PER_HOUR || budgetUsed >= DAILY_BUDGET) {
		return { status: 'busy' };
	}
	recent.push(now);
	if (clients.size > 5000) {
		for (const [k, times] of clients)
			if (now - times[times.length - 1] > 60 * 60 * 1000) clients.delete(k);
	}
	clients.set(opts.client, recent);
	budgetUsed++;

	const vehicle = await fetchRegistryVehicle(plate, opts.fetchFn);
	if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
	cache.set(plate, { at: now, vehicle });
	return { status: 'ok', vehicle };
}
