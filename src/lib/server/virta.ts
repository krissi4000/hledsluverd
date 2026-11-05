import { haversineKm, type LatLng } from '$lib/geo';
import type { ConnectorType } from '$lib/types';
import { DECOMMISSIONED, VIRTA_NEAR_M } from './scrapers/isorka';
import { planSiteSync } from './site-sync';

/**
 * Ísorka's charge points live on Virta's platform. Besides Ísorka's own posts, the list
 * holds hosts (hotels, shops, landlords) who set their own price, residential and staff
 * car parks that are "public" only on paper, and roaming copies of other networks. The
 * API cannot tell these apart, so seeds/virta-sites.json classifies every site by hand.
 */

/** The API rejects bboxes much larger than ~2°×6°; four tiles cover Iceland. */
export const VIRTA_TILES = [
	{ latMin: 63.2, latMax: 65.2, longMin: -24.6, longMax: -18.6 },
	{ latMin: 63.2, latMax: 65.2, longMin: -18.6, longMax: -13.4 },
	{ latMin: 65.2, latMax: 66.8, longMin: -24.6, longMax: -18.6 },
	{ latMin: 65.2, latMax: 66.8, longMin: -18.6, longMax: -13.4 }
];

const CONNECTOR_MAP: Record<string, ConnectorType> = {
	Mennekes: 'Type2',
	CCS: 'CCS2',
	CHAdeMO: 'CHAdeMO'
};

export interface VirtaSite extends LatLng {
	/** Virta station id — stamped as stations.external_ids.virta */
	id: number;
	name: string;
	address: string;
	connectors: { type: ConnectorType; powerKw: number; count: number }[];
}

interface RawListStation {
	id: number;
	name: string;
	latitude: number;
	longitude: number;
	address: string;
	city: string;
	provider: string;
	isRemoved: boolean;
	isPrivate: boolean;
	evses: { connectors: { type: string; maxKw: number | null }[] }[];
}

function isListStation(x: unknown): x is RawListStation {
	const s = x as RawListStation;
	return (
		typeof s === 'object' &&
		s !== null &&
		typeof s.id === 'number' &&
		typeof s.name === 'string' &&
		typeof s.latitude === 'number' &&
		typeof s.longitude === 'number' &&
		typeof s.provider === 'string' &&
		typeof s.isRemoved === 'boolean' &&
		typeof s.isPrivate === 'boolean' &&
		Array.isArray(s.evses) &&
		s.evses.every(
			(e) => Array.isArray(e?.connectors) && e.connectors.every((c) => typeof c?.type === 'string')
		)
	);
}

/** "Krambúðin  - Mývatni" → one space; a trailing kennitala ("… - 7005161210") dropped. */
export function virtaSiteName(raw: string): string {
	return raw
		.replace(/\s+/g, ' ')
		.replace(/\s*-\s*\d{10}$/, '')
		.trim();
}

const PLACEHOLDER = /^(unknown|n\/a|-)?$/i;

/**
 * Live, public sites on Virta's own platform from the map list tiles, de-duplicated.
 * Roaming copies (provider "Hubject"), removed, private and decommissioned posts are
 * dropped. Throws on an entry of unknown shape: better no sync than a wrong one.
 */
export function parseVirtaList(tiles: unknown[]): VirtaSite[] {
	const byId = new Map<number, VirtaSite>();
	for (const tile of tiles) {
		if (!Array.isArray(tile)) throw new Error('Virta list: tile is not an array');
		for (const raw of tile) {
			if (!isListStation(raw)) {
				throw new Error(`Virta list: unexpected entry ${JSON.stringify(raw).slice(0, 200)}`);
			}
			if (raw.provider !== 'Virta' || raw.isRemoved || raw.isPrivate) continue;
			if (DECOMMISSIONED.test(raw.name) || byId.has(raw.id)) continue;
			const counts = new Map<string, number>();
			for (const evse of raw.evses) {
				// an EVSE with both a CCS and a CHAdeMO cable offers each plug once
				const keys = new Set<string>();
				for (const c of evse.connectors) {
					const type = CONNECTOR_MAP[c.type];
					if (type && c.maxKw != null && c.maxKw > 0) keys.add(`${type}|${Math.round(c.maxKw)}`);
				}
				for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
			}
			byId.set(raw.id, {
				id: raw.id,
				name: virtaSiteName(raw.name),
				address: [raw.address, raw.city]
					.map((p) => (p ?? '').replace(/\s+/g, ' ').trim())
					.filter((p) => !PLACEHOLDER.test(p))
					.join(', '),
				lat: raw.latitude,
				lng: raw.longitude,
				connectors: [...counts].map(([key, count]) => {
					const [type, kw] = key.split('|');
					return { type: type as ConnectorType, powerKw: Number(kw), count };
				})
			});
		}
	}
	return [...byId.values()];
}

