import { eq } from 'drizzle-orm';
import type { ConnectorType, TariffKey } from '$lib/types';
import { deriveTariffKey } from '../matching';
import type { Db } from './client';
import { connectors, networks, prices, stations } from './schema';

export interface CurrentPrice {
	networkId: number;
	tariffKey: TariffKey;
	priceIskPerKwh: number;
	minuteFeeIsk: number | null;
	verifiedAt: Date;
	validFrom: Date;
}

/**
 * Newest network-wide price per (network, tariff), computed in TS —
 * the prices table stays small (a few rows per network per year).
 * Station-specific overrides (stationId != null) are ignored until a later phase needs them.
 */
export async function currentPrices(db: Db): Promise<CurrentPrice[]> {
	const all = await db.select().from(prices);
	const best = new Map<string, (typeof all)[number]>();
	for (const p of all) {
		if (p.stationId != null) continue;
		const key = `${p.networkId}:${p.tariffKey}`;
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
		networkId: p.networkId,
		tariffKey: p.tariffKey as TariffKey,
		priceIskPerKwh: p.priceIskPerKwh,
		minuteFeeIsk: p.minuteFeeIsk,
		verifiedAt: p.verifiedAt,
		validFrom: p.validFrom
	}));
}

export interface RateCardEntry {
	networkSlug: string;
	networkName: string;
	dc: number | null;
	dcVerifiedAt: Date | null;
	ac: number | null;
	acVerifiedAt: Date | null;
}

/** One entry per network that has any current price; sorted by DC price asc (nulls last), then AC. */
export async function rateCard(db: Db): Promise<RateCardEntry[]> {
	const [nets, cp] = await Promise.all([db.select().from(networks), currentPrices(db)]);
	const entries: RateCardEntry[] = [];
	for (const n of nets) {
		const forNet = cp.filter((p) => p.networkId === n.id);
		if (forNet.length === 0) continue;
		// a network pricing only the ≥150 kW tier still has a fast-charge price — fall back
		// to DC_150 so the network doesn't vanish from the card
		const dc =
			forNet.find((p) => p.tariffKey === 'DC') ?? forNet.find((p) => p.tariffKey === 'DC_150');
		const ac = forNet.find((p) => p.tariffKey === 'AC');
		entries.push({
			networkSlug: n.slug,
			networkName: n.name,
			dc: dc?.priceIskPerKwh ?? null,
			dcVerifiedAt: dc?.verifiedAt ?? null,
			ac: ac?.priceIskPerKwh ?? null,
			acVerifiedAt: ac?.verifiedAt ?? null
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
	const tariffsByNetwork = new Map<number, Set<TariffKey>>();
	for (const p of cp) {
		let set = tariffsByNetwork.get(p.networkId);
		if (!set) tariffsByNetwork.set(p.networkId, (set = new Set()));
		set.add(p.tariffKey);
	}

	const rows: StationRow[] = [];
	for (const s of sts) {
		const all = consByStation.get(s.id) ?? [];
		const ofMode = all.filter((c) => (mode === 'AC' ? c.type === 'Type2' : c.type !== 'Type2'));
		if (ofMode.length === 0) continue;

		const top = ofMode.reduce((a, b) => (b.powerKw > a.powerKw ? b : a));
		const tariffs = tariffsByNetwork.get(s.networkId) ?? new Set<TariffKey>();
		const key = deriveTariffKey(top.type as ConnectorType, top.powerKw, tariffs);
		const price = cp.find((p) => p.networkId === s.networkId && p.tariffKey === key) ?? null;
		const net = netById.get(s.networkId)!;

		rows.push({
			slug: s.slug,
			name: s.name,
			networkSlug: net.slug,
			networkName: net.name,
			price: price?.priceIskPerKwh ?? null,
			minuteFeeIsk: price?.minuteFeeIsk ?? null,
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
