// Rebuilds seeds/registry-variants.json, the tables that tell which type-approval variant
// a registered car is (src/lib/server/plate-variants.ts). Run it when the sources publish
// new data (the EEA once a year, Traficom every quarter):
//
//   1. Download https://opendata.traficom.fi/Content/Ajoneuvorekisteri.zip (about 200 MB,
//      from https://tieto.traficom.fi/en/datatraficom/open-data) and unzip its one CSV.
//   2. npx tsx scripts/build-registry-variants.ts <path to the CSV>
//   3. Add the EEA's newest table to EEA_TABLES below when a year is published.
//
// Then map any new variants in seeds/variant-cars.json: `--unmapped` lists the variants
// registered in Iceland that no car is mapped to, with the figures to decide by.
//
// Sources and licences:
// - Traficom, open data for vehicles (Finland), CC BY 4.0. One row per vehicle with the
//   first 10 characters of its VIN and its type-approval variant and version.
// - European Environment Agency, "Monitoring of CO2 emissions from passenger cars"
//   (Regulation (EU) 2019/631), reuse permitted with attribution. One row per newly
//   registered car; we take Iceland's battery-electric rows.
// Neither holds plates, full VINs or owners.

import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { registeredNameKey, registryMakeKey, variantKey } from '../src/lib/server/plate-variants';

const OUT = new URL('../seeds/registry-variants.json', import.meta.url);
const CURATED = new URL('../seeds/variant-cars.json', import.meta.url);
const EEA = 'https://discodata.eea.europa.eu/sql';
// [table, years]. The first table holds a provisional (P) and a final (F) row per car.
const EEA_TABLES: [string, number[]][] = [
	['co2cars', [2018, 2019, 2020, 2021, 2022]],
	['co2cars_2023Fv28', [2023]],
	['co2cars_2024Fv30', [2024]],
	['co2cars_2025Pv31', [2025]]
];

interface EeaRow {
	ID: number;
	Status: string;
	Mk: string | null;
	Cn: string | null;
	Va: string | null;
	Ve: string | null;
	Dr: string | null;
	Year: number;
	ep: number | null;
	z: number | null;
	Zr: number | null;
	m: number | null;
}

/** Iceland's electric cars of one year. The endpoint's firewall rejects ORDER BY and OR. */
async function icelandRows(table: string, year: number): Promise<EeaRow[]> {
	const query =
		'SELECT ID, Status, Mk, Cn, Va, Ve, Dr, Year, [Ep (KW)] AS ep, [Z (Wh/km)] AS z, Zr, [M (kg)] AS m ' +
		`FROM [CO2Emission].[latest].[${table}] WHERE MS='IS' AND Ft='ELECTRIC' AND Year=${year}`;
	const limit = 60000;
	const res = await fetch(`${EEA}?query=${encodeURIComponent(query)}&p=1&nrOfHits=${limit}`, {
		headers: { 'user-agent': 'Mozilla/5.0' },
		signal: AbortSignal.timeout(180_000)
	});
	if (!res.ok) throw new Error(`EEA ${table} ${year}: HTTP ${res.status}`);
	const body = (await res.json()) as { results?: EeaRow[]; errors?: unknown };
	if (!body.results) throw new Error(`EEA ${table} ${year}: ${JSON.stringify(body.errors)}`);
	if (body.results.length >= limit)
		throw new Error(`EEA ${table} ${year}: more than ${limit} rows`);
	// one row per car, the final figures where there are two
	const best = new Map<number, EeaRow>();
	for (const r of body.results) {
		const have = best.get(r.ID);
		if (!have || (have.Status !== 'F' && r.Status === 'F')) best.set(r.ID, r);
	}
	return [...best.values()];
}

/** VIN prefix → how many Finnish electric cars carry each variant. */
async function finnishVariants(csvPath: string): Promise<Map<string, Map<string, number>>> {
	const groups = new Map<string, Map<string, number>>();
	const add = (key: string, code: string) => {
		const m = groups.get(key) ?? new Map<string, number>();
		groups.set(key, m);
		m.set(code, (m.get(code) ?? 0) + 1);
	};
	const lines = createInterface({
		input: createReadStream(csvPath, 'latin1'),
		crlfDelay: Infinity
	});
	let col: Record<string, number> | null = null;
	for await (const line of lines) {
		const c = line.split(';');
		if (!col) {
			col = Object.fromEntries(c.map((name, i) => [name, i]));
			for (const name of [
				'ajoneuvoluokka',
				'kayttovoima',
				'variantti',
				'versio',
				'valmistenumero2'
			]) {
				if (!(name in col)) throw new Error(`Traficom CSV has no column ${name}`);
			}
			continue;
		}
		// passenger cars and vans (M1, N1 and their off-road G classes) running on electricity (04)
		if (!/^[MN]1G?$/.test(c[col.ajoneuvoluokka] ?? '') || c[col.kayttovoima] !== '04') continue;
		const vin10 = c[col.valmistenumero2] ?? '';
		const variant = c[col.variantti] ?? '';
		if (!/^[A-HJ-NPR-Z0-9]{10}$/.test(vin10) || !variant) continue;
		const code = variantKey(variant, c[col.versio] ?? '');
		// with the model-year character, and without it for model years not seen yet
		add(vin10.slice(0, 8) + vin10[9], code);
		add(vin10.slice(0, 8), code);
	}
	if (groups.size === 0) throw new Error('no electric cars found in the Traficom CSV');
	return groups;
}

