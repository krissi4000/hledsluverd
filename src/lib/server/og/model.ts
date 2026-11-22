// What each og:image draws, as plain data. The model holds every string and colour
// the template prints, so its hash identifies the image: it keys the render cache
// and is the ?v= on og:image, which changes whenever a price, a verification date
// or the day's date changes. Facebook caches images per URL, so a new ?v= is what
// makes it fetch the new one.

import { createHash } from 'node:crypto';
import * as m from '$lib/paraglide/messages';
import type { Locale } from '$lib/paraglide/runtime';
import { cheapestDc, networkColor, networkInitials, ownBrandPriceOnly } from '$lib/networks';
import { formatDate, isStale } from '$lib/format';
import type { RateCardEntry, StationDetail } from '../db/queries';
import {
	connectorSummary,
	perKwh,
	stationDescription,
	stationPriceViews,
	type PriceView,
	type ShareContext
} from '../share';
import { logoDataUri } from './logos';

/** Bump when templates.ts changes, so old ?v= URLs stop matching the new drawing. */
export const OG_TEMPLATE_VERSION = 1;

/** Networks shown on the homepage image. */
export const HOME_OG_ROWS = 5;

export interface OgNetwork {
	name: string;
	color: string;
	initials: string;
	/** data: URI, or null for the lettered badge */
	logo: string | null;
}

export interface HomeOgRow {
	network: OgNetwork;
	/** "frá 49 kr/kWh" */
	price: string;
	cheapest: boolean;
	/** "fyrir Tesla-bíla" */
	ownBrand: string | null;
	/** "staðfest 3.9.2026 · óstaðfest í meira en 30 daga" when stale */
	stale: string | null;
}

export interface HomeOgModel {
	kind: 'home';
	site: string;
	domain: string;
	heading: string;
	/** "Verð 7.11.2026" */
	date: string;
	cheapestLabel: string;
	rows: HomeOgRow[];
	/** shown instead of rows when no network has a DC price */
	empty: string | null;
}

export interface StationOgModel {
	kind: 'station';
	site: string;
	domain: string;
	name: string;
	address: string | null;
	network: OgNetwork;
	prices: PriceView[];
	/** label under "—" for a mode with no known price */
	priceUnknown: string;
	/** appended to the verification date of a stale price */
	staleNote: string;
	hostPriced: string | null;
	connectorsLabel: string;
	connectors: string[];
}

export type OgModel = HomeOgModel | StationOgModel;

function ogNetwork(slug: string, name: string): OgNetwork {
	return {
		name,
		color: networkColor(slug),
		initials: networkInitials(name),
		logo: logoDataUri(slug)
	};
}

/** Top networks by DC price, in rate card order, badge on cheapestDc. */
export function homeOgModel(cards: RateCardEntry[], ctx: ShareContext): HomeOgModel {
	const { locale } = ctx;
	const best = cheapestDc(cards);
	const rows = cards
		.filter((c) => c.dc !== null)
		.slice(0, HOME_OG_ROWS)
		.map((c): HomeOgRow => ({
			network: ogNetwork(c.networkSlug, c.networkName),
			price: perKwh(c.dc!, c.dcFrom, locale),
			cheapest: c === best,
			ownBrand: ownBrandPriceOnly(c.networkSlug) ? m.tesla_price_only({}, { locale }) : null,
			stale:
				c.dcVerifiedAt && isStale(c.dcVerifiedAt, ctx.now)
					? `${m.verified_on({ date: formatDate(c.dcVerifiedAt) }, { locale })} · ${m.og_stale({}, { locale })}`
					: null
		}));
	return {
		kind: 'home',
		site: m.site_title({}, { locale }),
		domain: ctx.domain,
		heading: m.og_home_heading({}, { locale }),
		date: m.og_prices_on({ date: formatDate(ctx.now) }, { locale }),
		cheapestLabel: m.cheapest({}, { locale }),
		rows,
		empty: rows.length === 0 ? m.og_no_prices({}, { locale }) : null
	};
}

export function stationOgModel(st: StationDetail, ctx: ShareContext): StationOgModel {
	const { locale } = ctx;
	return {
		kind: 'station',
		site: m.site_title({}, { locale }),
		domain: ctx.domain,
		name: st.name,
		address: st.address,
		network: ogNetwork(st.network.slug, st.network.name),
		prices: stationPriceViews(st, ctx),
		priceUnknown: m.price_unknown({}, { locale }),
		staleNote: m.og_stale({}, { locale }),
		hostPriced: st.hostPriced
			? m.station_host_priced({ network: st.network.name }, { locale })
			: null,
		connectorsLabel: m.th_connectors({}, { locale }),
		connectors: connectorSummary(st.connectors)
	};
}

export function ogHash(model: OgModel): string {
	return createHash('sha256')
		.update(JSON.stringify([OG_TEMPLATE_VERSION, model]))
		.digest('hex')
		.slice(0, 12);
}

function imagePath(base: string, model: OgModel, locale: Locale): string {
	const q = new URLSearchParams({ v: ogHash(model) });
	if (locale !== 'is') q.set('lang', locale);
	return `${base}?${q}`;
}

export function homeOgImage(cards: RateCardEntry[], ctx: ShareContext) {
	const model = homeOgModel(cards, ctx);
	const list = model.rows
		.map((r) => `${r.network.name} ${r.price}${r.ownBrand ? ` (${r.ownBrand})` : ''}`)
		.join(', ');
	return {
		path: imagePath('/og/home.png', model, ctx.locale),
		alt: m.og_home_alt(
			{ date: formatDate(ctx.now), list: list || (model.empty ?? '') },
			{ locale: ctx.locale }
		)
	};
}

export function stationOgImage(st: StationDetail, ctx: ShareContext) {
	const model = stationOgModel(st, ctx);
	return {
		path: imagePath(`/og/stod/${encodeURIComponent(st.slug)}.png`, model, ctx.locale),
		alt: stationDescription(st, ctx)
	};
}
