import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCarSeeds } from './car-seeds';
import { matchRegistryVehicle } from './plate-match';
import {
	registeredNameKey,
	registryMakeKey,
	variantHint,
	variantKey,
	vinKey
} from './plate-variants';
import { parseRegistryResponse } from './vehicle-registry';

const cars = parseCarSeeds(JSON.parse(readFileSync('seeds/cars.json', 'utf8')));
const variantCars: Record<string, Record<string, string[]>> = JSON.parse(
	readFileSync('seeds/variant-cars.json', 'utf8')
).cars;

describe('keys', () => {
	it.each([
		['VOLKSWAGEN, VW', 'VW'],
		['VOLKSWAGEN', 'VW'],
		['TESLA MOTORS', 'TESLA'],
		['MERCEDES-BENZ', 'MERCEDES'],
		['BMW I', 'BMW'],
		['Škoda', 'SKODA'],
		['KG MOBILITY', 'KGM'],
		['GREAT WALL MOTOR COMPANY', 'GWM'],
		['Polestar', 'POLESTAR']
	])('files the make %s under %s', (make, key) => {
		expect(registryMakeKey(make)).toBe(key);
	});

	it('keys a variant by its code, adding the version to short codes', () => {
		expect(variantKey('XZED', 'XZEDVE0?')).toBe('XZED');
		expect(variantKey('acebjc l1fx2', 'whatever')).toBe('ACEBJCL1FX2');
		// Peugeot 2008: variant "K" means nothing without the motor code in the version
		expect(variantKey('K', 'ZKXZ-R0A000')).toBe('K/ZKX');
	});

	it('keeps the VIN prefix and model year, never the serial number', () => {
		expect(vinKey('yv1xzedven2000000')).toBe('YV1XZEDVN');
		expect(vinKey('TOO-SHORT')).toBeNull();
		// I, O and Q are not VIN characters
		expect(vinKey('YV1XZEDVEN200000O')).toBeNull();
	});

	it('keys a registered name without its punctuation', () => {
		expect(registeredNameKey('ID.4 GTX 220 KW')).toBe('ID4GTX220KW');
	});
});

describe('seeds/variant-cars.json', () => {
	const bySlug = new Map(cars.map((c) => [c.slug, c]));

	it('lists only cars that exist, under their own make', () => {
		const wrong: string[] = [];
		for (const [make, variants] of Object.entries(variantCars)) {
			for (const [code, slugs] of Object.entries(variants)) {
				if (slugs.length === 0) wrong.push(`${make} ${code}: empty`);
				for (const slug of slugs) {
					const car = bySlug.get(slug);
					if (!car) wrong.push(`${make} ${code}: no car ${slug}`);
					else if (registryMakeKey(car.make) !== make) wrong.push(`${make} ${code}: ${slug}`);
				}
			}
		}
		expect(wrong).toEqual([]);
	});
});

// The VIN prefixes are real, the serial numbers are not.
const query = (
	make: string,
	commercialName: string,
	vin: string | null,
	registeredNewOn: string | null
) => ({ make, commercialName, vinKey: vin ? vinKey(vin) : null, registeredNewOn });

const slugsOf = (hint: ReturnType<typeof variantHint>) => (hint ? [...hint.slugs].sort() : null);

describe('variantHint', () => {
	it('tells a twin-motor XC40 from a single-motor one by the VIN prefix', () => {
		const twin = variantHint(query('VOLVO', 'XC40', 'YV1XZEDVEN2000000', '2021-12-16'));
		expect(slugsOf(twin)).toEqual(['volvo-xc40-recharge-p8-awd-twin-motor-78-kwh-2020']);
		expect(twin?.ownModel).toBe(true);
		const single = variantHint(query('VOLVO', 'XC40', 'YV1XZEFVKN2000000', '2022-04-27'));
		expect(slugsOf(single)).toEqual(['volvo-xc40-recharge-single-motor-69-kwh-2021']);
	});

	it('works from the VIN alone for a used import or a car newer than the Icelandic tables', () => {
		expect(slugsOf(variantHint(query('VOLVO', 'XC40', 'YV1XZEDVEN2000000', null)))).toEqual([
			'volvo-xc40-recharge-p8-awd-twin-motor-78-kwh-2020'
		]);
		expect(slugsOf(variantHint(query('VOLVO', 'EC40', 'YV1XKERR3T2000000', '2031-01-16')))).toEqual(
			[
				'volvo-c40-recharge-single-motor-extended-range-twin-motor-performance-82-kwh-2023',
				'volvo-ec40-single-motor-extended-range-twin-motor-performance-82-kwh-2024'
			]
		);
	});

	it('uses the registered name and day where the VIN says nothing (Volkswagen)', () => {
		const vinOnly = variantHint(
			query('VOLKSWAGEN, VW', 'ID.5 GTX 220 KW', 'WVGZZZE2ZPP000000', null)
		);
		// the E2 prefix is every ID.4 and ID.5; some of their variants are not mapped
		expect(vinOnly).toBeNull();
		const gtx = variantHint(
			query('VOLKSWAGEN, VW', 'ID.5 GTX 220 KW', 'WVGZZZE2ZPP000000', '2023-12-12')
		);
		expect(slugsOf(gtx)).toEqual([
			'volkswagen-id-5-gtx-77-kwh-2022',
			'volkswagen-id-5-pro-4motion-gtx-77-kwh-175-kw-2023'
		]);
	});

	it('answers from the day alone, and says the answer is not the car’s own', () => {
		// a day only Polestar's twin-motor Performance was registered on
		const hint = variantHint(query('POLESTAR', 'POLESTAR 2', null, '2023-06-13'));
		// the name narrows nothing here (every Polestar 2 is a "POLESTAR 2"), so it is the day
		expect(slugsOf(hint)).toEqual([
			'polestar-polestar-2-long-range-single-motor-dual-motor-78-kwh-2020'
		]);
	});

	it('gives no answer when the sources disagree', () => {
		// a single-motor VIN on a day only twin-motor XC40s were registered
		expect(variantHint(query('VOLVO', 'XC40', 'YV1XZEFVKN2000000', '2021-12-16'))).toBeNull();
	});

	it('gives no answer for a variant nobody has mapped, or a make it does not know', () => {
		expect(
			variantHint(query('NISSAN', 'LEAF 40KWH', 'SJNFAAZE1U0000000', '2022-05-02'))
		).toBeNull();
		expect(variantHint(query('TRABANT', '601', null, null))).toBeNull();
		expect(variantHint(query('VOLVO', 'XC40', null, null))).toBeNull();
	});
});

describe('a plate, end to end', () => {
	const fixture = (name: string) =>
		JSON.parse(readFileSync(`tests/fixtures/island-vehicle-search/${name}.json`, 'utf8'));

	it('picks the one car a registry record is', () => {
		// registered as a "2008"; its VIN prefix (motor code ZKX) and day make it the 50 kWh e-2008
		const vehicle = parseRegistryResponse(fixture('electric'))!;
		const match = matchRegistryVehicle(vehicle, cars);
		expect('candidates' in match && match.candidates.map((c) => c.slug)).toEqual([
			'peugeot-e-2008-50-kwh-136-hp-2020'
		]);
		// by name and year alone it could also be the 54 kWh one
		const byName = matchRegistryVehicle(vehicle, cars, () => null);
		expect('candidates' in byName && byName.candidates).toHaveLength(2);
	});
});
