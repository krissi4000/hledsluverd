import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DB_URL, closeTestDb, setupTestDb, truncateAll } from '../../../../tests/helpers/db';
import type { Db } from './client';
import { lastPriceFetch } from './queries';
import { networks, scrapeRuns } from './schema';

describe.skipIf(!TEST_DB_URL)('lastPriceFetch', () => {
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

	it('is null before any successful scrape', async () => {
		expect(await lastPriceFetch(db)).toBeNull();
		await db.insert(scrapeRuns).values({ networkId, status: 'failed', message: 'x' });
		expect(await lastPriceFetch(db)).toBeNull();
	});

	it('is the newest ok/changed run, ignoring later failures', async () => {
		await db.insert(scrapeRuns).values([
			{ networkId, status: 'ok', startedAt: new Date('2026-11-07T10:00:00Z') },
			{ networkId, status: 'changed', startedAt: new Date('2026-11-07T11:00:00Z') },
			{ networkId, status: 'failed', startedAt: new Date('2026-11-07T12:00:00Z') }
		]);
		expect((await lastPriceFetch(db))?.toISOString()).toBe('2026-11-07T11:00:00.000Z');
	});
});
