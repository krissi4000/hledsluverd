import type { ConnectorType } from '$lib/types';

/**
 * e1's public map JSON (what hledslunet.e1.is renders). e1 is the platform behind many
 * Icelandic operators (Orkan, Orkusalan, Bílorka, OV…), each an "owner partner". One
 * record is a charge point; a location groups the charge points at one site. No prices.
 */
export const E1_PUBLIC_MAP_URL = 'https://europe-north1-e1webservice.cloudfunctions.net/publicMap';

/** OCM vs. e1 coordinates for the same forecourt differ by up to ~150 m. */
export const E1_MATCH_M = 400;

const CONNECTOR_MAP: Record<string, ConnectorType> = {
	ccs2: 'CCS2',
	chademo: 'CHAdeMO',
	type2: 'Type2'
};

export interface E1Location {
	/** e1 locationId — stamped as stations.external_ids.e1 */
	id: number;
	/** e.g. "Orkan - Vesturlandsvegur" */
	name: string;
	address: string;
	lat: number;
	lng: number;
	ownerPartnerId: number;
	connectors: { type: ConnectorType; powerKw: number; count: number }[];
}

interface RawEvse {
	status: string;
	maxPower: number | null;
	connectors: { type: string }[];
}

interface RawChargePoint {
	locationId: number;
	name: { en?: string };
	address?: { en?: string };
	ownerPartnerId: number;
	accessType: string;
	geoposition: { latitude: number; longitude: number };
	evses: RawEvse[];
}

function isChargePoint(x: unknown): x is RawChargePoint {
	const c = x as RawChargePoint;
	return (
		typeof c === 'object' &&
		c !== null &&
		typeof c.locationId === 'number' &&
		typeof c.name?.en === 'string' &&
		typeof c.ownerPartnerId === 'number' &&
		typeof c.geoposition?.latitude === 'number' &&
		typeof c.geoposition?.longitude === 'number' &&
		Array.isArray(c.evses) &&
		c.evses.every((e) => Array.isArray(e?.connectors))
	);
}

/**
 * Public locations of the given owner partners, charge points merged per location.
 * Connectors count once per enabled EVSE with a known plug and power. Throws when the
 * payload shape is unknown, or when a wanted partner has no locations (renamed/moved
 * owner id — better to stop than to report every station as gone).
 */
export function parseE1Locations(json: unknown, ownerPartnerIds: number[]): E1Location[] {
	const data = (json as { data?: unknown })?.data;
	if (!Array.isArray(data)) throw new Error('e1 publicMap: no data array');
	const wanted = new Set(ownerPartnerIds);
	const byLocation = new Map<number, E1Location>();
	const counts = new Map<number, Map<string, number>>();

	for (const raw of data) {
		if (!isChargePoint(raw)) {
			throw new Error(`e1 publicMap: unexpected charge point ${JSON.stringify(raw).slice(0, 200)}`);
		}
		if (!wanted.has(raw.ownerPartnerId) || raw.accessType !== 'public') continue;
		let loc = byLocation.get(raw.locationId);
		if (!loc) {
			loc = {
				id: raw.locationId,
				name: raw.name.en!.trim(),
				address: (raw.address?.en ?? '').replace(/\s+/g, ' ').trim(),
				lat: raw.geoposition.latitude,
				lng: raw.geoposition.longitude,
				ownerPartnerId: raw.ownerPartnerId,
				connectors: []
			};
			byLocation.set(raw.locationId, loc);
			counts.set(raw.locationId, new Map());
		}
		const c = counts.get(raw.locationId)!;
		for (const evse of raw.evses) {
			if (evse.status === 'disabled' || !evse.maxPower || evse.maxPower <= 0) continue;
			const type = evse.connectors.map((x) => CONNECTOR_MAP[x.type]).find(Boolean);
			if (!type) continue;
			const key = `${type}|${Math.round(evse.maxPower / 1000)}`;
			c.set(key, (c.get(key) ?? 0) + 1);
		}
	}

	for (const id of wanted) {
		if (![...byLocation.values()].some((l) => l.ownerPartnerId === id)) {
			throw new Error(`e1 publicMap: no public locations for owner partner ${id}`);
		}
	}
	for (const loc of byLocation.values()) {
		loc.connectors = [...counts.get(loc.id)!].map(([key, count]) => {
			const [type, kw] = key.split('|');
			return { type: type as ConnectorType, powerKw: Number(kw), count };
		});
	}
	return [...byLocation.values()];
}

/** "Orkan - Vesturlandsvegur" / "Orkan Ólafsvík" → "Vesturlandsvegur (Orkan)" / "Ólafsvík (Orkan)" */
export function e1StationName(loc: E1Location, networkName: string): string {
	const esc = networkName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const bare = loc.name.replace(new RegExp(`^${esc}\\s*[-–,]?\\s*`, 'i'), '').trim();
	return `${bare || loc.name} (${networkName})`;
}
