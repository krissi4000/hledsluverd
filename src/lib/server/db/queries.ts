import { and, eq, inArray, isNull, max, or } from 'drizzle-orm';
import type { ConnectorType, TariffKey } from '$lib/types';
import { deriveTariffKey } from '../matching';
import { ambiguousTomtomIds, isUnderConstruction } from '../station-audit';
import type { Db } from './client';
import { availability, connectors, networks, prices, scrapeRuns, stations } from './schema';

/** Stall count where ours is per stall (supercharge.info: one plug per stall), else
 * null — see unknownStalls in $lib/availability. */
function perStallCount(
	st: { externalIds: { supercharge?: number } },
	cons: { count: number }[]
): number | null {
	return st.externalIds.supercharge != null ? cons.reduce((n, c) => n + c.count, 0) : null;
}

/**
 * The TomTom id to read live availability through, or null when there is none to trust:
 * a station that isn't open yet has no availability, and a TomTom POI stamped on stations
 * of two networks belongs to at most one of them (see ambiguousTomtomIds).
 */
function trustedTomtomId(
	st: { externalIds: { tomtom?: string } },
	underConstruction: boolean,
	ambiguous: ReadonlySet<string>
): string | null {
	const t = st.externalIds.tomtom;
	return t && !underConstruction && !ambiguous.has(t) ? t : null;
}

export interface CurrentPrice {
	/** prices.id of the current row — admin uses it to bump verified_at */
	id: number;
	networkId: number;
	stationId: number | null;
	/** the station's owner sets this price (stations.host_priced); false for network-wide rows */
	hostPriced: boolean;
	/** the station isn't open yet, so its price is never shown; false for network-wide rows */
	underConstruction: boolean;
	tariffKey: TariffKey;
	priceIskPerKwh: number;
	minuteFeeIsk: number | null;
	minuteFeeAfterMin: number | null;
	verifiedAt: Date;
	validFrom: Date;
}

/**
 * Rows that count: network-wide ones, and rows of active stations that still belong to the
 * row's network. A station moved to another network (an admin override) leaves its old
 * network's station prices behind as history; they must not price it under the new one.
 */
const livePriceRows = or(
	isNull(prices.stationId),
	and(eq(stations.isActive, true), eq(stations.networkId, prices.networkId))
);

/**
 * Newest price per (network, station-or-network-wide, tariff), computed in TS —
 * the prices table stays small (a few rows per network/station per year).
 */
export async function currentPrices(db: Db): Promise<CurrentPrice[]> {
	const rawAll = await db
		.select()
		.from(prices)
		.leftJoin(stations, eq(prices.stationId, stations.id))
		.where(livePriceRows);
	const hostPriced = new Set(rawAll.filter((r) => r.stations?.hostPriced).map((r) => r.prices.id));
	const underConstruction = new Set(
		rawAll.filter((r) => r.stations && isUnderConstruction(r.stations)).map((r) => r.prices.id)
	);
	const all = rawAll.map((r) => r.prices);
	const best = new Map<string, (typeof all)[number]>();
	for (const p of all) {
		const key = `${p.networkId}:${p.stationId ?? 'net'}:${p.tariffKey}`;
		const cur = best.get(key);
		if (
			!cur ||
			p.validFrom > cur.validFrom ||
			(p.validFrom.getTime() === cur.validFrom.getTime() && p.id > cur.id)
		) {
			best.set(key, p);
		}
	}
	return [...best.values()].map((p) => ({
		id: p.id,
		networkId: p.networkId,
		stationId: p.stationId,
		hostPriced: hostPriced.has(p.id),
		underConstruction: underConstruction.has(p.id),
		tariffKey: p.tariffKey as TariffKey,
		priceIskPerKwh: p.priceIskPerKwh,
		minuteFeeIsk: p.minuteFeeIsk,
		minuteFeeAfterMin: p.minuteFeeAfterMin,
		verifiedAt: p.verifiedAt,
		validFrom: p.validFrom
	}));
}

export interface RateCardEntry {
	networkSlug: string;
	networkName: string;
	dc: number | null;
	/** true when stations of this network currently have differing DC prices — display "frá" */
	dcFrom: boolean;
	dcVerifiedAt: Date | null;
	ac: number | null;
	acFrom: boolean;
	acVerifiedAt: Date | null;
	/**
	 * Some host-priced stations of this network (left out of the card) charge less than the
	 * card shows. The card says so, or it seems to contradict the station list.
	 */
	hostLower: boolean;
}

