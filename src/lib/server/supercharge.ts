import { haversineKm } from '$lib/geo';

/**
 * supercharge.info keeps a community-maintained list of every Tesla Supercharger
 * (status, stall count, GPS). OCM misses several of Iceland's newer sites, so this is
 * the station source for the Tesla network. It has no prices.
 */
export const SUPERCHARGE_INFO_URL = 'https://supercharge.info/service/supercharge/allSites';

/** Same site re-surveyed by OCM vs. supercharge.info lands within a few hundred metres. */
export const SUPERCHARGER_MATCH_M = 400;

export interface SuperchargerSite {
	id: number;
	/** e.g. "Akureyri, Iceland - Leiruvegur" */
	name: string;
	street: string;
	city: string;
	lat: number;
	lng: number;
	stallCount: number;
	/** 0 when supercharge.info doesn't know yet */
	powerKw: number;
	/** open to non-Tesla cars */
	otherEVs: boolean;
}

interface RawSite {
	id: number;
	name: string;
	status: string;
	address: { street?: string; city?: string; country?: string };
	gps: { latitude: number; longitude: number };
	stallCount: number;
	powerKilowatt: number;
	otherEVs: boolean;
}

function isRawSite(x: unknown): x is RawSite {
	const s = x as RawSite;
	return (
		typeof s === 'object' &&
		s !== null &&
		typeof s.id === 'number' &&
		typeof s.name === 'string' &&
		typeof s.status === 'string' &&
		typeof s.address === 'object' &&
		typeof s.gps?.latitude === 'number' &&
		typeof s.gps?.longitude === 'number' &&
		typeof s.stallCount === 'number'
	);
}

/** OPEN Icelandic sites only. Throws when the payload shape is not what we know. */
export function parseSuperchargeSites(json: unknown): SuperchargerSite[] {
	if (!Array.isArray(json)) throw new Error('supercharge.info: response is not an array');
	const out: SuperchargerSite[] = [];
	for (const raw of json) {
		if (!isRawSite(raw)) {
			throw new Error(
				`supercharge.info: unexpected site shape ${JSON.stringify(raw).slice(0, 200)}`
			);
		}
		if (raw.address.country !== 'Iceland' || raw.status !== 'OPEN') continue;
		out.push({
			id: raw.id,
			name: raw.name,
			street: raw.address.street ?? '',
			city: raw.address.city ?? '',
			lat: raw.gps.latitude,
			lng: raw.gps.longitude,
			stallCount: raw.stallCount,
			powerKw: typeof raw.powerKilowatt === 'number' ? raw.powerKilowatt : 0,
			otherEVs: raw.otherEVs === true
		});
	}
	if (out.length === 0)
		throw new Error('supercharge.info: no open Icelandic sites — format change?');
	return out;
}

/** "Akureyri, Iceland - Leiruvegur" → "Tesla Supercharger Akureyri - Leiruvegur" */
export function superchargerDisplayName(site: SuperchargerSite): string {
	return `Tesla Supercharger ${site.name.replace(/,\s*Iceland\b/, '').trim()}`;
}

export interface ExistingStation {
	id: number;
	name: string;
	lat: number;
	lng: number;
	superchargeId?: number;
}

export interface SuperchargerPlan {
	matched: { site: SuperchargerSite; station: ExistingStation; distanceM: number }[];
	toInsert: SuperchargerSite[];
	/** our stations no open site claimed — closed, or not a Supercharger (destination chargers) */
	unclaimed: ExistingStation[];
}

/**
 * Pair each open site with one of our Tesla stations: an existing supercharge id wins,
 * otherwise the nearest unclaimed station within SUPERCHARGER_MATCH_M. Sites are
 * processed closest-pair first so two nearby sites (old + new Egilsstaðir) can't
 * both grab the same station.
 */
export function planSuperchargerSync(
	sites: SuperchargerSite[],
	existing: ExistingStation[]
): SuperchargerPlan {
	const matched: SuperchargerPlan['matched'] = [];
	const claimedStations = new Set<number>();
	const claimedSites = new Set<number>();

	for (const site of sites) {
		const st = existing.find((e) => e.superchargeId === site.id);
		if (!st) continue;
		matched.push({ site, station: st, distanceM: haversineKm(site, st) * 1000 });
		claimedStations.add(st.id);
		claimedSites.add(site.id);
	}

	const pairs: { site: SuperchargerSite; station: ExistingStation; distanceM: number }[] = [];
	for (const site of sites) {
		if (claimedSites.has(site.id)) continue;
		for (const st of existing) {
			if (claimedStations.has(st.id) || st.superchargeId != null) continue;
			const distanceM = haversineKm(site, st) * 1000;
			if (distanceM <= SUPERCHARGER_MATCH_M) pairs.push({ site, station: st, distanceM });
		}
	}
	pairs.sort((a, b) => a.distanceM - b.distanceM);
	for (const p of pairs) {
		if (claimedSites.has(p.site.id) || claimedStations.has(p.station.id)) continue;
		matched.push(p);
		claimedSites.add(p.site.id);
		claimedStations.add(p.station.id);
	}

	return {
		matched,
		toInsert: sites.filter((s) => !claimedSites.has(s.id)),
		unclaimed: existing.filter((e) => !claimedStations.has(e.id))
	};
}
