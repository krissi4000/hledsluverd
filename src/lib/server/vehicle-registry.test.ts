import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { fetchRegistryVehicle, normalizePlate, parseRegistryResponse } from './vehicle-registry';

// real island.is responses (the plates are made up, and so are the VINs' serial numbers)
const fixture = (name: string) =>
	JSON.parse(readFileSync(`tests/fixtures/island-vehicle-search/${name}.json`, 'utf8'));

describe('normalizePlate', () => {
	it.each([
		['ab 123', 'AB123'],
		['AB-123', 'AB123'],
		['abc12', 'ABC12'],
		['ÞÓR', 'ÞÓR'],
		['tesla1', 'TESLA1']
	])('%s → %s', (input, plate) => {
		expect(normalizePlate(input)).toBe(plate);
	});

	it.each(['', 'a', 'TOOLONG7', 'AB.123', 'AB 1/3'])('rejects %j', (input) => {
		expect(normalizePlate(input)).toBeNull();
	});
});

describe('parseRegistryResponse', () => {
	it('reads an electric car: no CO2 figures at all', () => {
		expect(parseRegistryResponse(fixture('electric'))).toEqual({
			plate: 'AB123',
			make: 'PEUGEOT',
			commercialName: '2008',
			color: 'Svartur',
			firstRegYear: 2023,
			registeredNewOn: '2023-09-07',
			// VR3UKZKXZPJ…: the 8-character prefix and the model-year letter, never the serial
			vinKey: 'VR3UKZKXP',
			deregistered: false,
			co2: null,
			weightedCo2: null
		});
	});

	it('keeps no registration day for a used import, and no VIN key for an odd VIN', () => {
		const body = fixture('electric');
		body.data.publicVehicleSearch.firstRegDate = '2021-03-01T00:00:00.000Z';
		body.data.publicVehicleSearch.vin = 'IMPORT-1978';
		expect(parseRegistryResponse(body)).toMatchObject({
			firstRegYear: 2021,
			registeredNewOn: null,
			vinKey: null
		});
	});

	it('reads a plug-in hybrid: a weighted CO2 next to the plain one', () => {
		expect(parseRegistryResponse(fixture('plug-in-hybrid'))).toMatchObject({
			make: 'VOLVO',
			commercialName: 'XC60',
			co2: 163,
			weightedCo2: 23
		});
	});

	it('reads a petrol car: a plain CO2 figure only', () => {
		expect(parseRegistryResponse(fixture('combustion'))).toMatchObject({
			co2: 129,
			weightedCo2: null
		});
	});

	it('returns null for an unknown plate', () => {
		expect(parseRegistryResponse(fixture('not-found'))).toBeNull();
	});

	it('throws on a GraphQL error or an unexpected shape', () => {
		expect(() => parseRegistryResponse(fixture('error'))).toThrow(/Internal server error/);
		expect(() => parseRegistryResponse({ data: {} })).toThrow(/unexpected response/);
		expect(() => parseRegistryResponse('<html>')).toThrow();
	});

	it('marks a deregistered car', () => {
		const body = fixture('electric');
		body.data.publicVehicleSearch.vehicleStatus = 'Afskráð';
		expect(parseRegistryResponse(body)?.deregistered).toBe(true);
	});
});

describe('fetchRegistryVehicle', () => {
	it('posts the plate as a GraphQL variable and parses the answer', async () => {
		const fetchFn = vi.fn(async () => new Response(JSON.stringify(fixture('electric'))));
		const v = await fetchRegistryVehicle('AB123', fetchFn as typeof fetch);
		expect(v?.commercialName).toBe('2008');
		const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://island.is/api/graphql');
		expect(JSON.parse(init.body as string).variables).toEqual({ input: { search: 'AB123' } });
	});

	it('throws on an HTTP error', async () => {
		const fetchFn = async () => new Response('nope', { status: 503 });
		await expect(fetchRegistryVehicle('AB123', fetchFn)).rejects.toThrow(/HTTP 503/);
	});
});
