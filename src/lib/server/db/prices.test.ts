import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { desc } from 'drizzle-orm';
import { TEST_DB_URL, closeTestDb, setupTestDb, truncateAll } from '../../../../tests/helpers/db';
import type { Db } from './client';
import { networks, prices, stations } from './schema';
import { insertPriceIfChanged } from './prices';

describe.skipIf(!TEST_DB_URL)('insertPriceIfChanged', () => {
	let db: Db;
	let networkId: number;

	beforeAll(async () => {
		db = await setupTestDb();
	});
	afterAll(async () => {
		await closeTestDb(db);
	});
	beforeEach(async () => {
		await truncateAll(db);
		const [n] = await db.insert(networks).values({ name: 'ON', slug: 'on' }).returning();
		networkId = n.id;
	});

	it('inserts a first price row', async () => {
		const r = await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'DC',
			priceIskPerKwh: 49,
			source: 'manual'
		});
		expect(r).toBe('inserted');
		expect(await db.select().from(prices)).toHaveLength(1);
	});

	it('bumps verified_at without a new row when unchanged', async () => {
		await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'DC',
			priceIskPerKwh: 49,
			source: 'manual'
		});
		const [before] = await db.select().from(prices);
		await new Promise((r) => setTimeout(r, 20));
		const r = await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'DC',
			priceIskPerKwh: 49,
			source: 'scraper'
		});
		expect(r).toBe('verified');
		const rows = await db.select().from(prices);
		expect(rows).toHaveLength(1);
		expect(rows[0].verifiedAt.getTime()).toBeGreaterThan(before.verifiedAt.getTime());
	});

	it('appends a new row when the price changes, keeping history', async () => {
		await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'DC',
			priceIskPerKwh: 49,
			source: 'manual'
		});
		const r = await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'DC',
			priceIskPerKwh: 55,
			source: 'scraper'
		});
		expect(r).toBe('inserted');
		const rows = await db.select().from(prices).orderBy(desc(prices.validFrom), desc(prices.id));
		expect(rows).toHaveLength(2);
		expect(rows[0].priceIskPerKwh).toBe(55);
	});

	it('treats separate tariff keys independently', async () => {
		await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'DC',
			priceIskPerKwh: 49,
			source: 'manual'
		});
		const r = await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'AC',
			priceIskPerKwh: 39,
			source: 'manual'
		});
		expect(r).toBe('inserted');
		expect(await db.select().from(prices)).toHaveLength(2);
	});

	it('rejects implausible prices', async () => {
		await expect(
			insertPriceIfChanged(db, {
				networkId,
				tariffKey: 'DC',
				priceIskPerKwh: 4900,
				source: 'scraper'
			})
		).rejects.toThrow(/implausible/i);
		expect(await db.select().from(prices)).toHaveLength(0);
	});

	it('rejects NaN prices and minute fees (parse failures must not enter history)', async () => {
		await expect(
			insertPriceIfChanged(db, {
				networkId,
				tariffKey: 'DC',
				priceIskPerKwh: NaN,
				source: 'scraper'
			})
		).rejects.toThrow(/implausible/i);
		await expect(
			insertPriceIfChanged(db, {
				networkId,
				tariffKey: 'DC',
				priceIskPerKwh: 49,
				minuteFeeIsk: NaN,
				source: 'scraper'
			})
		).rejects.toThrow(/implausible/i);
		expect(await db.select().from(prices)).toHaveLength(0);
	});

	it('accepts the plausibility boundaries 10 and 200 inclusive', async () => {
		await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'AC',
			priceIskPerKwh: 10,
			source: 'manual'
		});
		await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'DC',
			priceIskPerKwh: 200,
			source: 'manual'
		});
		expect(await db.select().from(prices)).toHaveLength(2);
	});

	it('appends a new row when only the minute fee changes', async () => {
		await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'AC',
			priceIskPerKwh: 48,
			minuteFeeIsk: 0.5,
			source: 'manual'
		});
		const r = await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'AC',
			priceIskPerKwh: 48,
			minuteFeeIsk: 0,
			source: 'scraper'
		});
		expect(r).toBe('inserted');
		expect(await db.select().from(prices)).toHaveLength(2);
	});

	it('appends a new row when only the fee-free period changes', async () => {
		await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'DC',
			priceIskPerKwh: 73,
			minuteFeeIsk: 60,
			minuteFeeAfterMin: 60,
			source: 'scraper'
		});
		const same = await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'DC',
			priceIskPerKwh: 73,
			minuteFeeIsk: 60,
			minuteFeeAfterMin: 60,
			source: 'scraper'
		});
		expect(same).toBe('verified');
		const changed = await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'DC',
			priceIskPerKwh: 73,
			minuteFeeIsk: 60,
			minuteFeeAfterMin: 30,
			source: 'scraper'
		});
		expect(changed).toBe('inserted');
		expect(await db.select().from(prices)).toHaveLength(2);
	});

	it('rejects a non-integer or negative fee-free period', async () => {
		await expect(
			insertPriceIfChanged(db, {
				networkId,
				tariffKey: 'DC',
				priceIskPerKwh: 73,
				minuteFeeIsk: 60,
				minuteFeeAfterMin: 1.5,
				source: 'scraper'
			})
		).rejects.toThrow(/implausible/i);
		await expect(
			insertPriceIfChanged(db, {
				networkId,
				tariffKey: 'DC',
				priceIskPerKwh: 73,
				minuteFeeIsk: 60,
				minuteFeeAfterMin: -5,
				source: 'scraper'
			})
		).rejects.toThrow(/implausible/i);
		expect(await db.select().from(prices)).toHaveLength(0);
	});

	it('keeps station-scoped prices independent of the network-wide price', async () => {
		const [st] = await db
			.insert(stations)
			.values({
				networkId,
				slug: 'hellisheidi-on',
				name: 'Hellisheiði',
				location: { x: -21.4009, y: 64.0374 }
			})
			.returning();
		await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'DC',
			priceIskPerKwh: 49,
			source: 'manual'
		});
		const r = await insertPriceIfChanged(db, {
			networkId,
			stationId: st.id,
			tariffKey: 'DC',
			priceIskPerKwh: 55,
			source: 'manual'
		});
		expect(r).toBe('inserted');
		// re-sending the network-wide price must still dedupe against its own scope
		const again = await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'DC',
			priceIskPerKwh: 49,
			source: 'scraper'
		});
		expect(again).toBe('verified');
		expect(await db.select().from(prices)).toHaveLength(2);
	});
});
