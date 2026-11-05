import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	parseVirtaClassification,
	parseVirtaList,
	planVirtaSync,
	virtaSiteName,
	type VirtaSite,
	type VirtaSiteEntry
} from './virta';

// Two tiles of Virta's map list, 2026-11-05: Ísorka's own post, host sites (Heimar,
// Krambúðin), a residential post, a roaming copy, a decommissioned post, and a site
// that appears in both tiles.
const tiles: unknown[] = JSON.parse(
	readFileSync(
		new URL('../../../tests/fixtures/virta-list-tiles-2026-11.json', import.meta.url),
		'utf8'
	)
);
const seeds = JSON.parse(
	readFileSync(new URL('../../../seeds/virta-sites.json', import.meta.url), 'utf8')
);

describe('parseVirtaList', () => {
	const sites = parseVirtaList(tiles);
	const byId = new Map(sites.map((s) => [s.id, s]));

	it('keeps live Virta-platform sites once, dropping roaming and decommissioned posts', () => {
		expect(sites.map((s) => s.id).sort((a, b) => a - b)).toEqual([
			45432, 118164, 163966, 168182, 168344, 225652, 257803
		]);
		expect(byId.has(301029642)).toBe(false); // Atlantsolía via Hubject, prices zeroed
		expect(byId.has(11103)).toBe(false); // "Gamla stöð tekinn niður"
	});

	it('counts each plug of a two-cable EVSE and groups by type and power', () => {
		expect(byId.get(225652)!.connectors).toEqual(
			expect.arrayContaining([
				{ type: 'CHAdeMO', powerKw: 50, count: 1 },
				{ type: 'CCS2', powerKw: 200, count: 1 },
				{ type: 'CCS2', powerKw: 240, count: 7 }
			])
		);
		expect(byId.get(225652)!.connectors).toHaveLength(3);
		expect(byId.get(45432)!.connectors).toEqual([{ type: 'Type2', powerKw: 22, count: 13 }]);
	});

	it('cleans names and drops placeholder address parts', () => {
		expect(byId.get(257803)!.name).toBe('Krambúðin - Mývatni');
		expect(byId.get(168182)!.name).toBe('Raufahóll - Lava Tunnel');
		expect(byId.get(225652)!.address).toBe('Hagasmári 1, Kópavogur');
		expect(byId.get(118164)!.address).toBe(''); // "Unknown, N/A"
		expect(byId.get(168182)!.address).toBe('Raufarhóll');
	});

	it('throws on an entry of unknown shape instead of guessing', () => {
		expect(() => parseVirtaList([[{ id: 1, name: 'x' }]])).toThrow(/unexpected entry/);
		expect(() => parseVirtaList([{ data: [] }])).toThrow(/not an array/);
	});
});

describe('virtaSiteName', () => {
	it('leaves ordinary names alone', () => {
		expect(virtaSiteName('Hótel Selfoss')).toBe('Hótel Selfoss');
		expect(virtaSiteName('Akurhvarf 5 (18)')).toBe('Akurhvarf 5 (18)');
	});
});

describe('seeds/virta-sites.json', () => {
	const classes = parseVirtaClassification(seeds);

	it('parses, and classifies every site of the fixture', () => {
		for (const s of parseVirtaList(tiles)) expect(classes.has(s.id)).toBe(true);
	});

	it('marks Ísorka-branded posts own, hosts host and residential posts skip', () => {
		expect(classes.get(163966)!.status).toBe('own'); // Ísorka - Olís Álfheimar
		expect(classes.get(225652)!.status).toBe('host'); // Heimar - Smáralind
		expect(classes.get(168344)!.status).toBe('skip'); // Akurhvarf 5 (18)
	});

	it('rejects duplicates and unknown statuses', () => {
		const e = { id: 1, name: 'x', status: 'own' };
		expect(() => parseVirtaClassification({ sites: [e, e] })).toThrow(/duplicate/);
		expect(() => parseVirtaClassification({ sites: [{ ...e, status: 'maybe' }] })).toThrow(
			/bad entry/
		);
	});
});

describe('planVirtaSync', () => {
	const site = (id: number, lat: number, lng: number): VirtaSite => ({
		id,
		name: `site ${id}`,
		address: '',
		lat,
		lng,
		connectors: []
	});
	const cls = (entries: [number, VirtaSiteEntry['status']][]) =>
		new Map(entries.map(([id, status]) => [id, { id, name: '', status }]));
	const ours = (id: number, lat: number, lng: number, virta?: number, isActive = true) => ({
		id,
		lat,
		lng,
		isActive,
		externalIds: virta == null ? {} : { virta }
	});

	it('inserts classified own/host sites with their flag and ignores skipped ones', () => {
		const plan = planVirtaSync(
			[site(1, 64, -21), site(2, 64.1, -21), site(3, 64.2, -21)],
			cls([
				[1, 'own'],
				[2, 'host'],
				[3, 'skip']
			]),
			[]
		);
		expect(plan.toInsert.map((t) => [t.site.id, t.hostPriced])).toEqual([
			[1, false],
			[2, true]
		]);
		expect(plan.unclassified).toEqual([]);
	});

	it('keeps a stamped station on its site and pairs an unstamped one only when close', () => {
		const plan = planVirtaSync(
			[site(1, 64, -21), site(2, 64.1, -21), site(3, 64.2, -21)],
			cls([
				[2, 'host'],
				[3, 'host']
			]),
			[
				ours(10, 64, -21, 1), // stamped, site 1 unclassified
				ours(11, 64.1001, -21), // ~11 m from site 2 — OCM's copy of it
				ours(12, 64.205, -21) // ~550 m from site 3 — not the same post
			]
		);
		expect(plan.matched.map((m) => [m.station.id, m.site.id, m.hostPriced])).toEqual([
			[10, 1, null],
			[11, 2, true]
		]);
		expect(plan.toInsert.map((t) => t.site.id)).toEqual([3]);
	});

	it('re-pairs a station whose post was replaced, as with Olís Álfheimar', () => {
		// our station still carries the decommissioned post 11103; the new post is 9 m away
		const plan = planVirtaSync([site(163966, 64.13222, -21.86676)], cls([[163966, 'own']]), [
			ours(10, 64.13214, -21.86663, 11103)
		]);
		expect(plan.matched.map((m) => [m.station.id, m.site.id])).toEqual([[10, 163966]]);
		expect(plan.toInsert).toEqual([]);
		expect(plan.vanished).toEqual([]);
	});

	it("adds nothing on top of another network's station, as with Olís Ánanaustum under ON", () => {
		const plan = planVirtaSync(
			[site(165718, 64.15, -21.95), site(2, 64.2, -21.95)],
			cls([
				[165718, 'own'],
				[2, 'host']
			]),
			[],
			[{ id: 77, name: 'Ísorka - Olís Ánanaustum', lat: 64.15, lng: -21.95 }]
		);
		expect(plan.conflicts.map((c) => [c.site.id, c.station.id])).toEqual([[165718, 77]]);
		expect(plan.toInsert.map((t) => t.site.id)).toEqual([2]);
	});

	it('reports unclassified new sites and stamped stations gone from the list', () => {
		const plan = planVirtaSync([site(1, 64, -21), site(2, 64.1, -21)], cls([[1, 'own']]), [
			ours(10, 64, -21, 1),
			ours(11, 65, -20, 99),
			ours(12, 65, -19, 98, false)
		]);
		expect(plan.unclassified.map((s) => s.id)).toEqual([2]);
		expect(plan.vanished.map((s) => s.id)).toEqual([11]); // inactive 12 is already handled
	});
});
