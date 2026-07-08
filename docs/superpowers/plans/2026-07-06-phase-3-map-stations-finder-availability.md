# Phase 3: Map, Station Pages, Car Finder & Availability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three location-aware pages — `/kort` (full map), `/stod/[slug]` (station detail), `/bilaleit` (car finder) — plus best-effort live availability from TomTom and a cars database seeded from OpenEV Data.

**Architecture:** All reads keep the Phase-2 pattern (small typed query functions over Drizzle in `src/lib/server/db/`, computed in TS). Availability is a single-row-per-station cache (`availability` table, already in the schema) refreshed best-effort from TomTom's EV Charging Stations Availability API — page loads serve the cache with an age label and trigger refresh of stale entries; the refresh never blocks or breaks a page. Maps are MapLibre GL with OpenFreeMap tiles (no key, production-allowed) via one shared `StationMap.svelte` component. Car matching and effective-speed math are pure client-safe helpers so the finder filters entirely client-side.

**Tech Stack:** SvelteKit (Svelte 5 runes), TypeScript, PostgreSQL + PostGIS, Drizzle ORM, Paraglide i18n, Vitest, Playwright, maplibre-gl ^5.24.0 (new dependency), chart.js (existing), TomTom Search/EV Availability API, OpenEV Data v1.24.0.

---

## Context: what already exists (Phases 1–2)

