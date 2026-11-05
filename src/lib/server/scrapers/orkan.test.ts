import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { matchOrkanStations, parseOrkanPrices } from './orkan';
import { e1StationName, parseE1Locations } from '../e1map';

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

describe('live price table (2026-11) against e1-sourced stations', () => {
	const rows = parseOrkanPrices(
		readFileSync(
			new URL('../../../../tests/fixtures/orkan-orkustodvar-2026-11.html', import.meta.url),
			'utf8'
		)
	);
	const e1 = JSON.parse(
		readFileSync(
			new URL('../../../../tests/fixtures/e1-publicmap-2026-11.json', import.meta.url),
			'utf8'
		)
	);
	const sts = parseE1Locations(e1, [145]).map((l) => ({
		name: e1StationName(l, 'Orkan'),
		address: l.address
	}));

	it('parses all 20 stations', () => {
		expect(rows).toHaveLength(20);
		expect(rows.find((r) => r.name === 'Hörgárbraut, Akureyri')?.priceIskPerKwh).toBe(58);
	});

	it('matches every row to exactly one station, each station once', () => {
		const hits = rows.map((r) => matchOrkanStations(r.name, sts).map((s) => s.name));
		for (const [i, h] of hits.entries()) expect(h, rows[i].name).toHaveLength(1);
		expect(new Set(hits.flat()).size).toBe(20);
		expect(matchOrkanStations('Miklabraut við Kringlu', sts)[0].name).toBe(
			'Miklabraut Suður (Orkan)'
		);
	});
});
