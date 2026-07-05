import { eq } from 'drizzle-orm';
import type { ConnectorType, TariffKey } from '$lib/types';
import { deriveTariffKey } from '../matching';
import type { Db } from './client';
import { connectors, networks, prices, stations } from './schema';

export interface CurrentPrice {
	/** prices.id of the current row — admin uses it to bump verified_at */
	id: number;
	networkId: number;
	stationId: number | null;
	tariffKey: TariffKey;
	priceIskPerKwh: number;
	minuteFeeIsk: number | null;
	minuteFeeAfterMin: number | null;
	verifiedAt: Date;
	validFrom: Date;
}

/**
 * Newest price per (network, station-or-network-wide, tariff), computed in TS —
 * the prices table stays small (a few rows per network/station per year).
 */
export async function currentPrices(db: Db): Promise<CurrentPrice[]> {
	const all = await db.select().from(prices);
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
}

/** One entry per network that has any current price; cheapest (min) per mode, sorted by DC asc. */
export async function rateCard(db: Db): Promise<RateCardEntry[]> {
	const [nets, cp] = await Promise.all([db.select().from(networks), currentPrices(db)]);
	const entries: RateCardEntry[] = [];
	for (const n of nets) {
		const forNet = cp.filter((p) => p.networkId === n.id);
		if (forNet.length === 0) continue;
		const pick = (keys: TariffKey[]) => {
			const rows = forNet.filter((p) => keys.includes(p.tariffKey));
			if (rows.length === 0) return null;
			const min = rows.reduce((a, b) => (b.priceIskPerKwh < a.priceIskPerKwh ? b : a));
			return { min, from: new Set(rows.map((r) => r.priceIskPerKwh)).size > 1 };
		};
		// DC_150 included so a network pricing only the ≥150 kW tier keeps a fast-charge price
		const dc = pick(['DC', 'DC_150']);
		const ac = pick(['AC']);
		entries.push({
			networkSlug: n.slug,
			networkName: n.name,
			dc: dc?.min.priceIskPerKwh ?? null,
			dcFrom: dc?.from ?? false,
			dcVerifiedAt: dc?.min.verifiedAt ?? null,
			ac: ac?.min.priceIskPerKwh ?? null,
			acFrom: ac?.from ?? false,
			acVerifiedAt: ac?.min.verifiedAt ?? null
		});
	}
	return entries.sort(
		(a, b) => (a.dc ?? Infinity) - (b.dc ?? Infinity) || (a.ac ?? Infinity) - (b.ac ?? Infinity)
	);
}

export interface StationRow {
	slug: string;
	name: string;
	networkSlug: string;
	networkName: string;
	price: number | null;
	minuteFeeIsk: number | null;
	minuteFeeAfterMin: number | null;
	verifiedAt: Date | null;
	connectors: { type: ConnectorType; powerKw: number; count: number }[];
}

/**
 * Active stations that have a connector for the mode (AC → Type2; DC → CCS2/CHAdeMO),
 * priced via the tariff of their highest-power connector of that mode,
 * sorted by price asc (unknown price last), then name.
 */
export async function stationList(db: Db, mode: 'AC' | 'DC'): Promise<StationRow[]> {
	const [sts, cons, nets, cp] = await Promise.all([
		db.select().from(stations).where(eq(stations.isActive, true)),
		db.select().from(connectors),
		db.select().from(networks),
		currentPrices(db)
	]);
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
		// station-specific current price wins; network-wide price is the fallback
		const price =
			own.find((p) => p.tariffKey === key) ?? netWide.find((p) => p.tariffKey === key) ?? null;
		const net = netById.get(s.networkId)!;

		rows.push({
			slug: s.slug,
			name: s.name,
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
			}))
		});
	}
	return rows.sort(
		(a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || a.name.localeCompare(b.name, 'is')
	);
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
 * (min across its network-wide + station rows) at every change point.
 */
export async function trendSeries(db: Db, mode: 'AC' | 'DC'): Promise<TrendSeries[]> {
	const keys: TariffKey[] = mode === 'AC' ? ['AC'] : ['DC', 'DC_150'];
	const [nets, all] = await Promise.all([db.select().from(networks), db.select().from(prices)]);
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
