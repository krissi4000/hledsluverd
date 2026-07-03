import { describe, expect, it } from 'vitest';
import { formatIsk, formatDate, formatNumber } from './format';

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
