import { eq } from 'drizzle-orm';
import { networks, stations } from '../db/schema';
import type { ScrapedReading, Scraper } from './types';

export const N1_URL = 'https://n1.is/is/verdtafla';
const UA = { 'User-Agent': 'Mozilla/5.0 (hledsluverd.is price comparison)' };

/**
 * N1 embeds the price table as backslash-escaped JSON inside the raw HTML
 * (Next.js RSC payload — no __NEXT_DATA__, hashed CSS). The "Rafmagn" list
 * price is N1's published default; stations with their own published price
 * get a station-scoped reading via the getFuelPricesForStation server action.
 * N1 prices energy flat per station (no AC/DC split, no fees); their public
 * chargers are DC fast chargers, so readings go under the DC tariff. The page
 * shows consumer display prices (like pump prices) — treated as incl. VSK.
 */
export function parseN1ListPrice(html: string): number {
	const m = html.match(
		/\\"title\\":\\"Rafmagn\\"[^}]*?\\"unit\\":\\"kr\.\/kWh\\",\\"price\\":([0-9.]+)/
	);
	if (!m) throw new Error('N1 parse failed: Rafmagn list price not found — page layout changed?');
	return parseFloat(m[1]);
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
	for (const url of urls.slice(0, 40)) {
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
		const readings: ScrapedReading[] = [
			{ tariffKey: 'DC', priceIskPerKwh: parseN1ListPrice(html) } // network-wide Listaverð
		];
		const warnings: string[] = [];
		const [net] = await db.select().from(networks).where(eq(networks.slug, 'n1'));
		if (!net) throw new Error('n1 network missing');
		const sts = (await db.select().from(stations).where(eq(stations.networkId, net.id))).filter(
			(s) => s.externalIds.n1 != null
		);
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
