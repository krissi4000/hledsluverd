import { describe, expect, it } from 'vitest';
import { sortStations } from './station-list';

const rows = [
	{ name: 'B', price: 50, effectivePrice: 52 },
	{ name: 'A', price: 55, effectivePrice: 55 },
	{ name: 'C', price: null, effectivePrice: null },
	{ name: 'D', price: 40, effectivePrice: null },
	{ name: 'E', price: 48, effectivePrice: 56 }
];

describe('sortStations', () => {
	it('by price: cheapest raw price first, unknown last', () => {
		expect(sortStations(rows, 'price').map((r) => r.name)).toEqual(['D', 'E', 'B', 'A', 'C']);
	});

	it('by effective price: fees count, unpriceable effective after, unknown price last', () => {
		expect(sortStations(rows, 'effective').map((r) => r.name)).toEqual(['B', 'A', 'E', 'D', 'C']);
	});

	it('breaks ties by Icelandic name order and does not mutate the input', () => {
		const tie = [
			{ name: 'Ö', price: 1 },
			{ name: 'Á', price: 1 },
			{ name: 'A', price: 1 }
		];
		expect(sortStations(tie, 'price').map((r) => r.name)).toEqual(['A', 'Á', 'Ö']);
		expect(tie[0].name).toBe('Ö');
	});
});
