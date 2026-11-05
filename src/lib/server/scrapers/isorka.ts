import { eq } from 'drizzle-orm';
import { isPlausibleKwhPrice } from '../db/prices';
import { networks, stations } from '../db/schema';
import type { ScrapedReading, Scraper } from './types';

export const VIRTA_BASE = 'https://isorka.poweredbyvirta.com/api/core/v4';
export const VIRTA_HEADERS = {
	Accept: 'application/json',
	'X-Brand': 'isorka',
	'X-Source': 'isorka-web-map'
};
/** Virta allows 60 requests a minute (X-Ratelimit-Limit); stay just under it. */
export const VIRTA_REQUEST_GAP_MS = 1100;

export interface VirtaPricingEntry {
	name: string;
	priceCents: number;
}
export interface VirtaEvse {
	connectors: { currentType?: 'AC' | 'DC' }[];
	pricing?: VirtaPricingEntry[];
	minutesWithoutTimeCharge?: number | null;
}
export interface VirtaStation {
	id: number;
	name: string;
	evses: VirtaEvse[];
}

function centPrice(e: VirtaEvse, name: string): number | null {
	const entry = e.pricing?.find((p) => p.name === name);
	return entry ? entry.priceCents / 100 : null; // priceCents/100 = ISK incl. VSK (verified 24% ratio)
}

/**
 * Ísorka has no public price page; tariffs come per station from the Virta
 * platform API the isorka web map uses. We record the ACCOUNT tariff
 * (`pricing`), not `oneTimePricing` — the ad-hoc no-account rate is a fixed
 * 1.1× surcharge, and "almenn neytendaverð" is the app/account price.
 * Prices are per-EVSE; if EVSEs of one mode disagree we skip the station
 * rather than pick (never publish a price we can't stand behind).
 */
export function parseVirtaStation(st: VirtaStation): {
	readings: Omit<ScrapedReading, 'stationId'>[];
	warnings: string[];
} {
	const readings: Omit<ScrapedReading, 'stationId'>[] = [];
	const warnings: string[] = [];
	for (const mode of ['AC', 'DC'] as const) {
		const evses = st.evses.filter((e) => e.connectors.some((c) => c.currentType === mode));
		if (evses.length === 0) continue;
		const kwh = new Set(evses.map((e) => centPrice(e, 'price_per_kwh')));
		const fee = new Set(evses.map((e) => centPrice(e, 'price_per_minute')));
		const after = new Set(evses.map((e) => e.minutesWithoutTimeCharge ?? 0));
		if (kwh.size > 1 || fee.size > 1 || after.size > 1) {
			warnings.push(`${st.name}: ${mode} evses disagree on tariff — skipped`);
			continue;
		}
		const price = [...kwh][0];
		if (price == null) {
			warnings.push(`${st.name}: no price_per_kwh for ${mode} — skipped`);
			continue;
		}
		if (!isPlausibleKwhPrice(price)) {
			warnings.push(`${st.name}: implausible kWh price ${price} — skipped`);
			continue;
		}
		const minuteFee = [...fee][0];
		const hasFee = minuteFee != null && minuteFee > 0;
		readings.push({
			tariffKey: mode,
			priceIskPerKwh: price,
			minuteFeeIsk: hasFee ? minuteFee : null,
			minuteFeeAfterMin: hasFee ? [...after][0] || null : null
		});
	}
	return { readings, warnings };
}

/** An entry of the Virta map list endpoint (`/stations?latMin=…`). */
export interface VirtaListStation {
	id: number;
	latitude: number;
	longitude: number;
	name: string;
	provider: string;
	isRemoved?: boolean;
}

/** All verified prod matches (2026-11) sit within 7 m; 30 m leaves room for OCM pin drift. */
export const VIRTA_NEAR_M = 30;
/** Further out, a match also needs a shared distinctive name word (OCM pins can be 200+ m off). */
export const VIRTA_NAMED_M = 400;
// decommissioned posts stay listed, zero-priced: "Olís Álfheimar - Gamla stöð tekinn niður"
export const DECOMMISSIONED = /tekin\w*\s+niður/i;
// brand words every Ísorka station shares — they say nothing about *which* station
const GENERIC_WORDS = new Set(['ísorka', 'isorka', 'olís', 'olis', 'hleðsla', 'hleðslustöð']);

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const toRad = (d: number) => (d * Math.PI) / 180;
	const a =
		Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
	return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

