import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	parseSuperchargeSites,
	planSuperchargerSync,
	superchargerDisplayName,
	type ExistingStation
} from './supercharge';

// Iceland subset (+2 Norwegian sites) of supercharge.info allSites, 2026-11-05.
const fixture = JSON.parse(
	readFileSync(
		new URL('../../../tests/fixtures/supercharge-info-iceland-2026-11.json', import.meta.url),
		'utf8'
	)
);

describe('parseSuperchargeSites', () => {
	const sites = parseSuperchargeSites(fixture);

	it('keeps only open Icelandic sites', () => {
		expect(sites).toHaveLength(17);
		expect(sites.map((s) => s.name)).not.toContain('Grafarholt, Iceland'); // CLOSED_PERM
		expect(sites.map((s) => s.name)).not.toContain('Mývatn, Iceland'); // CONSTRUCTION
	});

	it('maps stall count, power and GPS', () => {
		const leira = sites.find((s) => s.name === 'Akureyri, Iceland - Leiruvegur')!;
		expect(leira).toMatchObject({ stallCount: 8, powerKw: 250, city: 'Akureyri', otherEVs: true });
		expect(leira.lat).toBeCloseTo(65.6696, 3);
		expect(superchargerDisplayName(leira)).toBe('Tesla Supercharger Akureyri - Leiruvegur');
	});

	it('throws on an unknown payload shape', () => {
		expect(() => parseSuperchargeSites({ sites: [] })).toThrow();
		expect(() => parseSuperchargeSites([{ id: 1 }])).toThrow(/unexpected site shape/);
		expect(() => parseSuperchargeSites(fixture.slice(0, 2))).toThrow(/no open Icelandic/);
	});
});

describe('planSuperchargerSync', () => {
	const sites = parseSuperchargeSites(fixture);
	const keflavik = sites.find((s) => s.name === 'Keflavik, Iceland')!;
	const egilsNew = sites.find((s) => s.name === 'Egilsstaðir, Iceland - Kaupvangur')!;

	it('matches by distance, inserts the rest, reports unclaimed stations', () => {
		const ours: ExistingStation[] = [
			{ id: 1, name: 'Supercharger Keflavik', lat: keflavik.lat + 0.001, lng: keflavik.lng },
			{ id: 2, name: 'Hotel Ranga', lat: 63.79, lng: -20.39 }
		];
		const plan = planSuperchargerSync(sites, ours);
		expect(plan.matched).toHaveLength(1);
		expect(plan.matched[0].site.id).toBe(keflavik.id);
		expect(plan.matched[0].distanceM).toBeLessThan(150);
		expect(plan.toInsert).toHaveLength(16);
		expect(plan.unclaimed.map((s) => s.id)).toEqual([2]);
	});

	it('prefers a stamped supercharge id over a closer station', () => {
		const ours: ExistingStation[] = [
			{ id: 1, name: 'near', lat: egilsNew.lat, lng: egilsNew.lng },
			{
				id: 2,
				name: 'stamped',
				lat: egilsNew.lat + 0.002,
				lng: egilsNew.lng,
				superchargeId: egilsNew.id
			}
		];
		const plan = planSuperchargerSync(sites, ours);
		expect(plan.matched.find((m) => m.site.id === egilsNew.id)!.station.id).toBe(2);
		expect(plan.unclaimed.map((s) => s.id)).toEqual([1]);
	});

	it('gives one station to at most one site (closest pair wins)', () => {
		const ours: ExistingStation[] = [
			{ id: 1, name: 'Keflavik', lat: keflavik.lat, lng: keflavik.lng }
		];
		const twin = { ...keflavik, id: -1, lat: keflavik.lat + 0.002 };
		const plan = planSuperchargerSync([twin, keflavik], ours);
		expect(plan.matched).toHaveLength(1);
		expect(plan.matched[0].site.id).toBe(keflavik.id);
		expect(plan.toInsert.map((s) => s.id)).toEqual([-1]);
	});
});
