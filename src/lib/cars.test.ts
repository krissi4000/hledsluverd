import { describe, expect, it } from 'vitest';
import { carInitials, carLogo, carMakeKey } from './cars';

describe('carMakeKey', () => {
	it('slugifies make names, dropping diacritics', () => {
		expect(carMakeKey('Škoda')).toBe('skoda');
		expect(carMakeKey('Citroën')).toBe('citroen');
		expect(carMakeKey('Mercedes-Benz')).toBe('mercedes-benz');
		expect(carMakeKey('MG Motor')).toBe('mg-motor');
		expect(carMakeKey('Rolls-Royce')).toBe('rolls-royce');
	});
});

describe('carLogo', () => {
	it('finds a bundled logo and returns null for unknown makes', () => {
		// small SVGs are inlined as data: URIs, larger ones become asset URLs
		expect(carLogo('Tesla')).toMatch(/Tesla|tesla/);
		expect(carLogo('Škoda')).toMatch(/ŠKODA|skoda/);
		expect(carLogo('No Such Make')).toBeNull();
	});
});

describe('carInitials', () => {
	it('uses the first letters of the first two words, or two letters of one', () => {
		expect(carInitials('Mercedes-Benz')).toBe('MB');
		expect(carInitials('BYD')).toBe('BY');
		expect(carInitials('Zeekr')).toBe('ZE');
	});
});
