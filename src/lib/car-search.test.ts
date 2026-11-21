import { describe, expect, it } from 'vitest';
import { searchCars, type SearchableCar } from './car-search';

const car = (
	make: string,
	model: string,
	variant: string,
	yearFrom: number,
	yearTo: number | null = null
): SearchableCar => ({ make, model, variant, yearFrom, yearTo });

// ordered like /bilar.json: make, model, newest first
const CARS = [
	car('Citroën', 'ë-C4', '54 kWh', 2024),
	car('Hyundai', 'IONIQ 5', 'Long Range', 2021),
	car('Hyundai', 'IONIQ 6', 'AWD', 2022),
	car('Hyundai', 'IONIQ Electric', '38 kWh', 2019, 2022),
	car('Kia', 'e-Niro', '64 kWh', 2018, 2022),
	car('MG', 'Cyberster', 'Long Range', 2024),
	car('MG', 'MG4', 'Long Range', 2022),
	car('Peugeot', 'e-2008', '50 kWh', 2020, 2023),
	car('Peugeot', 'e-208', '50 kWh', 2020, 2023),
	car('Škoda', 'Enyaq iV', '80', 2021, 2023),
	car('Tesla', 'Model 3', 'Long Range', 2019, 2023),
	car('Tesla', 'Model Y', 'Long Range', 2021, 2024),
	car('Volkswagen', 'ID.3', 'Pro', 2020),
	car('Volkswagen', 'ID.4', 'Pro', 2021),
	car('Volvo', 'EX40', 'Twin Motor', 2024),
	car('Volvo', 'XC40 Recharge', 'Twin Motor', 2020, 2023)
];

const names = (query: string) =>
	searchCars(CARS, query).map((c) => `${c.make} ${c.model} ${c.variant}`);

describe('searchCars', () => {
	it('ignores accents in the name', () => {
		expect(names('skoda enyaq')).toEqual(['Škoda Enyaq iV 80']);
		expect(names('citroen e-c4')).toEqual(['Citroën ë-C4 54 kWh']);
	});

	it('ignores punctuation and spacing inside a word', () => {
		expect(names('id4')).toEqual(['Volkswagen ID.4 Pro']);
		expect(names('e208')).toEqual(['Peugeot e-208 50 kWh']);
		expect(names('eniro')).toEqual(['Kia e-Niro 64 kWh']);
	});

	it('matches the words in any order', () => {
		expect(names('model y tesla')).toEqual(['Tesla Model Y Long Range']);
	});

	it('ranks the model the query names first', () => {
		expect(names('ioniq 5')).toEqual(['Hyundai IONIQ 5 Long Range']);
		expect(names('mg 4')[0]).toBe('MG MG4 Long Range');
		expect(names('ioniq')).toEqual([
			'Hyundai IONIQ 5 Long Range',
			'Hyundai IONIQ 6 AWD',
			'Hyundai IONIQ Electric 38 kWh'
		]);
	});

	it('matches a typed year against the model years, not the name', () => {
		expect(names('e-niro 2020')).toEqual(['Kia e-Niro 64 kWh']);
		expect(names('e-niro 2023')).toEqual([]);
		// a car still on sale matches any later year
		expect(names('id4 2026')).toEqual(['Volkswagen ID.4 Pro']);
		expect(names('tesla 2024')).toEqual(['Tesla Model Y Long Range']);
	});

	it('knows VW and the names Volvo used before 2024', () => {
		expect(names('vw id3')).toEqual(['Volkswagen ID.3 Pro']);
		expect(names('xc40')).toEqual(['Volvo XC40 Recharge Twin Motor', 'Volvo EX40 Twin Motor']);
	});

	it('waits for two characters and finds nothing for an unknown car', () => {
		expect(names('k')).toEqual([]);
		expect(names('  ')).toEqual([]);
		expect(names('trabant')).toEqual([]);
	});

	it('returns at most the limit', () => {
		expect(searchCars(CARS, 'o', 3)).toHaveLength(0); // one letter: too short
		expect(searchCars(CARS, 'on', 3)).toHaveLength(3);
	});
});