const DC_KEYS: TariffKey[] = ['DC', 'DC_150'];

/**
 * One entry per network that has any current price; cheapest (min) per mode, sorted by DC asc.
 * Host-priced stations are left out: the card compares what each network itself charges.
 * So are stations that aren't open yet.
 */
export async function rateCard(db: Db): Promise<RateCardEntry[]> {
	const [nets, cp] = await Promise.all([db.select().from(networks), currentPrices(db)]);
	const lowest = (rows: CurrentPrice[], keys: TariffKey[]) => {
		const of = rows.filter((p) => keys.includes(p.tariffKey));
		return of.length ? Math.min(...of.map((p) => p.priceIskPerKwh)) : null;
	};
	const below = (host: number | null, own: number | null) =>
		host !== null && own !== null && host < own;
	const entries: RateCardEntry[] = [];
	for (const n of nets) {
		const open = cp.filter((p) => p.networkId === n.id && !p.underConstruction);
		const forNet = open.filter((p) => !p.hostPriced);
		if (forNet.length === 0) continue;
		const pick = (keys: TariffKey[]) => {
			const rows = forNet.filter((p) => keys.includes(p.tariffKey));
			if (rows.length === 0) return null;
			const min = rows.reduce((a, b) => (b.priceIskPerKwh < a.priceIskPerKwh ? b : a));
			return { min, from: new Set(rows.map((r) => r.priceIskPerKwh)).size > 1 };
		};
		// DC_150 included so a network pricing only the ≥150 kW tier keeps a fast-charge price
		const dc = pick(DC_KEYS);
		const ac = pick(['AC']);
		const host = open.filter((p) => p.hostPriced);
		entries.push({
			networkSlug: n.slug,
			networkName: n.name,
			dc: dc?.min.priceIskPerKwh ?? null,
			dcFrom: dc?.from ?? false,
			dcVerifiedAt: dc?.min.verifiedAt ?? null,
			ac: ac?.min.priceIskPerKwh ?? null,
			acFrom: ac?.from ?? false,
			acVerifiedAt: ac?.min.verifiedAt ?? null,
			hostLower:
				below(lowest(host, DC_KEYS), dc?.min.priceIskPerKwh ?? null) ||
				below(lowest(host, ['AC']), ac?.min.priceIskPerKwh ?? null)
		});
	}
	return entries.sort(
		(a, b) => (a.dc ?? Infinity) - (b.dc ?? Infinity) || (a.ac ?? Infinity) - (b.ac ?? Infinity)
	);
}

export interface StationRow {
	slug: string;
	name: string;
	/** street and town (OCM/Virta/e1 style), searched by the homepage text box */
	address: string | null;
	lat: number;
	lng: number;
	networkSlug: string;
	networkName: string;
	price: number | null;
	minuteFeeIsk: number | null;
	minuteFeeAfterMin: number | null;
	verifiedAt: Date | null;
	connectors: { type: ConnectorType; powerKw: number; count: number }[];
	freeCount: number | null;
	totalCount: number | null;
	availabilityFetchedAt: Date | null;
	/** per-stall count, set only where it can be compared with TomTom's total */
	stallCount: number | null;
	/** not open yet: listed with a badge, never with a price or availability */
	underConstruction: boolean;
}

/** Not-yet-open stations go after every open one. */
const openFirst = (a: { underConstruction: boolean }, b: { underConstruction: boolean }) =>
	Number(a.underConstruction) - Number(b.underConstruction);

/**
 * Active stations that have a connector for the mode (AC → Type2; DC → CCS2/CHAdeMO),
 * priced via the tariff of their highest-power connector of that mode,
 * sorted by price asc (unknown price last, stations not open yet after those), then name.
 */
