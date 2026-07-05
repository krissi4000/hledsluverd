import { eq } from 'drizzle-orm';
import { networks, stations } from '../db/schema';
import type { ScrapedReading, Scraper } from './types';

export const VIRTA_BASE = 'https://isorka.poweredbyvirta.com/api/core/v4';
const HEADERS = { Accept: 'application/json', 'X-Brand': 'isorka', 'X-Source': 'isorka-web-map' };

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const isorkaScraper: Scraper = {
	id: 'isorka',
	async scrape(db) {
		const [net] = await db.select().from(networks).where(eq(networks.slug, 'isorka'));
		if (!net) throw new Error('isorka network missing');
		const sts = (await db.select().from(stations).where(eq(stations.networkId, net.id))).filter(
			(s) => s.externalIds.virta != null
		);
		if (sts.length === 0)
			throw new Error('no stations have externalIds.virta — run npm run match:virta');
		const readings: ScrapedReading[] = [];
		const warnings: string[] = [];
		let fetched = 0;
		for (const s of sts) {
			const res = await fetch(`${VIRTA_BASE}/stations/${s.externalIds.virta}`, {
				headers: HEADERS
			});
			if (!res.ok) {
				warnings.push(`${s.name}: HTTP ${res.status}`);
				continue;
			}
			fetched++;
			const parsed = parseVirtaStation((await res.json()) as VirtaStation);
			warnings.push(...parsed.warnings);
			readings.push(...parsed.readings.map((r) => ({ ...r, stationId: s.id })));
			await sleep(150);
		}
		if (fetched === 0) throw new Error(`all ${sts.length} Virta detail fetches failed`);
		return { readings, warnings };
	}
};
