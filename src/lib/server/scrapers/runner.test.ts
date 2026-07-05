import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { desc } from 'drizzle-orm';
import { TEST_DB_URL, closeTestDb, setupTestDb, truncateAll } from '../../../../tests/helpers/db';
import type { Db } from '../db/client';
import { networks, prices, scrapeRuns } from '../db/schema';
import type { Scraper } from './types';
import { runScrapers } from './runner';

const good = (id: string, price: number): Scraper => ({
	id,
	scrape: async () => ({ readings: [{ tariffKey: 'DC', priceIskPerKwh: price }], warnings: [] })
});
const broken = (id: string): Scraper => ({
	id,
	scrape: async () => {
		throw new Error('layout changed');
	}
});

describe.skipIf(!TEST_DB_URL)('runScrapers', () => {
	let db: Db;
	let onId: number;

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
				{ name: 'ON', slug: 'on', scraperId: 'on' },
				{ name: 'Orkan', slug: 'orkan', scraperId: 'orkan' },
				{ name: 'Tesla', slug: 'tesla', scraperId: null }
			])
			.returning();
		onId = rows[0].id;
	});

	it('first run inserts and reports changed; identical rerun reports ok and bumps verified', async () => {
		const first = await runScrapers(db, [good('on', 62), good('orkan', 49)]);
		expect(first.map((s) => s.status)).toEqual(['changed', 'changed']);
		const second = await runScrapers(db, [good('on', 62), good('orkan', 49)]);
		expect(second.map((s) => s.status)).toEqual(['ok', 'ok']);
		expect(await db.select().from(prices)).toHaveLength(2);
		expect(await db.select().from(scrapeRuns)).toHaveLength(4);
	});

	it('skips networks without a scraper_id (Tesla)', async () => {
		const summaries = await runScrapers(db, [good('on', 62), good('orkan', 49)]);
		expect(summaries.map((s) => s.networkSlug).sort()).toEqual(['on', 'orkan']);
	});

	it('isolates failures: one broken scraper never blocks the others', async () => {
		const summaries = await runScrapers(db, [broken('on'), good('orkan', 49)]);
		expect(summaries.find((s) => s.networkSlug === 'on')!.status).toBe('failed');
		expect(summaries.find((s) => s.networkSlug === 'orkan')!.status).toBe('changed');
		expect(await db.select().from(prices)).toHaveLength(1);
		const runs = await db.select().from(scrapeRuns);
		expect(runs.find((r) => r.networkId === onId)!.message).toMatch(/layout changed/);
	});

	it('an empty reading list is a failure, not a silent ok', async () => {
		const empty: Scraper = { id: 'on', scrape: async () => ({ readings: [], warnings: [] }) };
		const [s] = await runScrapers(db, [empty]);
		expect(s.status).toBe('failed');
	});

	it('an implausible price fails the run and stores nothing for it', async () => {
		const [s] = await runScrapers(db, [good('on', 4900)]);
		expect(s.status).toBe('failed');
		expect(s.message).toMatch(/implausible/i);
		expect(await db.select().from(prices)).toHaveLength(0);
	});

	it('a scraper_id with no registered module records a failed run', async () => {
		const summaries = await runScrapers(db, [good('orkan', 49)]);
		expect(summaries.find((s) => s.networkSlug === 'on')!.status).toBe('failed');
		expect(summaries.find((s) => s.networkSlug === 'on')!.message).toMatch(/no scraper module/);
	});

	it('notifies exactly once, when the 3rd consecutive failure lands', async () => {
		const calls: string[] = [];
		const notify = async (_topic: string, message: string) => {
			calls.push(message);
		};
		const opts = { ntfyTopic: 'test-topic', notify };
		await runScrapers(db, [broken('on'), good('orkan', 49)], opts);
		await runScrapers(db, [broken('on'), good('orkan', 49)], opts);
		expect(calls).toHaveLength(0);
		await runScrapers(db, [broken('on'), good('orkan', 49)], opts);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatch(/ON/);
		await runScrapers(db, [broken('on'), good('orkan', 49)], opts);
		expect(calls).toHaveLength(1); // 4th failure: no re-notification
	});

	it('warnings from a successful scrape land in the run message', async () => {
		const warny: Scraper = {
			id: 'on',
			scrape: async () => ({
				readings: [{ tariffKey: 'DC', priceIskPerKwh: 62 }],
				warnings: ['óþekkt stöð í verðtöflu: Baula']
			})
		};
		await runScrapers(db, [warny]);
		const runs = await db.select().from(scrapeRuns).orderBy(desc(scrapeRuns.id));
		expect(runs[0].message).toMatch(/Baula/);
	});
});