export async function stationList(db: Db, mode: 'AC' | 'DC'): Promise<StationRow[]> {
	const [sts, cons, nets, cp, avail] = await Promise.all([
		db.select().from(stations).where(eq(stations.isActive, true)),
		db.select().from(connectors),
		db.select().from(networks),
		currentPrices(db),
		db.select().from(availability)
	]);
	const ambiguous = ambiguousTomtomIds(sts);
	const availByStation = new Map(avail.map((a) => [a.stationId, a]));
	const netById = new Map(nets.map((n) => [n.id, n]));
	const consByStation = new Map<number, (typeof cons)[number][]>();
	for (const c of cons) {
		let arr = consByStation.get(c.stationId);
		if (!arr) consByStation.set(c.stationId, (arr = []));
		arr.push(c);
	}
	const rows: StationRow[] = [];
	for (const s of sts) {
		const all = consByStation.get(s.id) ?? [];
		const ofMode = all.filter((c) => (mode === 'AC' ? c.type === 'Type2' : c.type !== 'Type2'));
		if (ofMode.length === 0) continue;

		const top = ofMode.reduce((a, b) => (b.powerKw > a.powerKw ? b : a));
		const own = cp.filter((p) => p.stationId === s.id);
		const netWide = cp.filter((p) => p.networkId === s.networkId && p.stationId === null);
		const tariffs = new Set<TariffKey>([...own, ...netWide].map((p) => p.tariffKey));
		const key = deriveTariffKey(top.type as ConnectorType, top.powerKw, tariffs);
		const uc = isUnderConstruction(s);
		// station-specific current price wins; network-wide price is the fallback
		const price = uc
			? null
			: (own.find((p) => p.tariffKey === key) ?? netWide.find((p) => p.tariffKey === key) ?? null);
		const net = netById.get(s.networkId)!;
		const a = trustedTomtomId(s, uc, ambiguous) ? availByStation.get(s.id) : undefined;

		rows.push({
			slug: s.slug,
			name: s.name,
			address: s.address,
			lat: s.location.y,
			lng: s.location.x,
			networkSlug: net.slug,
			networkName: net.name,
			price: price?.priceIskPerKwh ?? null,
			minuteFeeIsk: price?.minuteFeeIsk ?? null,
			minuteFeeAfterMin: price?.minuteFeeAfterMin ?? null,
			verifiedAt: price?.verifiedAt ?? null,
			connectors: all.map((c) => ({
				type: c.type as ConnectorType,
				powerKw: c.powerKw,
				count: c.count
			})),
			freeCount: a?.freeCount ?? null,
			totalCount: a?.totalCount ?? null,
			availabilityFetchedAt: a?.fetchedAt ?? null,
			stallCount: perStallCount(s, all),
			underConstruction: uc
		});
	}
	return rows.sort(
		(a, b) =>
			openFirst(a, b) ||
			(a.price ?? Infinity) - (b.price ?? Infinity) ||
			a.name.localeCompare(b.name, 'is')
	);
}

export interface StationDetail {
	id: number;
	slug: string;
	name: string;
	address: string | null;
	lat: number;
	lng: number;
	network: { slug: string; name: string; websiteUrl: string | null };
	/** the site's owner sets the price here, not the network */
	hostPriced: boolean;
	/** not open yet: no prices, no availability */
	underConstruction: boolean;
	connectors: { type: ConnectorType; powerKw: number; count: number }[];
	prices: {
		mode: 'DC' | 'AC';
		tariffKey: TariffKey;
		priceIskPerKwh: number;
		minuteFeeIsk: number | null;
		minuteFeeAfterMin: number | null;
		verifiedAt: Date;
	}[];
	availability: { freeCount: number | null; totalCount: number | null; fetchedAt: Date } | null;
	/** per-stall count, set only where it can be compared with TomTom's total */
	stallCount: number | null;
	/** null when there is no availability to trust (none stamped, ambiguous, not open yet) */
	tomtomId: string | null;
}

