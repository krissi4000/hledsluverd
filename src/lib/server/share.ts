// Text for link previews: meta descriptions and the strings drawn on the og:images.
// Both read the same price views, so a description never says something the image
// doesn't. Honesty rules apply as on the site: an unknown price is said to be
// unknown, a stale one carries its verification date, and the "cheapest" claim uses
// cheapestDc, the rule behind the rate card badge.

import * as m from '$lib/paraglide/messages';
import type { Locale } from '$lib/paraglide/runtime';
import { cheapestDc, ownBrandPriceOnly } from '$lib/networks';
import { formatDate, formatIsk, formatNumber, isStale } from '$lib/format';
import { CONNECTOR_TYPES, type ConnectorType } from '$lib/types';
import type { RateCardEntry, StationDetail } from './db/queries';

export interface ShareContext {
	locale: Locale;
	now: Date;
	/** public host printed on the images, e.g. "hledsluverd.is" */
	domain: string;
}

/** "49 kr/kWh", or "frá 49 kr/kWh" when the network's stations differ in price. */
export function perKwh(price: number, from: boolean, locale: Locale): string {
	const p = formatIsk(price);
	return `${from ? m.price_from({ price: p }, { locale }) : p}/kWh`;
}

/** Same wording as the station page: "+ 0,5 kr/mín" or "+ 60 kr/mín eftir 60 mín". */
export function minuteFeeText(
	fee: number | null,
	afterMin: number | null,
	locale: Locale
): string | null {
	if (!fee) return null;
	return afterMin
		? m.minute_fee_after({ fee: formatNumber(fee), min: afterMin }, { locale })
		: m.minute_fee({ fee: formatNumber(fee) }, { locale });
}

/** "CCS2 ×4 · 50–150 kW", one entry per connector type in CONNECTOR_TYPES order. */
export function connectorSummary(
	connectors: { type: ConnectorType; powerKw: number; count: number }[]
): string[] {
	return CONNECTOR_TYPES.flatMap((type) => {
		const ofType = connectors.filter((c) => c.type === type);
		if (ofType.length === 0) return [];
		const count = ofType.reduce((n, c) => n + c.count, 0);
		const kws = ofType.map((c) => c.powerKw);
		const lo = Math.min(...kws);
		const hi = Math.max(...kws);
		const kw = lo === hi ? formatNumber(hi) : `${formatNumber(lo)}–${formatNumber(hi)}`;
		return [`${type} ×${count} · ${kw} kW`];
	});
}

export interface PriceView {
	mode: 'DC' | 'AC';
	/** "DC hraðhleðsla" */
	label: string;
	/** "49 kr/kWh"; null when the price is unknown */
	price: string | null;
	fee: string | null;
	/** "fyrir Tesla-bíla" on own-brand-only prices */
	ownBrand: string | null;
	/** "staðfest 5.11.2026" */
	verified: string | null;
	/** unverified for more than 30 days (isStale) */
	stale: boolean;
}

/**
 * One view per mode the station has connectors for, DC first. A mode without a
 * current price gets an unknown view rather than being left out.
 */
export function stationPriceViews(st: StationDetail, ctx: ShareContext): PriceView[] {
	const { locale } = ctx;
	return (['DC', 'AC'] as const)
		.filter((mode) =>
			st.connectors.some((c) => (mode === 'AC' ? c.type === 'Type2' : c.type !== 'Type2'))
		)
		.map((mode) => {
			const label =
				mode === 'DC' ? m.mode_label_dc({}, { locale }) : m.mode_label_ac({}, { locale });
			const p = st.prices.find((r) => r.mode === mode);
			if (!p) {
				return {
					mode,
					label,
					price: null,
					fee: null,
					ownBrand: null,
					verified: null,
					stale: false
				};
			}
			return {
				mode,
				label,
				price: perKwh(p.priceIskPerKwh, false, locale),
				fee: minuteFeeText(p.minuteFeeIsk, p.minuteFeeAfterMin, locale),
				ownBrand: ownBrandPriceOnly(st.network.slug) ? m.tesla_price_only({}, { locale }) : null,
				verified: m.verified_on({ date: formatDate(p.verifiedAt) }, { locale }),
				stale: isStale(p.verifiedAt, ctx.now)
			};
		});
}

/** "Ódýrasta hraðhleðslan í dag: Orkan, frá 49 kr/kWh – berðu saman …" */
export function homeDescription(cards: RateCardEntry[], ctx: ShareContext): string {
	const { locale } = ctx;
	const best = cheapestDc(cards);
	if (!best || best.dc === null) return m.seo_default_description({}, { locale });
	const price = perKwh(best.dc, best.dcFrom, locale);
	// "today" would be a confident claim about a price nobody has checked in a month
	if (best.dcVerifiedAt && isStale(best.dcVerifiedAt, ctx.now)) {
		return m.seo_home_description_stale(
			{ network: best.networkName, price, date: formatDate(best.dcVerifiedAt) },
			{ locale }
		);
	}
	return m.seo_home_description({ network: best.networkName, price }, { locale });
}

/** The network's name as a whole word in the station's name, so "ON" doesn't match "Krónan". */
export function namesNetwork(stationName: string, networkName: string): boolean {
	const escaped = networkName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'iu').test(stationName);
}

/** "Glæsibær (Orkan). DC hraðhleðsla: 49 kr/kWh + 64 kr/mín eftir 60 mín. Tengi: CCS2 ×2 · 150 kW" */
export function stationDescription(st: StationDetail, ctx: ShareContext): string {
	const { locale } = ctx;
	const prices = stationPriceViews(st, ctx).map((v) => {
		if (v.price === null) return `${v.label}: ${m.price_unknown({}, { locale })}`;
		const notes = [v.ownBrand, v.stale ? v.verified : null].filter(Boolean);
		const amount = [v.price, v.fee].filter(Boolean).join(' ');
		return `${v.label}: ${amount}${notes.length ? ` (${notes.join(', ')})` : ''}`;
	});
	const connectors = connectorSummary(st.connectors);
	const parts = {
		name: st.name,
		network: st.network.name,
		prices: prices.length ? prices.join(' · ') : m.price_unknown({}, { locale }),
		connectors: connectors.length
			? m.seo_connectors({ list: connectors.join(', ') }, { locale })
			: ''
	};
	// many station names already carry the network: "Suðurfell 4 (Orkan)", "ON Hellisheiði"
	const text = (
		namesNetwork(st.name, st.network.name)
			? m.seo_station_description_named(parts, { locale })
			: m.seo_station_description(parts, { locale })
	).trim();
	return st.hostPriced
		? `${text} ${m.station_host_priced({ network: st.network.name }, { locale })}`
		: text;
}
