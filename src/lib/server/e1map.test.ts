import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { e1StationName, parseE1Locations } from './e1map';

// All Orkan (owner partner 145) charge points + 4 others from e1's publicMap, 2026-11-05.
const fixture = JSON.parse(
	readFileSync(
		new URL('../../../tests/fixtures/e1-publicmap-2026-11.json', import.meta.url),
		'utf8'
	)
);
const ORKAN = 145;

describe('parseE1Locations', () => {
	const locs = parseE1Locations(fixture, [ORKAN]);

	it('returns only the wanted owner partners, one entry per location', () => {
		expect(locs).toHaveLength(20);
		expect(locs.every((l) => l.ownerPartnerId === ORKAN)).toBe(true);
		expect(new Set(locs.map((l) => l.id)).size).toBe(20);
	});

	it('counts connectors per type and power, skipping zero-power EVSEs', () => {
		const vest = locs.find((l) => l.name === 'Orkan - Vesturlandsvegur')!;
		expect(vest.connectors).toEqual(
			expect.arrayContaining([
				{ type: 'CCS2', powerKw: 400, count: 6 },
				{ type: 'CCS2', powerKw: 240, count: 2 },
				{ type: 'CHAdeMO', powerKw: 50, count: 2 }
			])
		);
		expect(vest.connectors).toHaveLength(3);
		const dalvegur = locs.find((l) => l.name === 'Orkan - Dalvegur')!;
		expect(dalvegur.connectors.reduce((n, c) => n + c.count, 0)).toBe(8); // 9th EVSE has 0 kW
	});

	it('normalizes multi-line addresses', () => {
		const landeyjar = locs.find((l) => l.name === 'Orkan - Landeyjar')!;
		expect(landeyjar.address).toBe('Brúnir 1 861 Hvolsvöllur');
	});

	it('skips disabled EVSEs', () => {
		const raw = fixture.data.find((c: { name: { en: string } }) => c.name.en === 'OV - Hvitanes');
		const [loc] = parseE1Locations({ data: [raw] }, [raw.ownerPartnerId]);
		const enabled = raw.evses.filter(
			(e: { status: string; maxPower: number }) => e.status !== 'disabled' && e.maxPower > 0
		).length;
		expect(loc.connectors.reduce((n, c) => n + c.count, 0)).toBe(enabled);
		expect(enabled).toBeLessThan(raw.evses.length);
	});

	it('throws on unknown shapes and on a partner with no locations', () => {
		expect(() => parseE1Locations([], [ORKAN])).toThrow(/no data array/);
		expect(() => parseE1Locations({ data: [{ id: 1 }] }, [ORKAN])).toThrow(/unexpected/);
		expect(() => parseE1Locations(fixture, [ORKAN, 999999])).toThrow(/owner partner 999999/);
	});
});

describe('e1StationName', () => {
	const loc = (name: string) => ({ ...parseE1Locations(fixture, [ORKAN])[0], name });
	it('moves the operator prefix into a suffix', () => {
		expect(e1StationName(loc('Orkan - Vesturlandsvegur'), 'Orkan')).toBe(
			'Vesturlandsvegur (Orkan)'
		);
		expect(e1StationName(loc('Orkan Ólafsvík'), 'Orkan')).toBe('Ólafsvík (Orkan)');
		expect(e1StationName(loc('Kringlan'), 'Orkan')).toBe('Kringlan (Orkan)');
	});
});
