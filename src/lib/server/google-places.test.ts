import { describe, expect, it } from 'vitest';
import {
	MATCH_RADIUS_M,
	chargingPlacesNear,
	exclusivePicks,
	mapsLink,
	pickPlace
} from './google-places';

const AT = { lat: 64.146, lng: -21.942 };
/** a place `m` metres due north of AT (one degree of latitude is 111 195 m here) */
const north = (id: string, m: number) => ({ id, lat: AT.lat + m / 111_195, lng: AT.lng });

describe('chargingPlacesNear', () => {
	it('asks only for ids and coordinates of charging stations around the point', async () => {
		let sent: { url: string; init: RequestInit } | undefined;
		const fetchFn = (async (url: string, init: RequestInit) => {
			sent = { url, init };
			return Response.json({
				places: [{ id: 'ChIJ-a', location: { latitude: 64.1461, longitude: -21.9421 } }]
			});
		}) as unknown as typeof fetch;

		expect(await chargingPlacesNear(AT, 'KEY', fetchFn)).toEqual([
			{ id: 'ChIJ-a', lat: 64.1461, lng: -21.9421 }
		]);
		expect(sent!.url).toBe('https://places.googleapis.com/v1/places:searchNearby');
		expect(sent!.init.method).toBe('POST');
		const headers = sent!.init.headers as Record<string, string>;
		expect(headers['x-goog-api-key']).toBe('KEY');
		// nothing but ids and coordinates: the rest of Places API content can't go with a map
		expect(headers['x-goog-fieldmask']).toBe('places.id,places.location');
		const body = JSON.parse(sent!.init.body as string);
		expect(body.includedPrimaryTypes).toEqual(['electric_vehicle_charging_station']);
		expect(body.rankPreference).toBe('DISTANCE');
		expect(body.locationRestriction.circle).toEqual({
			center: { latitude: AT.lat, longitude: AT.lng },
			radius: MATCH_RADIUS_M
		});
	});

	it('reads "nothing here" (an empty answer) as no places', async () => {
		const fetchFn = (async () => Response.json({})) as unknown as typeof fetch;
		expect(await chargingPlacesNear(AT, 'KEY', fetchFn)).toEqual([]);
	});

	it("throws with Google's reason on an error, and on an answer it can't read", async () => {
		const denied = (async () =>
			Response.json(
				{ error: { code: 403, message: 'Places API (New) has not been used', status: 'X' } },
				{ status: 403 }
			)) as unknown as typeof fetch;
		await expect(chargingPlacesNear(AT, 'KEY', denied)).rejects.toThrow(
			'HTTP 403 — Places API (New) has not been used'
		);
		const odd = (async () =>
			Response.json({ places: [{ id: 'ChIJ-a' }] })) as unknown as typeof fetch;
		await expect(chargingPlacesNear(AT, 'KEY', odd)).rejects.toThrow('unexpected place shape');
	});
});

describe('pickPlace', () => {
	it('takes the only charging place within the radius', () => {
		const m = pickPlace(AT, [north('a', 85), north('far', MATCH_RADIUS_M + 30)]);
		expect(m).toEqual({ kind: 'match', place: { ...north('a', 85), distM: 85 }, why: 'only' });
	});

	it('has no match when nothing is within the radius', () => {
		expect(pickPlace(AT, [])).toEqual({ kind: 'none' });
		expect(pickPlace(AT, [north('far', MATCH_RADIUS_M + 30)])).toEqual({ kind: 'none' });
	});

	it('takes a clearly nearest place: close by, the next one far off', () => {
		const m = pickPlace(AT, [north('across', 70), north('here', 12)]);
		expect(m.kind === 'match' && m.place.id).toBe('here');
		expect(m.kind === 'match' && m.why).toBe('nearest');
	});

	it('leaves places at similar distances to a human, nearest first', () => {
		const m = pickPlace(AT, [north('b', 30), north('a', 10)]);
		expect(m.kind).toBe('ambiguous');
		expect(m.kind === 'ambiguous' && m.candidates.map((c) => [c.id, c.distM])).toEqual([
			['a', 10],
			['b', 30]
		]);
		// a nearest one that is itself far off is no proof either
		expect(pickPlace(AT, [north('a', 60), north('b', 115)]).kind).toBe('ambiguous');
	});
});

describe('exclusivePicks', () => {
	it('stamps picks whose place no other station has or wants', () => {
		const picks = [
			{ slug: 'x-on', placeId: 'P1' },
			{ slug: 'y-on', placeId: 'P2' }
		];
		expect(exclusivePicks(picks, new Map())).toEqual({ stamp: picks, clash: [] });
	});

	it('holds back two stations that want one place, and a place already stamped', () => {
		const picks = [
			{ slug: 'kringlan-on', placeId: 'P1' },
			{ slug: 'kringlan-tesla', placeId: 'P1' },
			{ slug: 'smaralind-on', placeId: 'P2' },
			{ slug: 'hof-n1', placeId: 'P3' }
		];
		const { stamp, clash } = exclusivePicks(picks, new Map([['P2', 'smaralind-isorka']]));
		expect(stamp.map((p) => p.slug)).toEqual(['hof-n1']);
		expect(clash.map((p) => [p.slug, p.with])).toEqual([
			['kringlan-on', ['kringlan-tesla']],
			['kringlan-tesla', ['kringlan-on']],
			['smaralind-on', ['smaralind-isorka']]
		]);
	});
});

describe('mapsLink', () => {
	it('opens the place itself on Google Maps', () => {
		const u = new URL(mapsLink({ id: 'ChIJ-a', lat: 64.1461, lng: -21.9421 }));
		expect(u.origin + u.pathname).toBe('https://www.google.com/maps/search/');
		expect(u.searchParams.get('api')).toBe('1');
		expect(u.searchParams.get('query')).toBe('64.1461,-21.9421');
		expect(u.searchParams.get('query_place_id')).toBe('ChIJ-a');
	});
});
