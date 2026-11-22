import { describe, expect, it } from 'vitest';
import { STALE, card, ctx, price, station } from '../../../tests/helpers/share';
import {
	connectorSummary,
	homeDescription,
	namesNetwork,
	stationDescription,
	stationPriceViews
} from './share';

describe('homeDescription', () => {
	it('names the cheapest network, skipping own-brand-only prices like the rate card badge', () => {
		const cards = [card('tesla', 'Tesla', 27), card('orkan', 'Orkan', 49), card('on', 'ON', 62)];
		expect(homeDescription(cards, ctx())).toBe(
			'Ódýrasta hraðhleðslan í dag: Orkan, 49 kr/kWh – berðu saman verð allra hleðslufyrirtækja á Íslandi.'
		);
	});

	it('says "frá" when the network prices its stations differently', () => {
		const cards = [card('orkan', 'Orkan', 49, { dcFrom: true })];
		expect(homeDescription(cards, ctx())).toContain('Orkan, frá 49 kr/kWh');
	});

	it('drops "today" and gives the date when the cheapest price is stale', () => {
		const cards = [card('e1', 'e1', 45, { dcVerifiedAt: STALE }), card('on', 'ON', 62)];
		const d = homeDescription(cards, ctx());
		expect(d).not.toContain('í dag');
		expect(d).toContain('e1, 45 kr/kWh (staðfest 3.9.2026)');
	});

	it('falls back to the generic description when no network can claim cheapest', () => {
		const d = homeDescription([card('tesla', 'Tesla', 27), card('e1', 'e1', null)], ctx());
		expect(d).toMatch(/^Berðu saman verð/);
	});

	it('follows the locale', () => {
		const d = homeDescription([card('on', 'ON', 62)], ctx({ locale: 'en' }));
		expect(d).toBe(
			'Cheapest fast charging today: ON, 62 kr/kWh — compare prices across every charging network in Iceland.'
		);
	});
});

describe('namesNetwork', () => {
	it('finds the network as a whole word, in any case', () => {
		expect(namesNetwork('Suðurfell 4 (Orkan)', 'Orkan')).toBe(true);
		expect(namesNetwork('ON Hellisheiði', 'ON')).toBe(true);
		expect(namesNetwork('Ísorka - Ólafsvík', 'Ísorka')).toBe(true);
		expect(namesNetwork('Supercharger Blönduós', 'Tesla')).toBe(false);
	});

	it('does not match inside another word', () => {
		expect(namesNetwork('Krónan Lindum', 'ON')).toBe(false);
		expect(namesNetwork('Orkanesti', 'Orkan')).toBe(false);
	});
});

describe('connectorSummary', () => {
	it('groups by type in CONNECTOR_TYPES order, summing counts and showing a power range', () => {
		expect(
			connectorSummary([
				{ type: 'Type2', powerKw: 22, count: 2 },
				{ type: 'CCS2', powerKw: 50, count: 1 },
				{ type: 'CCS2', powerKw: 150, count: 3 },
				{ type: 'CHAdeMO', powerKw: 50, count: 1 }
			])
		).toEqual(['CCS2 ×4 · 50–150 kW', 'CHAdeMO ×1 · 50 kW', 'Type2 ×2 · 22 kW']);
	});

	it('writes decimal power the Icelandic way', () => {
		expect(connectorSummary([{ type: 'Type2', powerKw: 7.4, count: 1 }])).toEqual([
			'Type2 ×1 · 7,4 kW'
		]);
	});
});

describe('stationPriceViews', () => {
	it('gives every mode the station has connectors for a view, unknown when unpriced', () => {
		const views = stationPriceViews(station({ prices: [price('AC', 30)] }), ctx());
		expect(views.map((v) => [v.mode, v.price])).toEqual([
			['DC', null],
			['AC', '30 kr/kWh']
		]);
	});

	it('flags a price unverified for more than 30 days', () => {
		const [dc] = stationPriceViews(
			station({ prices: [price('DC', 49, { verifiedAt: STALE })] }),
			ctx()
		);
		expect(dc.stale).toBe(true);
		expect(dc.verified).toBe('staðfest 3.9.2026');
	});

	it('labels own-brand-only prices', () => {
		const st = station({ network: { slug: 'tesla', name: 'Tesla', websiteUrl: null } });
		expect(stationPriceViews(st, ctx())[0].ownBrand).toBe('fyrir Tesla-bíla');
	});
});

describe('stationDescription', () => {
	it('has name, network, current prices with fees, and connectors', () => {
		const st = station({
			prices: [price('DC', 49, { minuteFeeIsk: 64, minuteFeeAfterMin: 60 }), price('AC', 30)]
		});
		// plain spaces: the no-break spaces in the fee are typography (see fees.test.ts)
		expect(stationDescription(st, ctx()).replace(/\s/g, ' ')).toBe(
			'Glæsibær (Orkan). DC-hraðhleðsla: 49 kr/kWh + 64 kr/mín eftir 1 klst · AC-hleðsla: 30 kr/kWh. Tengi: CCS2 ×2 · 150 kW, Type2 ×2 · 22 kW.'
		);
	});

	it('does not repeat a network the station name already carries', () => {
		expect(stationDescription(station({ name: 'Suðurfell 4 (Orkan)' }), ctx())).toMatch(
			/^Suðurfell 4 \(Orkan\)\. DC-hraðhleðsla/
		);
	});

	it('says a price is unknown instead of leaving it out', () => {
		expect(stationDescription(station({ prices: [] }), ctx())).toContain(
			'DC-hraðhleðsla: verð óþekkt · AC-hleðsla: verð óþekkt'
		);
	});

	it('dates a stale price and notes own-brand pricing', () => {
		const st = station({
			network: { slug: 'tesla', name: 'Tesla', websiteUrl: null },
			connectors: [{ type: 'CCS2', powerKw: 250, count: 8 }],
			prices: [price('DC', 57, { verifiedAt: STALE })]
		});
		expect(stationDescription(st, ctx())).toContain(
			'DC-hraðhleðsla: 57 kr/kWh (fyrir Tesla-bíla, staðfest 3.9.2026)'
		);
	});

	it('says when the site owner sets the price', () => {
		expect(stationDescription(station({ hostPriced: true }), ctx())).toMatch(
			/22 kW\. Eigandi staðarins ákveður verðið hér, ekki Orkan\.$/
		);
	});
});
