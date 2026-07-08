import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseOpenEvData } from './cars-import';

const fixture = JSON.parse(
	readFileSync('tests/fixtures/open-ev-data-sample.json', 'utf8')
) as Parameters<typeof parseOpenEvData>[0];

describe('parseOpenEvData', () => {
	const result = parseOpenEvData(fixture);

	it('maps a ccs2 combo car to CCS2 + Type2 with both power figures', () => {
		const audi = result.cars.find((c) => c.slug === 'audi-a6-e-tron-2024-a6-e-tron')!;
		expect(audi).toMatchObject({
			make: 'Audi',
			model: 'A6 e-tron',
			variant: 'Base Sportback 2024',
			acConnector: 'Type2',
			maxAcKw: 11,
			dcConnector: 'CCS2',
			maxDcKw: 270
		});
	});

	it('normalizes nacs to CCS2 for European-market builds (Tesla)', () => {
		const tesla = result.cars.find((c) => c.slug === 'tesla-model-3-2024-model-3-long-range')!;
		expect(tesla.dcConnector).toBe('CCS2');
		expect(tesla.acConnector).toBe('Type2');
		expect(tesla.variant).toBe('Long Range 2024');
	});

	it('maps chademo DC and normalizes type1 AC to Type2 (Leaf)', () => {
		const leaf = result.cars.find((c) => c.slug === 'nissan-leaf-2024-leaf')!;
		expect(leaf).toMatchObject({
			variant: 'Base 2024',
			acConnector: 'Type2',
			maxAcKw: 6.6,
			dcConnector: 'CHAdeMO',
			maxDcKw: 50
		});
	});

	it('excludes records without a European market', () => {
		expect(result.cars).toHaveLength(3);
		expect(result.skippedNonEuropean).toBe(1);
	});

	it('prefers CCS2 over CHAdeMO regardless of DC port order', () => {
		const base = {
			make: { slug: 'x', name: 'X' },
			model: { slug: 'y', name: 'Y' },
			year: 2024,
			trim: { slug: 'base', name: 'Base' },
			vehicle_type: 'passenger_car',
			charging: { dc: { max_power_kw: 100 } },
			markets: ['DE']
		};
		const ccsFirst = parseOpenEvData({
			vehicles: [
				{
					...base,
					charge_ports: [
						{ kind: 'combo', connector: 'ccs2' },
						{ kind: 'dc_only', connector: 'chademo' }
					],
					unique_code: 'x:y:2024:ccs_first'
				}
			]
		});
		const chademoFirst = parseOpenEvData({
			vehicles: [
				{
					...base,
					charge_ports: [
						{ kind: 'dc_only', connector: 'chademo' },
						{ kind: 'combo', connector: 'ccs2' }
					],
					unique_code: 'x:y:2024:chademo_first'
				}
			]
		});
		expect(ccsFirst.cars[0].dcConnector).toBe('CCS2');
		expect(chademoFirst.cars[0].dcConnector).toBe('CCS2');
	});

	it('skips EU-market records whose ports all fail to map, with a warning', () => {
		const weird = parseOpenEvData({
			vehicles: [
				{
					...fixture.vehicles[3],
					markets: ['DE'],
					unique_code: 'byd:dolphin_mini:2023:eu_test'
				}
			]
		});
		expect(weird.cars).toHaveLength(0);
		expect(weird.skippedNoMappedPorts).toBe(1);
		expect(weird.warnings[0]).toMatch(/unmapped port combo:gb_t_dc/);
	});
});