const sorted = <T>(o: Record<string, T>): Record<string, T> =>
	Object.fromEntries(
		Object.keys(o)
			.sort()
			.map((k) => [k, o[k]])
	);

const csvPath = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!csvPath) {
	console.error('usage: npx tsx scripts/build-registry-variants.ts <Traficom CSV> [--unmapped]');
	process.exit(1);
}

const iceland: EeaRow[] = [];
for (const [table, years] of EEA_TABLES) {
	for (const year of years) iceland.push(...(await icelandRows(table, year)));
}
if (iceland.length < 30000)
	throw new Error(`only ${iceland.length} Icelandic rows: a table is missing`);

const days: Record<string, Record<string, Set<string>>> = {};
const names: Record<string, Record<string, Set<string>>> = {};
let coveredTo = '';
for (const r of iceland) {
	const make = registryMakeKey(r.Mk ?? '');
	const code = variantKey(r.Va ?? '', r.Ve ?? '');
	if (code === '/') continue;
	const name = registeredNameKey(r.Cn ?? '');
	if (name) ((names[make] ??= {})[name] ??= new Set()).add(code);
	if (!r.Dr) continue;
	if (r.Dr > coveredTo) coveredTo = r.Dr;
	((days[r.Dr] ??= {})[make] ??= new Set()).add(code);
}

const vin: Record<string, string[]> = {};
for (const [key, counts] of await finnishVariants(csvPath)) {
	const total = [...counts.values()].reduce((a, b) => a + b, 0);
	// A variant seen once among many is most likely a typing error, and an unmapped code
	// would switch the whole prefix off. Rare real variants are seen twice.
	const keep = [...counts].filter(([, n]) => n >= 2 || total < 20);
	if (keep.length) vin[key] = keep.sort((a, b) => b[1] - a[1]).map(([code]) => code);
}

const setsToLists = (o: Record<string, Record<string, Set<string>>>) =>
	sorted(
		Object.fromEntries(
			Object.entries(o).map(([k, v]) => [
				k,
				sorted(Object.fromEntries(Object.entries(v).map(([n, s]) => [n, [...s].sort()])))
			])
		)
	);

const previous = JSON.parse(readFileSync(OUT, 'utf8')) as { _readme: string[] };
writeFileSync(
	OUT,
	JSON.stringify(
		{
			_readme: previous._readme,
			coveredTo,
			vin: sorted(vin),
			names: setsToLists(names),
			days: setsToLists(days)
		},
		null,
		'\t'
	) + '\n'
);
console.log(
	`${iceland.length} Icelandic registrations to ${coveredTo}, ${Object.keys(vin).length} VIN prefixes.`
);
console.log('Now run: npx prettier --write seeds/registry-variants.json');

// which variants registered in Iceland have no car yet, most common first
const mapped = (
	JSON.parse(readFileSync(CURATED, 'utf8')) as { cars: Record<string, Record<string, string[]>> }
).cars;
const unmapped = new Map<string, EeaRow[]>();
for (const r of iceland) {
	const make = registryMakeKey(r.Mk ?? '');
	const code = variantKey(r.Va ?? '', r.Ve ?? '');
	if (mapped[make]?.[code]) continue;
	const key = `${make} ${code}`;
	unmapped.set(key, [...(unmapped.get(key) ?? []), r]);
}
const missing = [...unmapped.values()].reduce((n, rows) => n + rows.length, 0);
console.log(
	`${((100 * (iceland.length - missing)) / iceland.length).toFixed(1)}% of them are a mapped variant.`
);
if (process.argv.includes('--unmapped')) {
	const median = (values: (number | null)[]) => {
		const v = values.filter((x): x is number => x !== null).sort((a, b) => a - b);
		return v.length ? v[Math.floor(v.length / 2)] : null;
	};
	for (const [key, rows] of [...unmapped].sort((a, b) => b[1].length - a[1].length)) {
		const cn = [...new Set(rows.map((r) => (r.Cn ?? '').toUpperCase()))].slice(0, 3).join(' / ');
		const years = rows.map((r) => r.Year);
		console.log(
			`${key}: ${rows.length} cars, ${cn}, ${Math.min(...years)}-${Math.max(...years)}, ` +
				`${median(rows.map((r) => r.ep))} kW, ${median(rows.map((r) => r.Zr))} km WLTP, ` +
				`${median(rows.map((r) => r.z))} Wh/km, ${median(rows.map((r) => r.m))} kg`
		);
	}
}
