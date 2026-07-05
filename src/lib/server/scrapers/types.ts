import type { TariffKey } from '$lib/types';
import type { Db } from '../db/client';

export interface ScrapedReading {
	/** our stations.id; omitted = network-wide price */
	stationId?: number;
	tariffKey: TariffKey;
	priceIskPerKwh: number;
	minuteFeeIsk?: number | null;
	minuteFeeAfterMin?: number | null;
}

export interface ScrapeResult {
	readings: ScrapedReading[];
	/** non-fatal oddities (unmatched stations, skipped rows) — end up in scrape_runs.message */
	warnings: string[];
}

/**
 * One module per network. Fail loudly, never guess: a scraper that cannot
 * confidently parse must THROW — the runner records a failed run and yesterday's
 * price stays in place. Returning a guessed price is the one unforgivable failure.
 */
export interface Scraper {
	/** must equal networks.scraper_id */
	id: string;
	scrape(db: Db): Promise<ScrapeResult>;
}
