import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { TEST_DB_URL, closeTestDb, setupTestDb, truncateAll } from '../../../tests/helpers/db';
import type { Db } from './db/client';
import { setStationActive } from './admin';
import { insertPriceIfChanged } from './db/prices';
import { stationDetail, stationList } from './db/queries';
import {
	connectors,
	networks,
	prices,
	stationOverrides,
	stationSlugRedirects,
	stations
} from './db/schema';
import {
	applyOverride,
	dismissDuplicate,
	duplicateCandidates,
	formatConnectorSpec,
	markNotified,
	mergeStations,
	overridesByStation,
	parseConnectorSpec,
	parseOverrideForm,
	resolveStationSlug,
	saveStationOverride
} from './stations-admin';

describe('parseConnectorSpec', () => {
	it('reads counts, types and decimal-comma powers', () => {
		expect(parseConnectorSpec('2×CCS2 150; 1×chademo 62,5 kW\nType2 22')).toEqual([
			{ type: 'CCS2', powerKw: 150, count: 2 },
			{ type: 'CHAdeMO', powerKw: 62.5, count: 1 },
			{ type: 'Type2', powerKw: 22, count: 1 }
		]);
		expect(parseConnectorSpec('4x CCS2 50, 2*Type2 22')).toEqual([
			{ type: 'CCS2', powerKw: 50, count: 4 },
			{ type: 'Type2', powerKw: 22, count: 2 }
		]);
	});
	it('round-trips through formatConnectorSpec', () => {
		const cs = [
			{ type: 'CCS2' as const, powerKw: 62.5, count: 2 },
			{ type: 'Type2' as const, powerKw: 22, count: 1 }
		];
		expect(parseConnectorSpec(formatConnectorSpec(cs))).toEqual(cs);
	});
	it('rejects what it does not understand instead of guessing', () => {
		expect(parseConnectorSpec('')).toHaveProperty('error');
		expect(parseConnectorSpec('2×Tesla 250')).toHaveProperty('error');
		expect(parseConnectorSpec('CCS2')).toHaveProperty('error');
		expect(parseConnectorSpec('0×CCS2 50')).toHaveProperty('error');
		expect(parseConnectorSpec('CCS2 5000')).toHaveProperty('error');
	});
});

describe('parseOverrideForm', () => {
	const form = (o: Record<string, string>) => {
		const f = new FormData();
		for (const [k, v] of Object.entries(o)) f.set(k, v);
		return f;
	};
	it('treats blank fields as "no override"', () => {
		expect(
			parseOverrideForm(form({ stationId: '81', name: ' ', networkId: '', connectors: '' }))
		).toEqual({
			stationId: 81,
			name: null,
			networkId: null,
			connectors: null,
			underConstruction: null,
			note: null
		});
	});
	it('parses every field', () => {
		expect(
			parseOverrideForm(
				form({
					stationId: '81',
					name: 'ON Kirkjubæjarklaustri',
					networkId: '3',
					connectors: '1×CCS2 50',
					underConstruction: 'yes',
					note: 'stafsetning'
				})
			)
		).toEqual({
			stationId: 81,
			name: 'ON Kirkjubæjarklaustri',
			networkId: 3,
			connectors: [{ type: 'CCS2', powerKw: 50, count: 1 }],
			underConstruction: true,
			note: 'stafsetning'
		});
		expect(parseOverrideForm(form({ stationId: '1', underConstruction: 'no' }))).toMatchObject({
			underConstruction: false
		});
	});
	it('reports a bad connector list or station', () => {
		expect(parseOverrideForm(form({ stationId: '81', connectors: 'fullt' }))).toHaveProperty(
			'error'
		);
		expect(parseOverrideForm(form({ stationId: 'x' }))).toHaveProperty('error');
	});
});