/** Everything the /stod/[slug] page shows. Inactive or unknown slug → null. */
export async function stationDetail(db: Db, slug: string): Promise<StationDetail | null> {
	const [st] = await db
		.select()
		.from(stations)
		.where(and(eq(stations.slug, slug), eq(stations.isActive, true)));
	if (!st) return null;
	const [net] = await db.select().from(networks).where(eq(networks.id, st.networkId));
	const [cons, cp, avail, stamps] = await Promise.all([
		db.select().from(connectors).where(eq(connectors.stationId, st.id)),
		currentPrices(db),
		db.select().from(availability).where(eq(availability.stationId, st.id)),
		db
			.select({
				networkId: stations.networkId,
				isActive: stations.isActive,
				externalIds: stations.externalIds
			})
			.from(stations)
			.where(eq(stations.isActive, true))
	]);
	const uc = isUnderConstruction(st);
	const tomtomId = trustedTomtomId(st, uc, ambiguousTomtomIds(stamps));
	const own = cp.filter((p) => p.stationId === st.id);
	const netWide = cp.filter((p) => p.networkId === st.networkId && p.stationId === null);
	const tariffs = new Set<TariffKey>([...own, ...netWide].map((p) => p.tariffKey));
	const priceRows: StationDetail['prices'] = [];
	for (const mode of ['DC', 'AC'] as const) {
		if (uc) break;
		const ofMode = cons.filter((c) => (mode === 'AC' ? c.type === 'Type2' : c.type !== 'Type2'));
		if (ofMode.length === 0) continue;
		const top = ofMode.reduce((a, b) => (b.powerKw > a.powerKw ? b : a));
		const key = deriveTariffKey(top.type as ConnectorType, top.powerKw, tariffs);
		const price = own.find((p) => p.tariffKey === key) ?? netWide.find((p) => p.tariffKey === key);
		if (price) {
			priceRows.push({
				mode,
				tariffKey: key,
				priceIskPerKwh: price.priceIskPerKwh,
				minuteFeeIsk: price.minuteFeeIsk,
				minuteFeeAfterMin: price.minuteFeeAfterMin,
				verifiedAt: price.verifiedAt
			});
		}
	}
	return {
		id: st.id,
		slug: st.slug,
		name: st.name,
		address: st.address,
		lat: st.location.y,
		lng: st.location.x,
		network: { slug: net.slug, name: net.name, websiteUrl: net.websiteUrl },
		hostPriced: st.hostPriced,
		underConstruction: uc,
		connectors: cons.map((c) => ({
			type: c.type as ConnectorType,
			powerKw: c.powerKw,
			count: c.count
		})),
		prices: priceRows,
		availability:
			tomtomId && avail[0]
				? {
						freeCount: avail[0].freeCount,
						totalCount: avail[0].totalCount,
						fetchedAt: avail[0].fetchedAt
					}
				: null,
		stallCount: perStallCount(st, cons),
		tomtomId
	};
}

export interface MapStation {
	id: number;
	slug: string;
	name: string;
	networkSlug: string;
	networkName: string;
	lat: number;
	lng: number;
	/** headline price: the DC price when the station fast-charges, else the AC price */
	price: number | null;
	mode: 'DC' | 'AC';
	connectors: { type: ConnectorType; powerKw: number; count: number }[];
	freeCount: number | null;
	totalCount: number | null;
	availabilityFetchedAt: Date | null;
	/** per-stall count, set only where it can be compared with TomTom's total */
	stallCount: number | null;
	/** null when there is no availability to trust (none stamped, ambiguous, not open yet) */
	tomtomId: string | null;
	/** for the card's Google photos (Places UI Kit) */
	googlePlaceId: string | null;
	/** not open yet: no price, no availability, drawn under the other pins */
	underConstruction: boolean;
}

/** An active station's coordinates — for its Street View photo (/stod/[slug]/mynd). */
export async function stationLocation(
	db: Db,
	slug: string
): Promise<{ lat: number; lng: number } | null> {
	const [st] = await db
		.select({ location: stations.location })
		.from(stations)
		.where(and(eq(stations.slug, slug), eq(stations.isActive, true)));
	return st ? { lat: st.location.y, lng: st.location.x } : null;
}

