import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { networkColor, networkInitials, networkLogo } from './networks';

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
		expect(networkColor('orkan')).toBe('#eb008c');
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
