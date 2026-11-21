// Which variant of a model is a registered car? The registry's public lookup does not say,
// but it gives the VIN and the registration date, and two open datasets tie those to the
// car's EU type-approval variant (the code that fixes battery, motor and drive):
//
// - Traficom's open vehicle data (Finland, CC BY 4.0) lists every car's first 10 VIN
//   characters beside its type-approval variant. Makers build the variant into the VIN
//   (Volvo "XZED" = XC40 twin motor, Tesla "…FS" = LFP rear-wheel drive), so the first 8
//   characters plus the model-year character decode it for any car sold in Europe.
// - The EEA's CO2 monitoring data (Regulation (EU) 2019/631) lists every new car registered
//   in Iceland with its variant and the name it was registered under, and since mid-2021
//   its registration date. So we know which variants were registered on the car's day, and
//   which ever carried its registered name ("ID.4 GTX 220 KW"). These decide between
//   variants a VIN prefix shares, and cover makes whose European VINs carry no variant
//   (Volkswagen, Audi).
//
// seeds/registry-variants.json holds the tables (scripts/build-registry-variants.ts
// regenerates it) and seeds/variant-cars.json is the hand-kept map from each variant to our
// cars. A car must fit every source that knows it. When they disagree, or name a variant
// nobody has mapped, there is no answer and the owner picks as before: a wrong car is worse
// than a question.

import registryVariants from '../../../seeds/registry-variants.json';
import variantCars from '../../../seeds/variant-cars.json';

const vin = registryVariants.vin as Record<string, string[] | undefined>;
const days = registryVariants.days as Record<string, Record<string, string[]> | undefined>;
const names = registryVariants.names as Record<string, Record<string, string[]> | undefined>;
/** the day and name tables know every new registration up to this date */
const coveredTo: string = registryVariants.coveredTo;
const carsByVariant = variantCars.cars as Record<string, Record<string, string[]> | undefined>;

/**
 * The key the tables file a registered make under. Registries spell makes many ways
 * ("VOLKSWAGEN, VW", "TESLA MOTORS", "BMW I", "KG MOBILITY"); the tables use one per maker.
 */
export function registryMakeKey(make: string): string {
	const k = make.toUpperCase().replace(/[^A-Z0-9]/g, '');
	if (k.startsWith('VOLKSWAGEN') || k === 'VW') return 'VW';
	if (k.startsWith('TESLA')) return 'TESLA';
	if (k.startsWith('MERCEDES')) return 'MERCEDES';
	if (k.startsWith('BMW')) return 'BMW';
	if (k.startsWith('MG')) return 'MG';
	// "ŠKODA" loses its first letter above
	if (k.endsWith('KODA')) return 'SKODA';
	if (k.startsWith('CITRO')) return 'CITROEN';
	if (k.startsWith('DS')) return 'DS';
	if (k.startsWith('KG') || k.startsWith('SSANGYONG')) return 'KGM';
	if (k.startsWith('GREATWALL') || k === 'ORA' || k === 'GWM') return 'GWM';
	return k;
}

/**
 * A type-approval Variant as the tables key it. Some makers' variants are a letter or two
 * and only mean something with the Version (Peugeot "K" + "ZKXZ…" = 2008 with the 100 kW
 * motor), so short ones get the Version's first 3 characters.
 */
export function variantKey(variant: string, version: string): string {
	const va = variant.toUpperCase().replace(/\s+/g, '');
	if (va.length > 3) return va;
	return `${va}/${version.toUpperCase().replace(/\s+/g, '').slice(0, 3)}`;
}

/** First 8 VIN characters + the model-year character (10th), or null for a non-standard VIN. */
export function vinKey(vinNumber: string): string | null {
	const v = vinNumber.toUpperCase().trim();
	return /^[A-HJ-NPR-Z0-9]{17}$/.test(v) ? v.slice(0, 8) + v[9] : null;
}

/** A registered commercial name as the name table keys it: "ID.4 GTX 220 KW" → "ID4GTX220KW". */
export function registeredNameKey(name: string): string {
	return name.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export interface VariantHint {
	/** slugs of the cars the registered variant can be */
	slugs: Set<string>;
	/**
	 * true when the VIN or the registered name is behind it, which are this car's own;
	 * false when only its day is, and a day's registrations span every model of the make.
	 */
	ownModel: boolean;
}

export interface VariantQuery {
	make: string;
	commercialName: string;
	vinKey: string | null;
	/** date it was registered in Iceland as a new car (YYYY-MM-DD); null for a used import */
	registeredNewOn: string | null;
}

/** The cars a registered vehicle's variant can be, or null when the tables cannot tell. */
export function variantHint(v: VariantQuery): VariantHint | null {
	const make = registryMakeKey(v.make);
	const mapped = carsByVariant[make];
	if (!mapped) return null;

	const byVin = v.vinKey ? (vin[v.vinKey] ?? vin[v.vinKey.slice(0, 8)]) : undefined;
	// The Icelandic tables list new registrations only, up to coveredTo. A used import, or a
	// car newer than the tables, may be a variant they never saw.
	const inTables = v.registeredNewOn !== null && v.registeredNewOn <= coveredTo;
	const byDay = inTables ? days[v.registeredNewOn!]?.[make] : undefined;
	const byName = inTables ? names[make]?.[registeredNameKey(v.commercialName)] : undefined;
	const sources = [byVin, byDay, byName].filter((s) => s !== undefined);
	if (sources.length === 0) return null;
	const codes = sources[0].filter((c) => sources.every((s) => s.includes(c)));
	// the sources disagree: trust none
	if (codes.length === 0) return null;

	const slugs = new Set<string>();
	for (const code of codes) {
		const cars = mapped[code];
		// a variant nobody has mapped could be any car
		if (!cars) return null;
		for (const slug of cars) slugs.add(slug);
	}
	return { slugs, ownModel: byVin !== undefined || byName !== undefined };
}
