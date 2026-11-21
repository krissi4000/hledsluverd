// Where each network's price comes from, for the /um (about) page. Derived from the
// networks table: a network with a scraper_id is scraped hourly by that module
// (scripts/scrape.ts on hledsluverd-scrape.timer), the rest are entered in /admin.

/** The public page (or platform) each scraper reads, keyed by Scraper.id.
 * price-sources.test.ts checks this stays in step with the registered scrapers. */
export const SCRAPER_SOURCE_URLS: Record<string, string> = {
	on: 'https://www.on.is/verdskrar',
	isorka: 'https://isorka.poweredbyvirta.com',
	n1: 'https://n1.is/is/eldsneytisverd',
	orkan: 'https://www.orkan.is/orkustodvar/'
};

export interface PriceSource {
	name: string;
	slug: string;
	websiteUrl: string | null;
	method: 'scraped' | 'manual';
	/** what the scraper reads; null for manual networks */
	sourceUrl: string | null;
}

export function priceSources(
	nets: { name: string; slug: string; websiteUrl: string | null; scraperId: string | null }[],
	/** registered scraper ids — defaults to the keys above, which the test ties to allScrapers
	 * (importing allScrapers here would pull Playwright into the web server) */
	scraperIds: readonly string[] = Object.keys(SCRAPER_SOURCE_URLS)
): PriceSource[] {
	return nets
		.map((n) => {
			const scraped = n.scraperId !== null && scraperIds.includes(n.scraperId);
			return {
				name: n.name,
				slug: n.slug,
				websiteUrl: n.websiteUrl,
				method: scraped ? ('scraped' as const) : ('manual' as const),
				sourceUrl: scraped ? (SCRAPER_SOURCE_URLS[n.scraperId!] ?? n.websiteUrl) : null
			};
		})
		.sort(
			(a, b) =>
				(a.method === b.method ? 0 : a.method === 'scraped' ? -1 : 1) ||
				a.name.localeCompare(b.name, 'is')
		);
}
