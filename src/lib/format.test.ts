import { describe, expect, it } from 'vitest';
import { formatIsk, formatDate, formatNumber, isStale, ageParts } from './format';

describe('formatNumber', () => {
	it('formats fractional values with an Icelandic comma', () => {
		expect(formatNumber(0.5)).toBe('0,5');
	});
	it('formats whole numbers without decimals', () => {
		expect(formatNumber(2)).toBe('2');
	});
});

describe('formatIsk', () => {
	it('shows whole ISK without decimals', () => {
		expect(formatIsk(70)).toBe('70 kr');
	});
	it('shows one decimal with Icelandic comma when fractional', () => {
		expect(formatIsk(49.9)).toBe('49,9 kr');
	});
});

describe('formatDate', () => {
	it('formats as D.M.YYYY', () => {
		expect(formatDate(new Date('2026-07-02T12:00:00Z'))).toBe('2.7.2026');
	});
});

describe('isStale', () => {
	it('flags prices verified more than 30 days ago', () => {
		const now = new Date('2026-07-05T12:00:00Z');
		expect(isStale(new Date('2026-06-01T12:00:00Z'), now)).toBe(true);
		expect(isStale(new Date('2026-06-20T12:00:00Z'), now)).toBe(false);
	});
});

describe('ageParts', () => {
	it('reports minutes, then hours, then days', () => {
		const now = new Date('2026-07-06T12:00:00Z');
		expect(ageParts(new Date('2026-07-06T11:58:00Z'), now)).toEqual({ n: 2, unit: 'min' });
		expect(ageParts(new Date('2026-07-06T09:00:00Z'), now)).toEqual({ n: 3, unit: 'h' });
		expect(ageParts(new Date('2026-07-04T12:00:00Z'), now)).toEqual({ n: 2, unit: 'd' });
	});

	it('clamps future timestamps to zero minutes', () => {
		const now = new Date('2026-07-06T12:00:00Z');
		expect(ageParts(new Date('2026-07-06T12:00:30Z'), now)).toEqual({ n: 0, unit: 'min' });
	});
});
