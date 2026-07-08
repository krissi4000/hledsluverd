import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DB_URL, closeTestDb, setupTestDb, truncateAll } from '../../../tests/helpers/db';
import type { Db } from './db/client';
import { networks, stations } from './db/schema';
import { availabilityAll } from './db/availability';
import { refreshAvailability, resetBudget } from './availability-refresh';

const fixtureBody = readFileSync('tests/fixtures/tomtom-charging-availability.json', 'utf8');
const okFetch = (async () => new Response(fixtureBody, { status: 200 })) as typeof fetch;

describe.skipIf(!TEST_DB_URL)('refreshAvailability', () => {
	let db: Db;
	let st1: number, st2: number;

	beforeAll(async () => {
		db = await setupTestDb();
	});
	afterAll(async () => {
		await closeTestDb(db);
	});
	beforeEach(async () => {
		await truncateAll(db);
		resetBudget();
		const [n] = await db.insert(networks).values({ name: 'ON', slug: 'on' }).returning();
		const rows = await db
			.insert(stations)
			.values([
				{ networkId: n.id, slug: 'a-on', name: 'A', location: { x: -21.4, y: 64.03 } },
				{ networkId: n.id, slug: 'b-on', name: 'B', location: { x: -21.5, y: 64.05 } }
			])
			.returning();
		st1 = rows[0].id;
		st2 = rows[1].id;
	});

	it('fetches stations with no cache entry and writes the cache', async () => {
		const n = await refreshAvailability(
			db,
			[{ stationId: st1, tomtomId: 'tt-1', fetchedAt: null }],
			{ key: 'k', fetchFn: okFetch }
		);
		expect(n).toBe(1);
		const all = await availabilityAll(db);
		expect(all[0]).toMatchObject({ stationId: st1, freeCount: 1, totalCount: 2, source: 'tomtom' });
	});

	it('skips entries fresher than 5 minutes', async () => {
		const now = new Date('2026-07-06T12:00:00Z');
		const fresh = new Date(now.getTime() - 2 * 60 * 1000);
		const n = await refreshAvailability(
			db,
			[{ stationId: st1, tomtomId: 'tt-1', fetchedAt: fresh }],
			{ key: 'k', fetchFn: okFetch, now }
		);
		expect(n).toBe(0);
		expect(await availabilityAll(db)).toHaveLength(0);
	});

	it('refreshes oldest first and respects maxCalls', async () => {
		const now = new Date('2026-07-06T12:00:00Z');
		const older = new Date(now.getTime() - 60 * 60 * 1000);
		const old = new Date(now.getTime() - 10 * 60 * 1000);
		const n = await refreshAvailability(
			db,
			[
				{ stationId: st1, tomtomId: 'tt-1', fetchedAt: old },
				{ stationId: st2, tomtomId: 'tt-2', fetchedAt: older }
			],
			{ key: 'k', fetchFn: okFetch, now, maxCalls: 1 }
		);
		expect(n).toBe(1);
		const all = await availabilityAll(db);
		expect(all).toHaveLength(1);
		expect(all[0].stationId).toBe(st2); // the older one won the single slot
	});

	it('one failing station does not stop the others, and nothing throws', async () => {
		let calls = 0;
		const flaky = (async () => {
			calls++;
			if (calls === 1) return new Response('boom', { status: 500 });
			return new Response(fixtureBody, { status: 200 });
		}) as typeof fetch;
		const n = await refreshAvailability(
			db,
			[
				{ stationId: st1, tomtomId: 'tt-1', fetchedAt: null },
				{ stationId: st2, tomtomId: 'tt-2', fetchedAt: null }
			],
			{ key: 'k', fetchFn: flaky }
		);
		expect(n).toBe(1);
		expect((await availabilityAll(db)).map((a) => a.stationId)).toEqual([st2]);
	});

	it('an unknown id (empty connectors) writes nothing', async () => {
		const empty = (async () =>
			new Response(JSON.stringify({ connectors: [], chargingAvailability: 'x' }), {
				status: 200
			})) as typeof fetch;
		const n = await refreshAvailability(
			db,
			[{ stationId: st1, tomtomId: 'tt-dead', fetchedAt: null }],
			{ key: 'k', fetchFn: empty }
		);
		expect(n).toBe(0);
		expect(await availabilityAll(db)).toHaveLength(0);
	});
});
