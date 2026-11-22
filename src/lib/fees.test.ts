import { describe, expect, it } from 'vitest';
import { feeStartText, minuteFeeText } from './fees';

describe('minuteFeeText', () => {
	// read with plain spaces; the line-breaking rule has its own test below
	const plain = (s: string | null) => s?.replace(/\u00a0/g, ' ');

	it('says when a fee starts, in whole hours where it can', () => {
		expect(plain(minuteFeeText(0.5, null, 'is'))).toBe('+ 0,5 kr/mín');
		expect(plain(minuteFeeText(64, 60, 'is'))).toBe('+ 64 kr/mín eftir 1 klst');
		expect(plain(minuteFeeText(40, 45, 'is'))).toBe('+ 40 kr/mín eftir 45 mín');
		expect(plain(minuteFeeText(64, 60, 'en'))).toBe('+ 64 kr/min after 1 h');
	});

	it('only breaks a line between the fee and when it starts', () => {
		expect(minuteFeeText(0.5, null, 'is')).toBe('+\u00a00,5\u00a0kr/mín');
		expect(minuteFeeText(64, 60, 'is')).toBe('+\u00a064\u00a0kr/mín eftir\u00a01\u00a0klst');
	});

	it('is null without a fee', () => {
		expect(minuteFeeText(null, 60, 'is')).toBeNull();
		expect(minuteFeeText(0, null, 'is')).toBeNull();
	});
});

describe('feeStartText', () => {
	it('keeps minutes that are not whole hours', () => {
		expect(feeStartText(120, 'is')).toBe('2 klst');
		expect(feeStartText(90, 'is')).toBe('90 mín');
		expect(feeStartText(30, 'en')).toBe('30 min');
	});
});
