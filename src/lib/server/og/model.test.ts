import { describe, expect, it } from 'vitest';
import { FRESH, NOW, STALE, card, ctx, price, station } from '../../../../tests/helpers/share';
import { homeOgImage, homeOgModel, ogHash, stationOgImage, stationOgModel } from './model';

const cards = [
	card('tesla', 'Tesla', 27, { dcFrom: true }),
	card('orkan', 'Orkan', 49, { dcFrom: true }),
	card('on', 'ON', 62),
	card('isorka', 'Ísorka', 63, { dcFrom: true }),
	card('n1', 'N1', 70),
	card('e1', 'e1', 75),
	card('ac-only', 'AC Only', null)
];

describe('homeOgModel', () => {
	const mo = homeOgModel(cards, ctx());

	it('lists up to five networks with a DC price, in rate card order', () => {
		expect(mo.rows.map((r) => r.network.name)).toEqual(['Tesla', 'Orkan', 'ON', 'Ísorka', 'N1']);
		expect(mo.rows[1].price).toBe('frá 49 kr/kWh');
	});

	it('puts the cheapest badge where the rate card does, never on own-brand prices', () => {
		expect(mo.rows.filter((r) => r.cheapest).map((r) => r.network.name)).toEqual(['Orkan']);
		expect(mo.rows[0].ownBrand).toBe('fyrir Tesla-bíla');
	});

	it('dates the picture', () => {
		expect(mo.date).toBe('Verð 7.11.2026');
	});

	it('flags a stale price with its verification date', () => {
		const m2 = homeOgModel([card('on', 'ON', 62, { dcVerifiedAt: STALE })], ctx());
		expect(m2.rows[0].stale).toBe('staðfest 3.9.2026 · óstaðfest í meira en 30 daga');
	});

	it('says so when no network has a DC price', () => {
		const m2 = homeOgModel([card('ac-only', 'AC Only', null)], ctx());
		expect(m2.rows).toEqual([]);
		expect(m2.empty).toBe('Ekkert verð skráð enn');
	});
});

describe('ogHash', () => {
	const hash = (c = cards, x = ctx()) => ogHash(homeOgModel(c, x));

	it('is stable for the same data', () => {
		expect(hash()).toBe(hash());
		expect(hash()).toMatch(/^[0-9a-f]{12}$/);
	});

	it('changes when a price changes', () => {
		const changed = cards.map((c) => (c.networkSlug === 'on' ? { ...c, dc: 61 } : c));
		expect(hash(changed)).not.toBe(hash());
	});

	it('changes when a price turns stale, and on a new day', () => {
		const stale = cards.map((c) => (c.networkSlug === 'on' ? { ...c, dcVerifiedAt: STALE } : c));
		expect(hash(stale)).not.toBe(hash());
		expect(hash(cards, ctx({ now: new Date('2026-11-08T12:00:00Z') }))).not.toBe(hash());
	});

	it('ignores an hourly re-verification that changes nothing drawn', () => {
		const rechecked = cards.map((c) => ({ ...c, dcVerifiedAt: c.dcVerifiedAt && NOW }));
		expect(hash(rechecked)).toBe(hash());
	});

	it('differs per locale', () => {
		expect(hash(cards, ctx({ locale: 'en' }))).not.toBe(hash());
	});
});

describe('og:image refs', () => {
	it('versions the home image with the model hash', () => {
		const img = homeOgImage(cards, ctx());
		expect(img.path).toBe(`/og/home.png?v=${ogHash(homeOgModel(cards, ctx()))}`);
		expect(img.alt).toContain('Tesla frá 27 kr/kWh (fyrir Tesla-bíla), Orkan frá 49 kr/kWh');
	});

	it('pins the locale in the URL, since crawlers send no cookie', () => {
		expect(homeOgImage(cards, ctx({ locale: 'en' })).path).toMatch(
			/^\/og\/home\.png\?v=\w+&lang=en$/
		);
	});

	it('versions station images and changes ?v= when the price changes', () => {
		const a = stationOgImage(station(), ctx());
		const b = stationOgImage(station({ prices: [price('DC', 50), price('AC', 30)] }), ctx());
		expect(a.path).toMatch(/^\/og\/stod\/glaesibaer\.png\?v=\w{12}$/);
		expect(a.path).not.toBe(b.path);
	});
});

describe('stationOgModel', () => {
	it('carries unknown prices as unknown and the verification date of known ones', () => {
		const mo = stationOgModel(station({ prices: [price('AC', 30, { verifiedAt: FRESH })] }), ctx());
		expect(mo.prices.map((p) => [p.mode, p.price, p.verified])).toEqual([
			['DC', null, null],
			['AC', '30 kr/kWh', 'staðfest 5.11.2026']
		]);
		expect(mo.connectors).toEqual(['CCS2 ×2 · 150 kW', 'Type2 ×2 · 22 kW']);
		expect(mo.network.logo).toMatch(/^data:image\/svg\+xml;base64,/);
	});

	it('falls back to a lettered badge for a network without a logo', () => {
		const mo = stationOgModel(
			station({ network: { slug: 'nyr', name: 'Nýtt Fyrirtæki', websiteUrl: null } }),
			ctx()
		);
		expect(mo.network.logo).toBeNull();
		expect(mo.network.initials).toBe('NF');
	});
});