/**
 * own  — Ísorka's tariff (Ísorka-branded and neighbourhood "Hverfahleðsla" posts)
 * host — the site's owner sets the price (hotels, shops, landlords, schools…)
 * skip — not for the public map (residential, staff, members only, unpriced, no access)
 */
export type VirtaSiteStatus = 'own' | 'host' | 'skip';

export interface VirtaSiteEntry {
	id: number;
	/** for the humans who edit the file; Virta's current name is what we show */
	name: string;
	status: VirtaSiteStatus;
	note?: string;
}

export function parseVirtaClassification(json: unknown): Map<number, VirtaSiteEntry> {
	const sites = (json as { sites?: unknown })?.sites;
	if (!Array.isArray(sites)) throw new Error('virta-sites.json: no sites array');
	const out = new Map<number, VirtaSiteEntry>();
	for (const s of sites as VirtaSiteEntry[]) {
		if (typeof s?.id !== 'number' || !['own', 'host', 'skip'].includes(s.status)) {
			throw new Error(`virta-sites.json: bad entry ${JSON.stringify(s)}`);
		}
		if (out.has(s.id)) throw new Error(`virta-sites.json: duplicate id ${s.id}`);
		out.set(s.id, s);
	}
	return out;
}

type OurStation = LatLng & { id: number; isActive: boolean; externalIds: { virta?: number } };

export interface VirtaPlan<T extends OurStation> {
	/** paired with one of our stations; hostPriced null = unclassified, leave the flag alone */
	matched: { site: VirtaSite; station: T; distanceM: number; hostPriced: boolean | null }[];
	toInsert: { site: VirtaSite; hostPriced: boolean }[];
	/**
	 * would-be new sites sitting on another network's station — most likely the same post,
	 * filed under the wrong network by OCM. A human moves the station; we add nothing.
	 */
	conflicts: { site: VirtaSite; station: OtherStation; distanceM: number }[];
	/** live public sites nobody has classified yet — a human decides own/host/skip */
	unclassified: VirtaSite[];
	/** our active stations stamped with a Virta id that left the list, with nothing to re-pair */
	vanished: T[];
}

type OtherStation = LatLng & { id: number; name: string };

/**
 * What a sync should do. Classified own/host sites and sites we already carry are kept:
 * the stamped station keeps its site, and a station of ours that is unstamped, or stamped
 * with an id that left the list (a replaced post), pairs with a site within VIRTA_NEAR_M.
 * Anything left is a new station, unless another network already has one on the spot.
 */
export function planVirtaSync<T extends OurStation>(
	sites: VirtaSite[],
	classes: Map<number, VirtaSiteEntry>,
	ours: T[],
	others: OtherStation[] = []
): VirtaPlan<T> {
	const live = new Set(sites.map((s) => s.id));
	const liveStamp = (o: T) =>
		o.externalIds.virta != null && live.has(o.externalIds.virta) ? o.externalIds.virta : undefined;
	const stamped = new Set(ours.map(liveStamp).filter((v) => v != null));
	const hostPriced = (id: number): boolean | null => {
		const status = classes.get(id)?.status;
		return status === 'host' ? true : status === 'own' ? false : null;
	};
	const wanted = sites.filter((s) => hostPriced(s.id) != null || stamped.has(s.id));
	const plan = planSiteSync(wanted, ours, liveStamp, VIRTA_NEAR_M);
	const toInsert: VirtaPlan<T>['toInsert'] = [];
	const conflicts: VirtaPlan<T>['conflicts'] = [];
	for (const site of plan.toInsert) {
		const near = others
			.map((station) => ({ station, distanceM: haversineKm(site, station) * 1000 }))
			.filter((c) => c.distanceM <= VIRTA_NEAR_M)
			.sort((a, b) => a.distanceM - b.distanceM)[0];
		if (near) conflicts.push({ site, ...near });
		else toInsert.push({ site, hostPriced: hostPriced(site.id)! });
	}
	const matchedIds = new Set(plan.matched.map((m) => m.station.id));
	return {
		matched: plan.matched.map((m) => ({ ...m, hostPriced: hostPriced(m.site.id) })),
		toInsert,
		conflicts,
		unclassified: sites.filter((s) => !classes.has(s.id) && !stamped.has(s.id)),
		vanished: ours.filter(
			(o) =>
				o.isActive && o.externalIds.virta != null && liveStamp(o) == null && !matchedIds.has(o.id)
		)
	};
}
