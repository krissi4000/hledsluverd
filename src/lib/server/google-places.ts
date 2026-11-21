// Which Google Maps place is each of our stations? The station card on /kort shows the
// place's Google photos through the Places UI Kit ($lib/components/GooglePlacePhoto),
// which needs the place ID; `npm run match:google` stamps it as externalIds.google.
//
// Google's terms shape this (Places API, EEA billing address):
// - Of what the Places API returns, only place IDs and coordinates may be used with any
//   map, and place IDs may be stored indefinitely. So the search asks for nothing else
//   (no names), matching is by distance alone, and only the place ID is kept.
// - Places UI Kit content, unlike Places API content, may be shown with any map.
// Each search is billed as "Nearby Search Pro": 5 000 a month free, far more than one run
// over every station.
import { haversineKm, type LatLng } from '$lib/geo';

const SEARCH_NEARBY = 'https://places.googleapis.com/v1/places:searchNearby';

/** how far from our coordinates a Google place may be and still be the same station
 * (as for TomTom: chargers sit around car parks, and pins are placed loosely) */
export const MATCH_RADIUS_M = 120;
/** a nearest place this close, with every other one much farther, is taken as ours */
const CLEAR_NEAREST_M = 40;

export interface GooglePlace extends LatLng {
	id: string;
}

export type PlaceCandidate = GooglePlace & { distM: number };

export type PlaceMatch =
	| { kind: 'match'; place: PlaceCandidate; why: 'only' | 'nearest' }
	| { kind: 'none' }
	| { kind: 'ambiguous'; candidates: PlaceCandidate[] };

/**
 * Google's EV charging places within MATCH_RADIUS_M of `at`, nearest first. Throws on an
 * error response or an answer it can't read, like every other fetcher here.
 */
export async function chargingPlacesNear(
	at: LatLng,
	key: string,
	fetchFn: typeof fetch = fetch
): Promise<GooglePlace[]> {
	const res = await fetchFn(SEARCH_NEARBY, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-goog-api-key': key,
			// ids and coordinates only: the two things the terms let us use with a map
			'x-goog-fieldmask': 'places.id,places.location'
		},
		body: JSON.stringify({
			// a place that IS a charging station, not a hotel or shop that has one
			includedPrimaryTypes: ['electric_vehicle_charging_station'],
			maxResultCount: 20,
			rankPreference: 'DISTANCE',
			locationRestriction: {
				circle: { center: { latitude: at.lat, longitude: at.lng }, radius: MATCH_RADIUS_M }
			}
		}),
		signal: AbortSignal.timeout(10_000)
	});
	if (!res.ok) {
		const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
		const why = body?.error?.message;
		throw new Error(`Places API: HTTP ${res.status}${why ? ` — ${why}` : ''}`);
	}
	const body = (await res.json()) as {
		places?: { id?: unknown; location?: { latitude?: unknown; longitude?: unknown } }[];
	};
	// with nothing near, the answer has no places list at all
	return (body.places ?? []).map((p) => {
		const { latitude: lat, longitude: lng } = p.location ?? {};
		if (typeof p.id !== 'string' || typeof lat !== 'number' || typeof lng !== 'number') {
			throw new Error('Places API: unexpected place shape');
		}
		return { id: p.id, lat, lng };
	});
}

/**
 * Which of the places near our station is it? Coordinates are all there is to go on, so
 * this is cautious: the only EV charging place within the radius, or one clearly nearer
 * than the rest. Anything else is for a human to decide.
 */
export function pickPlace(here: LatLng, places: GooglePlace[]): PlaceMatch {
	const candidates = places
		.map((p) => ({ ...p, distM: Math.round(haversineKm(here, p) * 1000) }))
		.filter((p) => p.distM <= MATCH_RADIUS_M)
		.sort((a, b) => a.distM - b.distM);
	if (candidates.length === 0) return { kind: 'none' };
	if (candidates.length === 1) return { kind: 'match', place: candidates[0], why: 'only' };
	const [a, b] = candidates;
	if (a.distM <= CLEAR_NEAREST_M && b.distM >= Math.max(3 * a.distM, a.distM + CLEAR_NEAREST_M)) {
		return { kind: 'match', place: a, why: 'nearest' };
	}
	return { kind: 'ambiguous', candidates };
}

/**
 * One Google place, one station: a pick whose place another pick also chose, or that a
 * station already carries, is a clash for a human to settle (two of our stations at one
 * site, or Google only knowing one of them). Clashes list the slugs they collide with.
 */
export function exclusivePicks<T extends { slug: string; placeId: string }>(
	picks: T[],
	stamped: ReadonlyMap<string, string>
): { stamp: T[]; clash: (T & { with: string[] })[] } {
	const slugsByPlace = new Map<string, string[]>();
	for (const p of picks)
		slugsByPlace.set(p.placeId, [...(slugsByPlace.get(p.placeId) ?? []), p.slug]);
	const stamp: T[] = [];
	const clash: (T & { with: string[] })[] = [];
	for (const p of picks) {
		const others = (slugsByPlace.get(p.placeId) ?? []).filter((s) => s !== p.slug);
		const owner = stamped.get(p.placeId);
		if (owner) others.push(owner);
		if (others.length === 0) stamp.push(p);
		else clash.push({ ...p, with: others });
	}
	return { stamp, clash };
}

/** the place on Google Maps, for a human checking a match (a Maps URL, no API call) */
export function mapsLink(p: GooglePlace): string {
	return `https://www.google.com/maps/search/?${new URLSearchParams({
		api: '1',
		query: `${p.lat},${p.lng}`,
		query_place_id: p.id
	})}`;
}
