import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseVirtaStation, type VirtaStation } from './isorka';

const load = (name: string): VirtaStation =>
	JSON.parse(readFileSync(new URL(`../../../../tests/fixtures/${name}`, import.meta.url), 'utf8'));

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
