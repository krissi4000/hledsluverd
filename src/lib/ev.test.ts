import { describe, expect, it } from 'vitest';
import { carPlugForMode, effectiveKw, type CarSpec } from './ev';

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
