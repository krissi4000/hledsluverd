import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { matchOrkanStations, parseOrkanPrices } from './orkan';

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

describe('matchOrkanStations', () => {
	const sts = [
		{ name: 'Vesturlandsvegur (Orkan)', address: 'Vesturlandsvegur 1' },
		{ name: 'Hveragerði (Orkan)', address: 'Austurmörk 22' },
		{ name: 'Þorlákshöfn (Orkan)', address: null }
	];

	it('matches a bare place name by containment in the station name', () => {
		expect(matchOrkanStations('Vesturlandsvegur', sts).map((s) => s.name)).toEqual([
			'Vesturlandsvegur (Orkan)'
		]);
	});

	it('matches a compound "street, town" row via its street token in the address', () => {
		expect(matchOrkanStations('Austurmörk, Hveragerði', sts).map((s) => s.name)).toEqual([
			'Hveragerði (Orkan)'
		]);
	});

	it('falls back to the town token when the street is unknown', () => {
		expect(matchOrkanStations('Óþekkt gata, Hveragerði', sts).map((s) => s.name)).toEqual([
			'Hveragerði (Orkan)'
		]);
	});

	it('returns empty for a row that matches nothing', () => {
		expect(matchOrkanStations('Baula', sts)).toEqual([]);
	});
});
