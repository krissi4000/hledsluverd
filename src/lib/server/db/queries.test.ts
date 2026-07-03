import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DB_URL, closeTestDb, setupTestDb, truncateAll } from '../../../../tests/helpers/db';
import type { Db } from './client';
import { connectors, networks, prices, stations } from './schema';
import { insertPriceIfChanged } from './prices';
import { currentPrices, rateCard, stationList } from './queries';

describe.skipIf(!TEST_DB_URL)('read queries', () => {
	let db: Db;
	let on: number, n1: number;

	beforeAll(async () => {
		db = await setupTestDb();
	});
	afterAll(async () => {
		await closeTestDb(db);
	});

	beforeEach(async () => {
		await truncateAll(db);
		const rows = await db
			.insert(networks)
			.values([
				{ name: 'ON', slug: 'on' },
				{ name: 'N1', slug: 'n1' }
			])
			.returning();
		on = rows[0].id;
		n1 = rows[1].id;

		// ON: cheap DC + a 150 kW tier + AC. N1: expensive DC only.
		await insertPriceIfChanged(db, {
			networkId: on,
			tariffKey: 'AC',
			priceIskPerKwh: 39,
			source: 'manual'
		});
		await insertPriceIfChanged(db, {
			networkId: on,
			tariffKey: 'DC',
			priceIskPerKwh: 49,
			source: 'manual'
		});
		await insertPriceIfChanged(db, {
			networkId: on,
			tariffKey: 'DC_150',
			priceIskPerKwh: 55,
			source: 'manual'
		});
		await insertPriceIfChanged(db, {
			networkId: n1,
			tariffKey: 'DC',
			priceIskPerKwh: 70,
			source: 'manual'
		});
		// price change: DC 49 → 44 (current must be 44)
		await insertPriceIfChanged(db, {
			networkId: on,
			tariffKey: 'DC',
			priceIskPerKwh: 44,
			source: 'manual'
		});

		const st = await db
			.insert(stations)
			.values([
				{
					networkId: on,
					slug: 'hellisheidi-on',
					name: 'Hellisheiði',
					location: { x: -21.4, y: 64.03 }
				},
				{
					networkId: on,
					slug: 'laugardalur-on',
					name: 'Laugardalur',
					location: { x: -21.87, y: 64.14 }
				},
				{
					networkId: n1,
					slug: 'stadarskali-n1',
					name: 'Staðarskáli',
					location: { x: -21.08, y: 65.13 }
				},
				{
					networkId: n1,
					slug: 'gamla-n1',
					name: 'Gömul stöð',
					isActive: false,
					location: { x: -21, y: 64 }
				}
			])
			.returning();
		await db.insert(connectors).values([
			{ stationId: st[0].id, type: 'CCS2', powerKw: 200, count: 2 }, // → DC_150 (55)
			{ stationId: st[0].id, type: 'CHAdeMO', powerKw: 50, count: 1 },
			{ stationId: st[1].id, type: 'Type2', powerKw: 22, count: 4 }, // AC only
			{ stationId: st[2].id, type: 'CCS2', powerKw: 60, count: 2 } // → DC (70)
		]);
	});

	it('currentPrices returns the newest row per network+tariff', async () => {
		const cp = await currentPrices(db);
		const onDc = cp.find((p) => p.networkId === on && p.tariffKey === 'DC')!;
		expect(onDc.priceIskPerKwh).toBe(44);
		expect(cp).toHaveLength(4); // ON AC, DC, DC_150 + N1 DC
	});

	it('rateCard groups by network sorted by DC price', async () => {
		const cards = await rateCard(db);
		expect(cards.map((c) => c.networkSlug)).toEqual(['on', 'n1']);
		expect(cards[0]).toMatchObject({ networkSlug: 'on', dc: 44, ac: 39 });
		expect(cards[1]).toMatchObject({ networkSlug: 'n1', dc: 70, ac: null });
	});

	it('stationList DC: only stations with DC connectors, tier-derived price, sorted cheapest first', async () => {
		const list = await stationList(db, 'DC');
		expect(list.map((s) => s.slug)).toEqual(['hellisheidi-on', 'stadarskali-n1']);
		expect(list[0].price).toBe(55); // max-power connector is 200 kW → DC_150 tier
		expect(list[0].connectors).toHaveLength(2);
		expect(list[1].price).toBe(70);
	});

	it('stationList AC: only stations with Type2', async () => {
		const list = await stationList(db, 'AC');
		expect(list.map((s) => s.slug)).toEqual(['laugardalur-on']);
		expect(list[0].price).toBe(39);
	});

	it('excludes inactive stations', async () => {
		const all = [...(await stationList(db, 'DC')), ...(await stationList(db, 'AC'))];
		expect(all.find((s) => s.slug === 'gamla-n1')).toBeUndefined();
	});

	it('currentPrices ignores station-scoped rows and breaks validFrom ties by id', async () => {
		const [st] = await db.select().from(stations);
		await insertPriceIfChanged(db, {
			networkId: on,
			stationId: st.id,
			tariffKey: 'DC',
			priceIskPerKwh: 99,
			source: 'manual'
		});
		// two rows with identical validFrom — the higher id (later insert) must win
		const validFrom = new Date('2026-01-01T00:00:00Z');
		await db.insert(prices).values([
			{ networkId: n1, tariffKey: 'AC', priceIskPerKwh: 30, source: 'manual', validFrom },
			{ networkId: n1, tariffKey: 'AC', priceIskPerKwh: 32, source: 'manual', validFrom }
		]);
		const cp = await currentPrices(db);
		expect(cp.find((p) => p.networkId === on && p.tariffKey === 'DC')!.priceIskPerKwh).toBe(44);
		expect(cp.find((p) => p.networkId === n1 && p.tariffKey === 'AC')!.priceIskPerKwh).toBe(32);
	});

	it('rateCard keeps a network whose only price is the DC_150 tier', async () => {
		const [ork] = await db.insert(networks).values({ name: 'Orkan', slug: 'orkan' }).returning();
		await insertPriceIfChanged(db, {
			networkId: ork.id,
			tariffKey: 'DC_150',
			priceIskPerKwh: 89,
			source: 'manual'
		});
		const cards = await rateCard(db);
		expect(cards.map((c) => c.networkSlug)).toEqual(['on', 'n1', 'orkan']);
		expect(cards[2]).toMatchObject({ networkSlug: 'orkan', dc: 89, ac: null });
	});

	it('stationList prices stations on price-less networks as unknown, sorted last', async () => {
		const [e1] = await db.insert(networks).values({ name: 'e1', slug: 'e1' }).returning();
		const [st] = await db
			.insert(stations)
			.values({
				networkId: e1.id,
				slug: 'verdlaus-e1',
				name: 'Verðlaus',
				location: { x: -20, y: 64 }
			})
			.returning();
		await db.insert(connectors).values({ stationId: st.id, type: 'CCS2', powerKw: 150, count: 1 });
		const list = await stationList(db, 'DC');
		expect(list.map((s) => s.slug)).toEqual(['hellisheidi-on', 'stadarskali-n1', 'verdlaus-e1']);
		expect(list[2].price).toBeNull();
		expect(list[2].minuteFeeIsk).toBeNull();
		expect(list[2].verifiedAt).toBeNull();
	});
});
