import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { TariffKey } from '$lib/types';
import type { Db } from './client';
import { prices } from './schema';

export interface PriceReading {
	networkId: number;
	stationId?: number | null;
	tariffKey: TariffKey;
	priceIskPerKwh: number;
	/**
	 * Omitted/null means the network charges no minute fee — not "unknown".
	 * Scrapers must always pass the full reading: leaving this out when the
	 * network has a fee writes a new history row that erases the fee.
	 */
	minuteFeeIsk?: number | null;
	/** Minutes of charging before minuteFeeIsk applies; null = from the first minute. */
	minuteFeeAfterMin?: number | null;
	source: 'scraper' | 'manual';
}

const MIN_PLAUSIBLE = 10;
const MAX_PLAUSIBLE = 200;

export function isPlausibleKwhPrice(n: number): boolean {
	return Number.isFinite(n) && n >= MIN_PLAUSIBLE && n <= MAX_PLAUSIBLE;
}

/**
 * The single price-write path (Phase 2 scrapers call this exact function).
 * Changed value → new history row; unchanged → bump verified_at only.
 * Assumes a single sequential writer per (network, tariff, station);
 * concurrent writers may create duplicate history rows.
 */
export async function insertPriceIfChanged(
	db: Db,
	reading: PriceReading
): Promise<'inserted' | 'verified'> {
	if (
		!Number.isFinite(reading.priceIskPerKwh) ||
		reading.priceIskPerKwh < MIN_PLAUSIBLE ||
		reading.priceIskPerKwh > MAX_PLAUSIBLE
	) {
		throw new Error(
			`Implausible price ${reading.priceIskPerKwh} ISK/kWh for network ${reading.networkId} ${reading.tariffKey} — treated as a parse error, not stored`
		);
	}
	if (reading.minuteFeeIsk != null && !Number.isFinite(reading.minuteFeeIsk)) {
		throw new Error(
			`Implausible minute fee ${reading.minuteFeeIsk} ISK for network ${reading.networkId} ${reading.tariffKey} — treated as a parse error, not stored`
		);
	}
	if (
		reading.minuteFeeAfterMin != null &&
		(!Number.isInteger(reading.minuteFeeAfterMin) || reading.minuteFeeAfterMin < 0)
	) {
		throw new Error(
			`Implausible fee-free period ${reading.minuteFeeAfterMin} min for network ${reading.networkId} ${reading.tariffKey} — treated as a parse error, not stored`
		);
	}

	// normalize to 2 decimals — derived scraper prices (VAT math etc.) must not create
	// spurious history rows via float noise
	const priceIskPerKwh = Math.round(reading.priceIskPerKwh * 100) / 100;
	const minuteFeeIsk =
		reading.minuteFeeIsk == null ? null : Math.round(reading.minuteFeeIsk * 100) / 100;
	const minuteFeeAfterMin = reading.minuteFeeAfterMin ?? null;

	const stationCond =
		reading.stationId == null ? isNull(prices.stationId) : eq(prices.stationId, reading.stationId);

	const [current] = await db
		.select()
		.from(prices)
		.where(
			and(
				eq(prices.networkId, reading.networkId),
				eq(prices.tariffKey, reading.tariffKey),
				stationCond
			)
		)
		.orderBy(desc(prices.validFrom), desc(prices.id))
		.limit(1);

	if (
		current &&
		current.priceIskPerKwh === priceIskPerKwh &&
		(current.minuteFeeIsk ?? null) === minuteFeeIsk &&
		(current.minuteFeeAfterMin ?? null) === minuteFeeAfterMin
	) {
		await db
			.update(prices)
			.set({ verifiedAt: sql`now()` })
			.where(eq(prices.id, current.id));
		return 'verified';
	}

	await db.insert(prices).values({
		networkId: reading.networkId,
		stationId: reading.stationId ?? null,
		tariffKey: reading.tariffKey,
		priceIskPerKwh,
		minuteFeeIsk,
		minuteFeeAfterMin,
		source: reading.source
	});
	return 'inserted';
}