- **Stack conventions:** prettier (tabs, single quotes, width 100; `npm run lint` = `prettier --check .` must stay green — `tests/fixtures/` and `docs/superpowers/plans/` are prettier-ignored). Svelte 5 runes only. Messages live in `messages/is.json` + `messages/en.json`; new keys go **before `"lang_switch"`** in both; import as `import * as m from '$lib/paraglide/messages'`; recompile via `npx svelte-kit sync`; `src/lib/paraglide/` is gitignored — never `git add` it. NEVER touch `.env`. No new markdown files except the README edits Task 11 specifies.
- **Schema (`src/lib/server/db/schema.ts`):** all seven tables already exist, including `cars` (make, model, variant, slug unique, acConnector/maxAcKw/dcConnector/maxDcKw, unique(make, model, variant) nullsNotDistinct) and `availability` (stationId PK → stations, freeCount, totalCount, perType jsonb `Partial<Record<ConnectorType, { free: number; total: number }>>`, fetchedAt, source). `stations.externalIds` is jsonb typed `{ ocm?: number; tomtom?: string; virta?: number; n1?: string }`. `stations.location` is a PostGIS point `mode: 'xy'` — **`location.x` = longitude, `location.y` = latitude**. **No migration is needed in this phase.**
- **Types (`src/lib/types.ts`):** `CONNECTOR_TYPES = ['CCS2', 'CHAdeMO', 'Type2']`, `TARIFF_KEYS = ['AC', 'DC', 'DC_150']`.
- **Queries (`src/lib/server/db/queries.ts`):** `currentPrices(db)` (newest per network:station:tariff scope; rows of inactive stations excluded), `rateCard(db)`, `stationList(db, mode)` → `StationRow { slug, name, networkSlug, networkName, price, minuteFeeIsk, minuteFeeAfterMin, verifiedAt, connectors }` with station-scoped-price-overrides-network-wide resolution, `trendSeries(db, mode)` → `TrendSeries { networkSlug, networkName, points: { t, y }[] }`. `deriveTariffKey(type, powerKw, networkTariffs)` lives in `src/lib/server/matching.ts` (Type2 → AC; ≥150 kW → DC_150 when the network defines it; else DC).
- **Format helpers (`src/lib/format.ts`):** `formatNumber` (comma decimal), `formatIsk`, `formatDate`, `isStale` (>30 days).
- **DB tests:** suites use `describe.skipIf(!TEST_DB_URL)` with `tests/helpers/db.ts` (`setupTestDb`, `truncateAll`, `closeTestDb`); `truncateAll` iterates all schema tables, so `cars`/`availability` are already covered. Vitest runs DB files serially (`fileParallelism: false`). Current counts: **90 unit tests, 8 E2E**.
- **Routes:** `/` (rate card + StationTable with mode/connector/network filters; the table already renders a `th_free` "free chargers" column as a `—` placeholder), `/verdthroun` (Chart.js stepped trend, pattern to copy for the station-page graph), `/admin`. Layout header has a `.nav` with one link (`/verdthroun`).
- **E2E:** `e2e/homepage.test.ts`, Playwright against `npm run build && npm run preview` on port 4173, dev DB (real scraped prices; availability/cars tables empty until this phase's scripts run).
- **Scripts discipline:** `scripts/*.ts` run under tsx — they must not import `$env/*` (use `import 'dotenv/config'` + `process.env`, relative `../src/...` imports). Server-side env in routes/services uses `$env/dynamic/private`. Parsers/services that scripts import must therefore also avoid `$env/*` — pass keys as arguments.
- **Honesty rules (from the approved design, binding):** availability unknown → show `—`, **never `0`** (0 means "all busy"); availability shown → always with its age ("fyrir 2 mín"); TomTom down or budget spent → serve cached values with age label, surface no errors; prices unverified >30 days → amber. A wrong price/availability shown confidently is the one unforgivable failure.

**Non-goals (deferred):** admin station add/edit and OCM re-sync review (Phase 3.5/4 backlog); homepage "near me" filter (the map and finder cover it); availability history; per-connector-type availability display (stored in `perType`, not yet shown); geocoded address search.

## Research findings (verified 2026-07-06)

### OpenEV Data (car specs)

- Repo `open-ev-data/open-ev-data-dataset`, license **CDLA-Permissive-2.0** (resolves vault risk #4 — permissive, attribution courteous not mandatory). Release **v1.24.0** (2025-12-30), 1189 vehicles, 65 makes. Download: `https://github.com/open-ev-data/open-ev-data-dataset/releases/download/v1.24.0/open-ev-data-v1.24.0.json` — top level `{ schema_version, generated_at, vehicle_count, vehicles: [...], metadata }`.
- Vehicle record fields we use: `make {slug, name}`, `model {slug, name}`, `year`, `trim {slug, name}`, `variant {slug, name, kind}?`, `vehicle_type` (passenger_car | suv | pickup | van | other), `charge_ports: [{ kind: combo | ac_only | dc_only, connector }]`, `charging { ac { max_power_kw }, dc? { max_power_kw } }`, `markets: ["US","DE",...]`, `unique_code` (globally unique, e.g. `audi:a6_e_tron:2024:a6_e_tron`).
- Connector values across the dataset: ccs2 (750), gb_t_dc (205), ccs1 (202), type2 (60), nacs (29), gb_t_ac (18), type1 (7), chademo (4).
- **Critical gotcha:** the dataset models the US/global build. 2024 Teslas carry `nacs` and Leafs carry `type1` AC even on records whose `markets` include DE/GB. European builds ship CCS2/Type2 — without normalization Iceland's most common EV (Tesla) would match no station. Import rule: for European-market records, `nacs` → CCS2, `type1` → Type2; `gb_t_*`/`ccs1` ports are skipped; records without any European market are excluded.
- Tesla records have `trim.name === variant.name` ("Long Range" twice) — variant text must dedupe.
- 45 records have a DC port but no `charging.dc` block → `maxDcKw` stays null; the finder then shows the connector's power (documented, acceptable).

### TomTom EV Charging Stations Availability API

- **Iceland is covered** with both EV Static and EV Dynamic per the market-coverage docs — vault risk #1 resolves at documentation level; Task 6 verifies it live.
- Availability endpoint: `GET https://api.tomtom.com/search/2/chargingAvailability.json?key={key}&chargingAvailability={id}`. HTTP 200 with an **empty `connectors` array** means the id is unknown — store nothing. 403 = rate limit/unauthorized, 429 = QPS exceeded.
- Example response (docs, verbatim — Task 4's fixture):
  connectors: `[{ type, total, availability: { current: { available, occupied, reserved, unknown, outOfService }, perPowerLevel: [{ powerKW, available, occupied, reserved, unknown, outOfService }] } }]` plus top-level `chargingAvailability` (the id).
- Connector `type` values seen/mapped: `IEC62196Type2CCS` → CCS2, `Chademo` → CHAdeMO, `IEC62196Type2Outlet` / `IEC62196Type2CableAttached` → Type2. Others (Tesla, IEC60309…) count into totals but not perType.
- The `chargingAvailability` id comes from the Search API: nearby search `GET https://api.tomtom.com/search/2/nearbySearch/.json?key={key}&lat={lat}&lon={lon}&radius={m}&limit={n}` — results carry `position {lat, lon}` and `dataSources.chargingAvailability.id`; only EV-charging POIs have that dataSource, which self-selects them (no category filter needed).
- Freemium tier: 2 500 free requests/day, no card on file — hard-capped, cannot bill. Our daily budget guard stops at 2 000.
- **Requires `TOMTOM_API_KEY`** (free developer account) in `.env` — Task 6 gates on it.

### Maps

- maplibre-gl **^5.24.0** (new runtime dependency, installed in Task 8).
- Tiles: OpenFreeMap `https://tiles.openfreemap.org/styles/liberty` — keyless, no rate limits, commercial use allowed; MapLibre adds the required attribution control automatically.
- Headless-Chromium note for E2E: MapLibre needs WebGL. If pins never appear in Playwright, add `use: { launchOptions: { args: ['--enable-unsafe-swiftshader'] } }` to `playwright.config.ts` (software WebGL) — do that only if the map E2E actually fails without it.

## File structure

```
src/lib/geo.ts                          NEW  haversine + km formatting (client-safe)
src/lib/ev.ts                           NEW  car↔station matching + effective speed (client-safe)
src/lib/format.ts                       MOD  + ageParts()
src/lib/server/cars-import.ts           NEW  OpenEV Data → CarSeed[] parser (pure)
src/lib/server/db/cars.ts               NEW  carList query
src/lib/server/db/availability.ts       NEW  upsert + read of the availability cache
src/lib/server/tomtom.ts                NEW  TomTom response parsing + fetch (key as arg)
src/lib/server/availability-refresh.ts  NEW  stale-entry refresh with daily budget
src/lib/server/db/queries.ts            MOD  + stationDetail, + mapStations, StationRow + availability
src/lib/components/StationMap.svelte    NEW  shared MapLibre map (pins, selection, location pick)
src/lib/components/StationTable.svelte  MOD  free-chargers cell + station links
src/routes/stod/[slug]/+page.server.ts  NEW  station detail + single-station refresh
src/routes/stod/[slug]/+page.svelte     NEW  detail page (mini-map, prices, availability, trend)
src/routes/kort/+page.server.ts         NEW  all stations + background refresh
src/routes/kort/+page.svelte            NEW  full map with mini-card
src/routes/bilaleit/+page.server.ts     NEW  cars + stations payload
src/routes/bilaleit/+page.svelte        NEW  finder (car search, location, compatible map)
src/routes/+layout.svelte               MOD  nav links: Kort, Bílaleit
scripts/seed-cars.ts                    NEW  npm run seed:cars
scripts/match-tomtom.ts                 NEW  npm run match:tomtom
tests/fixtures/open-ev-data-sample.json NEW  4 real vehicles (all normalization paths)
tests/fixtures/tomtom-charging-availability.json NEW verbatim docs example
```

---

### Task 1: Client-safe geo + EV helpers

**Files:**
- Create: `src/lib/geo.ts` + Test: `src/lib/geo.test.ts`
- Create: `src/lib/ev.ts` + Test: `src/lib/ev.test.ts`

- [ ] **Step 1: Failing tests**

`src/lib/geo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatKm, haversineKm } from './geo';

describe('haversineKm', () => {
	it('measures Reykjavík–Akureyri at roughly 250 km', () => {
		const rvk = { lat: 64.1466, lng: -21.9426 };
		const aku = { lat: 65.6835, lng: -18.1002 };
		const d = haversineKm(rvk, aku);
		expect(d).toBeGreaterThan(240);
		expect(d).toBeLessThan(260);
		expect(haversineKm(aku, rvk)).toBeCloseTo(d, 6);
	});

	it('is zero for the same point', () => {
		expect(haversineKm({ lat: 64.1, lng: -21.9 }, { lat: 64.1, lng: -21.9 })).toBe(0);
	});
});

describe('formatKm', () => {
	it('shows one decimal under 10 km and whole km above', () => {
		expect(formatKm(1.234)).toBe('1,2 km');
		expect(formatKm(42.6)).toBe('43 km');
	});
});
```

`src/lib/ev.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { carMatchesStation, effectiveKw, type CarSpec } from './ev';

const leaf: CarSpec = { acConnector: 'Type2', maxAcKw: 6.6, dcConnector: 'CHAdeMO', maxDcKw: 50 };
const id4: CarSpec = { acConnector: 'Type2', maxAcKw: 11, dcConnector: 'CCS2', maxDcKw: 135 };

describe('carMatchesStation', () => {
	it('rejects a station with no matching connector', () => {
		expect(carMatchesStation(leaf, [{ type: 'CCS2', powerKw: 150 }])).toBe(false);
	});

	it('matches on either the AC or the DC connector', () => {
		expect(carMatchesStation(leaf, [{ type: 'CHAdeMO', powerKw: 50 }])).toBe(true);
		expect(carMatchesStation(leaf, [{ type: 'Type2', powerKw: 22 }])).toBe(true);
	});
});

describe('effectiveKw', () => {
	it('is limited by the car when the connector is faster', () => {
		expect(effectiveKw(id4, [{ type: 'CCS2', powerKw: 300 }])).toBe(135);
	});

	it('is limited by the connector when the car is faster', () => {
		expect(effectiveKw(id4, [{ type: 'CCS2', powerKw: 60 }])).toBe(60);
	});

	it('takes the best matching connector and ignores the rest', () => {
		expect(
			effectiveKw(leaf, [
				{ type: 'Type2', powerKw: 22 },
				{ type: 'CHAdeMO', powerKw: 50 },
				{ type: 'CCS2', powerKw: 300 }
			])
		).toBe(50);
	});

	it('plug-type fallback (null car max) yields the connector power', () => {
		const plugOnly: CarSpec = {
			acConnector: null,
			maxAcKw: null,
			dcConnector: 'CCS2',
			maxDcKw: null
		};
		expect(effectiveKw(plugOnly, [{ type: 'CCS2', powerKw: 150 }])).toBe(150);
	});

	it('returns null when nothing matches', () => {
		expect(effectiveKw(leaf, [{ type: 'CCS2', powerKw: 150 }])).toBeNull();
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/geo.test.ts src/lib/ev.test.ts` — expect FAIL (modules missing).

- [ ] **Step 3: Implement**

`src/lib/geo.ts`:

```ts
export interface LatLng {
	lat: number;
	lng: number;
}

const R_KM = 6371;

/** Great-circle distance (haversine) — accurate to ~0.5%, plenty for sorting stations. */
export function haversineKm(a: LatLng, b: LatLng): number {
	const rad = (d: number) => (d * Math.PI) / 180;
	const dLat = rad(b.lat - a.lat);
	const dLng = rad(b.lng - a.lng);
	const s =
		Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
	return 2 * R_KM * Math.asin(Math.sqrt(s));
}

export function formatKm(km: number): string {
	return km < 10 ? `${km.toFixed(1).replace('.', ',')} km` : `${Math.round(km)} km`;
}
```

`src/lib/ev.ts`:

```ts
import type { ConnectorType } from '$lib/types';

/** What matching needs to know about a car (subset of a cars-table row). */
export interface CarSpec {
	acConnector: ConnectorType | null;
	maxAcKw: number | null;
	dcConnector: ConnectorType | null;
	maxDcKw: number | null;
}

export interface StationConnector {
	type: ConnectorType;
	powerKw: number;
}

/** Design rule: match = the station has ≥1 connector equal to the car's AC or DC connector. */
export function carMatchesStation(car: CarSpec, connectors: StationConnector[]): boolean {
	return connectors.some((c) => c.type === car.acConnector || c.type === car.dcConnector);
}

/**
 * Effective charging speed at a station = max over matching connectors of
 * min(car max for that kind, connector power). A null car max (plug-type fallback,
 * or a dataset record without a DC spec) does not limit — the connector power counts.
 */
export function effectiveKw(car: CarSpec, connectors: StationConnector[]): number | null {
	let best: number | null = null;
	for (const c of connectors) {
		let carMax: number | null;
		if (c.type === car.dcConnector) carMax = car.maxDcKw;
		else if (c.type === car.acConnector) carMax = car.maxAcKw;
		else continue;
		const kw = Math.min(carMax ?? Infinity, c.powerKw);
		if (best === null || kw > best) best = kw;
	}
	return best;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/geo.test.ts src/lib/ev.test.ts` — expect 8 passing. Then `npx vitest run` — expect 98.

- [ ] **Step 5: Commit**

```bash
git add src/lib/geo.ts src/lib/geo.test.ts src/lib/ev.ts src/lib/ev.test.ts
git commit -m "feat: geo distance and car-compatibility helpers"
```

---

### Task 2: Cars import — OpenEV Data parser, seed script, carList query

**Files:**
- Create: `src/lib/server/cars-import.ts` + Test: `src/lib/server/cars-import.test.ts`
- Create: `tests/fixtures/open-ev-data-sample.json`
- Create: `scripts/seed-cars.ts`
- Create: `src/lib/server/db/cars.ts` + Test: `src/lib/server/db/cars.test.ts`
- Modify: `package.json` (script `seed:cars`)

- [ ] **Step 1: Fixture — four real vehicles covering every normalization path**

Create `tests/fixtures/open-ev-data-sample.json` with EXACTLY this content (four records extracted verbatim from the v1.24.0 release: plain ccs2, nacs→CCS2, chademo+type1, and a China-only exclusion):

```json
{
	"schema_version": "1.0.0",
	"vehicle_count": 4,
	"vehicles": [
		{
			"make": { "slug": "audi", "name": "Audi" },
			"model": { "slug": "a6_e_tron", "name": "A6 e-tron" },
			"year": 2024,
			"trim": { "slug": "base", "name": "Base" },
			"variant": { "slug": "sportback", "name": "Sportback", "kind": "body_style" },
			"vehicle_type": "passenger_car",
			"charge_ports": [{ "kind": "combo", "connector": "ccs2" }],
			"charging": {
				"ac": { "max_power_kw": 11, "phases": 3 },
				"dc": { "max_power_kw": 270, "architecture_voltage_class": "800v" }
			},
			"markets": ["US", "BR", "DE", "GB", "FR", "PT", "IT", "CN", "JP"],
			"unique_code": "audi:a6_e_tron:2024:a6_e_tron"
		},
		{
			"make": { "slug": "tesla", "name": "Tesla" },
			"model": { "slug": "model_3", "name": "Model 3" },
			"year": 2024,
			"trim": { "slug": "long_range", "name": "Long Range" },
			"variant": { "slug": "long_range", "name": "Long Range", "kind": "extended_range" },
			"vehicle_type": "passenger_car",
			"charge_ports": [{ "kind": "combo", "connector": "nacs" }],
			"charging": {
				"ac": { "max_power_kw": 11, "phases": 3 },
				"dc": { "max_power_kw": 250, "architecture_voltage_class": "400v" }
			},
			"markets": ["US", "CN", "DE", "GB", "FR", "JP"],
			"unique_code": "tesla:model_3:2024:model_3_long_range"
		},
		{
			"make": { "slug": "nissan", "name": "Nissan" },
			"model": { "slug": "leaf", "name": "Leaf" },
			"year": 2024,
			"trim": { "slug": "base", "name": "Base" },
			"vehicle_type": "passenger_car",
			"charge_ports": [
				{ "kind": "dc_only", "connector": "chademo" },
				{ "kind": "ac_only", "connector": "type1" }
			],
			"charging": {
				"ac": { "max_power_kw": 6.6, "phases": 1 },
				"dc": { "max_power_kw": 50, "architecture_voltage_class": "400v" }
			},
			"markets": ["US", "BR", "DE", "GB", "FR", "PT", "IT", "CN", "JP"],
			"unique_code": "nissan:leaf:2024:leaf"
		},
		{
			"make": { "slug": "byd", "name": "BYD" },
			"model": { "slug": "dolphin_mini", "name": "Dolphin Mini" },
			"year": 2023,
			"trim": { "slug": "plus", "name": "Plus" },
			"variant": { "slug": "plus", "name": "Plus", "kind": "battery_upgrade" },
			"vehicle_type": "passenger_car",
			"charge_ports": [{ "kind": "combo", "connector": "gb_t_dc" }],
			"charging": {
				"ac": { "max_power_kw": 6.6, "phases": 1 },
				"dc": { "max_power_kw": 40, "architecture_voltage_class": "400v" }
			},
			"markets": ["CN"],
			"unique_code": "byd:dolphin_mini:2023:dolphin_mini_plus"
		}
	]
}
```

- [ ] **Step 2: Failing parser tests**

`src/lib/server/cars-import.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseOpenEvData } from './cars-import';

const fixture = JSON.parse(
	readFileSync('tests/fixtures/open-ev-data-sample.json', 'utf8')
) as Parameters<typeof parseOpenEvData>[0];

describe('parseOpenEvData', () => {
	const result = parseOpenEvData(fixture);

	it('maps a ccs2 combo car to CCS2 + Type2 with both power figures', () => {
		const audi = result.cars.find((c) => c.slug === 'audi-a6-e-tron-2024-a6-e-tron')!;
		expect(audi).toMatchObject({
			make: 'Audi',
			model: 'A6 e-tron',
			variant: 'Base Sportback 2024',
			acConnector: 'Type2',
			maxAcKw: 11,
			dcConnector: 'CCS2',
			maxDcKw: 270
		});
	});

	it('normalizes nacs to CCS2 for European-market builds (Tesla)', () => {
		const tesla = result.cars.find((c) => c.slug === 'tesla-model-3-2024-model-3-long-range')!;
		expect(tesla.dcConnector).toBe('CCS2');
		expect(tesla.acConnector).toBe('Type2');
		// trim and variant are both "Long Range" — deduped, not repeated
		expect(tesla.variant).toBe('Long Range 2024');
	});

	it('maps chademo DC and normalizes type1 AC to Type2 (Leaf)', () => {
		const leaf = result.cars.find((c) => c.slug === 'nissan-leaf-2024-leaf')!;
		expect(leaf).toMatchObject({
			variant: 'Base 2024',
			acConnector: 'Type2',
			maxAcKw: 6.6,
			dcConnector: 'CHAdeMO',
			maxDcKw: 50
		});
	});

	it('excludes records without a European market', () => {
		expect(result.cars).toHaveLength(3);
		expect(result.skippedNonEuropean).toBe(1);
	});

	it('skips EU-market records whose ports all fail to map, with a warning', () => {
		const weird = parseOpenEvData({
			vehicles: [
				{
					...fixture.vehicles[3],
					markets: ['DE'],
					unique_code: 'byd:dolphin_mini:2023:eu_test'
				}
			]
		});
		expect(weird.cars).toHaveLength(0);
		expect(weird.skippedNoMappedPorts).toBe(1);
		expect(weird.warnings[0]).toMatch(/unmapped port combo:gb_t_dc/);
	});
});
```

Run: `npx vitest run src/lib/server/cars-import.test.ts` — expect FAIL (module missing).

- [ ] **Step 3: Implement the parser**

`src/lib/server/cars-import.ts`:

```ts
import type { ConnectorType } from '$lib/types';

/** The subset of an OpenEV Data vehicle record that the import reads. */
export interface OpenEvVehicle {
	make: { slug: string; name: string };
	model: { slug: string; name: string };
	year: number;
	trim?: { slug: string; name: string } | null;
	variant?: { slug: string; name: string; kind?: string } | null;
	vehicle_type?: string;
	charge_ports?: { kind: string; connector: string }[];
	charging?: {
		ac?: { max_power_kw?: number } | null;
		dc?: { max_power_kw?: number } | null;
	} | null;
	markets?: string[];
	unique_code: string;
}

export interface CarSeed {
	make: string;
	model: string;
	variant: string;
	slug: string;
	acConnector: ConnectorType | null;
	maxAcKw: number | null;
	dcConnector: ConnectorType | null;
	maxDcKw: number | null;
}

export interface CarsImportResult {
	cars: CarSeed[];
	skippedNonEuropean: number;
	skippedNoMappedPorts: number;
	warnings: string[];
}

/** Markets whose cars ship with European (IEC 62196) charge ports. */
const EUROPEAN_MARKETS = new Set([
	'IS',
	'DE',
	'GB',
	'FR',
	'IT',
	'ES',
	'PT',
	'NL',
	'BE',
	'LU',
	'AT',
	'CH',
	'IE',
	'DK',
	'SE',
	'NO',
	'FI',
	'PL',
	'CZ',
	'SK',
	'HU',
	'SI',
	'HR',
	'RO',
	'BG',
	'GR',
	'EE',
	'LV',
	'LT'
]);

// The dataset models the US/global build (Tesla → nacs, Leaf AC → type1). European
// builds of the same cars ship CCS2/Type2 inlets, so European-market records are
// normalized: nacs → CCS2, type1 → Type2. Chinese GB/T and US CCS1 ports have no
// European equivalent on the record itself — those ports are skipped with a warning.
const DC_MAP: Record<string, ConnectorType> = { ccs2: 'CCS2', nacs: 'CCS2', chademo: 'CHAdeMO' };
const AC_MAP: Record<string, ConnectorType> = { type2: 'Type2', type1: 'Type2' };

export function parseOpenEvData(data: { vehicles: OpenEvVehicle[] }): CarsImportResult {
	const out: CarsImportResult = {
		cars: [],
		skippedNonEuropean: 0,
		skippedNoMappedPorts: 0,
		warnings: []
	};
	for (const v of data.vehicles) {
		if (!(v.markets ?? []).some((mkt) => EUROPEAN_MARKETS.has(mkt))) {
			out.skippedNonEuropean++;
			continue;
		}
		let dcConnector: ConnectorType | null = null;
		let acConnector: ConnectorType | null = null;
		for (const p of v.charge_ports ?? []) {
			const dc = DC_MAP[p.connector];
			const ac = AC_MAP[p.connector];
			if ((p.kind === 'combo' || p.kind === 'dc_only') && dc) {
				// CCS2 beats CHAdeMO if a record somehow lists both DC ports
				if (dcConnector === null || dc === 'CCS2') dcConnector = dc;
			}
			// a CCS2 combo inlet accepts a plain Type2 AC plug
			if (p.kind === 'combo' && dc === 'CCS2') acConnector = 'Type2';
			if ((p.kind === 'ac_only' || p.kind === 'combo') && ac) acConnector = ac;
			if (!dc && !ac) out.warnings.push(`${v.unique_code}: unmapped port ${p.kind}:${p.connector}`);
		}
		if (!dcConnector && !acConnector) {
			out.skippedNoMappedPorts++;
			continue;
		}
		const variantParts = [
			v.trim?.name,
			v.variant?.name !== v.trim?.name ? v.variant?.name : null,
			String(v.year)
		];
		out.cars.push({
			make: v.make.name,
			model: v.model.name,
			variant: variantParts.filter(Boolean).join(' '),
			slug: v.unique_code.replace(/[:_]+/g, '-'),
			acConnector,
			maxAcKw: acConnector ? (v.charging?.ac?.max_power_kw ?? null) : null,
			dcConnector,
			maxDcKw: dcConnector ? (v.charging?.dc?.max_power_kw ?? null) : null
		});
	}
	return out;
}
```

Run: `npx vitest run src/lib/server/cars-import.test.ts` — expect 5 passing.

- [ ] **Step 4: Failing carList test**

`src/lib/server/db/cars.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DB_URL, closeTestDb, setupTestDb, truncateAll } from '../../../../tests/helpers/db';
import type { Db } from './client';
import { cars } from './schema';
import { carList } from './cars';

describe.skipIf(!TEST_DB_URL)('carList', () => {
	let db: Db;

	beforeAll(async () => {
		db = await setupTestDb();
	});
	afterAll(async () => {
		await closeTestDb(db);
	});
	beforeEach(async () => {
		await truncateAll(db);
	});

	it('returns cars ordered by make, model, variant with connector fields', async () => {
		await db.insert(cars).values([
			{
				make: 'Tesla',
				model: 'Model 3',
				variant: 'Long Range 2024',
				slug: 'tesla-model-3-2024-lr',
				acConnector: 'Type2',
				maxAcKw: 11,
				dcConnector: 'CCS2',
				maxDcKw: 250
			},
			{
				make: 'Nissan',
				model: 'Leaf',
				variant: 'Base 2024',
				slug: 'nissan-leaf-2024',
				acConnector: 'Type2',
				maxAcKw: 6.6,
				dcConnector: 'CHAdeMO',
				maxDcKw: 50
			}
		]);
		const list = await carList(db);
		expect(list.map((c) => c.make)).toEqual(['Nissan', 'Tesla']);
		expect(list[0]).toMatchObject({
			slug: 'nissan-leaf-2024',
			dcConnector: 'CHAdeMO',
			maxDcKw: 50
		});
	});

	it('returns an empty list when no cars are seeded', async () => {
		expect(await carList(db)).toEqual([]);
	});
});
```

Run: `npx vitest run src/lib/server/db/cars.test.ts` — expect FAIL.

- [ ] **Step 5: Implement carList**

`src/lib/server/db/cars.ts`:

```ts
import { asc } from 'drizzle-orm';
import type { ConnectorType } from '$lib/types';
import type { Db } from './client';
import { cars } from './schema';

export interface CarRow {
	slug: string;
	make: string;
	model: string;
	variant: string | null;
	acConnector: ConnectorType | null;
	maxAcKw: number | null;
	dcConnector: ConnectorType | null;
	maxDcKw: number | null;
}

/** Every car, ordered for the finder's search list (shipped to the client as JSON). */
export async function carList(db: Db): Promise<CarRow[]> {
	const rows = await db
		.select()
		.from(cars)
		.orderBy(asc(cars.make), asc(cars.model), asc(cars.variant));
	return rows.map((c) => ({
		slug: c.slug,
		make: c.make,
		model: c.model,
		variant: c.variant,
		acConnector: c.acConnector,
		maxAcKw: c.maxAcKw,
		dcConnector: c.dcConnector,
		maxDcKw: c.maxDcKw
	}));
}
```

Run: `npx vitest run src/lib/server/db/cars.test.ts` — expect 2 passing.

- [ ] **Step 6: Seed script**

`scripts/seed-cars.ts`:

```ts
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createDb } from '../src/lib/server/db/client';
import { cars } from '../src/lib/server/db/schema';
import { parseOpenEvData, type OpenEvVehicle } from '../src/lib/server/cars-import';

// Pinned release — bump deliberately, re-run to refresh (upserts by slug).
const DATASET_URL =
	'https://github.com/open-ev-data/open-ev-data-dataset/releases/download/v1.24.0/open-ev-data-v1.24.0.json';

async function loadDataset(): Promise<{ vehicles: OpenEvVehicle[] }> {
	const localPath = process.argv[2];
	if (localPath) return JSON.parse(readFileSync(localPath, 'utf8'));
	const res = await fetch(DATASET_URL, { redirect: 'follow' });
	if (!res.ok) throw new Error(`dataset download failed: HTTP ${res.status}`);
	return (await res.json()) as { vehicles: OpenEvVehicle[] };
}

async function main() {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL missing');
	const db = createDb(url);
	const parsed = parseOpenEvData(await loadDataset());
	let upserted = 0;
	let conflicts = 0;
	for (const c of parsed.cars) {
		try {
			await db
				.insert(cars)
				.values(c)
				.onConflictDoUpdate({ target: cars.slug, set: { ...c } });
			upserted++;
		} catch (e) {
			// duplicate (make, model, variant) across distinct unique_codes — skip, keep the first
			conflicts++;
			console.warn(`SKIP ${c.slug}: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
		}
	}
	for (const w of parsed.warnings) console.warn(`WARN ${w}`);
	console.log(
		`cars: ${upserted} upserted, ${conflicts} constraint conflicts skipped, ` +
			`${parsed.skippedNonEuropean} non-European skipped, ` +
			`${parsed.skippedNoMappedPorts} without usable ports skipped`
	);
	await db.$client.end();
}

