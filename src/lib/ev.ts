import type { ConnectorType } from '$lib/types';

/** What matching needs to know about a car (subset of a cars-table row). */
export interface CarSpec {
	acConnector: ConnectorType | null;
	maxAcKw: number | null;
	dcConnector: ConnectorType | null;
	maxDcKw: number | null;
}

export interface StationConnector {
	type: ConnectorType;
	powerKw: number;
}

/**
 * The car's plug for a charging mode: its AC plug for AC, its DC plug for DC.
 * The station list shows one price per mode, so a car only "fits" a station through
 * the plug that price applies to — a Leaf must not match a DC row via its Type2 socket.
 */
export function carPlugForMode(car: CarSpec, mode: 'AC' | 'DC'): ConnectorType | null {
	return mode === 'AC' ? car.acConnector : car.dcConnector;
}

/**
 * Effective charging speed at a station = max over matching connectors of
 * min(car max for that kind, connector power). A null car max (plug-type fallback,
 * or a dataset record without a DC spec) does not limit — the connector power counts.
 */
export function effectiveKw(car: CarSpec, connectors: StationConnector[]): number | null {
	let best: number | null = null;
	for (const c of connectors) {
		let carMax: number | null;
		if (c.type === car.dcConnector) carMax = car.maxDcKw;
		else if (c.type === car.acConnector) carMax = car.maxAcKw;
		else continue;
		const kw = Math.min(carMax ?? Infinity, c.powerKw);
		if (best === null || kw > best) best = kw;
	}
	return best;
}

// ── Session estimate: what a charge actually costs this car ──────────────────────────
//
// OpenEV Data has each car's peak DC power and usable battery size but no charging
// curve, so the average power over a session is a labelled approximation, never shown
// as exact (the UI prefixes it with "≈" and explains the assumption).

/** The session every estimate describes: 10 % → 80 % state of charge. */
export const SESSION_FROM_SOC = 0.1;
export const SESSION_TO_SOC = 0.8;

/**
 * DC: a car's average power from 10 to 80 % is roughly 60 % of its advertised peak —
 * the curve tapers well before 80 %. Coarse on purpose: real curves range from ~45 %
 * (early taper) to ~75 % (flat 800 V cars) of peak.
 */
export const DC_AVG_SHARE_OF_CAR_PEAK = 0.6;
/** DC: a charger slower than the car's curve delivers close to, not exactly, its rating. */
export const DC_AVG_SHARE_OF_CHARGER = 0.9;

/**
 * Approximate average power (kW) over a 10→80 % session.
 * - AC: the on-board charger draws flat up to 80 %, so min(car AC max, connector).
 * - DC: min(car peak × 0.6, charger × 0.9) — whichever end limits the session.
 * Null when the car's own max is unknown: the connector rating alone would be a guess.
 */
export function averageSessionKw(
	mode: 'AC' | 'DC',
	carMaxKw: number | null,
	connectorKw: number | null
): number | null {
	if (carMaxKw === null || !(carMaxKw > 0) || connectorKw === null || !(connectorKw > 0)) {
		return null;
	}
	if (mode === 'AC') return Math.min(carMaxKw, connectorKw);
	return Math.min(carMaxKw * DC_AVG_SHARE_OF_CAR_PEAK, connectorKw * DC_AVG_SHARE_OF_CHARGER);
}

export interface TariffForSession {
	priceIskPerKwh: number;
	minuteFeeIsk: number | null;
	/** minutes before the fee starts; null/0 = from the first minute */
	minuteFeeAfterMin: number | null;
}

export interface SessionEstimate {
	/** kWh delivered for 10→80 % (charging losses not included) */
	energyKwh: number;
	/** session length at the approximate average power */
	minutes: number;
	/** minutes the per-minute fee is charged for */
	feeMinutes: number;
	costIsk: number;
	/** costIsk / energyKwh: the kWh price with per-minute fees folded in */
	effectivePerKwh: number;
}