/** Every active station, priced for its dominant mode — feeds /kort. Not-yet-open ones last. */
export async function mapStations(db: Db): Promise<MapStation[]> {
	const [sts, cons, nets, cp, avail] = await Promise.all([
		db.select().from(stations).where(eq(stations.isActive, true)),
		db.select().from(connectors),
		db.select().from(networks),
		currentPrices(db),
		db.select().from(availability)
	]);
	const ambiguous = ambiguousTomtomIds(sts);
	const netById = new Map(nets.map((n) => [n.id, n]));
	const availByStation = new Map(avail.map((a) => [a.stationId, a]));
	const consByStation = new Map<number, (typeof cons)[number][]>();
	for (const c of cons) {
		let arr = consByStation.get(c.stationId);
		if (!arr) consByStation.set(c.stationId, (arr = []));
		arr.push(c);
	}
	const rows: MapStation[] = [];
	for (const s of sts) {
		const all = consByStation.get(s.id) ?? [];
		if (all.length === 0) continue;
		const mode: 'DC' | 'AC' = all.some((c) => c.type !== 'Type2') ? 'DC' : 'AC';
		const ofMode = all.filter((c) => (mode === 'AC' ? c.type === 'Type2' : c.type !== 'Type2'));
		const top = ofMode.reduce((a, b) => (b.powerKw > a.powerKw ? b : a));
		const own = cp.filter((p) => p.stationId === s.id);
		const netWide = cp.filter((p) => p.networkId === s.networkId && p.stationId === null);
		const tariffs = new Set<TariffKey>([...own, ...netWide].map((p) => p.tariffKey));
		const key = deriveTariffKey(top.type as ConnectorType, top.powerKw, tariffs);
		const uc = isUnderConstruction(s);
		const price = uc
			? null
			: (own.find((p) => p.tariffKey === key) ?? netWide.find((p) => p.tariffKey === key) ?? null);
		const net = netById.get(s.networkId)!;
		const tomtomId = trustedTomtomId(s, uc, ambiguous);
		const a = tomtomId ? availByStation.get(s.id) : undefined;
		rows.push({
			id: s.id,
			slug: s.slug,
			name: s.name,
			networkSlug: net.slug,
			networkName: net.name,
			lat: s.location.y,
			lng: s.location.x,
			price: price?.priceIskPerKwh ?? null,
			mode,
			connectors: all.map((c) => ({
				type: c.type as ConnectorType,
				powerKw: c.powerKw,
				count: c.count
			})),
			freeCount: a?.freeCount ?? null,
			totalCount: a?.totalCount ?? null,
			availabilityFetchedAt: a?.fetchedAt ?? null,
			stallCount: perStallCount(s, all),
			tomtomId,
			googlePlaceId: s.externalIds.google ?? null,
			underConstruction: uc
		});
	}
	return rows.sort((a, b) => openFirst(a, b) || a.name.localeCompare(b.name, 'is'));
}

export interface TrendSeries {
	networkSlug: string;
	networkName: string;
	/** stepped points: t = epoch ms of valid_from, y = the network's cheapest price then */
	points: { t: number; y: number }[];
}

/**
 * Price history for the trend graph. With three networks priced per station there is
 * no single "network price" — each line plots the network's CHEAPEST current price
 * (min across its network-wide + station rows) at every change point. Host-priced
 * stations and stations not open yet are left out, like on the rate card.
 */
export async function trendSeries(db: Db, mode: 'AC' | 'DC'): Promise<TrendSeries[]> {
	const keys: TariffKey[] = mode === 'AC' ? ['AC'] : DC_KEYS;
	const [nets, rawAll] = await Promise.all([
		db.select().from(networks),
		db
			.select()
			.from(prices)
			.leftJoin(stations, eq(prices.stationId, stations.id))
			.where(livePriceRows)
	]);
	const all = rawAll
		.filter((r) => !r.stations || (!r.stations.hostPriced && !isUnderConstruction(r.stations)))
		.map((r) => r.prices);
	const rows = all
		.filter((p) => (keys as string[]).includes(p.tariffKey))
		.sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime() || a.id - b.id);
	const state = new Map<string, number>(); // "network:station-or-net:tariff" → latest price
	const byNetwork = new Map<number, { t: number; y: number }[]>();
	for (const p of rows) {
		state.set(`${p.networkId}:${p.stationId ?? 'net'}:${p.tariffKey}`, p.priceIskPerKwh);
		let min = Infinity;
		for (const [k, v] of state) if (k.startsWith(`${p.networkId}:`)) min = Math.min(min, v);
		const pts = byNetwork.get(p.networkId) ?? [];
		if (pts.length === 0 || pts[pts.length - 1].y !== min) {
			pts.push({ t: p.validFrom.getTime(), y: min });
		}
		byNetwork.set(p.networkId, pts);
	}
	return nets
		.filter((n) => byNetwork.has(n.id))
		.map((n) => ({ networkSlug: n.slug, networkName: n.name, points: byNetwork.get(n.id)! }))
		.sort((a, b) => a.networkName.localeCompare(b.networkName, 'is'));
}

/** When any scraper last ran successfully: the footer's "prices last fetched" line.
 * Null when no scrape has succeeded yet (the footer then says nothing). */
export async function lastPriceFetch(db: Db): Promise<Date | null> {
	const [row] = await db
		.select({ t: max(scrapeRuns.startedAt) })
		.from(scrapeRuns)
		.where(inArray(scrapeRuns.status, ['ok', 'changed']));
	return row?.t ?? null;
}