main().catch((e) => {
	console.error(e);
	process.exitCode = 1;
});
```

Add to `package.json` scripts (after `seed:prices`):

```json
		"seed:cars": "tsx scripts/seed-cars.ts",
```

- [ ] **Step 7: Run the import live**

Run: `npm run seed:cars`
Expected: several hundred cars upserted (dataset has 1189 vehicles; non-European and port-less records are skipped), a handful of constraint-conflict SKIPs and unmapped-port WARNs is normal. Then sanity-check:

```bash
psql hledsluverd -c "SELECT count(*), count(*) FILTER (WHERE dc_connector IS NOT NULL) AS dc FROM cars;"
psql hledsluverd -c "SELECT make, model, variant, ac_connector, max_ac_kw, dc_connector, max_dc_kw FROM cars WHERE make='Tesla' LIMIT 5;"
```

Expected: Teslas show `dc_connector = CCS2` (the normalization worked). If count is 0 or Teslas are missing, STOP and report — do not proceed with an empty cars table.

- [ ] **Step 8: Full verification + commit**

```bash
npm run lint && npx vitest run
```

Expected: lint clean, 105 tests passing. Then:

```bash
git add src/lib/server/cars-import.ts src/lib/server/cars-import.test.ts tests/fixtures/open-ev-data-sample.json scripts/seed-cars.ts src/lib/server/db/cars.ts src/lib/server/db/cars.test.ts package.json
git commit -m "feat: cars database seeded from OpenEV Data with European-build normalization"
```

---

### Task 3: Availability cache store

**Files:**
- Create: `src/lib/server/db/availability.ts` + Test: `src/lib/server/db/availability.test.ts`

- [ ] **Step 1: Failing tests**

`src/lib/server/db/availability.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DB_URL, closeTestDb, setupTestDb, truncateAll } from '../../../../tests/helpers/db';
import type { Db } from './client';
import { networks, stations } from './schema';
import { availabilityAll, upsertAvailability } from './availability';

describe.skipIf(!TEST_DB_URL)('availability store', () => {
	let db: Db;
	let stationId: number;

	beforeAll(async () => {
		db = await setupTestDb();
	});
	afterAll(async () => {
		await closeTestDb(db);
	});
	beforeEach(async () => {
		await truncateAll(db);
		const [n] = await db.insert(networks).values({ name: 'ON', slug: 'on' }).returning();
		const [s] = await db
			.insert(stations)
			.values({
				networkId: n.id,
				slug: 'hellisheidi-on',
				name: 'Hellisheiði',
				location: { x: -21.4, y: 64.03 }
			})
			.returning();
		stationId = s.id;
	});

	it('inserts a first entry with fetchedAt defaulting to now', async () => {
		await upsertAvailability(db, {
			stationId,
			freeCount: 3,
			totalCount: 4,
			perType: { CCS2: { free: 3, total: 4 } },
			source: 'tomtom'
		});
		const all = await availabilityAll(db);
		expect(all).toHaveLength(1);
		expect(all[0]).toMatchObject({ stationId, freeCount: 3, totalCount: 4, source: 'tomtom' });
		expect(all[0].perType).toEqual({ CCS2: { free: 3, total: 4 } });
		expect(Math.abs(Date.now() - all[0].fetchedAt.getTime())).toBeLessThan(5000);
	});

	it('upsert overwrites the existing entry (latest only, no history)', async () => {
		await upsertAvailability(db, {
			stationId,
			freeCount: 3,
			totalCount: 4,
			perType: null,
			source: 'tomtom'
		});
		await upsertAvailability(db, {
			stationId,
			freeCount: 0,
			totalCount: 4,
			perType: null,
			source: 'tomtom',
			fetchedAt: new Date('2026-07-06T12:00:00Z')
		});
		const all = await availabilityAll(db);
		expect(all).toHaveLength(1);
		expect(all[0].freeCount).toBe(0);
		expect(all[0].fetchedAt.toISOString()).toBe('2026-07-06T12:00:00.000Z');
	});
});
```

Run: `npx vitest run src/lib/server/db/availability.test.ts` — expect FAIL.

- [ ] **Step 2: Implement**

`src/lib/server/db/availability.ts`:

```ts
import type { ConnectorType } from '$lib/types';
import type { Db } from './client';
import { availability } from './schema';

export interface AvailabilityEntry {
	stationId: number;
	freeCount: number | null;
	totalCount: number | null;
	perType: Partial<Record<ConnectorType, { free: number; total: number }>> | null;
	fetchedAt: Date;
	source: string;
}

/** Latest-only cache: one row per station, overwritten on every refresh. */
export async function upsertAvailability(
	db: Db,
	entry: Omit<AvailabilityEntry, 'fetchedAt'> & { fetchedAt?: Date }
): Promise<void> {
	const row = { ...entry, fetchedAt: entry.fetchedAt ?? new Date() };
	await db
		.insert(availability)
		.values(row)
		.onConflictDoUpdate({
			target: availability.stationId,
			set: {
				freeCount: row.freeCount,
				totalCount: row.totalCount,
				perType: row.perType,
				fetchedAt: row.fetchedAt,
				source: row.source
			}
		});
}

export async function availabilityAll(db: Db): Promise<AvailabilityEntry[]> {
	const rows = await db.select().from(availability);
	return rows.map((r) => ({
		stationId: r.stationId,
		freeCount: r.freeCount,
		totalCount: r.totalCount,
		perType: r.perType,
		fetchedAt: r.fetchedAt,
		source: r.source
	}));
}
```

- [ ] **Step 3: Run to verify pass**

Run: `npx vitest run src/lib/server/db/availability.test.ts` — expect 2 passing. Full run: 107.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/db/availability.ts src/lib/server/db/availability.test.ts
git commit -m "feat: availability cache store (latest-only upsert per station)"
```

---

### Task 4: TomTom availability client

**Files:**
- Create: `src/lib/server/tomtom.ts` + Test: `src/lib/server/tomtom.test.ts`
- Create: `tests/fixtures/tomtom-charging-availability.json`

**Constraint:** no `$env/*` imports — the API key is always a function argument (scripts run this under tsx).

- [ ] **Step 1: Fixture — the documented example response, verbatim**

Create `tests/fixtures/tomtom-charging-availability.json`:

```json
{
	"connectors": [
		{
			"type": "IEC62196Type2Outlet",
			"total": 2,
			"availability": {
				"current": {
					"available": 1,
					"occupied": 1,
					"reserved": 0,
					"unknown": 0,
					"outOfService": 0
				},
				"perPowerLevel": [
					{
						"powerKW": 22.2,
						"available": 1,
						"occupied": 0,
						"reserved": 0,
						"unknown": 0,
						"outOfService": 0
					},
					{
						"powerKW": 50.0,
						"available": 0,
						"occupied": 1,
						"reserved": 0,
						"unknown": 0,
						"outOfService": 0
					}
				]
			}
		}
	],
	"chargingAvailability": "75502858-a491-36fe-7128-23d400153b86"
}
```

- [ ] **Step 2: Failing tests**

`src/lib/server/tomtom.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	fetchChargingAvailability,
	parseChargingAvailability,
	type TomTomAvailabilityResponse
} from './tomtom';

const fixture = JSON.parse(
	readFileSync('tests/fixtures/tomtom-charging-availability.json', 'utf8')
) as TomTomAvailabilityResponse;

describe('parseChargingAvailability', () => {
	it('sums free and total across connectors and maps known types', () => {
		const parsed = parseChargingAvailability(fixture)!;
		expect(parsed.freeCount).toBe(1);
		expect(parsed.totalCount).toBe(2);
		expect(parsed.perType).toEqual({ Type2: { free: 1, total: 2 } });
	});

	it('counts unmapped connector types into the totals but not perType', () => {
		const parsed = parseChargingAvailability({
			connectors: [
				{
					type: 'IEC62196Type2CCS',
					total: 4,
					availability: {
						current: { available: 2, occupied: 2, reserved: 0, unknown: 0, outOfService: 0 }
					}
				},
				{
					type: 'Tesla',
					total: 8,
					availability: {
						current: { available: 5, occupied: 3, reserved: 0, unknown: 0, outOfService: 0 }
					}
				}
			],
			chargingAvailability: 'x'
		})!;
		expect(parsed.freeCount).toBe(7);
		expect(parsed.totalCount).toBe(12);
		expect(parsed.perType).toEqual({ CCS2: { free: 2, total: 4 } });
	});

	it('returns null for an empty connectors array (unknown id) and throws on garbage', () => {
		expect(parseChargingAvailability({ connectors: [], chargingAvailability: 'x' })).toBeNull();
		expect(() =>
			parseChargingAvailability({ connectors: [{}] } as unknown as TomTomAvailabilityResponse)
		).toThrow(/TomTom availability/);
	});
});

describe('fetchChargingAvailability', () => {
	it('calls the endpoint with the id and parses the body', async () => {
		let calledUrl = '';
		const fakeFetch = (async (url: RequestInfo | URL) => {
			calledUrl = String(url);
			return new Response(JSON.stringify(fixture), { status: 200 });
		}) as typeof fetch;
		const parsed = await fetchChargingAvailability('test-key', 'abc-123', fakeFetch);
		expect(calledUrl).toContain('chargingAvailability.json');
		expect(calledUrl).toContain('key=test-key');
		expect(calledUrl).toContain('chargingAvailability=abc-123');
		expect(parsed!.freeCount).toBe(1);
	});

	it('throws on a non-200 response', async () => {
		const fakeFetch = (async () => new Response('nope', { status: 403 })) as typeof fetch;
		await expect(fetchChargingAvailability('k', 'id', fakeFetch)).rejects.toThrow(/HTTP 403/);
	});
});
```

Run: `npx vitest run src/lib/server/tomtom.test.ts` — expect FAIL.

