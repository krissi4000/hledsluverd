import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { desc } from 'drizzle-orm';
import { TEST_DB_URL, closeTestDb, setupTestDb, truncateAll } from '../../../../tests/helpers/db';
import type { Db } from './client';
import { networks, prices } from './schema';
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
});
