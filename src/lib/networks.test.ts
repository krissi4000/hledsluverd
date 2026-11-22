import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cheapestDc, networkColor, networkInitials, networkLogo } from './networks';

const seeded: { slug: string }[] = JSON.parse(
	readFileSync(new URL('../../seeds/networks.json', import.meta.url), 'utf8')
);

describe('networkLogo', () => {
	it('has a logo for every seeded network', () => {
		for (const n of seeded) expect(networkLogo(n.slug), n.slug).toBeTruthy();
	});

	it('returns null for an unknown network', () => {
		expect(networkLogo('nope')).toBeNull();
	});
});

describe('networkColor', () => {
	it('uses the brand colour when known', () => {
		expect(networkColor('orkan')).toBe('#f4058e');
	});

	it('cycles a fallback palette for unknown networks', () => {
		expect(networkColor('x', 0)).not.toBe(networkColor('x', 1));
	});
});

describe('networkInitials', () => {
	it('takes the first two letters of a single word', () => {
		expect(networkInitials('Ísorka')).toBe('ÍS');
	});

	it('takes the first letter of the first two words', () => {
		expect(networkInitials('Orka náttúrunnar')).toBe('ON');
	});

	it('never returns an empty string', () => {
		expect(networkInitials('  ')).toBe('?');
	});
});

describe('cheapestDc', () => {
	const card = (networkSlug: string, dc: number | null) => ({ networkSlug, dc });

	it('skips own-brand-only prices, even when they are lowest', () => {
		const cards = [card('tesla', 27), card('orkan', 49), card('on', 62)];
		expect(cheapestDc(cards)?.networkSlug).toBe('orkan');
	});

	it('skips networks without a DC price', () => {
		expect(cheapestDc([card('e1', null), card('on', 62)])?.networkSlug).toBe('on');
	});

	it('does not depend on the input order', () => {
		expect(cheapestDc([card('on', 62), card('orkan', 49)])?.networkSlug).toBe('orkan');
	});

	it('keeps the earlier entry on a tie, matching the rate card order', () => {
		expect(cheapestDc([card('on', 49), card('orkan', 49)])?.networkSlug).toBe('on');
	});

	it('returns null when no network qualifies', () => {
		expect(cheapestDc([card('tesla', 27), card('e1', null)])).toBeNull();
		expect(cheapestDc([])).toBeNull();
	});
});
