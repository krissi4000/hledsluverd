import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DB_URL, closeTestDb, setupTestDb, truncateAll } from '../../../../tests/helpers/db';
import type { Db } from './client';
import { cars } from './schema';
import { carBySlug, carList } from './cars';

describe.skipIf(!TEST_DB_URL)('cars queries', () => {
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

	const leaf = (variant: string, yearFrom: number, yearTo: number | null) => ({
		make: 'Nissan',
		model: 'Leaf',
		variant,
		yearFrom,
		yearTo,
		slug: `nissan-leaf-${yearFrom}`,
		acConnector: 'Type2' as const,
		maxAcKw: 6.6,
		dcConnector: 'CHAdeMO' as const,
		maxDcKw: 46
	});

	it('lists cars by make and model, newest generation first, with plugs and years', async () => {
		await db.insert(cars).values([
			{
				make: 'Tesla',
				model: 'Model 3',
				variant: 'Long Range',
				yearFrom: 2019,
				yearTo: 2023,
				batteryKwh: 75,
				slug: 'tesla-model-3-lr-2019',
				acConnector: 'Type2',
				maxAcKw: 11,
				dcConnector: 'CCS2',
				maxDcKw: 250
			},
			leaf('24 kWh', 2011, 2015),
			leaf('40 kWh', 2018, 2022)
		]);
		const list = await carList(db);
		expect(list.map((c) => c.slug)).toEqual([
			'nissan-leaf-2018',
			'nissan-leaf-2011',
			'tesla-model-3-lr-2019'
		]);
		expect(list[2]).toEqual({
			slug: 'tesla-model-3-lr-2019',
			make: 'Tesla',
			model: 'Model 3',
			variant: 'Long Range',
			yearFrom: 2019,
			yearTo: 2023,
			batteryKwh: 75,
			acConnector: 'Type2',
			maxAcKw: 11,
			dcConnector: 'CCS2',
			maxDcKw: 250
		});
	});

	it('finds a car by slug', async () => {
		await db.insert(cars).values([leaf('40 kWh', 2018, 2022)]);
		expect(await carBySlug(db, 'nissan-leaf-2018')).toMatchObject({ variant: '40 kWh' });
		expect(await carBySlug(db, 'nope')).toBeNull();
	});

	it('allows the same variant name in two generations', async () => {
		await db.insert(cars).values([leaf('Base', 2011, 2017), leaf('Base', 2018, null)]);
		expect(await carList(db)).toHaveLength(2);
	});

	it('returns an empty list when no cars are seeded', async () => {
		expect(await carList(db)).toEqual([]);
	});
});