/**
 * Cost of a 10→80 % charge: energy × price + per-minute fee × billed minutes.
 * A fee from minute 0 is billed for the whole session; a fee after N minutes
 * (idle/overstay fee) only for the minutes past N — and nothing if the session is shorter.
 * Null when any input it needs is missing or nonsensical — show nothing, never a guess.
 */
export function estimateSession(
	tariff: TariffForSession,
	avgKw: number | null,
	batteryNetKwh: number | null
): SessionEstimate | null {
	if (avgKw === null || !(avgKw > 0)) return null;
	if (batteryNetKwh === null || !(batteryNetKwh > 0)) return null;
	if (!(tariff.priceIskPerKwh >= 0)) return null;
	const energyKwh = batteryNetKwh * (SESSION_TO_SOC - SESSION_FROM_SOC);
	const minutes = (energyKwh / avgKw) * 60;
	const fee = tariff.minuteFeeIsk ?? 0;
	const after = tariff.minuteFeeAfterMin ?? 0;
	const feeMinutes = fee > 0 ? Math.max(0, minutes - after) : 0;
	const costIsk = energyKwh * tariff.priceIskPerKwh + fee * feeMinutes;
	return { energyKwh, minutes, feeMinutes, costIsk, effectivePerKwh: costIsk / energyKwh };
}

/**
 * kr/kWh with per-minute fees folded in. Without any fee it is the raw price, exactly.
 * A fee from minute 0 costs fee × 60 / avgKw per kWh whatever the battery size; an
 * after-N-minutes fee depends on how long the session runs, so it needs the battery.
 * Null = can't say honestly (unknown power, or an idle fee with unknown session length).
 */
export function effectivePricePerKwh(
	tariff: TariffForSession,
	avgKw: number | null,
	batteryNetKwh: number | null
): number | null {
	const fee = tariff.minuteFeeIsk ?? 0;
	if (!(fee > 0)) return tariff.priceIskPerKwh;
	if (avgKw === null || !(avgKw > 0)) return null;
	if (!tariff.minuteFeeAfterMin) return tariff.priceIskPerKwh + (fee * 60) / avgKw;
	return estimateSession(tariff, avgKw, batteryNetKwh)?.effectivePerKwh ?? null;
}

/** Best connector rating among the given ones (the car picks the fastest plug that fits). */
export function maxConnectorKw(connectors: StationConnector[]): number | null {
	return connectors.length ? Math.max(...connectors.map((c) => c.powerKw)) : null;
}

export interface CarStationEstimate {
	/** kr/kWh with per-minute fees folded in; null = a fee exists but can't be priced */
	effectivePrice: number | null;
	/** true when effectivePrice rests on the power approximation (a fee was folded in) */
	effectiveApprox: boolean;
	/** 10→80 % cost; null without battery size or power data */
	session: { costIsk: number; minutes: number } | null;
}

/**
 * What the chosen car pays at a station: `connectors` are the station's connectors
 * for the car's plug in this mode, `tariff` the price the row shows (null = unknown,
 * then there is nothing to estimate).
 */
export function carStationEstimate(
	mode: 'AC' | 'DC',
	car: CarSpec & { batteryNetKwh: number | null },
	connectors: StationConnector[],
	tariff: TariffForSession | null
): CarStationEstimate | null {
	if (!tariff) return null;
	const avgKw = averageSessionKw(
		mode,
		mode === 'AC' ? car.maxAcKw : car.maxDcKw,
		maxConnectorKw(connectors)
	);
	const session = estimateSession(tariff, avgKw, car.batteryNetKwh);
	return {
		effectivePrice: effectivePricePerKwh(tariff, avgKw, car.batteryNetKwh),
		effectiveApprox: (tariff.minuteFeeIsk ?? 0) > 0,
		session: session && { costIsk: session.costIsk, minutes: session.minutes }
	};
}
