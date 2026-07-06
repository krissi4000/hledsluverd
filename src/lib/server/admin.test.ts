import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DB_URL, closeTestDb, setupTestDb, truncateAll } from '../../../tests/helpers/db';
import type { Db } from './db/client';
import { networks, prices, scrapeRuns, stations } from './db/schema';
import { insertPriceIfChanged } from './db/prices';
import { bumpVerified, scraperHealth, setStationActive, submitManualPrice } from './admin';

const form = (entries: Record<string, string>): FormData => {
	const f = new FormData();
	for (const [k, v] of Object.entries(entries)) f.set(k, v);
	return f;
};

describe.skipIf(!TEST_DB_URL)('admin logic', () => {
	let db: Db;
	let onId: number;
	let stationId: number;

	beforeAll(async () => {
		db = await setupTestDb();
	});
	afterAll(async () => {
		await closeTestDb(db);
	});
	beforeEach(async () => {
		await truncateAll(db);
		const [n] = await db
			.insert(networks)
			.values({ name: 'ON', slug: 'on', scraperId: 'on' })
			.returning();
		onId = n.id;
		const [s] = await db
			.insert(stations)
			.values({
				networkId: onId,
				slug: 'hellisheidi-on',
				name: 'Hellisheiði',
				location: { x: -21.4, y: 64.03 }
			})
			.returning();
		stationId = s.id;
	});

	it('submitManualPrice inserts a manual reading (decimal comma accepted)', async () => {
		const res = await submitManualPrice(
			db,
			form({ networkId: String(onId), tariffKey: 'AC', price: '48', minuteFee: '0,5' })
		);
		expect(res).toEqual({ ok: true });
		const [row] = await db.select().from(prices);
		expect(row).toMatchObject({
			priceIskPerKwh: 48,
			minuteFeeIsk: 0.5,
			source: 'manual',
			stationId: null
		});
	});

	it('submitManualPrice accepts an optional station scope and fee-after', async () => {
		const res = await submitManualPrice(
			db,
			form({
				networkId: String(onId),
				stationId: String(stationId),
				tariffKey: 'DC',
				price: '73',
				minuteFee: '60',
				minuteFeeAfterMin: '60'
			})
		);
		expect(res).toEqual({ ok: true });
		const [row] = await db.select().from(prices);
		expect(row).toMatchObject({ stationId, minuteFeeAfterMin: 60 });
	});

	it('submitManualPrice rejects bad input without writing', async () => {
		expect(
			(await submitManualPrice(db, form({ networkId: 'x', tariffKey: 'AC', price: '48' }))).ok
		).toBe(false);
		expect(
			(await submitManualPrice(db, form({ networkId: String(onId), tariffKey: 'XX', price: '48' })))
				.ok
		).toBe(false);
		expect(
			(await submitManualPrice(db, form({ networkId: String(onId), tariffKey: 'AC', price: '' })))
				.ok
		).toBe(false);
		const implausible = await submitManualPrice(
			db,
			form({ networkId: String(onId), tariffKey: 'AC', price: '4900' })
		);
		expect(implausible.ok).toBe(false);
		expect(implausible.error).toMatch(/implausible/i);
		expect(await db.select().from(prices)).toHaveLength(0);
	});

	it('submitManualPrice rejects stationId from a different network', async () => {
		const [other] = await db.insert(networks).values({ name: 'N1', slug: 'n1' }).returning();
		// stationId belongs to ON network, but networkId is the new N1 network
		const res = await submitManualPrice(
			db,
			form({
				networkId: String(other.id),
				stationId: String(stationId),
				tariffKey: 'DC',
				price: '50'
			})
		);
		expect(res.ok).toBe(false);
		expect(res.error).toMatch(/tilheyrir/);
		expect(await db.select().from(prices)).toHaveLength(0);
	});

	it('submitManualPrice rejects a non-integer stationId', async () => {
		const res = await submitManualPrice(
			db,
			form({ networkId: String(onId), stationId: '1.5', tariffKey: 'DC', price: '50' })
		);
		expect(res.ok).toBe(false);
		expect(res.error).toBe('ógilt form');
		expect(await db.select().from(prices)).toHaveLength(0);
	});

	it('bumpVerified touches only the targeted row', async () => {
		await insertPriceIfChanged(db, {
			networkId: onId,
			tariffKey: 'AC',
			priceIskPerKwh: 48,
			source: 'manual'
		});
		const [before] = await db.select().from(prices);
		await new Promise((r) => setTimeout(r, 20));
		expect(await bumpVerified(db, before.id)).toEqual({ ok: true });
		const [after] = await db.select().from(prices);
		expect(after.verifiedAt.getTime()).toBeGreaterThan(before.verifiedAt.getTime());
		expect((await bumpVerified(db, 999999)).ok).toBe(false);
	});

	it('setStationActive toggles visibility', async () => {
		expect(await setStationActive(db, stationId, false)).toEqual({ ok: true });
		const [s] = await db.select().from(stations);
		expect(s.isActive).toBe(false);
	});

	it('scraperHealth reports last run and consecutive failures per scraper network', async () => {
		await db.insert(scrapeRuns).values([
			{ networkId: onId, status: 'ok', message: '0 inserted, 2 verified' },
			{ networkId: onId, status: 'failed', message: 'layout changed' },
			{ networkId: onId, status: 'failed', message: 'layout changed' }
		]);
		const health = await scraperHealth(db);
		expect(health).toHaveLength(1);
		expect(health[0]).toMatchObject({
			networkName: 'ON',
			lastStatus: 'failed',
			consecutiveFailures: 2
		});
	});
});
