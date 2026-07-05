import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseOrkanPrices } from './orkan';

const html = readFileSync(
	new URL('../../../../tests/fixtures/orkan-orkustodvar.html', import.meta.url),
	'utf8'
);

describe('parseOrkanPrices', () => {
	it('pairs each station card with its Rafmagn column by heading text', () => {
		expect(parseOrkanPrices(html)).toEqual([{ name: 'Baula', priceIskPerKwh: 49 }]);
	});

	it('skips the header card and stations without a Rafmagn price (-)', () => {
		const names = parseOrkanPrices(html).map((r) => r.name);
		expect(names).not.toContain('Orkustöð');
		expect(names).not.toContain('Húsavík');
	});

	it('returns an empty list for foreign markup (scrape() turns that into a failure)', () => {
		expect(parseOrkanPrices('<div class="other"></div>')).toEqual([]);
	});
});
