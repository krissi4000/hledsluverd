import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { TariffKey } from '$lib/types';
import type { Db } from './client';
import { prices } from './schema';

export interface PriceReading {
	networkId: number;
	stationId?: number | null;
	tariffKey: TariffKey;
	priceIskPerKwh: number;
	minuteFeeIsk?: number | null;
	source: 'scraper' | 'manual';
}

const MIN_PLAUSIBLE = 10;
const MAX_PLAUSIBLE = 200;

export async function insertPriceIfChanged(
	db: Db,
	reading: PriceReading
): Promise<'inserted' | 'verified'> {
	if (reading.priceIskPerKwh < MIN_PLAUSIBLE || reading.priceIskPerKwh > MAX_PLAUSIBLE) {
		throw new Error(
			`Implausible price ${reading.priceIskPerKwh} ISK/kWh for network ${reading.networkId} ${reading.tariffKey} — treated as a parse error, not stored`
		);
	}

	// normalize to 2 decimals — derived scraper prices (VAT math etc.) must not create
	// spurious history rows via float noise
	const priceIskPerKwh = Math.round(reading.priceIskPerKwh * 100) / 100;
	const minuteFeeIsk =
		reading.minuteFeeIsk == null ? null : Math.round(reading.minuteFeeIsk * 100) / 100;

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
		(current.minuteFeeIsk ?? null) === minuteFeeIsk
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
		source: reading.source
	});
	return 'inserted';
}
