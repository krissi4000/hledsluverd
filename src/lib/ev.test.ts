import { describe, expect, it } from 'vitest';
import {
	averageSessionKw,
	carPlugForMode,
	carStationEstimate,
	effectiveKw,
	effectivePricePerKwh,
	estimateFullCharge,
	estimateSession,
	fullChargeSpeed,
	maxConnectorKw,
	modeConnectors,
	type CarSpec
} from './ev';

const leaf: CarSpec = { acConnector: 'Type2', maxAcKw: 6.6, dcConnector: 'CHAdeMO', maxDcKw: 50 };
const id4: CarSpec = { acConnector: 'Type2', maxAcKw: 11, dcConnector: 'CCS2', maxDcKw: 135 };

describe('carPlugForMode', () => {
	it('uses the DC plug for DC and the AC plug for AC', () => {
		expect(carPlugForMode(leaf, 'DC')).toBe('CHAdeMO');
		expect(carPlugForMode(leaf, 'AC')).toBe('Type2');
		expect(carPlugForMode(id4, 'DC')).toBe('CCS2');
	});

	it('is null when the car has no plug for that mode', () => {
		const acOnly: CarSpec = { acConnector: 'Type2', maxAcKw: 7, dcConnector: null, maxDcKw: null };
		expect(carPlugForMode(acOnly, 'DC')).toBeNull();
	});
});

describe('effectiveKw', () => {
	it('is limited by the car when the connector is faster', () => {
		expect(effectiveKw(id4, [{ type: 'CCS2', powerKw: 300 }])).toBe(135);
	});

	it('is limited by the connector when the car is faster', () => {
		expect(effectiveKw(id4, [{ type: 'CCS2', powerKw: 60 }])).toBe(60);
	});

	it('takes the best matching connector and ignores the rest', () => {
		expect(
			effectiveKw(leaf, [
				{ type: 'Type2', powerKw: 22 },
				{ type: 'CHAdeMO', powerKw: 50 },
				{ type: 'CCS2', powerKw: 300 }
			])
		).toBe(50);
	});

	it('plug-type fallback (null car max) yields the connector power', () => {
		const plugOnly: CarSpec = {
			acConnector: null,
			maxAcKw: null,
			dcConnector: 'CCS2',
			maxDcKw: null
		};
		expect(effectiveKw(plugOnly, [{ type: 'CCS2', powerKw: 150 }])).toBe(150);
	});

	it('returns null when nothing matches', () => {
		expect(effectiveKw(leaf, [{ type: 'CCS2', powerKw: 150 }])).toBeNull();
	});
});

describe('averageSessionKw', () => {
	it('AC: flat at min(car on-board charger, connector)', () => {
		expect(averageSessionKw('AC', 11, 22)).toBe(11);
		expect(averageSessionKw('AC', 22, 7.4)).toBe(7.4);
	});

	it('DC: car-limited at 60 % of the car peak', () => {
		expect(averageSessionKw('DC', 135, 300)).toBeCloseTo(81);
	});

	it('DC: charger-limited at 90 % of the charger rating', () => {
		expect(averageSessionKw('DC', 250, 50)).toBeCloseTo(45);
	});

	it('is null without a car max or connector power (no guessing)', () => {
		expect(averageSessionKw('DC', null, 150)).toBeNull();
		expect(averageSessionKw('DC', 150, null)).toBeNull();
		expect(averageSessionKw('AC', 0, 22)).toBeNull();
	});
});

