import { haversineKm, type LatLng } from '$lib/geo';
import type { stations } from './db/schema';
import { compareSiteNames } from './matching';

/**
 * Duplicate stations: the same physical site listed twice in one network. OCM holds
 * re-imported copies of a POI with drifted coordinates or another title ("N1 Ísafirði" /
 * "Ísafjörður (N1)"), and a sync can add a site whose OCM twin sits outside its match
 * radius. Nothing is merged automatically: candidates go to /admin (and the daily ntfy
 * note), where a human merges them or dismisses the pair.
 */

/** Exactly the schema's ids, so a new source (like google) can't be missed here. */
export type ExternalIds = (typeof stations.$inferSelect)['externalIds'];

export interface DuplicateStation extends LatLng {
	id: number;
	networkId: number;
	name: string;
	externalIds: ExternalIds;
}

/** Close enough that a similar name means the same site. */
export const DUPLICATE_NEAR_M = 100;
/** OCM pins can be a few hundred metres off: identical names still count out to here. */
export const DUPLICATE_SAME_NAME_M = 400;
/** Practically the same spot: the names don't need to agree. */
export const DUPLICATE_SAME_SPOT_M = 20;

/** Ids a source gives per site: two different values mean the source lists two sites. */
const SITE_ID_KEYS = ['virta', 'e1', 'supercharge', 'n1'] as const;
/** Ids that, shared, say our matchers took both stations for one site. */
const SHARED_ID_KEYS = ['n1', 'tomtom', 'virta', 'e1', 'supercharge', 'google'] as const;

export type DuplicateReason =
	| { kind: 'shared-id'; key: (typeof SHARED_ID_KEYS)[number] }
	| { kind: 'same-name' }
	| { kind: 'similar-name' }
	| { kind: 'same-spot' };

/**
 * Why a and b look like one site, or null when they don't. Stations of different
 * networks are never duplicates here: a wrong network is fixed with an override first.
 */
export function duplicateReasons(
	a: DuplicateStation,
	b: DuplicateStation
): { distanceM: number; reasons: DuplicateReason[] } | null {
	if (a.id === b.id || a.networkId !== b.networkId) return null;
	for (const k of SITE_ID_KEYS) {
		const va = a.externalIds[k];
		const vb = b.externalIds[k];
		if (va != null && vb != null && va !== vb) return null;
	}
	const distanceM = haversineKm(a, b) * 1000;
	if (distanceM > DUPLICATE_SAME_NAME_M) return null;

	const reasons: DuplicateReason[] = [];
	for (const key of SHARED_ID_KEYS) {
		const va = a.externalIds[key];
		if (va != null && va === b.externalIds[key]) reasons.push({ kind: 'shared-id', key });
	}
	const names = compareSiteNames(a.name, b.name);
	if (names === 'same') reasons.push({ kind: 'same-name' });
	else if (names === 'similar' && distanceM <= DUPLICATE_NEAR_M) {
		reasons.push({ kind: 'similar-name' });
	}
	if (distanceM <= DUPLICATE_SAME_SPOT_M) reasons.push({ kind: 'same-spot' });
	return reasons.length > 0 ? { distanceM, reasons } : null;
}

export interface DuplicateCandidate<S extends DuplicateStation = DuplicateStation> {
	/** the lower station id */
	a: S;
	b: S;
	distanceM: number;
	reasons: DuplicateReason[];
}

/** Stable key of an unordered pair, lower id first. */
export const pairKey = (x: number, y: number) => (x < y ? `${x}:${y}` : `${y}:${x}`);

/**
 * Every pair of the given (active) stations that looks like one site, minus pairs a
 * human dismissed. Strongest evidence first: shared ids, then distance.
 */
export function findDuplicateCandidates<S extends DuplicateStation>(
	stations: S[],
	dismissed: ReadonlySet<string> = new Set()
): DuplicateCandidate<S>[] {
	const sorted = [...stations].sort((x, y) => x.id - y.id);
	const out: DuplicateCandidate<S>[] = [];
	for (let i = 0; i < sorted.length; i++) {
		for (let j = i + 1; j < sorted.length; j++) {
			const a = sorted[i];
			const b = sorted[j];
			if (a.networkId !== b.networkId || dismissed.has(pairKey(a.id, b.id))) continue;
			const r = duplicateReasons(a, b);
			if (r) out.push({ a, b, ...r });
		}
	}
	const shared = (c: DuplicateCandidate<S>) =>
		c.reasons.filter((r) => r.kind === 'shared-id').length;
	return out.sort((x, y) => shared(y) - shared(x) || x.distanceM - y.distanceM);
}

/** A station that `candidate` (not yet in the DB) would duplicate, if any. */
export function likelyDuplicateOf<S extends DuplicateStation>(
	candidate: DuplicateStation,
	existing: S[]
): { station: S; distanceM: number; reasons: DuplicateReason[] } | null {
	let best: { station: S; distanceM: number; reasons: DuplicateReason[] } | null = null;
	for (const s of existing) {
		const r = duplicateReasons(candidate, s);
		if (r && (!best || r.distanceM < best.distanceM)) best = { station: s, ...r };
	}
	return best;
}

/**
 * Which external ids a merge moves to the survivor and which stay on the merged station.
 * - an id the survivor lacks moves over (the survivor gets the price source/live status);
 * - an id both hold with the same value is dropped from the merged one, so no scraper or
 *   sync writes to an inactive station;
 * - the OCM id, and any id the survivor holds with another value, stays: seed:ocm and the
 *   syncs then keep recognising the merged station and never insert it again.
 */
export function mergeExternalIds(
	survivor: ExternalIds,
	merged: ExternalIds
): { survivor: ExternalIds; merged: ExternalIds } {
	const s: Record<string, unknown> = { ...survivor };
	const m: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(merged)) {
		if (v == null) continue;
		if (k === 'ocm' && s.ocm !== v) m[k] = v;
		else if (s[k] == null) s[k] = v;
		else if (s[k] !== v) m[k] = v;
	}
	return { survivor: s as ExternalIds, merged: m as ExternalIds };
}
