import * as cheerio from 'cheerio';
import type { ScrapedReading, Scraper } from './types';

export const ON_URL = 'https://www.on.is/verdskrar';

/** "48 kr/kWh" → 48, "0,5 kr/mín" → 0.5 (Icelandic decimal comma; thousands dots stripped) */
function iskNumber(text: string): number {
	return parseFloat(text.replace(/\./g, '').replace(',', '.'));
}

/**
 * The verðskrá is Framer-rendered rich text (verified 2026-07-05). Traps:
 * - data-framer-name attributes hold STALE layer names (the DC cell says
 *   "69 kr/kWh" but renders 62) — only <p class="framer-text"> text is real.
 * - Every cell renders twice in responsive ssr-variant wrappers → first match wins.
 * - "– Vildarkjör" loyalty rows and the home-subscription tables must be skipped.
 * Only the Icelandic page is scraped; the English one lags behind.
 */
export function parseOnVerdskra(html: string): ScrapedReading[] {
	const $ = cheerio.load(html);
	let ac: ScrapedReading | undefined;
	let dc: ScrapedReading | undefined;
	$('div[data-framer-name="Row"]').each((_, row) => {
		const texts = $(row)
			.find('p.framer-text')
			.toArray()
			.map((el) => $(el).text().trim());
		if (texts.length === 0) return;
		const label = texts[0];
		if (label.includes('Vildarkjör')) return;
		const tariff = label.startsWith('Ferðahleðsla AC')
			? ('AC' as const)
			: label.startsWith('Hraðhleðsla DC')
				? ('DC' as const)
				: null;
		const energy = texts.find((t) => /kr\/kWh/.test(t));
		if (!tariff || !energy) return;
		const minute = texts.find((t) => /kr\/mín/.test(t));
		const fee = minute ? iskNumber(minute) : null;
		const reading: ScrapedReading = {
			tariffKey: tariff,
			priceIskPerKwh: iskNumber(energy),
			minuteFeeIsk: fee && fee > 0 ? fee : null,
			minuteFeeAfterMin: null
		};
		if (tariff === 'AC') ac ??= reading;
		else dc ??= reading;
	});
	if (!ac || !dc) {
		throw new Error(`ON parse failed: AC=${!!ac} DC=${!!dc} — did the verðskrá layout change?`);
	}
	return [ac, dc];
}

export const onScraper: Scraper = {
	id: 'on',
	async scrape() {
		const res = await fetch(ON_URL);
		if (!res.ok) throw new Error(`ON fetch failed: HTTP ${res.status}`);
		return { readings: parseOnVerdskra(await res.text()), warnings: [] };
	}
};
