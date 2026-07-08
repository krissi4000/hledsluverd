import { describe, expect, it } from 'vitest';
import { formatKm, haversineKm } from './geo';

describe('haversineKm', () => {
	it('measures Reykjavík–Akureyri at roughly 250 km', () => {
		const rvk = { lat: 64.1466, lng: -21.9426 };
		const aku = { lat: 65.6835, lng: -18.1002 };
		const d = haversineKm(rvk, aku);
		expect(d).toBeGreaterThan(240);
		expect(d).toBeLessThan(260);
		expect(haversineKm(aku, rvk)).toBeCloseTo(d, 6);
	});

	it('is zero for the same point', () => {
		expect(haversineKm({ lat: 64.1, lng: -21.9 }, { lat: 64.1, lng: -21.9 })).toBe(0);
	});
});

describe('formatKm', () => {
	it('shows one decimal under 10 km and whole km above', () => {
		expect(formatKm(1.234)).toBe('1,2 km');
		expect(formatKm(42.6)).toBe('43 km');
	});
});