const nameWords = (s: string) =>
	new Set(
		s
			.toLowerCase()
			.normalize('NFC')
			.split(/[^\p{L}\p{N}]+/u)
			.filter((w) => w.length >= 4 && !GENERIC_WORDS.has(w))
	);

export type VirtaMatch =
	| { kind: 'match'; station: VirtaListStation; distanceM: number; via: 'distance' | 'name' }
	| { kind: 'unmatched'; nearby: { station: VirtaListStation; distanceM: number }[] };

/**
 * Pairs one of our (OCM-seeded) Ísorka stations with a Virta station. Only
 * Ísorka's own (provider "Virta") live posts count: roaming partners return
 * zeroed pricing and decommissioned posts linger in the list at 0 kr.
 * Nearest post within VIRTA_NEAR_M wins outright; otherwise the nearest one
 * within VIRTA_NAMED_M that shares a distinctive name word. Anything else is
 * left for a human, with what is nearby.
 */
export function matchVirtaStation(
	ours: { name: string; lat: number; lng: number },
	list: VirtaListStation[]
): VirtaMatch {
	const near = list
		.filter((v) => v.provider === 'Virta' && !v.isRemoved && !DECOMMISSIONED.test(v.name))
		.map((v) => ({
			station: v,
			distanceM: haversineM(ours.lat, ours.lng, v.latitude, v.longitude)
		}))
		.filter((c) => c.distanceM <= VIRTA_NAMED_M)
		.sort((a, b) => a.distanceM - b.distanceM);
	if (near[0] && near[0].distanceM <= VIRTA_NEAR_M) {
		return { kind: 'match', ...near[0], via: 'distance' };
	}
	const ourWords = nameWords(ours.name);
	const named = near.find((c) => [...nameWords(c.station.name)].some((w) => ourWords.has(w)));
	if (named) return { kind: 'match', ...named, via: 'name' };
	return { kind: 'unmatched', nearby: near.slice(0, 3) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * GET a Virta URL, waiting out a 429 (rate limit) up to twice. Virta sends
 * X-Ratelimit-Reset (epoch seconds) with it; without one, wait a full minute.
 */
export async function virtaFetch(url: string): Promise<Response> {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(url, { headers: VIRTA_HEADERS });
		if (res.status !== 429 || attempt === 2) return res;
		const reset = Number(res.headers.get('x-ratelimit-reset'));
		const waitMs = reset > 0 ? reset * 1000 - Date.now() + 1000 : 60_000;
		await sleep(Math.min(Math.max(waitMs, 1000), 65_000));
	}
}

export const isorkaScraper: Scraper = {
	id: 'isorka',
	async scrape(db) {
		const [net] = await db.select().from(networks).where(eq(networks.slug, 'isorka'));
		if (!net) throw new Error('isorka network missing');
		const sts = (await db.select().from(stations).where(eq(stations.networkId, net.id))).filter(
			(s) => s.externalIds.virta != null && s.isActive
		);
		if (sts.length === 0)
			throw new Error('no stations have externalIds.virta — run npm run sync:virta');
		const readings: ScrapedReading[] = [];
		const warnings: string[] = [];
		let fetched = 0;
		for (const s of sts) {
			const started = Date.now();
			const res = await virtaFetch(`${VIRTA_BASE}/stations/${s.externalIds.virta}`);
			// one request per VIRTA_REQUEST_GAP_MS, counting the request's own time
			await sleep(VIRTA_REQUEST_GAP_MS - (Date.now() - started));
			if (!res.ok) {
				warnings.push(`${s.name}: HTTP ${res.status}`);
				continue;
			}
			fetched++;
			const parsed = parseVirtaStation((await res.json()) as VirtaStation);
			warnings.push(...parsed.warnings);
			readings.push(...parsed.readings.map((r) => ({ ...r, stationId: s.id })));
		}
		if (fetched === 0) throw new Error(`all ${sts.length} Virta detail fetches failed`);
		return { readings, warnings };
	}
};
