import { describe, expect, it } from 'vitest';
import { matchRegistryVehicle } from './plate-match';
import type { VariantHint } from './plate-variants';
import type { RegistryVehicle } from './vehicle-registry';

const car = (
	make: string,
	model: string,
	variant: string,
	yearFrom: number,
	yearTo: number | null
) => ({
	slug: `${make}-${model}-${variant}-${yearFrom}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
	make,
	model,
	variant,
	yearFrom,
	yearTo
});

const CARS = [
	car('Hyundai', 'IONIQ Electric', '28 kWh', 2016, 2019),
	car('Hyundai', 'IONIQ Electric', '38 kWh', 2019, 2022),
	car('Hyundai', 'IONIQ 5', 'Long Range', 2021, null),
	car('Hyundai', 'IONIQ 6', 'Long Range', 2022, null),
	car('Kia', 'e-Niro', '64 kWh', 2018, 2022),
	car('Kia', 'Niro EV', '64.8 kWh', 2022, null),
	car('Peugeot', 'e-2008', '50 kWh', 2020, 2023),
	car('Peugeot', 'e-2008', '54 kWh', 2023, null),
	car('Polestar', 'Polestar 2', 'Long Range Dual Motor', 2020, 2023),
	car('Polestar', 'Polestar 2', 'Long Range Single Motor', 2021, 2023),
	car('Tesla', 'Model 3', 'Long Range', 2019, 2023),
	car('Volvo', 'XC40 Recharge', 'Twin Motor', 2020, 2023),
	car('Volvo', 'EX40', 'Twin Motor', 2024, null),
	car('Volkswagen', 'ID.4', 'Pro', 2021, null),
	car('Audi', 'e-tron', '55 quattro', 2019, 2022),
	car('Audi', 'Q4 e-tron', '45 e-tron', 2021, null),
	car('Audi', 'Q4 Sportback e-tron', '45 e-tron', 2021, null),
	car('BMW', 'iX', 'xDrive40', 2021, null),
	car('BMW', 'iX1', 'xDrive30', 2022, null),
	car('Honda', 'e', '35.5 kWh', 2020, 2024),
	car('Hyundai', 'Kona Electric', '64 kWh', 2018, 2023),
	car('Mercedes-Benz', 'EQE', '350 4MATIC', 2022, null),
	car('Mercedes-Benz', 'EQE SUV', '350 4MATIC', 2023, null),
	car('Nissan', 'Leaf', '40 kWh', 2018, 2024),
	car('Nissan', 'Leaf', 'e+ 62 kWh', 2019, 2024),
	car('smart', '#1', 'Pro+', 2022, null),
	car('Toyota', 'bZ4X', '71.4 kWh', 2022, null)
];

const vehicle = (make: string, commercialName: string, firstRegYear: number | null, more = {}) =>
	({
		plate: 'AB123',
		make,
		commercialName,
		color: null,
		firstRegYear,
		registeredNewOn: null,
		vinKey: null,
		deregistered: false,
		co2: null,
		weightedCo2: null,
		...more
	}) satisfies RegistryVehicle;

// name and year only, unless a test passes what the variant tables would say
const slugs = (v: RegistryVehicle, hint: VariantHint | null = null) => {
	const m = matchRegistryVehicle(v, CARS, () => hint);
	return 'candidates' in m ? m.candidates.map((c) => `${c.model} ${c.variant}`) : m.kind;
};

describe('matchRegistryVehicle', () => {
	it('matches the registered name exactly and keeps every variant of that era', () => {
		expect(slugs(vehicle('POLESTAR', 'POLESTAR 2', 2022))).toEqual([
			'Polestar 2 Long Range Dual Motor',
			'Polestar 2 Long Range Single Motor'
		]);
	});

	it('finds an e-model registered without its "e-" (an e-2008 is a "2008")', () => {
		expect(slugs(vehicle('PEUGEOT', '2008', 2021))).toEqual(['e-2008 50 kWh']);
		// 2023 is in both ranges: both offered
		expect(slugs(vehicle('PEUGEOT', '2008', 2023))).toEqual(['e-2008 50 kWh', 'e-2008 54 kWh']);
	});

	it('matches a shorter registered name and narrows by year (XC40 → XC40 Recharge / EX40)', () => {
		expect(slugs(vehicle('VOLVO', 'XC40', 2021))).toEqual(['XC40 Recharge Twin Motor']);
		expect(slugs(vehicle('VOLVO', 'XC40', 2026))).toEqual(['EX40 Twin Motor']);
		// one year of slack either side of the model years: both in 2024
		expect(slugs(vehicle('VOLVO', 'XC40', 2024))).toEqual([
			'EX40 Twin Motor',
			'XC40 Recharge Twin Motor'
		]);
	});

	it('offers every IONIQ of the era for a bare "IONIQ", in-range first', () => {
		expect(slugs(vehicle('HYUNDAI', 'IONIQ', 2017))).toEqual(['IONIQ Electric 28 kWh']);
		expect(slugs(vehicle('HYUNDAI', 'IONIQ', 2022))).toEqual([
			'IONIQ Electric 38 kWh',
			'IONIQ 5 Long Range',
			'IONIQ 6 Long Range'
		]);
	});

	it('ranks the exact name first when a looser one also matches (NIRO in 2022)', () => {
		expect(slugs(vehicle('KIA', 'E-NIRO', 2022))).toEqual(['e-Niro 64 kWh']);
		expect(slugs(vehicle('KIA', 'NIRO', 2022))).toEqual(['e-Niro 64 kWh', 'Niro EV 64.8 kWh']);
	});

	it('matches make spellings of the registry (VW, TESLA MOTORS)', () => {
		expect(slugs(vehicle('VW', 'ID.4', 2022))).toEqual(['ID.4 Pro']);
		expect(slugs(vehicle('TESLA MOTORS', 'MODEL 3', 2020))).toEqual(['Model 3 Long Range']);
	});

	it('keeps a model match outside its known years rather than offering nothing', () => {
		expect(slugs(vehicle('TESLA', 'MODEL 3', 2030))).toEqual(['Model 3 Long Range']);
	});

	it('offers the make’s electric cars of the era when the name is unknown', () => {
		const m = matchRegistryVehicle(vehicle('KIA', 'SOUL', 2023), CARS, () => null);
		expect(m.kind).toBe('make');
		// in-range first: Niro EV (2022–), then e-Niro (to 2022, one year of slack)
		expect(slugs(vehicle('KIA', 'SOUL', 2023))).toEqual(['Niro EV 64.8 kWh', 'e-Niro 64 kWh']);
	});

	it('says unknown, not "not electric", for an old car with no CO2 and no model match', () => {
		expect(slugs(vehicle('KIA', 'SPORTAGE', 2005))).toBe('unknown');
		expect(slugs(vehicle('TRABANT', '601', 1980))).toBe('unknown');
	});

	it('trusts the registry’s CO2 figures for hybrids and fuel cars', () => {
		expect(slugs(vehicle('VOLVO', 'XC60', 2024, { co2: 163, weightedCo2: 23 }))).toBe(
			'plug-in-hybrid'
		);
		expect(slugs(vehicle('PEUGEOT', '2008', 2023, { co2: 129 }))).toBe('not-electric');
		// a recorded zero is an electric car
		expect(slugs(vehicle('PEUGEOT', '2008', 2021, { co2: 0 }))).toEqual(['e-2008 50 kWh']);
	});

	it('does not filter by year when the registry has no date', () => {
		expect(slugs(vehicle('PEUGEOT', '2008', null))).toHaveLength(2);
	});

	it('reads names that repeat the make or run words together', () => {
		expect(slugs(vehicle('TOYOTA', 'TOYOTA BZ4X', 2023))).toEqual(['bZ4X 71.4 kWh']);
		expect(slugs(vehicle('HONDA', 'HONDA E', 2021))).toEqual(['e 35.5 kWh']);
		expect(slugs(vehicle('HONDA', 'E', 2021))).toEqual(['e 35.5 kWh']);
		expect(slugs(vehicle('SMART', '#1', 2023))).toEqual(['#1 Pro+']);
		expect(slugs(vehicle('KIA', 'KIA E-NIRO', 2020))).toEqual(['e-Niro 64 kWh']);
	});

	it('reads names with the trim inside, and takes the fullest model name', () => {
		expect(slugs(vehicle('AUDI', 'Q4 45 E-TRON', 2023))).toEqual([
			'Q4 e-tron 45 e-tron',
			// a Sportback may be registered without the word, so it stays, last
			'Q4 Sportback e-tron 45 e-tron'
		]);
		expect(slugs(vehicle('AUDI', 'Q4 SPORTBACK 45 E-TRON', 2023))).toEqual([
			'Q4 Sportback e-tron 45 e-tron'
		]);
		// the first e-tron is not every Audi with "e-tron" in its name
		expect(slugs(vehicle('AUDI', 'E-TRON 55', 2020))).toEqual(['e-tron 55 quattro']);
		// and an iX1 is not an iX
		expect(slugs(vehicle('BMW', 'IX1 XDRIVE30', 2023))).toEqual(['iX1 xDrive30']);
		expect(slugs(vehicle('BMW', 'IX XDRIVE40', 2023))).toEqual(['iX xDrive40']);
	});

	it('knows the Kona by its other name', () => {
		expect(slugs(vehicle('HYUNDAI', 'KAUAI', 2020))).toEqual(['Kona Electric 64 kWh']);
		expect(slugs(vehicle('HYUNDAI', 'KONA KAUAI', 2020))).toEqual(['Kona Electric 64 kWh']);
	});

	it('keeps the body style a name may have dropped, after the one it names', () => {
		// an EQE SUV is registered as "EQE 350 4MATIC" too
		expect(slugs(vehicle('MERCEDES-BENZ', 'EQE 350 4MATIC', 2024))).toEqual([
			'EQE 350 4MATIC',
			'EQE SUV 350 4MATIC'
		]);
	});

	it('takes a battery size the registered name states', () => {
		expect(slugs(vehicle('NISSAN', 'NISSAN LEAF 40KWH', 2021))).toEqual(['Leaf 40 kWh']);
		expect(slugs(vehicle('NISSAN', 'LEAF 62KWH', 2021))).toEqual(['Leaf e+ 62 kWh']);
		expect(slugs(vehicle('NISSAN', 'LEAF', 2021))).toHaveLength(2);
	});
});

describe('matchRegistryVehicle with a variant hint', () => {
	const hint = (ownModel: boolean, ...slugsOfCars: string[]): VariantHint => ({
		slugs: new Set(slugsOfCars),
		ownModel
	});
	const slugOf = (model: string, variant: string) =>
		CARS.find((c) => c.model === model && c.variant === variant)!.slug;

	it('narrows the cars the name fits to the variant', () => {
		const single = hint(true, slugOf('Polestar 2', 'Long Range Single Motor'));
		expect(slugs(vehicle('POLESTAR', 'POLESTAR 2', 2022), single)).toEqual([
			'Polestar 2 Long Range Single Motor'
		]);
	});

	it('lets the variant overrule the year: old stock registered late is still the old car', () => {
		const old = hint(true, slugOf('XC40 Recharge', 'Twin Motor'));
		expect(slugs(vehicle('VOLVO', 'XC40', 2026), old)).toEqual(['XC40 Recharge Twin Motor']);
	});

	it('still narrows by year among the cars of the variant', () => {
		const both = hint(true, slugOf('e-2008', '50 kWh'), slugOf('e-2008', '54 kWh'));
		expect(slugs(vehicle('PEUGEOT', '2008', 2021), both)).toEqual(['e-2008 50 kWh']);
	});

	it('picks the body style a name dropped when the variant names it', () => {
		const suv = hint(false, slugOf('EQE SUV', '350 4MATIC'));
		expect(slugs(vehicle('MERCEDES-BENZ', 'EQE 350 4MATIC', 2024), suv)).toEqual([
			'EQE SUV 350 4MATIC'
		]);
	});

	it('trusts neither when the variant is of a model the name does not fit', () => {
		const other = hint(true, slugOf('IONIQ 5', 'Long Range'));
		expect(slugs(vehicle('HYUNDAI', 'KONA', 2020), other)).toEqual(['Kona Electric 64 kWh']);
	});

	it('takes the variant when the name fits nothing, but only if it is the car’s own', () => {
		const ownModel = hint(true, slugOf('Kona Electric', '64 kWh'));
		expect(slugs(vehicle('HYUNDAI', 'OS EV', 2020), ownModel)).toEqual(['Kona Electric 64 kWh']);
		// a whole day's registrations say nothing about a car whose name is unknown
		const thatDay = hint(false, slugOf('Kona Electric', '64 kWh'));
		const m = matchRegistryVehicle(vehicle('HYUNDAI', 'OS EV', 2020), CARS, () => thatDay);
		expect(m.kind).toBe('make');
	});

	it('does not ask the tables about a car the registry says burns fuel', () => {
		const any = hint(true, slugOf('e-2008', '50 kWh'));
		expect(slugs(vehicle('PEUGEOT', '2008', 2023, { co2: 129 }), any)).toBe('not-electric');
	});
});
