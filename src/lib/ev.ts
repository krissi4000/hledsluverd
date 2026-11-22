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
// The car data (seeds/cars.json) has each car's peak DC power and usable battery size
// but no charging curve, so the average power over a session is a labelled
// approximation, never shown as exact (the UI prefixes it with "≈" and explains the
// assumption).

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
	batteryKwh: number | null
): SessionEstimate | null {
	if (avgKw === null || !(avgKw > 0)) return null;
	if (batteryKwh === null || !(batteryKwh > 0)) return null;
	if (!(tariff.priceIskPerKwh >= 0)) return null;
	const energyKwh = batteryKwh * (SESSION_TO_SOC - SESSION_FROM_SOC);
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
	batteryKwh: number | null
): number | null {
	const fee = tariff.minuteFeeIsk ?? 0;
	if (!(fee > 0)) return tariff.priceIskPerKwh;
	if (avgKw === null || !(avgKw > 0)) return null;
	if (!tariff.minuteFeeAfterMin) return tariff.priceIskPerKwh + (fee * 60) / avgKw;
	return estimateSession(tariff, avgKw, batteryKwh)?.effectivePerKwh ?? null;
}

/**
 * The connectors a charge in this mode would use when no car is chosen: the mode's
 * (AC → Type2, DC → the rest), narrowed to the plug filter when that leaves any.
 */
export function modeConnectors<T extends StationConnector>(
	connectors: T[],
	mode: 'AC' | 'DC',
	plug: ConnectorType | null
): T[] {
	const ofMode = connectors.filter((c) => (mode === 'AC') === (c.type === 'Type2'));
	const ofPlug = plug ? ofMode.filter((c) => c.type === plug) : [];
	return ofPlug.length ? ofPlug : ofMode;
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
	car: CarSpec & { batteryKwh: number | null },
	connectors: StationConnector[],
	tariff: TariffForSession | null
): CarStationEstimate | null {
	if (!tariff) return null;
	const avgKw = averageSessionKw(
		mode,
		mode === 'AC' ? car.maxAcKw : car.maxDcKw,
		maxConnectorKw(connectors)
	);
	const session = estimateSession(tariff, avgKw, car.batteryKwh);
	return {
		effectivePrice: effectivePricePerKwh(tariff, avgKw, car.batteryKwh),
		effectiveApprox: (tariff.minuteFeeIsk ?? 0) > 0,
		session: session && { costIsk: session.costIsk, minutes: session.minutes }
	};
}

// ── Full charge: what the "Nálægt mér" list shows and ranks ──────────────────────────
//
// The nearby list prices a charge from empty to full (0 → 100 %). Same caveat as the
// 10→80 % estimate: there are no charging curves, so the time comes from ONE average
// power for the whole charge. The UI marks it "≈" and explains why it is an average.

/**
 * DC, 0→100 %: a car or charger rarely holds its rated power for the whole charge,
 * so neither counts for more than 80 % of its rating on average.
 */
export const FULL_DC_SHARE_OF_RATING = 0.8;
/**
 * DC, 0→100 %: the slow last 20 % means a full DC charge takes about an hour whatever
 * the car's peak (77 kWh at 233 kW ≈ 50–60 min, 40 kWh at 50 kW ≈ 60–70 min), i.e.
 * an average of about 1.1 kW per kWh of battery. This cap is what keeps a fast car's
 * full charge from looking like 20 minutes.
 */
export const FULL_DC_KW_PER_BATTERY_KWH = 1.1;
/** AC without a chosen car: the most common on-board charger. A 22 kW post charges
 * most cars at 11 kW. */
export const TYPICAL_AC_ONBOARD_KW = 11;
/**
 * Energy lost between the charger's meter (what is billed) and the battery: heat in
 * the cable, the car's charger and the battery. Typical figures, they vary with the
 * car and the weather. AC goes through the car's own charger, so it loses more.
 */
export const CHARGING_LOSS: Record<'AC' | 'DC', number> = { AC: 0.12, DC: 0.08 };

/**
 * What sets the average power of a full charge, i.e. why it takes as long as it does:
 * - `station`: the charger's rating
 * - `car`: the car's peak (DC) or its on-board charger (AC)
 * - `battery`: DC only, the slowing as the battery fills (FULL_DC_KW_PER_BATTERY_KWH)
 * - `onboard`: AC without a car, the assumed TYPICAL_AC_ONBOARD_KW
 */
export type FullChargeLimit = 'station' | 'car' | 'battery' | 'onboard';

export interface FullChargeSpeed {
	/** the one average power the estimate rests on */
	avgKw: number;
	limit: FullChargeLimit;
	/** the charger's rating */
	stationKw: number;
	/** the car's DC peak or AC on-board charger; null without a car */
	carKw: number | null;
}

/**
 * Approximate average power (kW) over a 0→100 % charge, and what sets it.
 * - AC: flat at min(car on-board charger, connector); 11 kW stands in for an unknown car.
 * - DC: min(car peak × 0.8, charger × 0.8, battery kWh × 1.1). Without the car's peak
 *   (only a battery size was given) the battery cap and the charger decide.
 * Null without a connector rating or a battery size.
 */
