import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DB_URL, closeTestDb, setupTestDb, truncateAll } from '../../../../tests/helpers/db';
import type { Db } from './client';
import { cars } from './schema';
import { carList } from './cars';

describe.skipIf(!TEST_DB_URL)('carList', () => {
	let db: Db;

	beforeAll(async () => {
		db = await setupTestDb();
	});
	afterAll(async () => {
		await closeTestDb(db);
	});
	beforeEach(async () => {
		await truncateAll(db);
	});

	it('returns cars ordered by make, model, variant with connector fields', async () => {
		await db.insert(cars).values([
			{
				make: 'Tesla',
				model: 'Model 3',
				variant: 'Long Range 2024',
				slug: 'tesla-model-3-2024-lr',
				acConnector: 'Type2',
				maxAcKw: 11,
				dcConnector: 'CCS2',
				maxDcKw: 250
			},
			{
				make: 'Nissan',
				model: 'Leaf',
				variant: 'Base 2024',
				slug: 'nissan-leaf-2024',
				acConnector: 'Type2',
				maxAcKw: 6.6,
				dcConnector: 'CHAdeMO',
				maxDcKw: 50
			}
		]);
		const list = await carList(db);
		expect(list.map((c) => c.make)).toEqual(['Nissan', 'Tesla']);
		expect(list[0]).toMatchObject({
			slug: 'nissan-leaf-2024',
			dcConnector: 'CHAdeMO',
			maxDcKw: 50
		});
	});

	it('returns an empty list when no cars are seeded', async () => {
		expect(await carList(db)).toEqual([]);
	});
});