describe('estimateSession', () => {
	const flat = { priceIskPerKwh: 50, minuteFeeIsk: null, minuteFeeAfterMin: null };

	it('charges 70 % of the usable battery and times it at the average power', () => {
		const e = estimateSession(flat, 50, 75)!;
		expect(e.energyKwh).toBeCloseTo(52.5);
		expect(e.minutes).toBeCloseTo(63);
		expect(e.feeMinutes).toBe(0);
		expect(e.costIsk).toBeCloseTo(2625);
		expect(e.effectivePerKwh).toBeCloseTo(50);
	});

	it('bills a fee from minute 0 for the whole session', () => {
		const e = estimateSession({ ...flat, minuteFeeIsk: 0.5 }, 50, 75)!;
		expect(e.feeMinutes).toBeCloseTo(63);
		expect(e.costIsk).toBeCloseTo(2625 + 31.5);
	});

	it('bills an after-N-minutes fee only past N', () => {
		// 63 min session, fee after 60 → 3 billed minutes
		const e = estimateSession({ ...flat, minuteFeeIsk: 30, minuteFeeAfterMin: 60 }, 50, 75)!;
		expect(e.feeMinutes).toBeCloseTo(3);
		expect(e.costIsk).toBeCloseTo(2625 + 90);
	});

	it('bills nothing when the session ends before the idle fee starts', () => {
		const e = estimateSession({ ...flat, minuteFeeIsk: 30, minuteFeeAfterMin: 60 }, 100, 75)!;
		expect(e.minutes).toBeCloseTo(31.5);
		expect(e.feeMinutes).toBe(0);
		expect(e.effectivePerKwh).toBeCloseTo(50);
	});

	it('is null when the battery size or power is missing', () => {
		expect(estimateSession(flat, 50, null)).toBeNull();
		expect(estimateSession(flat, null, 75)).toBeNull();
		expect(estimateSession(flat, 50, 0)).toBeNull();
	});
});

describe('effectivePricePerKwh', () => {
	it('is exactly the raw price without a minute fee, even with no car data', () => {
		expect(
			effectivePricePerKwh(
				{ priceIskPerKwh: 45, minuteFeeIsk: null, minuteFeeAfterMin: null },
				null,
				null
			)
		).toBe(45);
		expect(
			effectivePricePerKwh(
				{ priceIskPerKwh: 45, minuteFeeIsk: 0, minuteFeeAfterMin: null },
				null,
				null
			)
		).toBe(45);
	});

	it('folds a from-minute-0 fee in as fee × 60 / kW, independent of the battery', () => {
		// 0,5 kr/mín at 30 kW → 1 kr/kWh
		const t = { priceIskPerKwh: 45, minuteFeeIsk: 0.5, minuteFeeAfterMin: null };
		expect(effectivePricePerKwh(t, 30, null)).toBeCloseTo(46);
		expect(effectivePricePerKwh(t, 30, 75)).toBeCloseTo(46);
		expect(effectivePricePerKwh({ ...t, minuteFeeAfterMin: 0 }, 30, null)).toBeCloseTo(46);
	});

	it('includes an idle fee only when the session outlasts its free minutes', () => {
		const t = { priceIskPerKwh: 40, minuteFeeIsk: 20, minuteFeeAfterMin: 60 };
		// AC 11 kW, 52,5 kWh → ~286 min, ~226 billed minutes
		expect(effectivePricePerKwh(t, 11, 75)).toBeCloseTo(40 + (20 * (286.36 - 60)) / 52.5, 1);
		// DC 100 kW → 31,5 min, nothing billed
		expect(effectivePricePerKwh(t, 100, 75)).toBe(40);
	});

	it('is null when a fee exists but the data to price it is missing', () => {
		expect(
			effectivePricePerKwh(
				{ priceIskPerKwh: 45, minuteFeeIsk: 0.5, minuteFeeAfterMin: null },
				null,
				75
			)
		).toBeNull();
		expect(
			effectivePricePerKwh(
				{ priceIskPerKwh: 40, minuteFeeIsk: 20, minuteFeeAfterMin: 60 },
				11,
				null
			)
		).toBeNull();
	});
});

describe('maxConnectorKw', () => {
	it('picks the fastest connector, null for none', () => {
		expect(
			maxConnectorKw([
				{ type: 'CCS2', powerKw: 50 },
				{ type: 'CCS2', powerKw: 150 }
			])
		).toBe(150);
		expect(maxConnectorKw([])).toBeNull();
	});
});

