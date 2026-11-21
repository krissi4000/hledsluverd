// seeds/cars.json is the hand-maintained list of every electric car the search offers.
// Each entry is the European build of one charging spec (battery, on-board charger, DC
// inlet and peak) with the model years it was sold and the sources it was checked
// against. parseCarSeeds validates it before anything reaches the database and throws on
// the first bad entry: a typo there would show a driver a plug their car does not have.

import { STYLE_PRESET } from '$lib/car-shapes';
import type { ConnectorType } from '$lib/types';

export interface CarSeed {
	slug: string;
	make: string;
	model: string;
	variant: string;
	yearFrom: number;
	yearTo: number | null;
	batteryKwh: number | null;
	acConnector: ConnectorType | null;
	maxAcKw: number | null;
	dcConnector: ConnectorType | null;
	maxDcKw: number | null;
	bodyStyle: string | null;
	lengthMm: number | null;
	heightMm: number | null;
	wheelbaseMm: number | null;
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const AC_PLUGS: readonly unknown[] = ['Type2', null];
const DC_PLUGS: readonly unknown[] = ['CCS2', 'CHAdeMO', null];
const CONFIDENCE: readonly unknown[] = ['high', 'medium', 'low'];
const FIRST_YEAR = 2008;
const LAST_YEAR = 2030;

export function parseCarSeeds(data: { cars: unknown[] }): CarSeed[] {
	const seen = new Set<string>();
	return data.cars.map((raw, i) => {
		const c = (raw ?? {}) as Record<string, unknown>;
		const fail = (why: string): never => {
			throw new Error(`cars.json entry ${i} (${String(c.slug)}): ${why}`);
		};
		const num = (f: string, min: number, max: number, integer = false): number | null => {
			const v = c[f];
			if (v === null || v === undefined) return null;
			if (typeof v !== 'number' || !(v > min && v <= max) || (integer && !Number.isInteger(v))) {
				fail(`${f} must be ${integer ? 'a whole number ' : ''}in (${min}, ${max}], got ${v}`);
			}
			return v as number;
		};

		if (typeof c.slug !== 'string' || !SLUG.test(c.slug)) fail('slug must be kebab-case');
		for (const f of ['make', 'model', 'variant'] as const) {
			if (typeof c[f] !== 'string' || !(c[f] as string).trim()) fail(`${f} is required`);
		}

		const yearFrom = num('yearFrom', FIRST_YEAR - 1, LAST_YEAR, true);
		if (yearFrom === null) fail('yearFrom is required');
		const yearTo = num('yearTo', FIRST_YEAR - 1, LAST_YEAR, true);
		if (yearTo !== null && yearTo < yearFrom!) fail('yearTo is before yearFrom');

		const ac = c.acConnector ?? null;
		const dc = c.dcConnector ?? null;
		if (!AC_PLUGS.includes(ac)) fail(`acConnector must be Type2 or null, got ${ac}`);
		if (!DC_PLUGS.includes(dc)) fail(`dcConnector must be CCS2, CHAdeMO or null, got ${dc}`);
		if (!ac && !dc) fail('a car needs at least one plug');
		const maxAcKw = num('maxAcKw', 0, 43);
		const maxDcKw = num('maxDcKw', 0, 1000);
		if (maxAcKw !== null && !ac) fail('maxAcKw given without an AC plug');
		if (maxDcKw !== null && !dc) fail('maxDcKw given without a DC plug');

		const bodyStyle = c.bodyStyle ?? null;
		if (bodyStyle !== null && !(typeof bodyStyle === 'string' && bodyStyle in STYLE_PRESET)) {
			fail(`unknown bodyStyle ${bodyStyle}`);
		}

		// provenance is not stored in the database, but every entry must carry it
		const sources = c.sources;
		if (
			!Array.isArray(sources) ||
			sources.length === 0 ||
			!sources.every((s) => typeof s === 'string' && /^https?:\/\//.test(s))
		) {
			fail('sources must list at least one http(s) URL');
		}
		if (!CONFIDENCE.includes(c.confidence)) fail('confidence must be high, medium or low');

		const key = `${c.make}/${c.model}/${c.variant}/${yearFrom}`;
		if (seen.has(c.slug as string)) fail('duplicate slug');
		if (seen.has(key)) fail('duplicate make/model/variant/yearFrom');
		seen.add(c.slug as string);
		seen.add(key);

		return {
			slug: c.slug as string,
			make: c.make as string,
			model: c.model as string,
			variant: c.variant as string,
			yearFrom: yearFrom!,
			yearTo,
			batteryKwh: num('batteryKwh', 5, 250),
			acConnector: ac as ConnectorType | null,
			maxAcKw,
			dcConnector: dc as ConnectorType | null,
			maxDcKw,
			bodyStyle: bodyStyle as string | null,
			lengthMm: num('lengthMm', 2000, 7000, true),
			heightMm: num('heightMm', 1000, 3200, true),
			wheelbaseMm: num('wheelbaseMm', 1500, 4500, true)
		};
	});
}
