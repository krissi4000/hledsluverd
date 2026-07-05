import * as cheerio from 'cheerio';
import { eq } from 'drizzle-orm';
import { networks, stations } from '../db/schema';
import type { ScrapedReading, Scraper } from './types';

export const ORKAN_URL = 'https://www.orkan.is/orkustodvar/';

/**
 * orkan.is is Blazor Server: prices stream over a websocket after page load,
 * raw HTML is an empty shell (Googlebot-SSR stopped including the table in
 * 2025 — see gasvaktin/gasvaktin#16, which scrapes it the same way). Only the
 * fetch needs a browser; parsing stays fixture-tested cheerio. Markup is full
 * of Blazor <!--!--> comment nodes — DOM queries, never regex on raw text.
 */
export function parseOrkanPrices(html: string): { name: string; priceIskPerKwh: number }[] {
	const $ = cheerio.load(html);
	const out: { name: string; priceIskPerKwh: number }[] = [];
	$('.prices__card').each((_, card) => {
		if ($(card).find('.prices__card-content.heading').length > 0) return; // column-header card
		const name = $(card).find('.prices__card-heading div').first().text().trim();
		if (!name) return;
		$(card)
			.find('.prices__card-content > div')
			.each((__, cell) => {
				const heading = $(cell).find('.prices__price-heading').text().trim();
				if (heading !== 'Rafmagn') return; // columns move around — match by label, never index
				const value = $(cell).find('.prices__price-value').text().trim();
				if (!value || value === '-') return;
				const price = parseFloat(value.replace(',', '.'));
				if (Number.isFinite(price)) out.push({ name, priceIskPerKwh: price });
			});
	});
	return out;
}

export async function fetchOrkanHtml(): Promise<string> {
	const { chromium } = await import('playwright'); // lazy: only Orkan needs a browser
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		await page.goto(ORKAN_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
		// content arrives over the Blazor websocket seconds later — wait for real cells
		await page.waitForSelector(
			'.prices__list .prices__card-content:not(.heading) .prices__price-value',
			{ timeout: 30_000 }
		);
		return await page.$eval('.prices__list', (el) => el.outerHTML);
	} finally {
		await browser.close();
	}
}

const norm = (s: string) => s.toLowerCase().normalize('NFC').trim();

/**
 * Price-table names are bare place names, sometimes compound ("Austurmörk, Hveragerði");
 * ours carry "(Orkan)" and OCM addresses. Try the full name, then comma-separated
 * tokens (street before town), first candidate with any hit wins.
 */
export function matchOrkanStations<T extends { name: string; address: string | null }>(
	rowName: string,
	sts: T[]
): T[] {
	const full = norm(rowName);
	const candidates = [full, ...full.split(/\s*,\s*/).filter((t) => t.length >= 4)];
	for (const token of candidates) {
		const matches = sts.filter(
			(s) => norm(s.name).includes(token) || norm(s.address ?? '').includes(token)
		);
		if (matches.length > 0) return matches;
	}
	return [];
}

export const orkanScraper: Scraper = {
	id: 'orkan',
	async scrape(db) {
		const rows = parseOrkanPrices(await fetchOrkanHtml());
		if (rows.length === 0) throw new Error('Orkan parse: no Rafmagn rows — layout changed?');
		const [net] = await db.select().from(networks).where(eq(networks.slug, 'orkan'));
		if (!net) throw new Error('orkan network missing');
		const sts = await db.select().from(stations).where(eq(stations.networkId, net.id));
		const readings: ScrapedReading[] = [];
		const warnings: string[] = [];
		const matchedStations = new Set<number>();
		for (const row of rows) {
			const matches = matchOrkanStations(row.name, sts);
			if (matches.length === 0) {
				warnings.push(`óþekkt stöð í verðtöflu: ${row.name}`);
				continue;
			}
			for (const s of matches) {
				matchedStations.add(s.id);
				readings.push({
					stationId: s.id,
					tariffKey: 'DC',
					priceIskPerKwh: row.priceIskPerKwh,
					// biðgjald: after 60 min of charging, each minute costs one kWh price
					// (published prose on https://www.orkan.is/rafmagn/, 2026-07-05)
					minuteFeeIsk: row.priceIskPerKwh,
					minuteFeeAfterMin: 60
				});
			}
		}
		for (const s of sts) {
			if (!matchedStations.has(s.id)) warnings.push(`${s.name}: ekki í verðtöflu Orkunnar`);
		}
		return { readings, warnings };
	}
};