describe('carStationEstimate', () => {
	const car = { ...id4, batteryKwh: 77 };
	const ccs = [
		{ type: 'CCS2' as const, powerKw: 50 },
		{ type: 'CCS2' as const, powerKw: 150 }
	];

	it('is null when the station has no known price', () => {
		expect(carStationEstimate('DC', car, ccs, null)).toBeNull();
	});

	it('uses the fastest fitting connector and the car DC peak', () => {
		// avg = min(135 × 0.6, 150 × 0.9) = 81 kW; 53,9 kWh → ~39,9 min
		const e = carStationEstimate('DC', car, ccs, {
			priceIskPerKwh: 50,
			minuteFeeIsk: 0.5,
			minuteFeeAfterMin: null
		})!;
		expect(e.effectiveApprox).toBe(true);
		expect(e.effectivePrice).toBeCloseTo(50 + 30 / 81);
		expect(e.session!.minutes).toBeCloseTo((53.9 / 81) * 60);
		expect(e.session!.costIsk).toBeCloseTo(53.9 * 50 + 0.5 * ((53.9 / 81) * 60));
	});

	it('keeps the exact raw price but drops the cost without a battery size', () => {
		const e = carStationEstimate('DC', { ...car, batteryKwh: null }, ccs, {
			priceIskPerKwh: 50,
			minuteFeeIsk: null,
			minuteFeeAfterMin: null
		})!;
		expect(e).toEqual({ effectivePrice: 50, effectiveApprox: false, session: null });
	});

	it('uses the AC on-board charger limit in AC mode', () => {
		const e = carStationEstimate('AC', car, [{ type: 'Type2', powerKw: 22 }], {
			priceIskPerKwh: 30,
			minuteFeeIsk: null,
			minuteFeeAfterMin: null
		})!;
		expect(e.session!.minutes).toBeCloseTo((53.9 / 11) * 60);
	});
});

describe('modeConnectors', () => {
	const cons = [
		{ type: 'Type2' as const, powerKw: 22 },
		{ type: 'CCS2' as const, powerKw: 150 },
		{ type: 'CHAdeMO' as const, powerKw: 50 }
	];

	it('keeps the mode: Type2 for AC, the rest for DC', () => {
		expect(modeConnectors(cons, 'AC', null).map((c) => c.type)).toEqual(['Type2']);
		expect(modeConnectors(cons, 'DC', null).map((c) => c.type)).toEqual(['CCS2', 'CHAdeMO']);
	});

	it('narrows to the plug filter, but not to nothing', () => {
		expect(modeConnectors(cons, 'DC', 'CHAdeMO').map((c) => c.type)).toEqual(['CHAdeMO']);
		expect(modeConnectors(cons, 'DC', 'Type2').map((c) => c.type)).toEqual(['CCS2', 'CHAdeMO']);
	});
});

describe('fullChargeSpeed: average power', () => {
	const averageFullChargeKw = (...a: Parameters<typeof fullChargeSpeed>) =>
		fullChargeSpeed(...a)?.avgKw ?? null;

	it('AC: flat at min(on-board charger, connector)', () => {
		expect(averageFullChargeKw('AC', 11, 22, 77)).toBe(11);
		expect(averageFullChargeKw('AC', 22, 7.4, 77)).toBe(7.4);
	});

	it('AC without a car: a typical 11 kW on-board charger', () => {
		expect(averageFullChargeKw('AC', null, 22, 60)).toBe(11);
		expect(averageFullChargeKw('AC', null, 3.7, 60)).toBe(3.7);
	});

	it('DC: a fast car on a fast charger is capped by its battery (about an hour)', () => {
		// min(233 × 0.8, 350 × 0.8, 77 × 1.1) = 84.7 kW
		expect(averageFullChargeKw('DC', 233, 350, 77)).toBeCloseTo(84.7);
	});

	it('DC: a slow charger limits at 80 % of its rating', () => {
		expect(averageFullChargeKw('DC', 233, 50, 77)).toBeCloseTo(40);
	});

	it('DC: a low-peak car limits at 80 % of its peak', () => {
		// Kia e-Niro: min(77 × 0.8, 150 × 0.8, 64 × 1.1) = 61.6 kW
		expect(averageFullChargeKw('DC', 77, 150, 64)).toBeCloseTo(61.6);
	});

	it('DC without the car peak: battery and charger decide', () => {
		expect(averageFullChargeKw('DC', null, 150, 60)).toBeCloseTo(66);
		expect(averageFullChargeKw('DC', null, 50, 60)).toBeCloseTo(40);
	});

	it('is null without a connector rating or a battery size', () => {
		expect(averageFullChargeKw('DC', 150, null, 60)).toBeNull();
		expect(averageFullChargeKw('DC', 150, 0, 60)).toBeNull();
		expect(averageFullChargeKw('DC', 150, 150, null)).toBeNull();
		expect(averageFullChargeKw('AC', 11, 22, 0)).toBeNull();
	});
});

