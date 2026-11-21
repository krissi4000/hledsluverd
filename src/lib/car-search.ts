// Matching for the car search box. People type car names loosely, so the search ignores
// accents (skoda → Škoda, e-c4 → ë-C4), punctuation and spacing inside a word (id4 → ID.4,
// e208 → e-208), and word order (model y tesla). Every typed word must appear somewhere
// in the car's name, except a year, which matches the car's model years ("leaf 2019");
// results that name the model outright rank first.

import { carMakeKey } from './car-key';

export interface SearchableCar {
	make: string;
	model: string;
	variant: string | null;
	yearFrom: number | null;
	/** null = still on sale */
	yearTo: number | null;
}

/** lowercase without accents: "Škoda ë-C4" → "skoda e-c4" */
export function foldName(s: string): string {
	return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** folded, letters and digits only: "ID.4 Pro" → "id4pro" */
export function compactName(s: string): string {
	return foldName(s).replace(/[^a-z0-9]/g, '');
}

/** Other names people use for a make, keyed by carMakeKey(make). */
const MAKE_ALIASES: Record<string, string> = {
	volkswagen: 'VW'
};

/** Earlier or other names of a model, keyed by "carMakeKey(make)/model". */
const MODEL_ALIASES: Record<string, string> = {
	// renamed in 2024; the same car was sold as XC40/C40 Recharge before
	'volvo/EX40': 'XC40 Recharge',
	'volvo/EC40': 'C40 Recharge'
};

function aliases(c: SearchableCar): string {
	const make = carMakeKey(c.make);
	return `${MAKE_ALIASES[make] ?? ''} ${MODEL_ALIASES[`${make}/${c.model}`] ?? ''}`;
}

const YEAR = /^(19|20)\d\d$/;

/** Was the car sold in this year? Cars without years never match a year. */
function soldIn(car: SearchableCar, year: number): boolean {
	if (car.yearFrom === null) return false;
	return car.yearFrom <= year && year <= (car.yearTo ?? new Date().getFullYear() + 1);
}

/** The cars matching a search, best first; empty until at least two letters are typed. */
export function searchCars<T extends SearchableCar>(
	cars: readonly T[],
	query: string,
	limit = 30
): T[] {
	const tokens = query.split(/\s+/).map(compactName).filter(Boolean);
	const words = tokens.filter((t) => !YEAR.test(t));
	const years = tokens.filter((t) => YEAR.test(t)).map(Number);
	const joined = words.join('');
	if (tokens.join('').length < 2) return [];

	const scored: { car: T; score: number; i: number }[] = [];
	cars.forEach((car, i) => {
		const name = `${car.make} ${car.model} ${car.variant ?? ''} ${aliases(car)}`;
		const haystack = compactName(name);
		if (!words.every((t) => haystack.includes(t))) return;
		if (!years.every((y) => soldIn(car, y))) return;
		const nameWords = foldName(name).split(/[^a-z0-9]+/);
		let score = 0;
		// the query names the model ("ioniq 5", "kia ev6", "id4") — beats "IONIQ 6 AWD"
		if (joined) {
			const model = compactName(car.model);
			if (model.startsWith(joined) || compactName(car.make + car.model).includes(joined)) {
				score += 4;
			} else if (haystack.includes(joined)) {
				score += 2;
			}
		}
		// whole-word starts rank above matches in the middle of a word
		for (const t of words) if (nameWords.some((w) => w.startsWith(t))) score += 1;
		scored.push({ car, score, i });
	});
	return scored
		.sort((a, b) => b.score - a.score || a.i - b.i)
		.slice(0, limit)
		.map((s) => s.car);
}
