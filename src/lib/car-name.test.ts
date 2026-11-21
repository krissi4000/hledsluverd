import { describe, expect, it } from 'vitest';
import { carFullName, carVariantLabel, carYears } from './car-name';

describe('carYears', () => {
	it.each([
		[2018, 2022, '2018–2022'],
		[2023, null, '2023–'],
		[2022, 2022, '2022'],
		[null, null, '']
	])('%s–%s → %j', (yearFrom, yearTo, label) => {
		expect(carYears({ yearFrom, yearTo })).toBe(label);
	});
});

describe('carVariantLabel / carFullName', () => {
	const ev6 = {
		make: 'Kia',
		model: 'EV6',
		variant: 'Long Range 77 kWh',
		yearFrom: 2021,
		yearTo: 2024
	};

	it('joins the variant and the years', () => {
		expect(carVariantLabel(ev6)).toBe('Long Range 77 kWh · 2021–2024');
		expect(carFullName(ev6)).toBe('Kia EV6 Long Range 77 kWh · 2021–2024');
	});

	it('leaves out what is missing', () => {
		expect(carVariantLabel({ variant: null, yearFrom: 2020, yearTo: null })).toBe('2020–');
		expect(carVariantLabel({ variant: 'Base', yearFrom: null, yearTo: null })).toBe('Base');
	});
});
