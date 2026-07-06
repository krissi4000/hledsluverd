import { desc, eq, sql } from 'drizzle-orm';
import { TARIFF_KEYS, type TariffKey } from '$lib/types';
import type { Db } from './db/client';
import { insertPriceIfChanged } from './db/prices';
import { networks, prices, scrapeRuns, stations } from './db/schema';

export interface AdminResult {
	ok: boolean;
	error?: string;
}

/** "0,5" → 0.5; empty/missing → null; garbage → NaN (caller rejects) */
function num(v: FormDataEntryValue | null): number | null {
	if (typeof v !== 'string' || v.trim() === '') return null;
	return parseFloat(v.trim().replace(',', '.'));
}

export async function submitManualPrice(db: Db, form: FormData): Promise<AdminResult> {
	const networkId = num(form.get('networkId'));
	const stationId = num(form.get('stationId'));
	const tariffKey = String(form.get('tariffKey') ?? '');
	const price = num(form.get('price'));
	const minuteFee = num(form.get('minuteFee'));
	const minuteFeeAfterMin = num(form.get('minuteFeeAfterMin'));
	if (
		networkId === null ||
		!Number.isInteger(networkId) ||
		!(TARIFF_KEYS as readonly string[]).includes(tariffKey) ||
		price === null ||
		Number.isNaN(price)
	) {
		return { ok: false, error: 'ógilt form' };
	}
	try {
		await insertPriceIfChanged(db, {
			networkId,
			stationId: stationId === null ? null : stationId,
			tariffKey: tariffKey as TariffKey,
			priceIskPerKwh: price,
			minuteFeeIsk: minuteFee,
			minuteFeeAfterMin: minuteFeeAfterMin === null ? null : Math.round(minuteFeeAfterMin),
			source: 'manual'
		});
		return { ok: true };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

export async function bumpVerified(db: Db, priceId: number): Promise<AdminResult> {
	const rows = await db
		.update(prices)
		.set({ verifiedAt: sql`now()` })
		.where(eq(prices.id, priceId))
		.returning({ id: prices.id });
	return rows.length === 1 ? { ok: true } : { ok: false, error: 'verðfærsla fannst ekki' };
}

export async function setStationActive(
	db: Db,
	stationId: number,
	isActive: boolean
): Promise<AdminResult> {
	const rows = await db
		.update(stations)
		.set({ isActive })
		.where(eq(stations.id, stationId))
		.returning({ id: stations.id });
	return rows.length === 1 ? { ok: true } : { ok: false, error: 'stöð fannst ekki' };
}

export interface ScraperHealthEntry {
	networkSlug: string;
	networkName: string;
	lastStatus: 'ok' | 'changed' | 'failed' | null;
	lastRunAt: Date | null;
	lastMessage: string | null;
	consecutiveFailures: number;
}

export async function scraperHealth(db: Db): Promise<ScraperHealthEntry[]> {
	const nets = (await db.select().from(networks)).filter((n) => n.scraperId !== null);
	const out: ScraperHealthEntry[] = [];
	for (const net of nets) {
		const runs = await db
			.select()
			.from(scrapeRuns)
			.where(eq(scrapeRuns.networkId, net.id))
			.orderBy(desc(scrapeRuns.startedAt), desc(scrapeRuns.id))
			.limit(50);
		let consecutiveFailures = 0;
		for (const r of runs) {
			if (r.status !== 'failed') break;
			consecutiveFailures++;
		}
		out.push({
			networkSlug: net.slug,
			networkName: net.name,
			lastStatus: runs[0]?.status ?? null,
			lastRunAt: runs[0]?.startedAt ?? null,
			lastMessage: runs[0]?.message ?? null,
			consecutiveFailures
		});
	}
	return out.sort((a, b) => a.networkName.localeCompare(b.networkName, 'is'));
}
