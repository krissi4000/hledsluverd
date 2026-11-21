// How a car's variant and model years are written in the UI.

interface Years {
	yearFrom: number | null;
	yearTo: number | null;
}

/** "2021–2024"; "2023–" while still on sale; "2022" for a single year; "" when unknown */
export function carYears({ yearFrom, yearTo }: Years): string {
	if (yearFrom === null) return '';
	if (yearTo === yearFrom) return String(yearFrom);
	return `${yearFrom}–${yearTo ?? ''}`;
}

/** "Long Range 77 kWh · 2021–2024" */
export function carVariantLabel(car: Years & { variant: string | null }): string {
	return [car.variant, carYears(car)].filter(Boolean).join(' · ');
}

/** "Kia EV6 Long Range 77 kWh · 2021–2024" */
export function carFullName(car: Years & { make: string; model: string; variant: string | null }) {
	return `${car.make} ${car.model} ${carVariantLabel(car)}`.trim();
}