- [ ] **Step 3: Implement**

`src/lib/server/tomtom.ts`:

```ts
import type { ConnectorType } from '$lib/types';

const BASE = 'https://api.tomtom.com/search/2';

/** TomTom connector type → our enum; unmapped types still count into the totals. */
const CONNECTOR_MAP: Record<string, ConnectorType> = {
	IEC62196Type2CCS: 'CCS2',
	Chademo: 'CHAdeMO',
	IEC62196Type2Outlet: 'Type2',
	IEC62196Type2CableAttached: 'Type2'
};

interface TomTomCurrent {
	available: number;
	occupied: number;
	reserved: number;
	unknown: number;
	outOfService: number;
}

export interface TomTomAvailabilityResponse {
	connectors: {
		type: string;
		total: number;
		availability: { current: TomTomCurrent };
	}[];
	chargingAvailability: string;
}

export interface ParsedAvailability {
	freeCount: number;
	totalCount: number;
	perType: Partial<Record<ConnectorType, { free: number; total: number }>>;
}

/** An empty connectors array means TomTom does not know the id — we know nothing, store nothing. */
export function parseChargingAvailability(
	body: TomTomAvailabilityResponse
): ParsedAvailability | null {
	if (!Array.isArray(body.connectors)) throw new Error('TomTom availability: unexpected shape');
	if (body.connectors.length === 0) return null;
	const parsed: ParsedAvailability = { freeCount: 0, totalCount: 0, perType: {} };
	for (const c of body.connectors) {
		const cur = c.availability?.current;
		if (!cur || typeof c.total !== 'number' || typeof cur.available !== 'number') {
			throw new Error('TomTom availability: unexpected shape');
		}
		parsed.freeCount += cur.available;
		parsed.totalCount += c.total;
		const mapped = CONNECTOR_MAP[c.type];
		if (mapped) {
			const t = (parsed.perType[mapped] ??= { free: 0, total: 0 });
			t.free += cur.available;
			t.total += c.total;
		}
	}
	return parsed;
}

export async function fetchChargingAvailability(
	key: string,
	chargingAvailabilityId: string,
	fetchFn: typeof fetch = fetch
): Promise<ParsedAvailability | null> {
	const url =
		`${BASE}/chargingAvailability.json?key=${encodeURIComponent(key)}` +
		`&chargingAvailability=${encodeURIComponent(chargingAvailabilityId)}`;
	const res = await fetchFn(url);
	if (!res.ok) throw new Error(`TomTom availability HTTP ${res.status}`);
	return parseChargingAvailability((await res.json()) as TomTomAvailabilityResponse);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/lib/server/tomtom.test.ts` — expect 5 passing. Full run: 112.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/tomtom.ts src/lib/server/tomtom.test.ts tests/fixtures/tomtom-charging-availability.json
git commit -m "feat: TomTom charging-availability client with connector mapping"
```

---

### Task 5: Availability refresh service (staleness + daily budget)

**Files:**
- Create: `src/lib/server/availability-refresh.ts` + Test: `src/lib/server/availability-refresh.test.ts`

**Design:** page loads call this with the stations they care about; it refreshes only entries older than 5 minutes (or missing), oldest first, bounded by a per-call cap and a daily budget (in-memory counter — the app runs as one long-lived systemd process; a restart resetting the counter is acceptable because TomTom's free tier is hard-capped and cannot bill). Best-effort by design: individual failures are logged and skipped; **this function never throws**.

- [ ] **Step 1: Failing tests**

`src/lib/server/availability-refresh.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DB_URL, closeTestDb, setupTestDb, truncateAll } from '../../../tests/helpers/db';
import type { Db } from './db/client';
import { networks, stations } from './db/schema';
import { availabilityAll, upsertAvailability } from './db/availability';
import { refreshAvailability, resetBudget } from './availability-refresh';

const fixtureBody = readFileSync('tests/fixtures/tomtom-charging-availability.json', 'utf8');
const okFetch = (async () => new Response(fixtureBody, { status: 200 })) as typeof fetch;

describe.skipIf(!TEST_DB_URL)('refreshAvailability', () => {
	let db: Db;
	let st1: number, st2: number;

	beforeAll(async () => {
		db = await setupTestDb();
	});
	afterAll(async () => {
		await closeTestDb(db);
	});
	beforeEach(async () => {
		await truncateAll(db);
		resetBudget();
		const [n] = await db.insert(networks).values({ name: 'ON', slug: 'on' }).returning();
		const rows = await db
			.insert(stations)
			.values([
				{ networkId: n.id, slug: 'a-on', name: 'A', location: { x: -21.4, y: 64.03 } },
				{ networkId: n.id, slug: 'b-on', name: 'B', location: { x: -21.5, y: 64.05 } }
			])
			.returning();
		st1 = rows[0].id;
		st2 = rows[1].id;
	});

	it('fetches stations with no cache entry and writes the cache', async () => {
		const n = await refreshAvailability(
			db,
			[{ stationId: st1, tomtomId: 'tt-1', fetchedAt: null }],
			{ key: 'k', fetchFn: okFetch }
		);
		expect(n).toBe(1);
		const all = await availabilityAll(db);
		expect(all[0]).toMatchObject({ stationId: st1, freeCount: 1, totalCount: 2, source: 'tomtom' });
	});

	it('skips entries fresher than 5 minutes', async () => {
		const now = new Date('2026-07-06T12:00:00Z');
		const fresh = new Date(now.getTime() - 2 * 60 * 1000);
		const n = await refreshAvailability(
			db,
			[{ stationId: st1, tomtomId: 'tt-1', fetchedAt: fresh }],
			{ key: 'k', fetchFn: okFetch, now }
		);
		expect(n).toBe(0);
		expect(await availabilityAll(db)).toHaveLength(0);
	});

	it('refreshes oldest first and respects maxCalls', async () => {
		const now = new Date('2026-07-06T12:00:00Z');
		const older = new Date(now.getTime() - 60 * 60 * 1000);
		const old = new Date(now.getTime() - 10 * 60 * 1000);
		const n = await refreshAvailability(
			db,
			[
				{ stationId: st1, tomtomId: 'tt-1', fetchedAt: old },
				{ stationId: st2, tomtomId: 'tt-2', fetchedAt: older }
			],
			{ key: 'k', fetchFn: okFetch, now, maxCalls: 1 }
		);
		expect(n).toBe(1);
		const all = await availabilityAll(db);
		expect(all).toHaveLength(1);
		expect(all[0].stationId).toBe(st2); // the older one won the single slot
	});

	it('one failing station does not stop the others, and nothing throws', async () => {
		let calls = 0;
		const flaky = (async () => {
			calls++;
			if (calls === 1) return new Response('boom', { status: 500 });
			return new Response(fixtureBody, { status: 200 });
		}) as typeof fetch;
		const n = await refreshAvailability(
			db,
			[
				{ stationId: st1, tomtomId: 'tt-1', fetchedAt: null },
				{ stationId: st2, tomtomId: 'tt-2', fetchedAt: null }
			],
			{ key: 'k', fetchFn: flaky }
		);
		expect(n).toBe(1);
		expect((await availabilityAll(db)).map((a) => a.stationId)).toEqual([st2]);
	});

	it('an unknown id (empty connectors) writes nothing', async () => {
		const empty = (async () =>
			new Response(JSON.stringify({ connectors: [], chargingAvailability: 'x' }), {
				status: 200
			})) as typeof fetch;
		const n = await refreshAvailability(
			db,
			[{ stationId: st1, tomtomId: 'tt-dead', fetchedAt: null }],
			{ key: 'k', fetchFn: empty }
		);
		expect(n).toBe(0);
		expect(await availabilityAll(db)).toHaveLength(0);
	});
});
```

Run: `npx vitest run src/lib/server/availability-refresh.test.ts` — expect FAIL.

- [ ] **Step 2: Implement**

`src/lib/server/availability-refresh.ts`:

```ts
import type { Db } from './db/client';
import { upsertAvailability } from './db/availability';
import { fetchChargingAvailability } from './tomtom';

export const STALE_AFTER_MS = 5 * 60 * 1000;
// TomTom freemium: 2 500 free requests/day, hard-capped (no card, cannot bill).
// We stop well short so the match script and manual testing always have headroom.
const DAILY_BUDGET = 2000;

let budgetDay = '';
let budgetUsed = 0;

function underBudget(now: Date): boolean {
	const day = now.toISOString().slice(0, 10);
	if (day !== budgetDay) {
		budgetDay = day;
		budgetUsed = 0;
	}
	return budgetUsed < DAILY_BUDGET;
}

/** Test hook. */
export function resetBudget(): void {
	budgetDay = '';
	budgetUsed = 0;
}

export interface RefreshTarget {
	stationId: number;
	tomtomId: string;
	/** current cache timestamp; null = never fetched */
	fetchedAt: Date | null;
}

export interface RefreshOptions {
	key: string;
	fetchFn?: typeof fetch;
	now?: Date;
	maxCalls?: number;
}

/**
 * Refresh the availability cache for the stale subset of targets (oldest first).
 * Best-effort by design: failures are logged and skipped, the budget stops calls,
 * and this NEVER throws — pages serve whatever the cache holds, with age labels.
 * Returns the number of stations actually refreshed.
 */
export async function refreshAvailability(
	db: Db,
	targets: RefreshTarget[],
	opts: RefreshOptions
): Promise<number> {
	const now = opts.now ?? new Date();
	const fetchFn = opts.fetchFn ?? fetch;
	const stale = targets
		.filter((t) => !t.fetchedAt || now.getTime() - t.fetchedAt.getTime() > STALE_AFTER_MS)
		.sort((a, b) => (a.fetchedAt?.getTime() ?? 0) - (b.fetchedAt?.getTime() ?? 0))
		.slice(0, opts.maxCalls ?? 25);
	let refreshed = 0;
	for (const t of stale) {
		if (!underBudget(now)) break;
		budgetUsed++;
		try {
			const parsed = await fetchChargingAvailability(opts.key, t.tomtomId, fetchFn);
			if (parsed === null) continue; // id unknown to TomTom — leave the cache alone
			await upsertAvailability(db, {
				stationId: t.stationId,
				...parsed,
				source: 'tomtom',
				fetchedAt: now
			});
			refreshed++;
		} catch (e) {
			console.error(
				`availability refresh failed for station ${t.stationId}:`,
				e instanceof Error ? e.message : e
			);
		}
	}
	return refreshed;
}
```

- [ ] **Step 3: Run to verify pass**

Run: `npx vitest run src/lib/server/availability-refresh.test.ts` — expect 5 passing. Full run: 117.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/availability-refresh.ts src/lib/server/availability-refresh.test.ts
git commit -m "feat: best-effort availability refresh with 5-min staleness and daily budget"
```

---

### Task 6: TomTom match script + live Iceland verification (risk gate)

**Files:**
- Create: `scripts/match-tomtom.ts`
- Modify: `package.json` (script `match:tomtom`), `.env.example` (add `TOMTOM_API_KEY=`)

**GATE:** this task needs `TOMTOM_API_KEY` in `.env`. Check first (`grep -c TOMTOM_API_KEY .env` — do NOT print the file). If missing, STOP and report NEEDS_CONTEXT: the session owner must register a free TomTom developer account (developer.tomtom.com, freemium: 2 500 req/day, no card) and add the key.

**Matching discipline (same as Phase 2):** stamp only when exactly ONE charging POI sits within 120 m of the station; 0 → UNMATCHED (station simply never shows availability — by design); >1 → AMBIGUOUS, print candidates for manual review, stamp nothing. Wrong-match risk here is availability (annoying), not price (unforgivable) — but the discipline stays.

- [ ] **Step 1: The script**

Append to `.env.example`:

```
TOMTOM_API_KEY=
```

`scripts/match-tomtom.ts`:

```ts
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { createDb } from '../src/lib/server/db/client';
import { stations } from '../src/lib/server/db/schema';
import { haversineKm } from '../src/lib/geo';

const KEY = process.env.TOMTOM_API_KEY;
const MAX_DIST_M = 120;

interface NearbyResult {
	poi?: { name?: string };
	position: { lat: number; lon: number };
	dataSources?: { chargingAvailability?: { id: string } };
}

async function nearby(lat: number, lon: number): Promise<NearbyResult[]> {
	const url =
		`https://api.tomtom.com/search/2/nearbySearch/.json?key=${encodeURIComponent(KEY!)}` +
		`&lat=${lat}&lon=${lon}&radius=300&limit=20`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`nearbySearch HTTP ${res.status}`);
	const body = (await res.json()) as { results?: NearbyResult[] };
	return body.results ?? [];
}

async function main() {
	if (!KEY) throw new Error('TOMTOM_API_KEY missing from .env');
	const db = createDb(process.env.DATABASE_URL!);
	const sts = await db.select().from(stations).where(eq(stations.isActive, true));
	let stamped = 0;
	let kept = 0;
	let unmatched = 0;
	let ambiguous = 0;
	for (const s of sts) {
		if (s.externalIds.tomtom) {
			kept++;
			continue;
		}
		const here = { lat: s.location.y, lng: s.location.x };
		// only EV-charging POIs carry a chargingAvailability dataSource — that filter
		// self-selects chargers, no category id needed
		const candidates = (await nearby(here.lat, here.lng))
			.filter((r) => r.dataSources?.chargingAvailability?.id)
			.map((r) => ({
				id: r.dataSources!.chargingAvailability!.id,
				name: r.poi?.name ?? '?',
				distM: Math.round(haversineKm(here, { lat: r.position.lat, lng: r.position.lon }) * 1000)
			}))
			.filter((c) => c.distM <= MAX_DIST_M);
		if (candidates.length === 1) {
			await db
				.update(stations)
				.set({ externalIds: { ...s.externalIds, tomtom: candidates[0].id } })
				.where(eq(stations.id, s.id));
			console.log(`STAMP ${s.slug} ← ${candidates[0].id} (${candidates[0].distM} m, "${candidates[0].name}")`);
			stamped++;
		} else if (candidates.length === 0) {
			console.log(`UNMATCHED ${s.slug} — no charging POI within ${MAX_DIST_M} m`);
			unmatched++;
		} else {
			console.log(`AMBIGUOUS ${s.slug} — ${candidates.length} charging POIs within ${MAX_DIST_M} m:`);
			for (const c of candidates) console.log(`   ${c.id}  ${c.distM} m  "${c.name}"`);
			ambiguous++;
		}
		await new Promise((r) => setTimeout(r, 150));
	}
	console.log(
		`\n${stamped} stamped, ${kept} already stamped, ${unmatched} unmatched, ` +
			`${ambiguous} ambiguous — of ${sts.length} active stations`
	);
	await db.$client.end();
}

