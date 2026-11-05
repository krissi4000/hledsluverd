import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	matchVirtaStation,
	parseVirtaStation,
	type VirtaListStation,
	type VirtaStation
} from './isorka';

const load = (name: string): VirtaStation =>
	JSON.parse(readFileSync(new URL(`../../../../tests/fixtures/${name}`, import.meta.url), 'utf8'));

describe('matchVirtaStation', () => {
	// Virta map list entries within 500 m of our Ísorka stations, 2026-11-05
	const list: VirtaListStation[] = JSON.parse(
		readFileSync(
			new URL('../../../../tests/fixtures/virta-list-2026-11.json', import.meta.url),
			'utf8'
		)
	);
	const match = (name: string, lat: number, lng: number) => {
		const m = matchVirtaStation({ name, lat, lng }, list);
		return m.kind === 'match' ? m.station.id : null;
	};

	// our OCM-seeded Ísorka stations on prod, 2026-11-05, and the Virta post each one is
	it.each([
		['Ísorka - Íþróttamiðstöð Fjallabyggð Ólafsfirði', 66.07045, -18.64969, 168419],
		['Ísorka Reykholti', 64.17475, -20.4451, 45905],
		['Ísorka - Olís Fitjar', 63.97971, -22.54755, 225285],
		['Ísorka Blönduósi', 65.66003, -20.28281, 213142],
		['Ísorka - Olís Akranes', 64.32472, -22.06746, 197285],
		['Ísorka - Olís Siglufirði', 66.14954, -18.90335, 165780],
		['Ísorka - Olís Höfn', 64.25556, -15.20881, 165752],
		['Ísorka - Olís Hella', 63.83496, -20.40165, 165728],
		['Ísorka Fmos', 64.16548, -21.70298, 4598],
		['Ísorka Sundlaugin Stokkseyri', 63.83787, -21.06358, 7665],
		['Ísorka - Bláskógarbyggð', 64.21432, -20.73126, 152802],
		['Ísorka Ráðhús Árborgar', 63.9369, -21.002, 260457],
		['Ísorka Sundhöll Selfossi', 63.93604, -20.99755, 4892],
		['Ísorka - Olís Borgarnesi', 64.54474, -21.9074, 233908],
		['Ísorka - Olís Vík í Mýrdal', 63.41755, -19.00366, 239345],
		['Ísorka Stykkishólmur', 65.07335, -22.7296, 77506],
		['Ísorka - Olís Fjallkonuvegur', 64.13783, -21.80727, 235122],
		['Ísorka - Olís Reyðarfjörður', 65.03407, -14.23123, 165785],
		['Ísorka - Olís Húsavík (Í uppsetningu)', 66.03926, -17.34316, 222714],
		['Ísorka Eyrarbakka', 63.86478, -21.15754, 7619],
		// nearest post (2 m) is "Olís Álfheimar - Gamla stöð tekinn niður" at 0 kr
		['Ísorka - Olís Álfheimar', 64.13223, -21.86658, 163966],
		// OCM pin is 225 m off; same name on both sides
		['Ísorka - Olís Kirkjubæjarklaustur', 63.79373, -18.04256, 181839]
	])('%s → virta %s', (name, lat, lng, id) => {
		expect(match(name, lat, lng)).toBe(id);
	});

	it.each([
		// nearest Virta post is "Orkustofnun Grensásvegi", 146 m away, free (0 kr)
		['Ísorka Verslun', 64.13055, -21.87315],
		// only roaming (Hubject) posts nearby — prices zeroed
		['Ísorka Lágafellslaug', 64.16464, -21.72536],
		['Ísorka Íþróttamiðstöð að Varmá', 64.16987, -21.6898],
		['Ísorka - Ólafsvík', 64.89528, -23.70851],
		// "Ísorka - Fjörður" is 360 m away but shares no name word — a human decides
		['Isorka Hafnarfirdi', 64.06497, -21.95617]
	])('%s → unmatched', (name, lat, lng) => {
		expect(match(name, lat, lng)).toBeNull();
	});

	it('lists nearby posts for an unmatched station', () => {
		const m = matchVirtaStation(
			{ name: 'Isorka Hafnarfirdi', lat: 64.06497, lng: -21.95617 },
			list
		);
		expect(m.kind === 'unmatched' && m.nearby.map((n) => n.station.id)).toContain(54975);
	});
});

describe('parseVirtaStation', () => {
	it('reads the account tariff of a DC station: kWh price, minute fee, free period', () => {
		const { readings, warnings } = parseVirtaStation(load('virta-station-dc.json'));
		expect(warnings).toEqual([]);
		expect(readings).toEqual([
			{ tariffKey: 'DC', priceIskPerKwh: 73, minuteFeeIsk: 60, minuteFeeAfterMin: 60 }
		]);
	});

	it('reads an AC post with a zero minute fee as fee-less', () => {
		const { readings } = parseVirtaStation(load('virta-station-ac.json'));
		expect(readings).toEqual([
			{ tariffKey: 'AC', priceIskPerKwh: 24, minuteFeeIsk: null, minuteFeeAfterMin: null }
		]);
	});

	it('refuses to pick a price when evses of the same mode disagree', () => {
		const { readings, warnings } = parseVirtaStation(load('virta-station-conflict.json'));
		expect(readings).toEqual([]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatch(/disagree/);
	});

	it('warns instead of guessing when price_per_kwh is missing', () => {
		const st = load('virta-station-dc.json');
		st.evses[0].pricing = st.evses[0].pricing?.filter((p) => p.name !== 'price_per_kwh');
		const { readings, warnings } = parseVirtaStation(st);
		expect(readings).toEqual([]);
		expect(warnings[0]).toMatch(/price_per_kwh/);
	});

	it('skips a station mode with implausible kWh price (0) and warns', () => {
		const st = load('virta-station-dc.json');
		// set price_per_kwh to 0 cents → 0 ISK (below plausible floor)
		const kwh = st.evses[0].pricing?.find((p) => p.name === 'price_per_kwh');
		if (kwh) kwh.priceCents = 0;
		const { readings, warnings } = parseVirtaStation(st);
		expect(readings).toEqual([]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatch(/implausible/);
	});

	it('plausible station still parses unchanged after implausible-check is added', () => {
		const { readings, warnings } = parseVirtaStation(load('virta-station-dc.json'));
		expect(warnings).toEqual([]);
		expect(readings).toEqual([
			{ tariffKey: 'DC', priceIskPerKwh: 73, minuteFeeIsk: 60, minuteFeeAfterMin: 60 }
		]);
	});
});