describe('fullChargeSpeed', () => {
	it('names what sets the average power: the station, the car or the battery', () => {
		expect(fullChargeSpeed('DC', 233, 50, 77)).toMatchObject({
			limit: 'station',
			stationKw: 50,
			carKw: 233
		});
		expect(fullChargeSpeed('DC', 77, 150, 64)).toMatchObject({ limit: 'car', carKw: 77 });
		const battery = fullChargeSpeed('DC', 233, 350, 77)!;
		expect(battery.limit).toBe('battery');
		expect(battery.avgKw).toBeCloseTo(84.7);
		expect(battery.stationKw).toBe(350);
	});

	it('DC without the car peak: never the car', () => {
		expect(fullChargeSpeed('DC', null, 50, 60)?.limit).toBe('station');
		expect(fullChargeSpeed('DC', null, 150, 60)?.limit).toBe('battery');
	});

	it('AC: the station, the car on-board charger, or the assumed one without a car', () => {
		expect(fullChargeSpeed('AC', 11, 7.4, 60)).toMatchObject({ avgKw: 7.4, limit: 'station' });
		expect(fullChargeSpeed('AC', 11, 22, 60)).toMatchObject({ avgKw: 11, limit: 'car' });
		expect(fullChargeSpeed('AC', null, 22, 60)).toMatchObject({
			avgKw: 11,
			limit: 'onboard',
			carKw: null
		});
	});

	it('a tie goes to the station (its rating is what the visitor can compare)', () => {
		expect(fullChargeSpeed('DC', 150, 150, 200)?.limit).toBe('station');
		expect(fullChargeSpeed('AC', 11, 11, 60)?.limit).toBe('station');
	});

	it('is null on the same inputs as the estimate', () => {
		expect(fullChargeSpeed('DC', 150, null, 60)).toBeNull();
		expect(fullChargeSpeed('AC', 11, 22, null)).toBeNull();
	});
});

describe('estimateFullCharge', () => {
	const noFee = { priceIskPerKwh: 64, minuteFeeIsk: null, minuteFeeAfterMin: null };

	it('bills the battery plus charging losses and times it at the average power', () => {
		const e = estimateFullCharge('DC', noFee, 80, 75)!;
		expect(e.loss).toBe(0.08);
		expect(e.billedKwh).toBeCloseTo(81);
		expect(e.minutes).toBeCloseTo((81 / 80) * 60);
		expect(e.energyIsk).toBeCloseTo(81 * 64);
		expect(e.feeIsk).toBe(0);
		expect(e.feeFromMin).toBeNull();
		expect(e.costIsk).toBeCloseTo(81 * 64);
	});

	it('loses more on AC', () => {
		expect(estimateFullCharge('AC', noFee, 11, 50)!.billedKwh).toBeCloseTo(56);
	});

	it('bills an after-N-minutes fee only for the minutes past N', () => {
		// Orkan: 64 kr/kWh + 64 kr/min after 60 min; 81 kWh at 54 kW = 90 min → 30 fee minutes
		const e = estimateFullCharge(
			'DC',
			{ priceIskPerKwh: 64, minuteFeeIsk: 64, minuteFeeAfterMin: 60 },
			54,
			75
		)!;
		expect(e.minutes).toBeCloseTo(90);
		expect(e.feeFromMin).toBe(60);
		expect(e.feeMinutes).toBeCloseTo(30);
		expect(e.feeIsk).toBeCloseTo(30 * 64);
		expect(e.costIsk).toBeCloseTo(81 * 64 + 30 * 64);
	});

	it('bills a fee from minute 0 for the whole charge', () => {
		const e = estimateFullCharge(
			'AC',
			{ priceIskPerKwh: 48, minuteFeeIsk: 0.5, minuteFeeAfterMin: null },
			11,
			50
		)!;
		expect(e.feeFromMin).toBe(0);
		expect(e.feeMinutes).toBeCloseTo(e.minutes);
		expect(e.feeIsk).toBeCloseTo(0.5 * e.minutes);
	});

	it('bills no fee when the charge ends before it starts', () => {
		const e = estimateFullCharge(
			'DC',
			{ priceIskPerKwh: 64, minuteFeeIsk: 64, minuteFeeAfterMin: 60 },
			100,
			60
		)!;
		expect(e.feeMinutes).toBe(0);
		expect(e.feeIsk).toBe(0);
	});

	it('is null when power or battery is missing', () => {
		expect(estimateFullCharge('DC', noFee, null, 60)).toBeNull();
		expect(estimateFullCharge('DC', noFee, 80, null)).toBeNull();
	});
});
