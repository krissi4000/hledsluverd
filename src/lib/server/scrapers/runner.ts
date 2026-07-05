import { desc, eq } from 'drizzle-orm';
import { insertPriceIfChanged } from '../db/prices';
import { networks, scrapeRuns } from '../db/schema';
import type { Db } from '../db/client';
import type { Scraper } from './types';

export interface RunnerOptions {
	/** ntfy.sh topic for failure alerts; unset = no notifications */
	ntfyTopic?: string;
	/** injectable for tests */
	notify?: (topic: string, message: string) => Promise<void>;
}

export interface RunSummary {
	networkSlug: string;
	status: 'ok' | 'changed' | 'failed';
	message: string;
}

async function ntfy(topic: string, message: string): Promise<void> {
	await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, { method: 'POST', body: message });
}

/**
 * Runs every network's scraper sequentially, isolated: one broken scraper never
 * blocks the others, and a failure leaves the previous price standing (correct
 * behavior — better stale than wrong). Every run is logged to scrape_runs; the
 * 3rd consecutive failure for a network triggers a single ntfy push.
 */
export async function runScrapers(
	db: Db,
	scrapers: Scraper[],
	opts: RunnerOptions = {}
): Promise<RunSummary[]> {
	const notify = opts.notify ?? ntfy;
	const byId = new Map(scrapers.map((s) => [s.id, s]));
	const nets = (await db.select().from(networks)).filter((n) => n.scraperId !== null);
	const summaries: RunSummary[] = [];
	for (const net of nets) {
		let status: RunSummary['status'];
		let message: string;
		try {
			const scraper = byId.get(net.scraperId!);
			if (!scraper) throw new Error(`no scraper module registered for '${net.scraperId}'`);
			const { readings, warnings } = await scraper.scrape(db);
			if (readings.length === 0) throw new Error('scraper returned no readings');
			let inserted = 0;
			let verified = 0;
			for (const r of readings) {
				const res = await insertPriceIfChanged(db, { ...r, networkId: net.id, source: 'scraper' });
				if (res === 'inserted') inserted++;
				else verified++;
			}
			status = inserted > 0 ? 'changed' : 'ok';
			message =
				`${inserted} inserted, ${verified} verified` +
				(warnings.length ? `; ${warnings.join(' | ')}` : '');
		} catch (e) {
			status = 'failed';
			message = e instanceof Error ? e.message : String(e);
		}
		await db.insert(scrapeRuns).values({ networkId: net.id, status, message });
		summaries.push({ networkSlug: net.slug, status, message });

		if (status === 'failed' && opts.ntfyTopic) {
			const last = await db
				.select()
				.from(scrapeRuns)
				.where(eq(scrapeRuns.networkId, net.id))
				.orderBy(desc(scrapeRuns.startedAt), desc(scrapeRuns.id))
				.limit(4);
			let streak = 0;
			for (const run of last) {
				if (run.status !== 'failed') break;
				streak++;
			}
			// exactly 3: alert once when the streak starts, not on every later run
			if (streak === 3) {
				try {
					await notify(
						opts.ntfyTopic,
						`${net.name}: skrapari hefur brugðist 3 keyrslur í röð — ${message}`
					);
				} catch {
					// alerting must never break the run loop
				}
			}
		}
	}
	return summaries;
}
