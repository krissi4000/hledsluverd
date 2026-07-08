import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DB_URL, closeTestDb, setupTestDb, truncateAll } from '../../../../tests/helpers/db';
import type { Db } from './client';
import { networks, stations } from './schema';
import { availabilityAll, upsertAvailability } from './availability';

describe.skipIf(!TEST_DB_URL)('availability store', () => {
	let db: Db;
	let stationId: number;

	beforeAll(async () => {
		db = await setupTestDb();
	});
	afterAll(async () => {
		await closeTestDb(db);
	});
	beforeEach(async () => {
		await truncateAll(db);
		const [n] = await db.insert(networks).values({ name: 'ON', slug: 'on' }).returning();
		const [s] = await db
			.insert(stations)
			.values({
				networkId: n.id,
				slug: 'hellisheidi-on',
				name: 'Hellisheiði',
				location: { x: -21.4, y: 64.03 }
			})
			.returning();
		stationId = s.id;
	});

	it('inserts a first entry with fetchedAt defaulting to now', async () => {
		await upsertAvailability(db, {
			stationId,
			freeCount: 3,
			totalCount: 4,
			perType: { CCS2: { free: 3, total: 4 } },
			source: 'tomtom'
		});
		const all = await availabilityAll(db);
		expect(all).toHaveLength(1);
		expect(all[0]).toMatchObject({ stationId, freeCount: 3, totalCount: 4, source: 'tomtom' });
		expect(all[0].perType).toEqual({ CCS2: { free: 3, total: 4 } });
		expect(Math.abs(Date.now() - all[0].fetchedAt.getTime())).toBeLessThan(5000);
	});

	it('upsert overwrites the existing entry (latest only, no history)', async () => {
		await upsertAvailability(db, {
			stationId,
			freeCount: 3,
			totalCount: 4,
			perType: null,
			source: 'tomtom'
		});
		await upsertAvailability(db, {
			stationId,
			freeCount: 0,
			totalCount: 4,
			perType: null,
			source: 'tomtom',
			fetchedAt: new Date('2026-07-06T12:00:00Z')
		});
		const all = await availabilityAll(db);
		expect(all).toHaveLength(1);
		expect(all[0].freeCount).toBe(0);
		expect(all[0].fetchedAt.toISOString()).toBe('2026-07-06T12:00:00.000Z');
	});
});