export function fullChargeSpeed(
	mode: 'AC' | 'DC',
	carMaxKw: number | null,
	connectorKw: number | null,
	batteryKwh: number | null
): FullChargeSpeed | null {
	if (connectorKw === null || !(connectorKw > 0)) return null;
	if (batteryKwh === null || !(batteryKwh > 0)) return null;
	const carKw = carMaxKw !== null && carMaxKw > 0 ? carMaxKw : null;
	const speed = (avgKw: number, limit: FullChargeLimit): FullChargeSpeed => ({
		avgKw,
		limit,
		stationKw: connectorKw,
		carKw
	});
	if (mode === 'AC') {
		const onboard = carKw ?? TYPICAL_AC_ONBOARD_KW;
		if (connectorKw <= onboard) return speed(connectorKw, 'station');
		return speed(onboard, carKw !== null ? 'car' : 'onboard');
	}
	const byStation = connectorKw * FULL_DC_SHARE_OF_RATING;
	const byCar = carKw !== null ? carKw * FULL_DC_SHARE_OF_RATING : Infinity;
	const byBattery = batteryKwh * FULL_DC_KW_PER_BATTERY_KWH;
	const avgKw = Math.min(byStation, byCar, byBattery);
	return speed(avgKw, avgKw === byStation ? 'station' : avgKw === byCar ? 'car' : 'battery');
}

// ── An ordinary visit: what the nearby list ranks by ─────────────────────────────────
//
// Most visitors top up; they don't charge from empty to full. So the nearby ranking
// compares what every visit pays per kWh, not the cost of a full charge.

/**
 * Average power of an ordinary visit, for spreading a per-minute fee over the kWh it
 * buys: fullChargeSpeed's assumptions without the slow last 20 %, which a top-up stops
 * short of. Null without a connector rating.
 */
export function visitKw(
	mode: 'AC' | 'DC',
	carMaxKw: number | null,
	connectorKw: number | null
): number | null {
	if (connectorKw === null || !(connectorKw > 0)) return null;
	const carKw = carMaxKw !== null && carMaxKw > 0 ? carMaxKw : null;
	if (mode === 'AC') return Math.min(connectorKw, carKw ?? TYPICAL_AC_ONBOARD_KW);
	return Math.min(connectorKw, carKw ?? Infinity) * FULL_DC_SHARE_OF_RATING;
}

/**
 * kr/kWh every visit pays: the kWh price, plus a per-minute fee that runs from the first
 * minute, spread over the kWh bought at `kw`. A fee that only starts after N minutes (an
 * overstay fee) is left out: a top-up is over before it starts, and the card says it.
 * Without a speed to spread a from-the-start fee over, the bare price stands.
 */
export function visitPricePerKwh(tariff: TariffForSession, kw: number | null): number {
	if (tariff.minuteFeeAfterMin) return tariff.priceIskPerKwh;
	return effectivePricePerKwh(tariff, kw, null) ?? tariff.priceIskPerKwh;
}

export interface FullChargeEstimate {
	mode: 'AC' | 'DC';
	/** usable battery, kWh: what goes into the battery from 0 to 100 % */
	batteryKwh: number;
	/** charging losses as a share of the battery energy (0.08 = 8 %) */
	loss: number;
	/** kWh the charger meters and bills: the battery plus charging losses */
	billedKwh: number;
	/** the one average power the whole estimate rests on */
	avgKw: number;
	minutes: number;
	priceIskPerKwh: number;
	minuteFeeIsk: number | null;
	/** minute the per-minute fee starts (0 = from the first minute); null = no fee */
	feeFromMin: number | null;
	/** minutes the per-minute fee is charged for */
	feeMinutes: number;
	energyIsk: number;
	feeIsk: number;
	costIsk: number;
}

/**
 * Cost of a 0→100 % charge: billed kWh × price + per-minute fee × billed minutes.
 * The time is billed kWh / average kW. Null when any input is missing — show
 * "unknown", never a guess.
 */
export function estimateFullCharge(
	mode: 'AC' | 'DC',
	tariff: TariffForSession,
	avgKw: number | null,
	batteryKwh: number | null
): FullChargeEstimate | null {
	if (avgKw === null || !(avgKw > 0)) return null;
	if (batteryKwh === null || !(batteryKwh > 0)) return null;
	if (!(tariff.priceIskPerKwh >= 0)) return null;
	const loss = CHARGING_LOSS[mode];
	const billedKwh = batteryKwh * (1 + loss);
	const minutes = (billedKwh / avgKw) * 60;
	const fee = tariff.minuteFeeIsk ?? 0;
	const feeFromMin = fee > 0 ? (tariff.minuteFeeAfterMin ?? 0) : null;
	const feeMinutes = feeFromMin === null ? 0 : Math.max(0, minutes - feeFromMin);
	const energyIsk = billedKwh * tariff.priceIskPerKwh;
	const feeIsk = fee * feeMinutes;
	return {
		mode,
		batteryKwh,
		loss,
		billedKwh,
		avgKw,
		minutes,
		priceIskPerKwh: tariff.priceIskPerKwh,
		minuteFeeIsk: fee > 0 ? fee : null,
		feeFromMin,
		feeMinutes,
		energyIsk,
		feeIsk,
		costIsk: energyIsk + feeIsk
	};
}