main().catch((e) => {
	console.error(e);
	process.exitCode = 1;
});
```

Add to `package.json` scripts (after `match:n1`):

```json
		"match:tomtom": "tsx scripts/match-tomtom.ts",
```

- [ ] **Step 2: Run the match live**

Run: `npm run match:tomtom`
Expected: a stamped/unmatched/ambiguous summary over the ~90 active stations. This is the empirical test of vault risk #1 (TomTom coverage of Iceland). Record the counts in your report. UNMATCHED stations are fine (they never show availability); AMBIGUOUS ones are listed for the session owner to stamp manually later. Re-running must be idempotent (`kept` grows, nothing re-stamps).

- [ ] **Step 3: Verify one live availability fetch (EV Dynamic in Iceland)**

Pick a STAMP line from step 2 and run (replace `<ID>`):

```bash
npx tsx -e "
import 'dotenv/config';
import { fetchChargingAvailability } from './src/lib/server/tomtom';
fetchChargingAvailability(process.env.TOMTOM_API_KEY!, '<ID>').then((r) => console.log(JSON.stringify(r)));
"
```

Expected: a JSON object with plausible freeCount/totalCount for that station (or `null` if TomTom has static-only data for it — try a second id before concluding). Report what you saw: this is the live confirmation that Icelandic availability data actually flows.

- [ ] **Step 4: Verification + commit**

```bash
npm run lint && npx vitest run
```

Expected: clean, 117 passing (no new tests — scripts are exercised live, like Phase 2's match scripts).

```bash
git add scripts/match-tomtom.ts package.json .env.example
git commit -m "feat: match:tomtom stamps chargingAvailability ids onto stations (unique-within-120m)"
```

---

### Task 7: Age labels + homepage free-chargers column

**Files:**
- Modify: `src/lib/format.ts` + Test: `src/lib/format.test.ts`
- Modify: `src/lib/server/db/queries.ts` (extend `stationList` + `StationRow`) + Test: `src/lib/server/db/queries.test.ts`
- Modify: `src/lib/components/StationTable.svelte`
- Modify: `messages/is.json`, `messages/en.json`

- [ ] **Step 1: ageParts helper (TDD)**

Add to `src/lib/format.test.ts`:

```ts
describe('ageParts', () => {
	it('reports minutes, then hours, then days', () => {
		const now = new Date('2026-07-06T12:00:00Z');
		expect(ageParts(new Date('2026-07-06T11:58:00Z'), now)).toEqual({ n: 2, unit: 'min' });
		expect(ageParts(new Date('2026-07-06T09:00:00Z'), now)).toEqual({ n: 3, unit: 'h' });
		expect(ageParts(new Date('2026-07-04T12:00:00Z'), now)).toEqual({ n: 2, unit: 'd' });
	});

	it('clamps future timestamps to zero minutes', () => {
		const now = new Date('2026-07-06T12:00:00Z');
		expect(ageParts(new Date('2026-07-06T12:00:30Z'), now)).toEqual({ n: 0, unit: 'min' });
	});
});
```

(Extend the existing import line with `ageParts`.) Run `npx vitest run src/lib/format.test.ts` — expect FAIL. Then add to `src/lib/format.ts`:

```ts
/** Coarse age of a cache entry, for "as of N min ago" labels. */
export function ageParts(from: Date, now = new Date()): { n: number; unit: 'min' | 'h' | 'd' } {
	const min = Math.max(0, Math.round((now.getTime() - from.getTime()) / 60000));
	if (min < 60) return { n: min, unit: 'min' };
	const h = Math.round(min / 60);
	if (h < 24) return { n: h, unit: 'h' };
	return { n: Math.round(h / 24), unit: 'd' };
}
```

Run again — expect PASS.

- [ ] **Step 2: stationList exposes the availability cache (TDD)**

Add to `src/lib/server/db/queries.test.ts` (inside the existing describe; `availability` needs adding to the schema import line):

```ts
	it('stationList surfaces cached availability and leaves it null when absent', async () => {
		const st = await db.select().from(stations);
		const hellisheidi = st.find((s) => s.slug === 'hellisheidi-on')!;
		await db.insert(availability).values({
			stationId: hellisheidi.id,
			freeCount: 3,
			totalCount: 4,
			perType: null,
			fetchedAt: new Date('2026-07-06T12:00:00Z'),
			source: 'tomtom'
		});
		const list = await stationList(db, 'DC');
		const withAvail = list.find((s) => s.slug === 'hellisheidi-on')!;
		expect(withAvail.freeCount).toBe(3);
		expect(withAvail.totalCount).toBe(4);
		expect(withAvail.availabilityFetchedAt?.toISOString()).toBe('2026-07-06T12:00:00.000Z');
		const without = list.find((s) => s.slug === 'stadarskali-n1')!;
		expect(without.freeCount).toBeNull();
		expect(without.availabilityFetchedAt).toBeNull();
	});
```

Run — expect FAIL (property missing). Then in `src/lib/server/db/queries.ts`:

1. Import `availability` in the schema import.
2. Extend `StationRow` with:

```ts
	freeCount: number | null;
	totalCount: number | null;
	availabilityFetchedAt: Date | null;
```

3. In `stationList`, add `db.select().from(availability)` as a fifth member of the `Promise.all`, build `const availByStation = new Map(avail.map((a) => [a.stationId, a]));`, and set on each pushed row:

```ts
			freeCount: availByStation.get(s.id)?.freeCount ?? null,
			totalCount: availByStation.get(s.id)?.totalCount ?? null,
			availabilityFetchedAt: availByStation.get(s.id)?.fetchedAt ?? null,
```

Run — expect PASS.

- [ ] **Step 3: Messages**

`messages/is.json` (before `"lang_switch"`):

```json
	"age_min": "fyrir {n} mín",
	"age_h": "fyrir {n} klst",
	"age_d": "fyrir {n} dögum",
```

`messages/en.json`:

```json
	"age_min": "{n} min ago",
	"age_h": "{n} h ago",
	"age_d": "{n} days ago",
```

- [ ] **Step 4: The table cell**

In `src/lib/components/StationTable.svelte`, extend the format import with `ageParts`, add a tiny helper in the script block:

```ts
	function age(d: Date): string {
		const p = ageParts(d);
		return p.unit === 'min' ? m.age_min({ n: p.n }) : p.unit === 'h' ? m.age_h({ n: p.n }) : m.age_d({ n: p.n });
	}
