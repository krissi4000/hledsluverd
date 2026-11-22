import { describe, expect, it } from 'vitest';
import { DEFAULT_SITE_ORIGIN, siteOrigin } from './site';

describe('siteOrigin', () => {
	it('uses ORIGIN, normalised to an origin without a trailing slash', () => {
		expect(siteOrigin('https://hledsluverd.is/')).toBe('https://hledsluverd.is');
		expect(siteOrigin(' http://localhost:3000 ')).toBe('http://localhost:3000');
	});

	it('falls back when ORIGIN is unset, empty or not an http(s) URL', () => {
		for (const bad of [undefined, '', 'hledsluverd.is', 'ftp://hledsluverd.is']) {
			expect(siteOrigin(bad)).toBe(DEFAULT_SITE_ORIGIN);
		}
	});
});