describe('applyOverride', () => {
	const upstream = {
		name: 'Landbúnaðar Háskólinn - Hvanneyri',
		connectors: [{ type: 'CCS2' as const, powerKw: 22, count: 4 }]
	};
	it('passes upstream through when nothing is overridden', () => {
		expect(applyOverride(upstream, undefined)).toEqual({ ...upstream, kept: [] });
		expect(applyOverride(upstream, { name: null, connectors: null })).toEqual({
			...upstream,
			kept: []
		});
	});
	it("keeps the admin's name and connectors", () => {
		const fixed = [{ type: 'Type2' as const, powerKw: 22, count: 4 }];
		expect(applyOverride(upstream, { name: 'Hvanneyri', connectors: fixed })).toEqual({
			name: 'Hvanneyri',
			connectors: fixed,
			kept: ['name', 'connectors']
		});
		expect(applyOverride(upstream, { name: null, connectors: fixed }).name).toBe(upstream.name);
	});
});

describe.skipIf(!TEST_DB_URL)('station review (DB)', () => {
	let db: Db;
	let on: number, n1: number;

	beforeAll(async () => {
		db = await setupTestDb();
	});
	afterAll(async () => {
		await closeTestDb(db);
	});

	const byId = async (id: number) =>
		(await db.select().from(stations).where(eq(stations.id, id)))[0];
	const connectorsOf = (id: number) =>
		db.select().from(connectors).where(eq(connectors.stationId, id));

	let hvolsA: number, hvolsB: number, vik: number, vikN1: number;

	beforeEach(async () => {
		await truncateAll(db);
		[{ id: on }, { id: n1 }] = await db
			.insert(networks)
			.values([
				{ name: 'ON', slug: 'on' },
				{ name: 'N1', slug: 'n1' }
			])
			.returning();
		const st = await db
			.insert(stations)
			.values([
				{
					networkId: n1,
					slug: 'hvolsvollur-n1-n1',
					name: 'Hvolsvöllur (N1)',
					location: { x: -20.2346, y: 63.74979 },
					externalIds: { ocm: 174284 }
				},
				{
					networkId: n1,
					slug: 'hvolsvollur-n1-n1-173807',
					name: 'Hvolsvöllur (N1)',
					location: { x: -20.23522, y: 63.74978 },
					externalIds: { ocm: 173807, n1: '8210_service', tomtom: 'a721' }
				},
				{
					networkId: on,
					slug: 'vik-n1-on',
					name: 'Vík (N1)',
					location: { x: -19.00102, y: 63.41781 },
					externalIds: { ocm: 999 }
				},
				{
					networkId: n1,
					slug: 'vik-i-myrdal-n1-n1',
					name: 'Vík í Mýrdal (N1)',
					location: { x: -19.0019, y: 63.41775 },
					externalIds: { n1: '8700_service' }
				}
			])
			.returning();
		[hvolsA, hvolsB, vik, vikN1] = st.map((s) => s.id);
		await db.insert(connectors).values([
			{ stationId: hvolsB, type: 'CCS2', powerKw: 150, count: 2 },
			{ stationId: vik, type: 'CCS2', powerKw: 50, count: 1 }
		]);
		await insertPriceIfChanged(db, {
			networkId: n1,
			stationId: hvolsB,
			tariffKey: 'DC',
			priceIskPerKwh: 65,
			source: 'scraper'
		});
	});

	describe('mergeStations', () => {
		it('moves the missing ids and connectors to the survivor and retires the duplicate', async () => {
			expect(await mergeStations(db, hvolsA, hvolsB)).toEqual({ ok: true });
			const a = await byId(hvolsA);
			const b = await byId(hvolsB);
			expect(a.externalIds).toEqual({ ocm: 174284, n1: '8210_service', tomtom: 'a721' });
			expect(a.isActive).toBe(true);
			expect(b).toMatchObject({
				isActive: false,
				mergedIntoId: hvolsA,
				externalIds: { ocm: 173807 }
			});
			// survivor had no connectors: it inherits the duplicate's
			expect((await connectorsOf(hvolsA)).map((c) => [c.type, c.powerKw, c.count])).toEqual([
				['CCS2', 150, 2]
			]);
			// the duplicate's price history stays where it was written
			const hist = await db.select().from(prices).where(eq(prices.stationId, hvolsB));
			expect(hist).toHaveLength(1);
			// the list now has one Hvolsvöllur
			const list = await stationList(db, 'DC');
			expect(list.filter((s) => s.name === 'Hvolsvöllur (N1)').map((s) => s.slug)).toEqual([
				'hvolsvollur-n1-n1'
			]);
		});

		it('keeps the survivor’s own connectors', async () => {
			await db
				.insert(connectors)
				.values({ stationId: hvolsA, type: 'CCS2', powerKw: 50, count: 1 });
			await mergeStations(db, hvolsA, hvolsB);
			expect((await connectorsOf(hvolsA)).map((c) => c.powerKw)).toEqual([50]);
		});

		it('refuses stations of different networks, and double merges', async () => {
			expect(await mergeStations(db, vikN1, vik)).toMatchObject({ ok: false });
			expect((await byId(vik)).isActive).toBe(true);
			expect(await mergeStations(db, hvolsA, hvolsA)).toMatchObject({ ok: false });
			await mergeStations(db, hvolsA, hvolsB);
			expect(await mergeStations(db, hvolsA, hvolsB)).toMatchObject({ ok: false });
			expect(await mergeStations(db, hvolsB, hvolsA)).toMatchObject({ ok: false });
		});

		it('reactivating a merged station on /admin undoes the merge link', async () => {
			await mergeStations(db, hvolsA, hvolsB);
			expect(await setStationActive(db, hvolsB, true)).toEqual({ ok: true });
			expect(await byId(hvolsB)).toMatchObject({ isActive: true, mergedIntoId: null });
			expect(await resolveStationSlug(db, 'hvolsvollur-n1-n1-173807')).toBeNull();
			// still the same spot and name: back on the review list
			expect((await duplicateCandidates(db)).map((c) => [c.a.id, c.b.id])).toEqual([
				[hvolsA, hvolsB]
			]);
		});

		it('repoints earlier merges when their survivor is merged in turn', async () => {
			const [c] = await db
				.insert(stations)
				.values({
					networkId: n1,
					slug: 'hvols-c',
					name: 'Hvolsvöllur',
					location: { x: -20.2346, y: 63.7498 }
				})
				.returning();
			await mergeStations(db, hvolsB, c.id);
			await mergeStations(db, hvolsA, hvolsB);
			expect((await byId(c.id)).mergedIntoId).toBe(hvolsA);
			expect(await resolveStationSlug(db, 'hvols-c')).toBe('hvolsvollur-n1-n1');
		});
	});

	describe('resolveStationSlug', () => {
		it('sends a merged duplicate’s slug to the survivor', async () => {
			await mergeStations(db, hvolsA, hvolsB);
			expect(await resolveStationSlug(db, 'hvolsvollur-n1-n1-173807')).toBe('hvolsvollur-n1-n1');
			expect(await stationDetail(db, 'hvolsvollur-n1-n1-173807')).toBeNull();
		});
		it('is null for live slugs, unknown slugs and stations deactivated without a merge', async () => {
			expect(await resolveStationSlug(db, 'hvolsvollur-n1-n1')).toBeNull();
			expect(await resolveStationSlug(db, 'engin-stod')).toBeNull();
			await db.update(stations).set({ isActive: false }).where(eq(stations.id, vik));
			expect(await resolveStationSlug(db, 'vik-n1-on')).toBeNull();
		});
	});

	describe('saveStationOverride', () => {
		const blank = {
			name: null,
			networkId: null,
			connectors: null,
			underConstruction: null,
			note: null
		};

		it('renames a station, moves its slug and keeps the old one as a redirect', async () => {
			const [krikju] = await db
				.insert(stations)
				.values({
					networkId: on,
					slug: 'on-krikjubaejarklaustri-on',
					name: 'ON Krikjubæjarklaustri',
					location: { x: -18.06, y: 63.79 }
				})
				.returning();
			const r = await saveStationOverride(db, {
				...blank,
				stationId: krikju.id,
				name: 'ON Kirkjubæjarklaustri',
				note: 'stafsetningarvilla í OCM'
			});
			expect(r).toEqual({ ok: true });
			const st = await byId(krikju.id);
			expect(st).toMatchObject({
				name: 'ON Kirkjubæjarklaustri',
				slug: 'on-kirkjubaejarklaustri-on'
			});
			expect(await resolveStationSlug(db, 'on-krikjubaejarklaustri-on')).toBe(
				'on-kirkjubaejarklaustri-on'
			);
			const ov = (await overridesByStation(db)).get(krikju.id)!;
			expect(ov).toMatchObject({
				name: 'ON Kirkjubæjarklaustri',
				networkId: null,
				connectors: null
			});
		});

		it('moves a station to the right network, after which it can merge', async () => {
			await saveStationOverride(db, { ...blank, stationId: vik, networkId: n1 });
			const st = await byId(vik);
			expect(st).toMatchObject({ networkId: n1, slug: 'vik-n1-n1' });
			expect(await resolveStationSlug(db, 'vik-n1-on')).toBe('vik-n1-n1');
			expect(await mergeStations(db, vikN1, vik)).toEqual({ ok: true });
			// old slug → renamed slug → merged into Vík í Mýrdal
			expect(await resolveStationSlug(db, 'vik-n1-on')).toBe('vik-i-myrdal-n1-n1');
			expect(await resolveStationSlug(db, 'vik-n1-n1')).toBe('vik-i-myrdal-n1-n1');
		});

		it('suffixes the id when the new slug is taken', async () => {
			await saveStationOverride(db, {
				...blank,
				stationId: vik,
				name: 'Vík í Mýrdal (N1)',
				networkId: n1
			});
			expect((await byId(vik)).slug).toBe(`vik-i-myrdal-n1-n1-${vik}`);
		});

		it('replaces connectors and sets the under-construction flag', async () => {
			await saveStationOverride(db, {
				...blank,
				stationId: vik,
				connectors: [{ type: 'CCS2', powerKw: 150, count: 2 }],
				underConstruction: true
			});
			expect((await connectorsOf(vik)).map((c) => [c.type, c.powerKw, c.count])).toEqual([
				['CCS2', 150, 2]
			]);
			expect((await byId(vik)).underConstruction).toBe(true);
			expect((await byId(vik)).slug).toBe('vik-n1-on'); // name and network unchanged
			expect(await db.select().from(stationSlugRedirects)).toEqual([]);
		});

		it('an empty override removes the row; a renamed station can be renamed back', async () => {
			await saveStationOverride(db, { ...blank, stationId: vik, name: 'Vík' });
			expect((await byId(vik)).slug).toBe('vik-on');
			await saveStationOverride(db, { ...blank, stationId: vik, name: 'Vík (N1)' });
			expect((await byId(vik)).slug).toBe('vik-n1-on');
			// the live slug must never also be a redirect
			const redirects = await db.select().from(stationSlugRedirects);
			expect(redirects.map((r) => r.oldSlug)).toEqual(['vik-on']);
			await saveStationOverride(db, { ...blank, stationId: vik });
			expect(await db.select().from(stationOverrides)).toEqual([]);
		});

		it('refuses an unknown station or network', async () => {
			expect(await saveStationOverride(db, { ...blank, stationId: 99999 })).toMatchObject({
				ok: false
			});
			expect(
				await saveStationOverride(db, { ...blank, stationId: vik, networkId: 99999 })
			).toMatchObject({ ok: false });
		});
	});

	describe('duplicate review', () => {
		it('lists the Hvolsvöllur pair until it is merged or dismissed', async () => {
			const pairs = (await duplicateCandidates(db)).map((c) => [c.a.id, c.b.id]);
			expect(pairs).toEqual([[hvolsA, hvolsB]]);
			await dismissDuplicate(db, hvolsB, hvolsA);
			expect(await duplicateCandidates(db)).toEqual([]);
		});
		it('drops merged pairs and keeps notified ones listed', async () => {
			await markNotified(db, [[hvolsB, hvolsA]]);
			expect(await duplicateCandidates(db)).toHaveLength(1);
			await mergeStations(db, hvolsA, hvolsB);
			expect(await duplicateCandidates(db)).toEqual([]);
		});
		it('rejects a malformed pair', async () => {
			expect(await dismissDuplicate(db, hvolsA, hvolsA)).toMatchObject({ ok: false });
		});
	});
});
