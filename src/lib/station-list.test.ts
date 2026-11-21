import { describe, expect, it } from 'vitest';
import {
	formatNear,
	matchesSearch,
	normalizeSearch,
	parseNear,
	parseSearch,
	SEARCH_MAX_LENGTH,
	sortStations
} from './station-list';

describe('normalizeSearch', () => {
	it('folds case, accents and the Icelandic letters', () => {
		expect(normalizeSearch('  Reykjavík ')).toBe('reykjavik');
		expect(normalizeSearch('Blönduósi')).toBe('blonduosi');
		expect(normalizeSearch('Þórshöfn')).toBe('thorshofn');
		expect(normalizeSearch('Hveragerði  Æsa')).toBe('hveragerdi aesa');
	});
});

describe('matchesSearch', () => {
	const fields = ['RVK-Borg Ráðhús', 'Tjarnargata 11, Reykjavík'];

	it('matches on name or address (town), accent-insensitively', () => {
		expect(matchesSearch('radhus', fields)).toBe(true);
		expect(matchesSearch('reykjavik', fields)).toBe(true);
		expect(matchesSearch('Akureyri', fields)).toBe(false);
	});

	it('needs every word, in any order', () => {
		expect(matchesSearch('reykjavík ráðhús', fields)).toBe(true);
		expect(matchesSearch('reykjavík ikea', fields)).toBe(false);
	});

	it('an empty query matches everything; a null address is fine', () => {
		expect(matchesSearch('   ', fields)).toBe(true);
		expect(matchesSearch('ikea', ['IKEA', null])).toBe(true);
	});
});

describe('parseSearch', () => {
	it('trims and caps the length', () => {
		expect(parseSearch(null)).toBe('');
		expect(parseSearch('  Vík  ')).toBe('Vík');
		expect(parseSearch('x'.repeat(500))).toHaveLength(SEARCH_MAX_LENGTH);
	});
});

describe('parseNear / formatNear', () => {
	it('parses "lat,lng" and re-rounds to 3 decimals', () => {
		expect(parseNear('64.1466,-21.9426')).toEqual({ lat: 64.147, lng: -21.943 });
		expect(parseNear('64.146,-21.942')).toEqual({ lat: 64.146, lng: -21.942 });
	});

	it('rejects garbage and out-of-range values', () => {
		for (const bad of [null, '', '64.1', '64,1,2', 'abc,def', '91,0', '0,181', '1e3,2', '64.1,']) {
			expect(parseNear(bad)).toBeNull();
		}
	});

	it('formats rounded so the browser never sends more precision', () => {
		expect(formatNear({ lat: 64.14663, lng: -21.94261 })).toBe('64.147,-21.943');
		expect(formatNear({ lat: 65, lng: -18.1 })).toBe('65.000,-18.100');
	});
});

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

	it('by distance: nearest first, unknown distance last, then cheapest', () => {
		const near = [
			{ name: 'far', price: 40, distanceKm: 12 },
			{ name: 'none', price: 30, distanceKm: null },
			{ name: 'close-dear', price: 60, distanceKm: 1.5 },
			{ name: 'close-cheap', price: 50, distanceKm: 1.5 }
		];
		expect(sortStations(near, 'distance').map((r) => r.name)).toEqual([
			'close-cheap',
			'close-dear',
			'far',
			'none'
		]);
	});

	it('lists stations that are not open yet after every open one, even unpriced ones', () => {
		const uc = [
			{ name: 'A', price: null, underConstruction: true },
			{ name: 'B', price: null, underConstruction: false },
			{ name: 'C', price: 30 }
		];
		expect(sortStations(uc, 'price').map((r) => r.name)).toEqual(['C', 'B', 'A']);
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
