import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	fetchChargingAvailability,
	parseChargingAvailability,
	type TomTomAvailabilityResponse
} from './tomtom';

const fixture = JSON.parse(
	readFileSync('tests/fixtures/tomtom-charging-availability.json', 'utf8')
) as TomTomAvailabilityResponse;

describe('parseChargingAvailability', () => {
	it('sums free and total across connectors and maps known types', () => {
		const parsed = parseChargingAvailability(fixture)!;
		expect(parsed.freeCount).toBe(1);
		expect(parsed.totalCount).toBe(2);
		expect(parsed.perType).toEqual({ Type2: { free: 1, total: 2 } });
	});

	it('counts unmapped connector types into the totals but not perType', () => {
		const parsed = parseChargingAvailability({
			connectors: [
				{
					type: 'IEC62196Type2CCS',
					total: 4,
					availability: {
						current: { available: 2, occupied: 2, reserved: 0, unknown: 0, outOfService: 0 }
					}
				},
				{
					type: 'Tesla',
					total: 8,
					availability: {
						current: { available: 5, occupied: 3, reserved: 0, unknown: 0, outOfService: 0 }
					}
				}
			],
			chargingAvailability: 'x'
		})!;
		expect(parsed.freeCount).toBe(7);
		expect(parsed.totalCount).toBe(12);
		expect(parsed.perType).toEqual({ CCS2: { free: 2, total: 4 } });
	});

	it('returns null for an empty connectors array (unknown id) and throws on garbage', () => {
		expect(parseChargingAvailability({ connectors: [], chargingAvailability: 'x' })).toBeNull();
		expect(() =>
			parseChargingAvailability({ connectors: [{}] } as unknown as TomTomAvailabilityResponse)
		).toThrow(/TomTom availability/);
	});
});

describe('fetchChargingAvailability', () => {
	it('calls the endpoint with the id and parses the body', async () => {
		let calledUrl = '';
		const fakeFetch = (async (url: RequestInfo | URL) => {
			calledUrl = String(url);
			return new Response(JSON.stringify(fixture), { status: 200 });
		}) as typeof fetch;
		const parsed = await fetchChargingAvailability('test-key', 'abc-123', fakeFetch);
		expect(calledUrl).toContain('chargingAvailability.json');
		expect(calledUrl).toContain('key=test-key');
		expect(calledUrl).toContain('chargingAvailability=abc-123');
		expect(parsed!.freeCount).toBe(1);
	});

	it('throws on a non-200 response', async () => {
		const fakeFetch = (async () => new Response('nope', { status: 403 })) as typeof fetch;
		await expect(fetchChargingAvailability('k', 'id', fakeFetch)).rejects.toThrow(/HTTP 403/);
	});
});