```

and replace the placeholder cell `<td data-label={m.th_free()}>—</td>` with:

```svelte
						<td data-label={m.th_free()}>
							{#if s.freeCount !== null && s.totalCount !== null}
								<span data-testid="free-count">{s.freeCount}/{s.totalCount}</span>
								{#if s.availabilityFetchedAt}<small class="verified"
										>{age(s.availabilityFetchedAt)}</small
									>{/if}
							{:else}—{/if}
						</td>
```

Honesty rule enforced by the guard: unknown availability renders `—`, never `0`.

- [ ] **Step 5: Verify**

```bash
npm run lint && npx svelte-kit sync && npx svelte-check --tsconfig ./tsconfig.json && npx vitest run && npx playwright test
```

Expected: clean / 0 errors / 120 / 8 (homepage E2E untouched: the cell renders `—` when the dev DB has no cache rows and `n/m` once Task 6 + a page load have populated some — both fine).

- [ ] **Step 6: Commit**

```bash
git add src/lib/format.ts src/lib/format.test.ts src/lib/server/db/queries.ts src/lib/server/db/queries.test.ts src/lib/components/StationTable.svelte messages/
git commit -m "feat: homepage free-chargers column from the availability cache with age labels"
```

---

### Task 8: Station detail — query, shared map component, `/stod/[slug]` page

**Files:**
- Modify: `src/lib/server/db/queries.ts` (add `stationDetail`) + Test: `src/lib/server/db/queries.test.ts`
- Create: `src/lib/components/StationMap.svelte`
- Create: `src/routes/stod/[slug]/+page.server.ts`, `src/routes/stod/[slug]/+page.svelte`
- Modify: `src/lib/components/StationTable.svelte` (station names link to `/stod/[slug]`)
- Modify: `messages/is.json`, `messages/en.json`
- Test: `e2e/homepage.test.ts` (new test)

- [ ] **Step 1: Install maplibre**

```bash
npm install maplibre-gl@^5.24.0
```

- [ ] **Step 2: stationDetail (TDD)**

Add to `src/lib/server/db/queries.test.ts`:

```ts
	it('stationDetail resolves prices per mode with station-scope override', async () => {
		const st = await db.select().from(stations);
		const stadarskali = st.find((s) => s.slug === 'stadarskali-n1')!;
		await insertPriceIfChanged(db, {
			networkId: n1,
			stationId: stadarskali.id,
			tariffKey: 'DC',
			priceIskPerKwh: 50,
			source: 'scraper'
		});
		const detail = (await stationDetail(db, 'stadarskali-n1'))!;
		expect(detail.network.slug).toBe('n1');
		expect(detail.lat).toBeCloseTo(65.13, 2);
		expect(detail.lng).toBeCloseTo(-21.08, 2);
		expect(detail.connectors).toHaveLength(1);
		expect(detail.prices).toEqual([
			expect.objectContaining({ mode: 'DC', tariffKey: 'DC', priceIskPerKwh: 50 })
		]);
		expect(detail.availability).toBeNull();
	});

	it('stationDetail lists both modes for a mixed station and includes availability', async () => {
		const st = await db.select().from(stations);
		const hellisheidi = st.find((s) => s.slug === 'hellisheidi-on')!;
		await db.insert(connectors).values({ stationId: hellisheidi.id, type: 'Type2', powerKw: 22, count: 2 });
		await db.insert(availability).values({
			stationId: hellisheidi.id,
			freeCount: 1,
			totalCount: 3,
			perType: null,
			fetchedAt: new Date('2026-07-06T12:00:00Z'),
			source: 'tomtom'
		});
		const detail = (await stationDetail(db, 'hellisheidi-on'))!;
		expect(detail.prices.map((p) => p.mode).sort()).toEqual(['AC', 'DC']);
		const dc = detail.prices.find((p) => p.mode === 'DC')!;
		expect(dc.tariffKey).toBe('DC_150'); // 200 kW CCS2 → DC_150 tier
		expect(dc.priceIskPerKwh).toBe(55);
		expect(detail.availability).toMatchObject({ freeCount: 1, totalCount: 3 });
	});

	it('stationDetail returns null for unknown slugs and inactive stations', async () => {
		expect(await stationDetail(db, 'engin-stod')).toBeNull();
		expect(await stationDetail(db, 'gamla-n1')).toBeNull();
	});
```

Run — expect FAIL. Then add to `src/lib/server/db/queries.ts` (import `and` from drizzle-orm and `availability` from schema if not already):

```ts
export interface StationDetail {
	id: number;
	slug: string;
	name: string;
	address: string | null;
	lat: number;
	lng: number;
	network: { slug: string; name: string; websiteUrl: string | null };
	connectors: { type: ConnectorType; powerKw: number; count: number }[];
	prices: {
		mode: 'DC' | 'AC';
		tariffKey: TariffKey;
		priceIskPerKwh: number;
		minuteFeeIsk: number | null;
		minuteFeeAfterMin: number | null;
		verifiedAt: Date;
	}[];
	availability: { freeCount: number | null; totalCount: number | null; fetchedAt: Date } | null;
	tomtomId: string | null;
}

/** Everything the /stod/[slug] page shows. Inactive or unknown slug → null. */
export async function stationDetail(db: Db, slug: string): Promise<StationDetail | null> {
	const [st] = await db
		.select()
		.from(stations)
		.where(and(eq(stations.slug, slug), eq(stations.isActive, true)));
	if (!st) return null;
	const [net] = await db.select().from(networks).where(eq(networks.id, st.networkId));
	const [cons, cp, avail] = await Promise.all([
		db.select().from(connectors).where(eq(connectors.stationId, st.id)),
		currentPrices(db),
		db.select().from(availability).where(eq(availability.stationId, st.id))
	]);
	const own = cp.filter((p) => p.stationId === st.id);
	const netWide = cp.filter((p) => p.networkId === st.networkId && p.stationId === null);
	const tariffs = new Set<TariffKey>([...own, ...netWide].map((p) => p.tariffKey));
	const priceRows: StationDetail['prices'] = [];
	for (const mode of ['DC', 'AC'] as const) {
		const ofMode = cons.filter((c) => (mode === 'AC' ? c.type === 'Type2' : c.type !== 'Type2'));
		if (ofMode.length === 0) continue;
		const top = ofMode.reduce((a, b) => (b.powerKw > a.powerKw ? b : a));
		const key = deriveTariffKey(top.type as ConnectorType, top.powerKw, tariffs);
		const price = own.find((p) => p.tariffKey === key) ?? netWide.find((p) => p.tariffKey === key);
		if (price) {
			priceRows.push({
				mode,
				tariffKey: key,
				priceIskPerKwh: price.priceIskPerKwh,
				minuteFeeIsk: price.minuteFeeIsk,
				minuteFeeAfterMin: price.minuteFeeAfterMin,
				verifiedAt: price.verifiedAt
			});
		}
	}
	return {
		id: st.id,
		slug: st.slug,
		name: st.name,
		address: st.address,
		lat: st.location.y,
		lng: st.location.x,
		network: { slug: net.slug, name: net.name, websiteUrl: net.websiteUrl },
		connectors: cons.map((c) => ({ type: c.type as ConnectorType, powerKw: c.powerKw, count: c.count })),
		prices: priceRows,
		availability: avail[0]
			? { freeCount: avail[0].freeCount, totalCount: avail[0].totalCount, fetchedAt: avail[0].fetchedAt }
			: null,
		tomtomId: st.externalIds.tomtom ?? null
	};
}
```

Run — expect the 3 new tests to pass (123 total).

- [ ] **Step 3: Shared map component**

Create `src/lib/components/StationMap.svelte` (used by this page with a single pin, by `/kort` with all pins, by `/bilaleit` with pick-location):

```svelte
<script lang="ts">
	import maplibregl from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import { formatNumber } from '$lib/format';
	import type { LatLng } from '$lib/geo';

	interface PinStation {
		id: number;
		lat: number;
		lng: number;
		price: number | null;
	}

	let {
		stations,
		selectedId = $bindable(null),
		pickLocation = false,
		userLocation = $bindable(null),
		center = [-18.8, 65.0] as [number, number],
		zoom = 5.2,
		fallbackText
	}: {
		stations: PinStation[];
		selectedId?: number | null;
		pickLocation?: boolean;
		userLocation?: LatLng | null;
		center?: [number, number];
		zoom?: number;
		fallbackText: string;
	} = $props();

	let mapEl = $state<HTMLDivElement>();
	let map = $state<maplibregl.Map>();
	let failed = $state(false);
	let markers: maplibregl.Marker[] = [];
	let userMarker: maplibregl.Marker | undefined;

	$effect(() => {
		if (!mapEl) return;
		let m: maplibregl.Map;
		try {
			m = new maplibregl.Map({
				container: mapEl,
				style: 'https://tiles.openfreemap.org/styles/liberty',
				center,
				zoom
			});
		} catch {
			failed = true; // no WebGL — the SSR content still tells the whole story
			return;
		}
		if (pickLocation) {
			m.on('click', (e) => {
				userLocation = { lat: e.lngLat.lat, lng: e.lngLat.lng };
			});
		}
		map = m;
		return () => m.remove();
	});

	$effect(() => {
		if (!map) return;
		for (const mk of markers) mk.remove();
		markers = stations.map((s) => {
			const el = document.createElement('button');
			el.className = 'pin';
			el.dataset.testid = 'map-pin';
			el.type = 'button';
			el.textContent = s.price === null ? '?' : formatNumber(s.price);
			el.addEventListener('click', (ev) => {
				ev.stopPropagation();
				selectedId = s.id;
			});
			return new maplibregl.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(map!);
		});
	});

	$effect(() => {
		if (!map) return;
		userMarker?.remove();
		userMarker = undefined;
		if (userLocation) {
			const el = document.createElement('div');
			el.className = 'you';
			el.dataset.testid = 'user-pin';
			userMarker = new maplibregl.Marker({ element: el })
				.setLngLat([userLocation.lng, userLocation.lat])
				.addTo(map);
		}
	});
</script>

{#if failed}
	<p class="fallback" data-testid="map-fallback">{fallbackText}</p>
{:else}
	<div class="map" bind:this={mapEl}></div>
{/if}

<style>
	.map {
		width: 100%;
		height: 100%;
		min-height: 16rem;
	}
	.fallback {
		opacity: 0.7;
		padding: 1rem 0;
	}
	:global(.pin) {
		background: var(--accent, #2e7d32);
		color: #fff;
		border: 2px solid #fff;
		border-radius: 1rem;
		padding: 0.05rem 0.45rem;
		font-size: 0.8rem;
		font-weight: 700;
		cursor: pointer;
		box-shadow: 0 1px 3px rgb(0 0 0 / 40%);
	}
	:global(.you) {
		width: 1rem;
		height: 1rem;
		border-radius: 50%;
		background: #1565c0;
		border: 3px solid #fff;
		box-shadow: 0 1px 3px rgb(0 0 0 / 40%);
	}
</style>
```

- [ ] **Step 4: Messages**

`messages/is.json` (before `"lang_switch"`):

```json
	"station_prices": "Verð",
	"station_availability": "Laus hleðslutæki",
	"station_directions": "Leiðarlýsing (Google Maps)",
	"station_trend": "Verðþróun {network}",
	"map_fallback": "Kortið gat ekki hlaðist í þessum vafra.",
	"mode_label_dc": "DC hraðhleðsla",
	"mode_label_ac": "AC hleðsla",
```

`messages/en.json`:

```json
	"station_prices": "Prices",
	"station_availability": "Free chargers",
	"station_directions": "Directions (Google Maps)",
	"station_trend": "{network} price trend",
	"map_fallback": "The map could not load in this browser.",
	"mode_label_dc": "DC fast charging",
	"mode_label_ac": "AC charging",
```

- [ ] **Step 5: The route**

`src/routes/stod/[slug]/+page.server.ts`:

```ts
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { stationDetail, trendSeries } from '$lib/server/db/queries';
import { refreshAvailability } from '$lib/server/availability-refresh';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	let station = await stationDetail(db, params.slug);
	if (!station) error(404, 'Stöð finnst ekki');
	// one station, one call, never throws: worth the small wait for live availability
	if (env.TOMTOM_API_KEY && station.tomtomId) {
		const n = await refreshAvailability(
			db,
			[
				{
					stationId: station.id,
					tomtomId: station.tomtomId,
					fetchedAt: station.availability?.fetchedAt ?? null
				}
			],
			{ key: env.TOMTOM_API_KEY, maxCalls: 1 }
		);
		if (n > 0) station = (await stationDetail(db, params.slug))!;
	}
	const mode = station.connectors.some((c) => c.type !== 'Type2') ? ('DC' as const) : ('AC' as const);
	const series = (await trendSeries(db, mode)).filter(
		(s) => s.networkSlug === station!.network.slug
	);
	return { station, series, now: Date.now() };
};
```

`src/routes/stod/[slug]/+page.svelte`:

```svelte
<script lang="ts">
	import Chart from 'chart.js/auto';
	import * as m from '$lib/paraglide/messages';
	import StationMap from '$lib/components/StationMap.svelte';
	import { ageParts, formatDate, formatIsk, formatNumber, isStale } from '$lib/format';

	let { data } = $props();
	let canvas = $state<HTMLCanvasElement>();

	const st = $derived(data.station);

	function age(d: Date): string {
		const p = ageParts(d);
		return p.unit === 'min'
			? m.age_min({ n: p.n })
			: p.unit === 'h'
				? m.age_h({ n: p.n })
				: m.age_d({ n: p.n });
	}

	$effect(() => {
		if (!canvas || data.series.length === 0) return;
		const chart = new Chart(canvas, {
			type: 'line',
			data: {
				datasets: data.series.map((s) => ({
					label: s.networkName,
					data: [...s.points, { t: data.now, y: s.points[s.points.length - 1].y }].map((p) => ({
						x: p.t,
						y: p.y
					})),
					stepped: true,
					borderColor: '#2e7d32',
					backgroundColor: '#2e7d32',
					pointRadius: 2
				}))
			},
			options: {
				scales: {
					x: {
						type: 'linear',
						ticks: { maxTicksLimit: 6, callback: (v) => formatDate(new Date(Number(v))) }
					},
					y: { title: { display: true, text: 'kr/kWh' } }
				}
			}
		});
		return () => chart.destroy();
	});
</script>

<svelte:head>
	<title>{st.name} — {m.site_title()}</title>
	<meta name="description" content="{st.name} · {st.network.name}" />
</svelte:head>

<article>
	<h2>{st.name}</h2>
	<p class="meta">
		{st.network.name}{#if st.address}
			· {st.address}{/if}
		· <a
			href="https://www.google.com/maps/dir/?api=1&destination={st.lat},{st.lng}"
			rel="noopener external">{m.station_directions()}</a
		>
	</p>

	<div class="cols">
		<section aria-label={m.station_prices()}>
			<h3>{m.station_prices()}</h3>
			{#each st.prices as p (p.mode)}
				<p class="price-row" data-testid="station-price">
					<span class="mode">{p.mode === 'DC' ? m.mode_label_dc() : m.mode_label_ac()}</span>
					<strong>{formatIsk(p.priceIskPerKwh)}</strong>
					{#if p.minuteFeeIsk}<small
							>{p.minuteFeeAfterMin
								? m.minute_fee_after({
										fee: formatNumber(p.minuteFeeIsk),
										min: p.minuteFeeAfterMin
									})
								: m.minute_fee({ fee: formatNumber(p.minuteFeeIsk) })}</small
						>{/if}
					<small class="verified" class:stale={isStale(p.verifiedAt)}
						>{m.verified_on({ date: formatDate(p.verifiedAt) })}</small
					>
				</p>
			{:else}
				<p><em>{m.price_unknown()}</em></p>
			{/each}

			<h3>{m.station_availability()}</h3>
			<p data-testid="station-availability">
				{#if st.availability && st.availability.freeCount !== null && st.availability.totalCount !== null}
					<strong>{st.availability.freeCount}/{st.availability.totalCount}</strong>
					<small class="verified">{age(st.availability.fetchedAt)}</small>
				{:else}—{/if}
			</p>

			<h3>{m.th_connectors()}</h3>
			<p>
				{#each st.connectors as c}
					<span class="chip">{c.type} ×{c.count} · {c.powerKw} kW</span>
				{/each}
			</p>
		</section>

		<div class="minimap" data-testid="station-map">
			<StationMap
				stations={[{ id: st.id, lat: st.lat, lng: st.lng, price: st.prices[0]?.priceIskPerKwh ?? null }]}
				center={[st.lng, st.lat]}
				zoom={12}
				fallbackText={m.map_fallback()}
			/>
		</div>
	</div>

	{#if data.series.length > 0}
		<section aria-label={m.station_trend({ network: st.network.name })}>
			<h3>{m.station_trend({ network: st.network.name })}</h3>
			<div class="chart"><canvas bind:this={canvas} data-testid="station-trend"></canvas></div>
		</section>
	{/if}
</article>

<style>
	.meta {
		opacity: 0.8;
	}
	.cols {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.5rem;
		align-items: start;
	}
	@media (max-width: 640px) {
		.cols {
			grid-template-columns: 1fr;
		}
	}
	.minimap {
		height: 20rem;
	}
	.price-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: baseline;
	}
	.mode {
		opacity: 0.7;
		min-width: 9rem;
	}
	.chip {
		display: inline-block;
		border: 1px solid var(--border, #ccc);
		border-radius: 1rem;
		padding: 0 0.5rem;
		margin: 0 0.2rem 0.2rem 0;
		font-size: 0.85rem;
		white-space: nowrap;
	}
	.verified {
		opacity: 0.6;
		font-size: 0.75rem;
	}
	.verified.stale {
		color: #b26a00;
		opacity: 1;
	}
	.chart {
		position: relative;
		min-height: 16rem;
		max-width: 44rem;
	}
</style>
```

- [ ] **Step 6: Link station names from the homepage table**

In `src/lib/components/StationTable.svelte`, replace the name cell content:

```svelte
						<td data-label={m.th_station()}><a href="/stod/{s.slug}">{s.name}</a></td>
```

- [ ] **Step 7: E2E**

Add to `e2e/homepage.test.ts`:

```ts
test('station page shows prices, availability honesty and the trend graph', async ({ page }) => {
	await page.goto('/');
	await page.locator('[data-testid="station-row"] a').first().click();
	await expect(page.locator('article h2')).toBeVisible();
	expect(await page.locator('[data-testid="station-price"]').count()).toBeGreaterThan(0);
	// availability is best-effort: either n/m or the honest "—", never a bare 0
	await expect(page.locator('[data-testid="station-availability"]')).toHaveText(/—|\d+\/\d+/);
	await expect(page.locator('[data-testid="station-trend"]')).toBeVisible();
});
```

- [ ] **Step 8: Verify**

```bash
npm run lint && npx svelte-kit sync && npx svelte-check --tsconfig ./tsconfig.json && npx vitest run && npx playwright test
```

Expected: clean / 0 errors / 123 / 9. If the mini-map renders as the fallback in E2E it does not matter for this test (nothing asserts pins here); WebGL contingency is handled in Task 9.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/lib/server/db/queries.ts src/lib/server/db/queries.test.ts src/lib/components/StationMap.svelte src/lib/components/StationTable.svelte src/routes/stod/ messages/ e2e/homepage.test.ts
git commit -m "feat: /stod/[slug] station pages with mini-map, per-mode prices, availability and trend"
```

---

### Task 9: `/kort` — the full map

**Files:**
- Modify: `src/lib/server/db/queries.ts` (add `mapStations`) + Test: `src/lib/server/db/queries.test.ts`
- Create: `src/routes/kort/+page.server.ts`, `src/routes/kort/+page.svelte`
- Modify: `src/routes/+layout.svelte` (nav link), `messages/is.json`, `messages/en.json`
- Test: `e2e/homepage.test.ts`

- [ ] **Step 1: mapStations (TDD)**

Add to `src/lib/server/db/queries.test.ts`:

```ts
	it('mapStations returns every active station with a headline price and coordinates', async () => {
		const list = await mapStations(db);
		expect(list.map((s) => s.slug).sort()).toEqual([
			'hellisheidi-on',
			'laugardalur-on',
			'stadarskali-n1'
		]);
		const hellisheidi = list.find((s) => s.slug === 'hellisheidi-on')!;
		expect(hellisheidi.mode).toBe('DC');
		expect(hellisheidi.price).toBe(55); // 200 kW → DC_150 tier
		expect(hellisheidi.lat).toBeCloseTo(64.03, 2);
		expect(hellisheidi.lng).toBeCloseTo(-21.4, 2);
		const laugardalur = list.find((s) => s.slug === 'laugardalur-on')!;
		expect(laugardalur.mode).toBe('AC'); // Type2-only station
		expect(laugardalur.price).toBe(39);
	});

	it('mapStations joins the availability cache and the tomtom stamp', async () => {
		const st = await db.select().from(stations);
		const hellisheidi = st.find((s) => s.slug === 'hellisheidi-on')!;
		await db
			.update(stations)
			.set({ externalIds: { tomtom: 'tt-42' } })
			.where(eq(stations.id, hellisheidi.id));
		await db.insert(availability).values({
			stationId: hellisheidi.id,
			freeCount: 2,
			totalCount: 3,
			perType: null,
			fetchedAt: new Date('2026-07-06T12:00:00Z'),
			source: 'tomtom'
		});
		const list = await mapStations(db);
		const row = list.find((s) => s.slug === 'hellisheidi-on')!;
		expect(row.tomtomId).toBe('tt-42');
		expect(row.freeCount).toBe(2);
		expect(row.totalCount).toBe(3);
		const bare = list.find((s) => s.slug === 'stadarskali-n1')!;
		expect(bare.tomtomId).toBeNull();
		expect(bare.freeCount).toBeNull();
	});
```

(The second test uses `eq` — add `import { eq } from 'drizzle-orm';` to `queries.test.ts` if it is not already there.)

Run — expect FAIL. Then add to `src/lib/server/db/queries.ts`:

```ts
export interface MapStation {
	id: number;
	slug: string;
	name: string;
	networkSlug: string;
	networkName: string;
	lat: number;
	lng: number;
	/** headline price: the DC price when the station fast-charges, else the AC price */
	price: number | null;
	mode: 'DC' | 'AC';
	connectors: { type: ConnectorType; powerKw: number; count: number }[];
	freeCount: number | null;
	totalCount: number | null;
	availabilityFetchedAt: Date | null;
	tomtomId: string | null;
}

/** Every active station, priced for its dominant mode — feeds /kort and /bilaleit. */
export async function mapStations(db: Db): Promise<MapStation[]> {
	const [sts, cons, nets, cp, avail] = await Promise.all([
		db.select().from(stations).where(eq(stations.isActive, true)),
		db.select().from(connectors),
		db.select().from(networks),
		currentPrices(db),
		db.select().from(availability)
	]);
	const netById = new Map(nets.map((n) => [n.id, n]));
	const availByStation = new Map(avail.map((a) => [a.stationId, a]));
	const consByStation = new Map<number, (typeof cons)[number][]>();
	for (const c of cons) {
		let arr = consByStation.get(c.stationId);
		if (!arr) consByStation.set(c.stationId, (arr = []));
		arr.push(c);
	}
	const rows: MapStation[] = [];
	for (const s of sts) {
		const all = consByStation.get(s.id) ?? [];
		if (all.length === 0) continue;
		const mode: 'DC' | 'AC' = all.some((c) => c.type !== 'Type2') ? 'DC' : 'AC';
		const ofMode = all.filter((c) => (mode === 'AC' ? c.type === 'Type2' : c.type !== 'Type2'));
		const top = ofMode.reduce((a, b) => (b.powerKw > a.powerKw ? b : a));
		const own = cp.filter((p) => p.stationId === s.id);
		const netWide = cp.filter((p) => p.networkId === s.networkId && p.stationId === null);
		const tariffs = new Set<TariffKey>([...own, ...netWide].map((p) => p.tariffKey));
		const key = deriveTariffKey(top.type as ConnectorType, top.powerKw, tariffs);
		const price =
			own.find((p) => p.tariffKey === key) ?? netWide.find((p) => p.tariffKey === key) ?? null;
		const net = netById.get(s.networkId)!;
		const a = availByStation.get(s.id);
		rows.push({
			id: s.id,
			slug: s.slug,
			name: s.name,
			networkSlug: net.slug,
			networkName: net.name,
			lat: s.location.y,
			lng: s.location.x,
			price: price?.priceIskPerKwh ?? null,
			mode,
			connectors: all.map((c) => ({ type: c.type as ConnectorType, powerKw: c.powerKw, count: c.count })),
			freeCount: a?.freeCount ?? null,
			totalCount: a?.totalCount ?? null,
			availabilityFetchedAt: a?.fetchedAt ?? null,
			tomtomId: s.externalIds.tomtom ?? null
		});
	}
	return rows.sort((a, b) => a.name.localeCompare(b.name, 'is'));
}
```

Run — expect PASS (125 total).

- [ ] **Step 2: Messages**

`messages/is.json` (before `"lang_switch"`):

```json
	"nav_map": "Kort",
	"map_title": "Kort af hleðslustöðvum",
	"map_details": "Nánar",
	"map_js": "Kortið þarf JavaScript — stöðvalistinn á forsíðunni virkar án þess.",
```

`messages/en.json`:

```json
	"nav_map": "Map",
	"map_title": "Charging station map",
	"map_details": "Details",
	"map_js": "The map needs JavaScript — the station list on the homepage works without it.",
```

- [ ] **Step 3: Route**

`src/routes/kort/+page.server.ts`:

```ts
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { mapStations } from '$lib/server/db/queries';
import { refreshAvailability } from '$lib/server/availability-refresh';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const sts = await mapStations(db);
	// Fire-and-forget: serve the cache now (age-labeled), refresh stale entries for
	// the next viewer. refreshAvailability never throws; the catch is belt-and-braces.
	if (env.TOMTOM_API_KEY) {
		const targets = sts
			.filter((s) => s.tomtomId)
			.map((s) => ({ stationId: s.id, tomtomId: s.tomtomId!, fetchedAt: s.availabilityFetchedAt }));
		refreshAvailability(db, targets, { key: env.TOMTOM_API_KEY }).catch(() => {});
	}
	return { stations: sts };
};
```

`src/routes/kort/+page.svelte`:

```svelte
<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import StationMap from '$lib/components/StationMap.svelte';
	import { ageParts, formatIsk } from '$lib/format';

	let { data } = $props();
	let selectedId = $state<number | null>(null);

	const selected = $derived(data.stations.find((s) => s.id === selectedId) ?? null);

	function age(d: Date): string {
		const p = ageParts(d);
		return p.unit === 'min'
			? m.age_min({ n: p.n })
			: p.unit === 'h'
				? m.age_h({ n: p.n })
				: m.age_d({ n: p.n });
	}
</script>

<svelte:head>
	<title>{m.map_title()} — {m.site_title()}</title>
	<meta name="description" content={m.map_title()} />
</svelte:head>

<section aria-label={m.map_title()} class="wrap">
	<h2 class="visually-hidden">{m.map_title()}</h2>
	<noscript><p class="js-note">{m.map_js()}</p></noscript>
	<div class="maparea">
		<StationMap stations={data.stations} bind:selectedId fallbackText={m.map_fallback()} />
		{#if selected}
			<aside class="card" data-testid="map-card">
				<h3><a href="/stod/{selected.slug}">{selected.name}</a></h3>
				<p class="net">{selected.networkName}</p>
				<p class="price">
					{#if selected.price !== null}
						<strong>{formatIsk(selected.price)}</strong> {selected.mode}
					{:else}
						<em>{m.price_unknown()}</em>
					{/if}
				</p>
				<p>
					{#each selected.connectors as c}
						<span class="chip">{c.type} ×{c.count} · {c.powerKw} kW</span>
					{/each}
				</p>
				<p data-testid="card-availability">
					{m.th_free()}:
					{#if selected.freeCount !== null && selected.totalCount !== null}
						{selected.freeCount}/{selected.totalCount}
						{#if selected.availabilityFetchedAt}<small>{age(selected.availabilityFetchedAt)}</small
							>{/if}
					{:else}—{/if}
				</p>
				<a class="more" href="/stod/{selected.slug}">{m.map_details()} →</a>
			</aside>
		{/if}
	</div>
</section>

<style>
	/* break out of main's centered column so the map runs edge to edge */
	.wrap {
		margin: -1rem calc(50% - 50vw) 0;
	}
	.maparea {
		position: relative;
		height: calc(100vh - 7rem);
		min-height: 24rem;
	}
	.card {
		position: absolute;
		left: 0.75rem;
		bottom: 0.75rem;
		z-index: 10;
		background: #fff;
		border: 1px solid var(--border, #ccc);
		border-radius: 0.5rem;
		box-shadow: 0 2px 8px rgb(0 0 0 / 20%);
		padding: 0.75rem 1rem;
		max-width: 20rem;
	}
	.card h3 {
		margin: 0 0 0.25rem;
	}
	.card p {
		margin: 0.25rem 0;
	}
	.net {
		opacity: 0.7;
		font-size: 0.9rem;
	}
	.chip {
		display: inline-block;
		border: 1px solid var(--border, #ccc);
		border-radius: 1rem;
		padding: 0 0.5rem;
		margin: 0 0.2rem 0.2rem 0;
		font-size: 0.8rem;
		white-space: nowrap;
	}
	.more {
		font-weight: 600;
	}
	.js-note {
		padding: 1rem;
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}
</style>
```

- [ ] **Step 4: Nav link**

In `src/routes/+layout.svelte`, extend the nav:

```svelte
	<nav class="nav">
		<a href="/kort">{m.nav_map()}</a>
		<a href="/verdthroun">{m.nav_trends()}</a>
	</nav>
```

and to keep the links spaced, add to its styles:

```css
	.nav {
		display: inline-flex;
		gap: 0.75rem;
	}
```

(Keep the existing `.nav { font-size: 0.9rem; }` rule — merge into one block.)

- [ ] **Step 5: E2E**

Add to `e2e/homepage.test.ts`:

```ts
test('map page renders price pins and a mini-card linking to the station', async ({ page }) => {
	await page.goto('/kort');
	const pins = page.locator('[data-testid="map-pin"]');
	await expect(pins.first()).toBeVisible({ timeout: 15000 });
	expect(await pins.count()).toBeGreaterThan(10);
	await pins.first().click();
	const card = page.locator('[data-testid="map-card"]');
	await expect(card).toBeVisible();
	await expect(card.locator('a[href^="/stod/"]').first()).toBeVisible();
	await expect(card.locator('[data-testid="card-availability"]')).toHaveText(/—|\d+\/\d+/);
});
```

**WebGL contingency:** if this test fails with the map-fallback visible (headless Chromium without WebGL), add to `playwright.config.ts`:

```ts
	use: {
		baseURL: 'http://localhost:4173',
		launchOptions: { args: ['--enable-unsafe-swiftshader'] }
	}
```

and re-run. Only commit that change if it was actually needed.

- [ ] **Step 6: Verify**

```bash
npm run lint && npx svelte-kit sync && npx svelte-check --tsconfig ./tsconfig.json && npx vitest run && npx playwright test
```

Expected: clean / 0 errors / 125 / 10.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/db/queries.ts src/lib/server/db/queries.test.ts src/routes/kort/ src/routes/+layout.svelte messages/ e2e/homepage.test.ts
git commit -m "feat: /kort — full-map view with price pins, mini-card and background availability refresh"
```

(Include `playwright.config.ts` in the add only if the WebGL contingency was applied.)

---

### Task 10: `/bilaleit` — the car finder

**Files:**
- Create: `src/routes/bilaleit/+page.server.ts`, `src/routes/bilaleit/+page.svelte`
- Modify: `src/routes/+layout.svelte` (nav link), `messages/is.json`, `messages/en.json`
- Test: `e2e/homepage.test.ts`

- [ ] **Step 1: Messages**

`messages/is.json` (before `"lang_switch"`):

```json
	"nav_finder": "Bílaleit",
	"finder_title": "Hvar getur minn bíll hlaðið?",
	"finder_pick_car": "Veldu bíl",
	"finder_search": "Leita að bíl…",
	"finder_no_car": "Bíllinn minn er ekki í listanum",
	"finder_pick_plug": "Veldu tengi í staðinn",
	"finder_change": "Breyta",
	"finder_use_location": "Nota staðsetningu mína",
	"finder_or_tap": "…eða smelltu á kortið til að velja staðsetningu",
	"finder_up_to": "allt að {kw} kW",
	"finder_compatible": "{n} samhæfar stöðvar",
	"finder_js": "Bílaleitin þarf JavaScript — stöðvalistinn á forsíðunni virkar án þess.",
```

`messages/en.json`:

```json
	"nav_finder": "Car finder",
	"finder_title": "Where can my car charge?",
	"finder_pick_car": "Pick your car",
	"finder_search": "Search for a car…",
	"finder_no_car": "My car is not in the list",
	"finder_pick_plug": "Pick a plug type instead",
	"finder_change": "Change",
	"finder_use_location": "Use my location",
	"finder_or_tap": "…or tap the map to set a location",
	"finder_up_to": "up to {kw} kW",
	"finder_compatible": "{n} compatible stations",
	"finder_js": "The car finder needs JavaScript — the station list on the homepage works without it.",
```

- [ ] **Step 2: Route**

`src/routes/bilaleit/+page.server.ts`:

```ts
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { carList } from '$lib/server/db/cars';
import { mapStations } from '$lib/server/db/queries';
import { refreshAvailability } from '$lib/server/availability-refresh';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [cars, stations] = await Promise.all([carList(db), mapStations(db)]);
	if (env.TOMTOM_API_KEY) {
		const targets = stations
			.filter((s) => s.tomtomId)
			.map((s) => ({ stationId: s.id, tomtomId: s.tomtomId!, fetchedAt: s.availabilityFetchedAt }));
		refreshAvailability(db, targets, { key: env.TOMTOM_API_KEY }).catch(() => {});
	}
	return { cars, stations };
};
```

`src/routes/bilaleit/+page.svelte`:

```svelte
<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import StationMap from '$lib/components/StationMap.svelte';
	import { carMatchesStation, effectiveKw, type CarSpec } from '$lib/ev';
	import { formatKm, haversineKm, type LatLng } from '$lib/geo';
	import { formatIsk } from '$lib/format';
	import { CONNECTOR_TYPES, type ConnectorType } from '$lib/types';

	let { data } = $props();

	const CAR_KEY = 'hledsluverd:car';
	const PLUG_KEY = 'hledsluverd:plug';

	let search = $state('');
	let carSlug = $state<string | null>(null);
	let plug = $state<ConnectorType | null>(null);
	let userLocation = $state<LatLng | null>(null);
	let selectedId = $state<number | null>(null);

	// restore the remembered choice once, client-side only
	$effect(() => {
		const savedCar = localStorage.getItem(CAR_KEY);
		const savedPlug = localStorage.getItem(PLUG_KEY) as ConnectorType | null;
		if (savedCar && data.cars.some((c) => c.slug === savedCar)) carSlug = savedCar;
		else if (savedPlug && (CONNECTOR_TYPES as readonly string[]).includes(savedPlug))
			plug = savedPlug;
	});

	const car = $derived.by((): CarSpec | null => {
		if (carSlug) {
			const c = data.cars.find((x) => x.slug === carSlug);
			if (c) return c;
		}
		if (plug) {
			return {
				acConnector: plug === 'Type2' ? plug : null,
				maxAcKw: null,
				dcConnector: plug !== 'Type2' ? plug : null,
				maxDcKw: null
			};
		}
		return null;
	});

	const carLabel = $derived.by(() => {
		if (carSlug) {
			const c = data.cars.find((x) => x.slug === carSlug);
			if (c) return `${c.make} ${c.model} ${c.variant ?? ''}`.trim();
		}
		return plug ?? '';
	});

	const hits = $derived(
		search.trim().length < 2
			? []
			: data.cars
					.filter((c) =>
						`${c.make} ${c.model} ${c.variant ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())
					)
					.slice(0, 30)
	);

	const compatible = $derived(
		car === null ? [] : data.stations.filter((s) => carMatchesStation(car, s.connectors))
	);

	const sorted = $derived.by(() => {
		const rows = compatible.map((s) => ({
			...s,
			kw: car ? effectiveKw(car, s.connectors) : null,
			km: userLocation ? haversineKm(userLocation, { lat: s.lat, lng: s.lng }) : null
		}));
		return rows.sort((a, b) =>
			a.km !== null && b.km !== null
				? a.km - b.km
				: (a.price ?? Infinity) - (b.price ?? Infinity)
		);
	});

	const selected = $derived(sorted.find((s) => s.id === selectedId) ?? null);

	function chooseCar(slug: string) {
		carSlug = slug;
		plug = null;
		search = '';
		localStorage.setItem(CAR_KEY, slug);
		localStorage.removeItem(PLUG_KEY);
	}

	function choosePlug(p: ConnectorType) {
		plug = p;
		carSlug = null;
		localStorage.setItem(PLUG_KEY, p);
		localStorage.removeItem(CAR_KEY);
	}

	function reset() {
		carSlug = null;
		plug = null;
		localStorage.removeItem(CAR_KEY);
		localStorage.removeItem(PLUG_KEY);
	}

	function locate() {
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
			},
			() => {
				/* denied — the map-tap fallback is right there */
			}
		);
	}
</script>

<svelte:head>
	<title>{m.finder_title()} — {m.site_title()}</title>
	<meta name="description" content={m.finder_title()} />
</svelte:head>

<section aria-label={m.finder_title()}>
	<h2>{m.finder_title()}</h2>
	<noscript><p>{m.finder_js()}</p></noscript>

	{#if car === null}
		<h3>{m.finder_pick_car()}</h3>
		<input
			type="search"
			placeholder={m.finder_search()}
			bind:value={search}
			data-testid="car-search"
		/>
		{#if hits.length > 0}
			<ul class="hits" data-testid="car-hits">
				{#each hits as c (c.slug)}
					<li>
						<button type="button" onclick={() => chooseCar(c.slug)}
							>{c.make} {c.model} {c.variant ?? ''}</button
						>
					</li>
				{/each}
			</ul>
		{/if}
		<p class="fallback-plug">
			{m.finder_no_car()} — {m.finder_pick_plug()}:
			{#each CONNECTOR_TYPES as t (t)}
				<button type="button" class="plug" onclick={() => choosePlug(t)}>{t}</button>
			{/each}
		</p>
	{:else}
		<p class="chosen" data-testid="chosen-car">
			<strong>{carLabel}</strong>
			<button type="button" onclick={reset}>{m.finder_change()}</button>
			<button type="button" onclick={locate}>{m.finder_use_location()}</button>
			<small>{m.finder_or_tap()}</small>
		</p>
		<p data-testid="compatible-count">{m.finder_compatible({ n: compatible.length })}</p>

		<div class="maparea">
			<StationMap
				stations={sorted}
				bind:selectedId
				bind:userLocation
				pickLocation={true}
				fallbackText={m.map_fallback()}
			/>
			{#if selected}
				<aside class="card" data-testid="finder-card">
					<h3><a href="/stod/{selected.slug}">{selected.name}</a></h3>
					<p class="net">{selected.networkName}</p>
					<p>
						{#if selected.price !== null}<strong>{formatIsk(selected.price)}</strong>
							{selected.mode}{:else}<em>{m.price_unknown()}</em>{/if}
						{#if selected.kw !== null}
							· {m.finder_up_to({ kw: Math.round(selected.kw) })}{/if}
						{#if selected.km !== null}
							· {formatKm(selected.km)}{/if}
					</p>
				</aside>
			{/if}
		</div>

		<ol class="results" data-testid="finder-results">
			{#each sorted.slice(0, 25) as s (s.id)}
				<li>
					<a href="/stod/{s.slug}">{s.name}</a>
					<span class="net">{s.networkName}</span>
					{#if s.price !== null}<strong>{formatIsk(s.price)}</strong>{/if}
					{#if s.kw !== null}<span>{m.finder_up_to({ kw: Math.round(s.kw) })}</span>{/if}
					{#if s.km !== null}<span>{formatKm(s.km)}</span>{/if}
				</li>
			{/each}
		</ol>
	{/if}
</section>

<style>
	input[type='search'] {
		width: 100%;
		max-width: 24rem;
		padding: 0.4rem 0.6rem;
		font-size: 1rem;
		border: 1px solid var(--border, #ccc);
		border-radius: 0.4rem;
	}
	.hits {
		list-style: none;
		margin: 0.5rem 0;
		padding: 0;
		max-width: 24rem;
	}
	.hits button {
		display: block;
		width: 100%;
		text-align: left;
		background: none;
		border: none;
		border-bottom: 1px solid var(--border, #e2e2e2);
		padding: 0.4rem 0.25rem;
		font-size: 0.95rem;
		cursor: pointer;
	}
	.hits button:hover {
		background: #f4f4f4;
	}
	.plug {
		margin-left: 0.4rem;
		border: 1px solid var(--border, #ccc);
		border-radius: 1rem;
		background: none;
		padding: 0.15rem 0.7rem;
		cursor: pointer;
	}
	.chosen button {
		margin-left: 0.5rem;
	}
	.maparea {
		position: relative;
		height: 55vh;
		min-height: 20rem;
		margin: 0.75rem 0;
	}
	.card {
		position: absolute;
		left: 0.75rem;
		bottom: 0.75rem;
		z-index: 10;
		background: #fff;
		border: 1px solid var(--border, #ccc);
		border-radius: 0.5rem;
		box-shadow: 0 2px 8px rgb(0 0 0 / 20%);
		padding: 0.6rem 0.9rem;
		max-width: 20rem;
	}
	.card h3 {
		margin: 0 0 0.25rem;
	}
	.card p {
		margin: 0.25rem 0;
	}
	.net {
		opacity: 0.7;
		font-size: 0.9rem;
		margin-right: 0.4rem;
	}
	.results {
		padding-left: 1.25rem;
	}
	.results li {
		padding: 0.25rem 0;
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
		align-items: baseline;
	}
</style>
```

- [ ] **Step 3: Nav link**

In `src/routes/+layout.svelte`:

```svelte
	<nav class="nav">
		<a href="/kort">{m.nav_map()}</a>
		<a href="/bilaleit">{m.nav_finder()}</a>
		<a href="/verdthroun">{m.nav_trends()}</a>
	</nav>
```

- [ ] **Step 4: E2E (mocked geolocation)**

Add to `e2e/homepage.test.ts`:

```ts
test('finder flow: pick a car, get compatible stations with speed and distance', async ({
	browser
}) => {
	const ctx = await browser.newContext({
		geolocation: { latitude: 64.1466, longitude: -21.9426 },
		permissions: ['geolocation'],
		baseURL: 'http://localhost:4173'
	});
	const page = await ctx.newPage();
	await page.goto('/bilaleit');
	await page.locator('[data-testid="car-search"]').fill('Leaf');
	await page.locator('[data-testid="car-hits"] button').first().click();
	await expect(page.locator('[data-testid="chosen-car"]')).toBeVisible();
	await expect(page.locator('[data-testid="compatible-count"]')).toBeVisible();
	const rows = page.locator('[data-testid="finder-results"] li');
	expect(await rows.count()).toBeGreaterThan(0);
	await expect(rows.first()).toContainText(/kW/);
	// distance appears once geolocation is applied
	await page.getByRole('button', { name: /staðsetningu|location/i }).click();
	await expect(rows.first()).toContainText(/km/, { timeout: 10000 });
	await ctx.close();
});
```

Note: a CHAdeMO car (Leaf) is deliberately chosen — compatible stations must be a strict subset (only stations with CHAdeMO or Type2), which exercises real filtering against the dev DB.

- [ ] **Step 5: Verify**

```bash
npm run lint && npx svelte-kit sync && npx svelte-check --tsconfig ./tsconfig.json && npx vitest run && npx playwright test
```

Expected: clean / 0 errors / 125 / 11. The finder E2E needs `npm run seed:cars` to have populated the dev DB (Task 2 did).

- [ ] **Step 6: Commit**

```bash
git add src/routes/bilaleit/ src/routes/+layout.svelte messages/ e2e/homepage.test.ts
git commit -m "feat: /bilaleit — car finder with plug fallback, geolocation/map-tap and effective speed"
```

---

### Task 11: README, final verification, wrap-up

**Files:**
- Modify: `README.md`
- Vault (outside repo, session owner only): `Hleðsluverð.md` updates.

- [ ] **Step 1: README — add after the "Scrapers" section**

```markdown
## Cars & availability

    npm run seed:cars      # import EV specs from OpenEV Data (pinned release, upserts by slug)
    npm run match:tomtom   # one-time: stamp TomTom availability ids onto stations (needs TOMTOM_API_KEY)

- Car data: [OpenEV Data](https://github.com/open-ev-data/open-ev-data-dataset)
  (CDLA-Permissive-2.0). European-market normalization is applied at import
  (`nacs` → CCS2, `type1` → Type2) because the dataset models US builds.
- Availability comes from TomTom's EV Charging Stations Availability API,
  best-effort: a 5-minute cache in the `availability` table, refreshed on page
  loads within a daily request budget. Unknown availability renders as "—",
  never 0. Set `TOMTOM_API_KEY` in `.env` (free tier, hard-capped).
- Map tiles: [OpenFreeMap](https://openfreemap.org) (keyless; attribution is
  rendered on the map by MapLibre).
```

- [ ] **Step 2: Full verification**

```bash
npm run lint && npx svelte-kit sync && npx svelte-check --tsconfig ./tsconfig.json && npx vitest run && npx playwright test
```

Expected: prettier clean, 0 svelte-check errors, 125 unit tests, 11 E2E.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README — cars import, TomTom availability, map tiles and attributions"
```

- [ ] **Step 4: Process wrap-up (session owner, not the implementer)**

1. Final whole-branch review (superpowers:code-reviewer) over `main..phase-3-map-stations-finder` before merging.
2. Vault `Hleðsluverð.md`: tick Fasi 3 with date + summary (map/station pages/finder/availability, test counts, TomTom match results). Risk register: risk #1 (TomTom coverage) → resolved/rewritten with the live match results from Task 6; risk #4 (open-ev-data license) → resolved, CDLA-Permissive-2.0, dataset `open-ev-data/open-ev-data-dataset` v1.24.0.
3. Phase 4 checklist additions: `TOMTOM_API_KEY` in the server `.env`; run `npm run seed:cars` and `npm run match:tomtom` against the production DB after seeding.
4. Deferred backlog note: admin station add/edit + OCM re-sync review; homepage "near me"; per-type availability display; stamping the AMBIGUOUS TomTom stations by hand.

## Self-review notes (spec coverage)

- Síður og UX: `/stod/[slug]` ✓ (name, network, address, mini-map, connectors+power, per-mode prices, availability with age, network trend graph, directions link); `/kort` ✓ (full-bleed MapLibre, price-labeled pins, mini-card with link); `/bilaleit` ✓ (searchable car list + localStorage, plug-type fallback, geolocation or map-tap — nothing location-related stored server-side, compatible-only pins, effective speed "allt að X kW"); homepage free-chargers column ✓. Homepage "near me" deliberately deferred (map/finder cover it).
- Degraded states: availability unknown → "—" never 0 ✓ (guards in all three surfaces); availability always age-labeled ✓; TomTom down/budget → cache with age, no errors ✓ (refreshAvailability never throws); geolocation denied → map-tap ✓; car missing → plug picker ✓; JS disabled → homepage untouched, map/finder show noscript notes ✓.
- Gagnasöfnun: TomTom seed-time matching with ambiguity review ✓ (unique-within-120m, AMBIGUOUS printed); 5-min runtime refresh scoped to viewed stations ✓ (station page = 1 call, map/finder = capped background refresh); daily budget counter ✓ (in-memory, documented trade-off); open-ev-data license verified ✓ (CDLA-Permissive-2.0).
- Gagnalíkan derivation rules: car↔station match and effective-speed = min(car, connector) ✓ (`src/lib/ev.ts`, matches the vault note verbatim); station price per connector tariff ✓ (reuses `deriveTariffKey` + station-scope-first resolution everywhere).
- Prófanir: logic tests for matching, effective speed, nearest-sorting inputs (haversine) ✓; fixture tests for both external APIs ✓ (verbatim captures); E2E: finder flow with mocked geolocation ✓, station page renders graph ✓, map pins ✓.
- Type consistency: `MapStation` feeds both `/kort` and `/bilaleit`; `StationMap` prop shape `{ id, lat, lng, price }` is a subset of both `MapStation` and the station-detail pin — checked. `ageParts` consumed in StationTable, station page, kort card. `CarRow` (db) is structurally compatible with `CarSpec` (ev.ts) — the finder passes rows directly.
