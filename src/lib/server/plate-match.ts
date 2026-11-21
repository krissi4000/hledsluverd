// Turns a registry record into the cars it could be.
//
// - Electric or not: electric cars have no CO2 figure, plug-in hybrids have a weighted CO2,
//   everything else has a plain CO2. Cars from before CO2 was recorded have none either, so
//   "no CO2" only means "possibly electric" and the model name decides.
// - Variant: the registry names no battery or motor, but the VIN prefix and the registration
//   date identify the car's type-approval variant (plate-variants.ts), and that maps to our
//   cars. This is what tells a 64 kWh Niro from a 39 kWh one.
// - Model name: the fallback, and the tie-break between models that share a variant code.
//   The registered name is upper case and loose: shorter than the marketing name ("2008"
//   for an e-2008, "XC40" for an XC40 Recharge), with the make repeated ("TOYOTA BZ4X") or
//   the trim inside ("Q4 45 E-TRON"). Every plausible model is offered.
// - Year: the first-registration year narrows what is left (imports keep their foreign date).
//
// Options the registry never shows (a DC inlet that was optional, a CCS adapter) stay for
// the owner to pick. Only when a single car is left is it picked for them.

import { carMakeKey } from '$lib/car-key';
import { foldName } from '$lib/car-search';
import { variantHint, type VariantHint, type VariantQuery } from './plate-variants';
import type { RegistryVehicle } from './vehicle-registry';

interface MatchableCar {
	slug: string;
	make: string;
	model: string;
	variant: string | null;
	yearFrom: number | null;
	yearTo: number | null;
}

export type PlateMatch<T> =
	/** cars the registered variant or name matches, best first */
	| { kind: 'model'; candidates: T[] }
	/** the make is known but no model matches: its electric cars of that era, to pick from */
	| { kind: 'make'; candidates: T[] }
	| { kind: 'plug-in-hybrid' }
	/** the registry records a CO2 figure, so it burns fuel */
	| { kind: 'not-electric' }
	/** no electric car of this make (from around the car's year) in the list */
	| { kind: 'unknown' };

/** One word of a name, without accents, case or punctuation. */
function word(s: string): string {
	return foldName(s).replace(/[^a-z0-9]/g, '');
}

