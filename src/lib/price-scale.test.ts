import { describe, expect, it } from 'vitest';
import { priceRanks, rankColors } from './price-scale';

describe('priceRanks', () => {
	it('ranks cheapest 0 and most expensive 1', () => {
		const r = priceRanks([
			{ id: 1, price: 40 },
			{ id: 2, price: 60 },
			{ id: 3, price: 80 }
		]);
		expect([r.get(1), r.get(2), r.get(3)]).toEqual([0, 0.5, 1]);
	});

	it('uses rank, not distance, so one outlier does not squash the rest', () => {
		const r = priceRanks([
			{ id: 1, price: 40 },
			{ id: 2, price: 41 },
			{ id: 3, price: 42 },
			{ id: 4, price: 150 }
		]);
		expect(r.get(2)).toBeCloseTo(1 / 3);
		expect(r.get(3)).toBeCloseTo(2 / 3);
	});

	it('gives tied prices the same rank', () => {
		const r = priceRanks([
			{ id: 1, price: 50 },
			{ id: 2, price: 50 },
			{ id: 3, price: 70 }
		]);
		expect(r.get(1)).toBe(r.get(2));
		expect(r.get(3)).toBe(1);
	});

	it('ranks AC and DC separately', () => {
		const r = priceRanks([
			{ id: 1, price: 30, mode: 'AC' },
			{ id: 2, price: 35, mode: 'AC' },
			{ id: 3, price: 60, mode: 'DC' },
			{ id: 4, price: 80, mode: 'DC' }
		]);
		expect([r.get(1), r.get(2), r.get(3), r.get(4)]).toEqual([0, 1, 0, 1]);
	});

	it('leaves out unknown prices and groups with nothing to compare', () => {
		const r = priceRanks([
			{ id: 1, price: null },
			{ id: 2, price: 50, mode: 'AC' },
			{ id: 3, price: 50, mode: 'AC' },
			{ id: 4, price: 70, mode: 'DC' }
		]);
		expect(r.size).toBe(0);
	});
});

describe('rankColors', () => {
	it('goes from green to red', () => {
		expect(rankColors(0).background).toBe('hsl(120 75% 84%)');
		expect(rankColors(1).background).toBe('hsl(0 75% 84%)');
	});
});
