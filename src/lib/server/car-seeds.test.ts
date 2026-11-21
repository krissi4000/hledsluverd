import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCarSeeds } from './car-seeds';

const leaf = {
	slug: 'nissan-leaf-40-kwh-2018',
	make: 'Nissan',
	model: 'Leaf',
	variant: '40 kWh',
	yearFrom: 2018,
	yearTo: 2022,
	batteryKwh: 39,
	acConnector: 'Type2',
	maxAcKw: 6.6,
	dcConnector: 'CHAdeMO',
	maxDcKw: 46,
	bodyStyle: 'hatchback',
	lengthMm: 4490,
	heightMm: 1540,
	wheelbaseMm: 2700,
	sources: ['https://example.com/leaf'],
	confidence: 'high',
	notes: 'anything'
};

describe('parseCarSeeds', () => {
	it('accepts the checked-in seeds/cars.json', () => {
		const cars = parseCarSeeds(JSON.parse(readFileSync('seeds/cars.json', 'utf8')));
		expect(cars.length).toBeGreaterThan(300);
		// the makes OpenEV Data lacked, and old cars it lacked
		expect(cars.some((c) => c.make === 'Kia')).toBe(true);
		expect(cars.some((c) => c.model === 'e-Golf')).toBe(true);
	});

	it('maps an entry to the database columns, without its provenance', () => {
		const { sources: _s, confidence: _c, notes: _n, ...columns } = leaf;
		expect(parseCarSeeds({ cars: [leaf] })).toEqual([columns]);
	});

	it('accepts a car without a DC inlet and a model still on sale', () => {
		const zoe = { ...leaf, slug: 'zoe', dcConnector: null, maxDcKw: null, yearTo: null };
		expect(parseCarSeeds({ cars: [zoe] })[0]).toMatchObject({ dcConnector: null, yearTo: null });
	});

	it.each([
		['a DC plug as the AC plug', { acConnector: 'CCS2' }, /acConnector/],
		['a Type 1 inlet (store it as Type2)', { acConnector: 'Type1' }, /acConnector/],
		['an unknown DC plug', { dcConnector: 'NACS' }, /dcConnector/],
		[
			'no plug at all',
			{ acConnector: null, dcConnector: null, maxAcKw: null, maxDcKw: null },
			/at least one plug/
		],
		['a DC speed without a DC plug', { dcConnector: null }, /maxDcKw given without/],
		['an implausible AC speed', { maxAcKw: 64 }, /maxAcKw must be/],
		['a speed given as text', { maxDcKw: '46' }, /maxDcKw must be/],
		['no first year', { yearFrom: null }, /yearFrom is required/],
		['a range ending before it starts', { yearTo: 2017 }, /yearTo is before/],
		['a fractional year', { yearFrom: 2018.5 }, /yearFrom must be a whole number/],
		['an unknown body style', { bodyStyle: 'pickup' }, /bodyStyle/],
		['no sources', { sources: [] }, /sources/],
		['a source that is not a URL', { sources: ['Wikipedia'] }, /sources/],
		['no confidence', { confidence: undefined }, /confidence/],
		['a slug that is not kebab-case', { slug: 'Nissan Leaf' }, /slug/],
		['a missing model', { model: '' }, /model is required/]
	])('throws on %s', (_, change, error) => {
		expect(() => parseCarSeeds({ cars: [{ ...leaf, ...change }] })).toThrow(error);
	});

	it('throws on a duplicate slug or a duplicate name and first year', () => {
		expect(() => parseCarSeeds({ cars: [leaf, { ...leaf, variant: 'other' }] })).toThrow(
			/duplicate slug/
		);
		expect(() => parseCarSeeds({ cars: [leaf, { ...leaf, slug: 'other' }] })).toThrow(
			/duplicate make/
		);
		// the same name in another generation is fine
		expect(
			parseCarSeeds({ cars: [leaf, { ...leaf, slug: 'other', yearFrom: 2023, yearTo: null }] })
		).toHaveLength(2);
	});
});
