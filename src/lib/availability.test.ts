import { describe, expect, it } from 'vitest';
import { unknownStalls } from './availability';

describe('unknownStalls', () => {
	it('is the stalls TomTom does not report', () => {
		expect(unknownStalls(20, 6)).toBe(14);
	});
	it('is 0 when TomTom covers the site, or reports more', () => {
		expect(unknownStalls(8, 8)).toBe(0);
		expect(unknownStalls(3, 9)).toBe(0);
	});
	it('is 0 without a per-stall count or without live data', () => {
		expect(unknownStalls(null, 6)).toBe(0);
		expect(unknownStalls(20, null)).toBe(0);
	});
});
