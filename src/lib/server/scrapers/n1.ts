import { eq } from 'drizzle-orm';
import { networks, stations } from '../db/schema';
import type { ScrapedReading, Scraper } from './types';

// Moved from /is/verdtafla (404 since 2026-11) to /is/eldsneytisverd.
export const N1_URL = 'https://n1.is/is/eldsneytisverd';
export const N1_UA = { 'User-Agent': 'Mozilla/5.0 (hledsluverd.is price comparison)' };
const UA = N1_UA;

type Escaped = { title: string; unit?: string; price: number };

/** Un-escape a backslash-escaped JSON array that sits in the RSC payload under `key`. */
function escapedArray<T>(html: string, key: string, terminator = ''): T[] | null {
	const m = html.match(new RegExp(`\\\\"${key}\\\\":(\\[.*?\\])${terminator}`));
	return m ? (JSON.parse(m[1].replace(/\\"/g, '"')) as T[]) : null;
}

/**
 * N1 embeds the price table as backslash-escaped JSON inside the raw HTML
 * (Next.js RSC payload — no __NEXT_DATA__, hashed CSS). `listPriceItems` is
 * N1's nationwide Listaverð; stations with their own published price get a
 * station-scoped reading via the getFuelPricesForStation server action.
 * N1 prices energy flat per station (no AC/DC split, no fees); their public
 * chargers are DC fast chargers, so readings go under the DC tariff. The page
 * shows consumer display prices (like pump prices) — treated as incl. VSK.
 *
 * Returns null when the list exists but has no Rafmagn row (the case since the
 * 2026-11 redesign). Never fall back to `initialItems`: that is the *default
 * station's* price card (Ártúnshöfði), not a network-wide price.
 */
export function parseN1ListPrice(html: string): number | null {
	const items = escapedArray<Escaped>(html, 'listPriceItems');
	if (!items) throw new Error('N1 parse failed: listPriceItems not found — page layout changed?');
	const raf = items.find((i) => i.title === 'Rafmagn');
	if (!raf) return null;
	if (raf.unit !== 'kr./kWh' || typeof raf.price !== 'number') {
		throw new Error(`N1 parse failed: unexpected Rafmagn list row ${JSON.stringify(raf)}`);
	}
	return raf.price;
}

export interface N1Location {
	value: string;
	label: string;
}

/** The station picker's options: value like "4931_service", label "N1 Blönduós - Norðurlandsvegur 3 - 540 Blönduós". */
export function parseN1Locations(html: string): N1Location[] {
	const locs = escapedArray<N1Location>(html, 'locations', ',\\\\"defaultLocation');
	if (!locs) throw new Error('N1 locations blob not found — page layout changed?');
	return locs;
}

/** 6-char lowercase stem survives Icelandic declension: blönduós→blöndu ⊂ "n1 blönduósi" */
function stem(word: string): string | null {
	const w = word.toLowerCase().replace(/[^a-záðéíóúýþæö]/g, '');
	return w.length >= 4 ? w.slice(0, 6) : null;
}

export type N1Match =
	| { kind: 'match'; location: N1Location; via: string }
	| { kind: 'ambiguous'; candidates: N1Location[]; via: string }
	| { kind: 'unmatched' };

/**
 * Pairs one of our N1 stations with a picker location, most precise rule first:
 *   1. street stem + house number ("Austurvegur 18" ↔ "Austurvegi 18"),
 *   2. station-name stem ("Staðarskáli (N1)" ↔ "N1 Staðarskála"),
 *   3. street stem alone ("Skógarlind" ↔ "Skógarlind 2").
 * The first rule with any hit decides; several distinct hits = ambiguous, never
 * a pick. Town words are never used on their own — "Ísafjörður" or "Kópavogur"
 * hit several stations.
 */
export function matchN1Location(
	station: { name: string; address: string | null },
	locations: N1Location[]
): N1Match {
	const usable = locations.filter((l) => /_(service|self)$/.test(l.value));
	const label = (l: N1Location) => l.label.toLowerCase();
	const streetPart = (station.address ?? '').split(',').map((p) => p.trim());
	const withNumber = streetPart.find((p) => /^[^\d()]+\s\d+[a-z]?$/i.test(p));
	// "Street, Town" only — a lone segment is usually just the town
	const firstStreet =
		streetPart.length >= 2 && streetPart[0] && !/\(/.test(streetPart[0])
			? streetPart[0]
			: undefined;

	const rules: [string, (l: N1Location) => boolean][] = [];
	if (withNumber) {
		const [, street, num] = withNumber.match(/^(.+?)\s(\d+[a-z]?)$/i)!;
		const s = stem(street);
		const numRe = new RegExp(`(?<![\\d])${num}(?![\\d])`, 'i');
		if (s) rules.push(['street+number', (l) => label(l).includes(s) && numRe.test(l.label)]);
	}
	const nameStem = stem(
		station.name
			.replace(/\(N1\)/i, '')
			.trim()
			.split(/\s+/)[0] ?? ''
	);
	if (nameStem) rules.push(['name', (l) => label(l).includes(nameStem)]);
	const streetStem = firstStreet ? stem(firstStreet.split(/\s+/)[0]) : null;
	if (streetStem) rules.push(['street', (l) => label(l).includes(streetStem)]);

	for (const [via, test] of rules) {
		const hits = usable.filter(test);
		if (hits.length === 0) continue;
		const unique = [...new Map(hits.map((h) => [h.value, h])).values()];
		return unique.length === 1
			? { kind: 'match', location: unique[0], via }
			: { kind: 'ambiguous', candidates: unique, via };
	}
	return { kind: 'unmatched' };
}

/** RSC flight response: the payload line starts "1:". Returns null when the station has no Rafmagn row. */
export function parseN1ActionResponse(body: string): number | null {
	const line = body.split('\n').find((l) => l.startsWith('1:'));
	if (!line) throw new Error('N1 action response: no payload line');
	const obj = JSON.parse(line.slice(2)) as {
		success?: boolean;
		items?: { title: string; unit?: string; price: number }[];
	};
	if (!obj.success || !Array.isArray(obj.items)) {
		throw new Error('N1 action response: unexpected shape');
	}
	const raf = obj.items.find((i) => i.title === 'Rafmagn');
	return raf ? raf.price : null;
}

/** The Next-Action id rotates every deploy; it sits next to "getFuelPricesForStation" in one JS chunk. */
export function extractActionId(chunkJs: string): string | null {
	const m = chunkJs.match(/\(\s*"([0-9a-f]{40,})"[^)]*?"getFuelPricesForStation"\s*\)/);
	return m ? m[1] : null;
}

async function deriveActionId(html: string): Promise<string> {
	const urls = [...new Set(html.match(/\/_next\/static\/chunks\/[a-zA-Z0-9_.-]+\.js/g) ?? [])];
	for (const url of urls) {
		const res = await fetch(`https://n1.is${url}`, { headers: UA });
		if (!res.ok) continue;
		const id = extractActionId(await res.text());
		if (id) return id;
	}
	throw new Error('N1: getFuelPricesForStation action id not found in any chunk — build changed?');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const n1Scraper: Scraper = {
	id: 'n1',
	async scrape(db) {
		const res = await fetch(N1_URL, { headers: UA });
		if (!res.ok) throw new Error(`N1 fetch failed: HTTP ${res.status}`);
		const html = await res.text();
		const readings: ScrapedReading[] = [];
		const warnings: string[] = [];
		const listPrice = parseN1ListPrice(html);
		if (listPrice !== null) {
			readings.push({ tariffKey: 'DC', priceIskPerKwh: listPrice }); // network-wide Listaverð
		} else {
			warnings.push('no Rafmagn row in Listaverð — station prices only');
		}
		const [net] = await db.select().from(networks).where(eq(networks.slug, 'n1'));
		if (!net) throw new Error('n1 network missing');
		const sts = (await db.select().from(stations).where(eq(stations.networkId, net.id))).filter(
			(s) => s.externalIds.n1 != null
		);
		if (listPrice === null && sts.length === 0) {
			throw new Error(
				'N1 publishes no Rafmagn list price and no station has externalIds.n1 — run npm run match:n1'
			);
		}
		if (sts.length > 0) {
			const actionId = await deriveActionId(html);
			for (const s of sts) {
				const post = await fetch(N1_URL, {
					method: 'POST',
					headers: {
						...UA,
						Accept: 'text/x-component',
						'Next-Action': actionId,
						'Content-Type': 'text/plain;charset=UTF-8'
					},
					body: JSON.stringify([s.externalIds.n1])
				});
				if (!post.ok) {
					warnings.push(`${s.name}: HTTP ${post.status}`);
					continue;
				}
				const price = parseN1ActionResponse(await post.text());
				if (price === null) {
					warnings.push(`${s.name}: no Rafmagn price published`);
					continue;
				}
				readings.push({ stationId: s.id, tariffKey: 'DC', priceIskPerKwh: price });
				await sleep(150);
			}
		}
		return { readings, warnings };
	}
};
