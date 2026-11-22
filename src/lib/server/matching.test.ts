import { describe, expect, it } from 'vitest';
import { compareSiteNames, deriveTariffKey, siteNameWords } from './matching';
import type { TariffKey } from '$lib/types';

const withTier = new Set<TariffKey>(['AC', 'DC', 'DC_150']);
const withoutTier = new Set<TariffKey>(['AC', 'DC']);

describe('deriveTariffKey', () => {
	it('maps Type2 to AC regardless of power', () => {
		expect(deriveTariffKey('Type2', 22, withTier)).toBe('AC');
	});
	it('keeps Type2 as AC even at tier-level power', () => {
		expect(deriveTariffKey('Type2', 150, withTier)).toBe('AC');
	});
	it('maps DC connectors to DC below 150 kW', () => {
		expect(deriveTariffKey('CCS2', 60, withTier)).toBe('DC');
		expect(deriveTariffKey('CHAdeMO', 50, withTier)).toBe('DC');
	});
	it('maps ≥150 kW to DC_150 when the network defines the tier', () => {
		expect(deriveTariffKey('CCS2', 150, withTier)).toBe('DC_150');
		expect(deriveTariffKey('CCS2', 250, withTier)).toBe('DC_150');
	});
	it('falls back to DC at ≥150 kW when the network has no tier', () => {
		expect(deriveTariffKey('CCS2', 250, withoutTier)).toBe('DC');
	});
});

describe('siteNameWords', () => {
	it('drops brand and charging words and keeps the place', () => {
		expect(siteNameWords('Ísorka - Olís Kirkjubæjarklaustur')).toEqual(['kirkjubæjarklaustur']);
		expect(siteNameWords('Staðarskáli (N1)')).toEqual(['staðarskáli']);
		expect(siteNameWords('Tesla Supercharger Hvolsvöllur')).toEqual(['hvolsvöllur']);
		expect(siteNameWords('Höfði - Hverfahleðsla')).toEqual(['höfði']);
	});
	it('keeps house numbers, drops one-letter words', () => {
		expect(siteNameWords('Heimar - Hlíðasmári 6')).toEqual(['heimar', 'hlíðasmári', '6']);
		expect(siteNameWords('Vík í Mýrdal (N1)')).toEqual(['vík', 'mýrdal']);
	});
});

describe('compareSiteNames', () => {
	it('same: identical identifying words, whatever the branding', () => {
		expect(
			compareSiteNames('Ísorka - Olís Kirkjubæjarklaustur', 'Ísorka - Olís Kirkjubæjarklaustur')
		).toBe('same');
		expect(compareSiteNames('Staðarskáli (N1)', 'N1 Staðarskáli')).toBe('same');
	});
	it('similar: one name inside the other, declension and typos tolerated', () => {
		expect(compareSiteNames('Vík (N1)', 'Vík í Mýrdal (N1)')).toBe('similar');
		expect(compareSiteNames('N1 Ísafirði', 'Ísafjörður (N1)')).toBe('similar');
		expect(compareSiteNames('Byko Akureyri', 'ON - Byko')).toBe('similar');
		expect(compareSiteNames('ON Krikjubæjarklaustri', 'Kirkjubæjarklaustur (N1)')).toBe('similar');
	});
	it('different: other streets, other numbers, other sides of the road', () => {
		expect(compareSiteNames('Seljavegur - Hverfahleðsla', 'Framnesvegur - Hverfahleðsla')).toBe(
			'different'
		);
		expect(compareSiteNames('Miklabraut Norður (Orkan)', 'Miklabraut Suður (Orkan)')).toBe(
			'different'
		);
		expect(compareSiteNames('Heimar - Hlíðasmári 6', 'Heimar - Hlíðasmári 1')).toBe('different');
		expect(compareSiteNames('Íþaka - Dalvegur 30', 'Íþaka - Dalvegur 30A')).toBe('different');
	});
	it('different when a name has no identifying words at all', () => {
		expect(compareSiteNames('N1', 'Vík (N1)')).toBe('different');
	});
});
