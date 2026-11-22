import { describe, expect, it } from 'vitest';
import {
	formatIsk,
	formatIskPerKwh,
	formatDate,
	formatEstimateIsk,
	formatNumber,
	formatTime,
	isStale,
	ageParts,
	noBreak,
	showRelativeAge
} from './format';

describe('noBreak', () => {
	it('makes every space non-breaking', () => {
		expect(noBreak('48 kr/kWh')).toBe('48\u00a0kr/kWh');
		expect(noBreak('Hæg hleðsla')).toBe('Hæg\u00a0hleðsla');
		expect(noBreak('49')).toBe('49');
	});
});

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

describe('formatEstimateIsk', () => {
	it('rounds to 10 kr and groups thousands with a dot', () => {
		expect(formatEstimateIsk(2484.4)).toBe('2.480 kr');
		expect(formatEstimateIsk(2485)).toBe('2.490 kr');
		expect(formatEstimateIsk(12345)).toBe('12.350 kr');
		expect(formatEstimateIsk(994)).toBe('990 kr');
	});
});

describe('formatIskPerKwh', () => {
	it('carries the unit', () => {
		expect(formatIskPerKwh(49)).toBe('49 kr/kWh');
		expect(formatIskPerKwh(62.5)).toBe('62,5 kr/kWh');
	});
});

describe('showRelativeAge', () => {
	const now = new Date('2026-11-09T12:00:00Z');
	it('is relative for a few days, then a date', () => {
		expect(showRelativeAge(new Date('2026-11-09T11:00:00Z'), now)).toBe(true);
		expect(showRelativeAge(new Date('2026-11-06T13:00:00Z'), now)).toBe(true);
		expect(showRelativeAge(new Date('2026-11-06T11:00:00Z'), now)).toBe(false);
	});
});

describe('formatTime', () => {
	it('is Icelandic (UTC) time, zero-padded', () => {
		expect(formatTime(new Date('2026-11-07T09:05:00Z'))).toBe('09:05');
		expect(formatTime(new Date('2026-07-01T23:59:59Z'))).toBe('23:59');
	});
});
