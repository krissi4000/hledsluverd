import { haversineKm, type LatLng } from '$lib/geo';

/** A word or phrase, not part of a longer word (\b is ASCII-only). */
const phrase = (src: string, flags = 'iu') =>
	new RegExp(`(?<![\\p{L}\\p{N}])(?:${src})(?![\\p{L}\\p{N}])`, flags);

// "Ísorka - Olís Húsavík (Í uppsetningu)", "… - Coming soon", "… (í byggingu)"
const UNDER_CONSTRUCTION = phrase(
	'uppsetning\\p{L}*|coming\\s+soon|under\\s+construction|í\\s+byggingu|væntanleg\\p{L}*|opnar\\s+(?:bráðlega|bráðum|fljótlega)'
);

/** The name says the station isn't open yet. */
export function isUnderConstructionName(name: string): boolean {
	return UNDER_CONSTRUCTION.test(name);
}

/** stations.under_construction is an admin's call when set, else the name decides. */
export function isUnderConstruction(s: { name: string; underConstruction: boolean | null }) {
	return s.underConstruction ?? isUnderConstructionName(s.name);
}

// Which network a station name names. ON is matched case-sensitively: "on" is English.
const BRANDS: [slug: string, re: RegExp][] = [
	['n1', phrase('n1')],
	['orkan', phrase('orkan')],
	['isorka', phrase('ísorka|isorka')],
	['on', phrase('ON', 'u')],
	['on', phrase('orka\\s+náttúrunnar')],
	['tesla', phrase('tesla|supercharger')],
	['e1', phrase('e1')]
];

export function brandsInName(name: string): Set<string> {
	return new Set(BRANDS.filter(([, re]) => re.test(name)).map(([slug]) => slug));
}

export interface AuditStation extends LatLng {
	id: number;
	name: string;
	networkSlug: string;
}

export type NetworkConflict<S extends AuditStation> =
	| { station: S; kind: 'name'; brands: string[] }
	| { station: S; kind: 'colocated'; other: S; distanceM: number };

/** Another network's station this close is probably the same post filed twice. */
export const COLOCATED_M = 50;

/**
 * Stations whose network deserves a second look: the name names another network
 * ("Vík (N1)" filed under ON), or another network's station stands on the same spot
 * (one charger under two operators, or two operators at one forecourt). For review only:
 * nothing here reassigns a station.
 */
export function networkConflicts<S extends AuditStation>(stations: S[]): NetworkConflict<S>[] {
	const out: NetworkConflict<S>[] = [];
	for (const s of stations) {
		const brands = brandsInName(s.name);
		if (brands.size > 0 && !brands.has(s.networkSlug)) {
			out.push({ station: s, kind: 'name', brands: [...brands] });
		}
	}
	const sorted = [...stations].sort((a, b) => a.id - b.id);
	for (let i = 0; i < sorted.length; i++) {
		for (let j = i + 1; j < sorted.length; j++) {
			const a = sorted[i];
			const b = sorted[j];
			if (a.networkSlug === b.networkSlug) continue;
			const distanceM = haversineKm(a, b) * 1000;
			if (distanceM <= COLOCATED_M)
				out.push({ station: a, kind: 'colocated', other: b, distanceM });
		}
	}
	return out;
}

/**
 * TomTom ids stamped on active stations of more than one network. match:tomtom stamps
 * the only charging POI near a station, so two operators on one forecourt can end up
 * with the same POI: its live status belongs to at most one of them, and we can't tell
 * which. Such availability is unknown, never shown.
 */
export function ambiguousTomtomIds(
	stations: { networkId: number; isActive: boolean; externalIds: { tomtom?: string } }[]
): Set<string> {
	const networksById = new Map<string, Set<number>>();
	for (const s of stations) {
		const t = s.externalIds.tomtom;
		if (!t || !s.isActive) continue;
		const set = networksById.get(t) ?? new Set<number>();
		set.add(s.networkId);
		networksById.set(t, set);
	}
	return new Set([...networksById].filter(([, nets]) => nets.size > 1).map(([t]) => t));
}