/** A name's words; smart's "#1" keeps its hash as "no1" so it is not just "1". */
function words(s: string): string[] {
	return s.replace(/#/g, 'no').split(/\s+/).map(word).filter(Boolean);
}

/** Registered make spellings that differ from the marketing name, by compacted spelling. */
const MAKE_ALIASES: Record<string, string> = {
	vw: 'volkswagen',
	mercedes: 'mercedesbenz',
	mgmotor: 'mg',
	greatwallmotorcompany: 'gwm',
	ora: 'gwm',
	kgmobility: 'kgm'
};

function makeMatches(registered: string, make: string): boolean {
	const reg = word(registered);
	const ours = word(make);
	if (MAKE_ALIASES[reg] === ours) return true;
	// "BMW I" for BMW, "TESLA MOTORS" for Tesla, "DS AUTOMOBILES" for DS, "VOLKSWAGEN, VW"
	return reg === ours || (ours.length >= 2 && reg.startsWith(ours));
}

/** Names the registry uses for a model besides its own, by make key and our model name. */
const MODEL_ALIASES: Record<string, string[]> = {
	'volvo/XC40 Recharge': ['XC40'],
	'volvo/C40 Recharge': ['C40'],
	'volvo/EX40': ['XC40'],
	'volvo/EC40': ['C40'],
	// sold as the Kauai where "Kona" could not be used; Iceland's registry has both
	'hyundai/Kona Electric': ['Kona', 'Kauai'],
	'skoda/Enyaq iV': ['Enyaq'],
	'skoda/Enyaq Coupé iV': ['Enyaq Coupé'],
	'porsche/Macan Electric': ['Macan'],
	'gwm/ORA 03': ['ORA Funky Cat', 'Funky Cat'],
	'mg/Marvel R': ['Marvel'],
	'mg/MGS5 EV': ['S5 EV'],
	'bmw/i3': ['i3s'],
	'lexus/RZ': ['RZ300e', 'RZ350e', 'RZ450e', 'RZ500e', 'RZ550e'],
	'opel/Combo-e Life': ['Combo Life'],
	'opel/Zafira-e Life': ['Zafira Life']
};

function modelNames(car: MatchableCar): string[] {
	const names = [car.model, ...(MODEL_ALIASES[`${carMakeKey(car.make)}/${car.model}`] ?? [])];
	// e-Niro → Niro, e-2008 → 2008, ë-C4 → C4, e-Golf → Golf (not EV6 or eNV200)
	const bare = car.model.replace(/^[eë][-\s]/i, '');
	if (bare !== car.model) names.push(bare);
	return names;
}

/** The registered name as registered and without a leading make ("TOYOTA BZ4X" → "BZ4X"). */
function registeredNames(vehicle: RegistryVehicle): string[][] {
	const all = words(vehicle.commercialName);
	const make = words(vehicle.make);
	const names = [all];
	// the whole make ("KG MOBILITY TORRES EVX") or its first word ("VOLKSWAGEN, VW" → "VOLKSWAGEN")
	for (const lead of [make, make.slice(0, 1)]) {
		if (lead.length && lead.length < all.length && lead.every((w, i) => all[i] === w)) {
			names.push(all.slice(lead.length));
			break;
		}
	}
	// "AMG EQE 43 4MATIC" is an EQE
	return names.map((n) => (n.length > 1 && n[0] === 'amg' ? n.slice(1) : n));
}

/** Are `part`'s words, in order, among `whole`'s, starting with the same word? */
function startsAndContains(whole: string[], part: string[]): boolean {
	if (part.length === 0 || part.length > whole.length || whole[0] !== part[0]) return false;
	let i = 0;
	for (const w of whole) if (w === part[i]) i++;
	return i === part.length;
}

const EXACT = 1000;
const SPELLED_OUT = 100;
const SHORTENED = 50;

/**
 * How well a registered name fits a car's model; 0 = not at all.
 * EXACT: the same name. SPELLED_OUT + n: all n words of our name are in theirs ("Q4 e-tron"
 * in "Q4 45 E-TRON"). SHORTENED: theirs is the start of ours ("XC40" for XC40 Recharge,
 * "IONIQ" for any IONIQ, "CORSA" for Corsa-e).
 */
function modelScore(registered: string[][], car: MatchableCar): number {
	let best = 0;
	for (const name of modelNames(car)) {
		const ours = words(name);
		const oursJoined = ours.join('');
		for (const reg of registered) {
			const regJoined = reg.join('');
			if (regJoined === oursJoined) return EXACT;
			if (startsAndContains(reg, ours)) best = Math.max(best, SPELLED_OUT + ours.length);
			else if (
				startsAndContains(ours, reg) ||
				// run together ("500" for 500e), but an "IX" is not an iX1
				(regJoined.length >= 2 &&
					oursJoined.startsWith(regJoined) &&
					!/^\d/.test(oursJoined.slice(regJoined.length)))
			) {
				best = Math.max(best, SHORTENED);
			}
		}
	}
	return best;
}

/** 0 when the year is inside the car's model years, else how many years outside. */
function yearDistance(car: MatchableCar, year: number): number {
	if (car.yearFrom === null) return 0;
	if (year < car.yearFrom) return car.yearFrom - year;
	const to = car.yearTo ?? Infinity;
	return year > to ? year - to : 0;
}

/**
 * A battery size in the registered name ("LEAF 40KWH"): keeps the cars that state it, if
 * any does.
 */
function statedBattery<T extends MatchableCar>(vehicle: RegistryVehicle, cars: T[]): T[] {
	const kwh = /(\d{2,3})(?:[.,]\d)?\s*kwh/i.exec(vehicle.commercialName)?.[1];
	if (!kwh) return cars;
	const stated = cars.filter((c) =>
		new RegExp(`(^|\\D)${kwh}([.,]\\d)?\\s*kwh`, 'i').test(c.variant ?? '')
	);
	return stated.length ? stated : cars;
}

export function matchRegistryVehicle<T extends MatchableCar>(
	vehicle: RegistryVehicle,
	cars: readonly T[],
	/** injectable for tests; the checked-in tables by default */
	hintFor: (v: VariantQuery) => VariantHint | null = variantHint
): PlateMatch<T> {
	if (vehicle.weightedCo2 !== null) return { kind: 'plug-in-hybrid' };
	if (vehicle.co2 !== null && vehicle.co2 > 0) return { kind: 'not-electric' };

	// a registration year can be a year off the model year (registered in January,
	// built the year before), so allow one year either side
	const year = vehicle.firstRegYear;
	const fitsYear = (c: T) => year === null || yearDistance(c, year) <= 1;
	const registered = registeredNames(vehicle);
	const scores = new Map<T, number>();
	const score = (c: T) => {
		let s = scores.get(c);
		if (s === undefined) scores.set(c, (s = modelScore(registered, c)));
		return s;
	};
	const rank = (list: T[]) =>
		[...list].sort(
			(a, b) =>
				score(b) - score(a) || (year === null ? 0 : yearDistance(a, year) - yearDistance(b, year))
		);

	// by name: the cars of the make whose model fits the registered name
	const ofMake = cars.filter((c) => makeMatches(vehicle.make, c.make));
	const fitting = ofMake.filter((c) => score(c) > 0);
	const top = Math.max(0, ...fitting.map(score));
	// Of the models spelled out in the registered name only the fullest is meant: a
	// "Q4 SPORTBACK 50 E-TRON" is a Q4 Sportback e-tron, not also a Q4 e-tron. Models the
	// name is merely short for stay ("NIRO" is an e-Niro, and may be a Niro EV).
	const named =
		top >= SPELLED_OUT
			? fitting.filter((c) => score(c) === top || score(c) === SHORTENED)
			: fitting;
	// Registries drop body-style words: an EQE SUV is registered as "EQE 350 4MATIC", a
	// Taycan Cross Turismo as "TAYCAN 4". Models whose name adds to a matched one stay
	// possible, after it.
	const namedModels = [...new Set(named.map((c) => c.model))].map(words);
	const longer = ofMake.filter(
		(c) => !named.includes(c) && namedModels.some((n) => startsAndContains(words(c.model), n))
	);
	const possible = [...named, ...longer];
	const possibleInYears = possible.filter(fitsYear);
	// a model match outside its known years beats offering nothing
	const byName = possibleInYears.length ? possibleInYears : possible;

	// by variant: what the VIN prefix and the registration day say the car is
	const hint = hintFor(vehicle);
	if (hint) {
		const pool = cars.filter((c) => hint.slugs.has(c.slug));
		// The variant and the registered name must agree on the model. When the name fits
		// other models only, one of the two is wrong and neither is trusted. When the name
		// fits nothing we know, the variant stands if it is this car's own (from its VIN or
		// its registered name); a day's registrations span every model of the make.
		const agreed = pool.filter((c) => possible.includes(c));
		const exact = agreed.length ? agreed : possible.length === 0 && hint.ownModel ? pool : [];
		if (exact.length) {
			// the variant knows the generation better than the registration year does: an
			// old-generation Kona first registered in 2025 is still the old Kona
			const inYears = exact.filter(fitsYear);
			return {
				kind: 'model',
				candidates: rank(statedBattery(vehicle, inYears.length ? inYears : exact))
			};
		}
	}

	if (byName.length > 0) return { kind: 'model', candidates: rank(statedBattery(vehicle, byName)) };

	// the make sells electric cars but none matches the registered name: offer the ones
	// from around the car's year. "Not electric" is only ever said on the registry's word
	// (a CO2 figure), never inferred.
	if (ofMake.length === 0) return { kind: 'unknown' };
	const ofEra = ofMake.filter(fitsYear);
	if (ofEra.length === 0) return { kind: 'unknown' };
	return { kind: 'make', candidates: rank(ofEra) };
}
