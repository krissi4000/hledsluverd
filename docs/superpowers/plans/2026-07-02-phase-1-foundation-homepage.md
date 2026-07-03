# Hleðsluverð Phase 1: Foundation & Homepage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A locally-running SvelteKit site whose server-rendered homepage shows Iceland's charging networks' current prices (rate card) and all stations sorted by cheapest, with real seeded data, IS/EN language toggle, and tests.

**Architecture:** One SvelteKit app (TypeScript, Svelte 5) + PostgreSQL/PostGIS via Drizzle ORM. Seven-table schema with an append-only `prices` table. Seed scripts import stations from Open Charge Map (fixture-tested parser) and initial prices from a human-verified JSON. Homepage is fully SSR — sorting, mode toggle (DC/AC), and filters are plain links with query params, so the page works without JavaScript.

**Tech Stack:** SvelteKit (Svelte 5 runes), TypeScript, Drizzle ORM + drizzle-kit, postgres.js, PostgreSQL 16 + PostGIS, Paraglide JS 2.x (i18n), Vitest, Playwright, tsx (scripts).

**Spec:** Obsidian vault — `/home/kjb/Skoli/Obsidian/skoli-vault/notes/Hleðsluverð.md` and linked notes (Arkitektúr, Gagnalíkan, Gagnasöfnun, Síður og UX, Prófanir og rekstur).

**Out of scope for Phase 1** (later plans): scrapers & scrape_runs usage, trends page, admin page, map/PMTiles, station detail pages, car finder, TomTom availability, deployment. The schema for ALL of it is created now (one migration story); the `availability`, `cars`, `scrape_runs` tables simply stay empty until their phase.

**Known limitation (for Phase 3):** drizzle-orm 0.45.2 ignores the `srid` option — `stations.location` is `geometry(Point)` without SRID enforcement at the column level. Our writes embed SRID 4326; Phase 3 nearest-station queries must pass SRID explicitly (e.g. `ST_SetSRID` / `ST_DistanceSphere`) rather than relying on a column constraint.

**Conventions for the executor:**

- Node ≥ 20. Run everything from the repo root `/home/kjb/Projects/hledsluverd`.
- CLI tools (`sv`, `paraglide-js`) evolve; if a flag is rejected or a prompt differs, pick the option matching the step's intent and note the deviation in the commit message.
- Icelandic characters in strings and filenames are intentional — preserve them exactly.

---

## File structure (end state of Phase 1)

```
.env / .env.example          # DATABASE_URL, DATABASE_URL_TEST, OCM_API_KEY
drizzle.config.ts
drizzle/                     # generated SQL migrations
messages/is.json             # Paraglide messages (Icelandic, base)
messages/en.json
project.inlang/settings.json
seeds/networks.json          # the 6 networks + OCM operator matchers
seeds/prices-initial.json    # human-verified launch prices
scripts/seed-networks.ts
scripts/seed-ocm.ts
scripts/seed-prices.ts
src/lib/types.ts             # ConnectorType, TariffKey (shared client/server)
src/lib/format.ts            # formatIsk, formatDate
src/lib/server/db/schema.ts  # all 7 tables
src/lib/server/db/client.ts  # createDb(url) factory
src/lib/server/db/index.ts   # app-facing db instance ($env)
src/lib/server/db/prices.ts  # insertPriceIfChanged (reused by Phase 2 scrapers)
src/lib/server/db/queries.ts # currentPrices, stationList, rateCard
src/lib/server/matching.ts   # deriveTariffKey (+ car matching in Phase 3)
src/lib/server/slug.ts       # slugify with Icelandic transliteration
src/lib/server/ocm.ts        # OCM JSON → station/connector drafts
src/lib/components/RateCard.svelte
src/lib/components/StationTable.svelte
src/routes/+layout.svelte
src/routes/+page.server.ts
src/routes/+page.svelte
src/routes/lang/+server.ts   # no-JS language toggle (sets cookie, redirects)
tests/fixtures/ocm-sample.json
tests/helpers/db.ts          # test-DB migrate/truncate helpers
e2e/homepage.test.ts
README.md
```

Unit tests are colocated: `src/lib/server/slug.test.ts`, `matching.test.ts`, `ocm.test.ts`, `db/prices.test.ts`, `db/queries.test.ts`.

---

### Task 1: Scaffold SvelteKit project with test tooling

**Files:**

- Create: entire SvelteKit skeleton (via CLI), `vitest` + `playwright` + `prettier` add-ons
- Modify: `.gitignore` (already exists — CLI may append)

- [x] **Step 1: Scaffold into the existing repo**

Run:

```bash
cd /home/kjb/Projects/hledsluverd
npx sv@latest create . --template minimal --types ts --no-add-ons --install npm
```

Expected: files created (`package.json`, `svelte.config.js`, `vite.config.ts`, `src/routes/+page.svelte`, …). If prompted about the non-empty directory, choose to continue.

- [x] **Step 2: Add test/format tooling**

Run:

```bash
npx sv add vitest playwright prettier --install npm
```

Expected: `vitest` config merged into `vite.config.ts`, `playwright.config.ts` created (with an `e2e/` test dir or similar — if it creates `e2e/demo.test.ts`, keep the folder, delete the demo test), prettier config added.

- [x] **Step 3: Verify dev server boots**

Run: `npm run dev -- --open=false & sleep 5 && curl -sf http://localhost:5173 | head -c 200; kill %1`
Expected: HTML output containing `<!doctype html>` (any content). No errors.

- [x] **Step 4: Verify test runners work**

Run: `npm run test:unit -- --run 2>&1 | tail -5` (or `npx vitest run`)
Expected: passes (or "no test files found" exit 0 — acceptable at this point).

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold SvelteKit app with vitest, playwright, prettier"
```

---

### Task 2: Postgres databases, Drizzle config, connection factory

**Files:**

- Create: `.env`, `.env.example`, `drizzle.config.ts`, `src/lib/server/db/client.ts`, `src/lib/server/db/index.ts`

- [x] **Step 1: Install dependencies**

```bash
npm i drizzle-orm postgres
npm i -D drizzle-kit tsx dotenv
```

- [x] **Step 2: Verify dev and test databases with PostGIS**

**Already done during environment prep (2026-07-03):** both databases exist and PostGIS was enabled by the superuser (Arch's postgis package is not a "trusted" extension, so `CREATE EXTENSION postgis` requires `sudo -u postgres psql -d <db> -c 'CREATE EXTENSION postgis;'` — plain-role `psql` fails). `.env` also already exists with `OCM_API_KEY` filled in; do not overwrite it, only reconcile it with `.env.example`.

Verify only:

```bash
psql -d hledsluverd -tAc "select postgis_version()"
psql -d hledsluverd_test -tAc "select postgis_version()"
```

Expected: a PostGIS version string from each.

- [x] **Step 3: Write `.env` and `.env.example`**

`.env` (gitignored already) and `.env.example` (committed), same content:

```bash
DATABASE_URL=postgres://localhost:5432/hledsluverd
DATABASE_URL_TEST=postgres://localhost:5432/hledsluverd_test
OCM_API_KEY=
```

- [x] **Step 4: Write `drizzle.config.ts`**

```ts
import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing — copy .env.example to .env');

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'postgresql',
	dbCredentials: { url: process.env.DATABASE_URL! },
	// PostGIS bookkeeping tables must not be dropped/managed by drizzle
	extensionsFilters: ['postgis'],
	tablesFilter: ['!spatial_ref_sys']
});
```

- [x] **Step 5: Write connection factory and app instance**

`src/lib/server/db/client.ts`:

```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export function createDb(url: string) {
	// idle_timeout releases idle pool connections (dev SSR reloads orphan pools otherwise)
	const client = postgres(url, { idle_timeout: 20, max_lifetime: 60 * 30 });
	return drizzle(client, { schema });
}
export type Db = ReturnType<typeof createDb>;
```

`src/lib/server/db/index.ts` (app-facing; SvelteKit loads `.env` itself):

```ts
import { env } from '$env/dynamic/private';
import { createDb } from './client';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
export const db = createDb(env.DATABASE_URL);
```

(`schema.ts` doesn't exist yet — create it as an empty file `export {};` so imports resolve; Task 3 fills it.)

- [x] **Step 6: Smoke-test the connection**

Run: `npx tsx -e "import 'dotenv/config'; import postgres from 'postgres'; const s = postgres(process.env.DATABASE_URL); const r = await s\`select postgis_version()\`; console.log(r[0]); await s.end();"`
Expected: prints a PostGIS version object.

- [x] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add Postgres + Drizzle setup with dev/test databases"
```

---

### Task 3: Full database schema + first migration

**Files:**

- Create: `src/lib/types.ts`
- Modify: `src/lib/server/db/schema.ts`
- Create: `drizzle/0000_*.sql` (generated)

- [x] **Step 1: Write shared types**

`src/lib/types.ts`:

```ts
export const CONNECTOR_TYPES = ['CCS2', 'CHAdeMO', 'Type2'] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

export const TARIFF_KEYS = ['AC', 'DC', 'DC_150'] as const;
export type TariffKey = (typeof TARIFF_KEYS)[number];
```

- [x] **Step 2: Write the schema (all 7 tables — spec: Gagnalíkan note)**

`src/lib/server/db/schema.ts`:

```ts
import {
	pgTable,
	pgEnum,
	serial,
	text,
	integer,
	boolean,
	doublePrecision,
	timestamp,
	jsonb,
	geometry,
	index,
	unique
} from 'drizzle-orm/pg-core';
import { CONNECTOR_TYPES, TARIFF_KEYS, type ConnectorType } from '$lib/types';

export const connectorTypeEnum = pgEnum('connector_type', CONNECTOR_TYPES);

export const networks = pgTable('networks', {
	id: serial('id').primaryKey(),
	name: text('name').notNull(),
	slug: text('slug').notNull().unique(),
	websiteUrl: text('website_url'),
	scraperId: text('scraper_id')
});

export const stations = pgTable(
	'stations',
	{
		id: serial('id').primaryKey(),
		networkId: integer('network_id')
			.notNull()
			.references(() => networks.id),
		slug: text('slug').notNull().unique(),
		name: text('name').notNull(),
		address: text('address'),
		location: geometry('location', { type: 'point', mode: 'xy', srid: 4326 }).notNull(),
		externalIds: jsonb('external_ids')
			.$type<{ ocm?: number; tomtom?: string }>()
			.notNull()
			.default({}),
		isActive: boolean('is_active').notNull().default(true),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true })
			.notNull()
			.defaultNow()
			.$onUpdate(() => new Date())
	},
	(t) => [index('stations_location_idx').using('gist', t.location)]
);

export const connectors = pgTable('connectors', {
	id: serial('id').primaryKey(),
	stationId: integer('station_id')
		.notNull()
		.references(() => stations.id, { onDelete: 'cascade' }),
	type: connectorTypeEnum('type').notNull(),
	powerKw: doublePrecision('power_kw').notNull(),
	count: integer('count').notNull().default(1)
});

export const prices = pgTable(
	'prices',
	{
		id: serial('id').primaryKey(),
		networkId: integer('network_id')
			.notNull()
			.references(() => networks.id),
		stationId: integer('station_id').references(() => stations.id, { onDelete: 'restrict' }), // NULL = network-wide; price history blocks hard deletes — use is_active
		tariffKey: text('tariff_key', { enum: TARIFF_KEYS }).notNull(),
		priceIskPerKwh: doublePrecision('price_isk_per_kwh').notNull(),
		minuteFeeIsk: doublePrecision('minute_fee_isk'),
		validFrom: timestamp('valid_from', { withTimezone: true }).notNull().defaultNow(),
		source: text('source', { enum: ['scraper', 'manual'] }).notNull(),
		verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull().defaultNow(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [index('prices_current_idx').on(t.networkId, t.tariffKey, t.validFrom)]
);

export const availability = pgTable('availability', {
	stationId: integer('station_id')
		.primaryKey()
		.references(() => stations.id, { onDelete: 'cascade' }),
	freeCount: integer('free_count'),
	totalCount: integer('total_count'),
	perType:
		jsonb('per_type').$type<Partial<Record<ConnectorType, { free: number; total: number }>>>(),
	fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
	source: text('source').notNull() // free text until Phase 3 pins the source set
});

export const cars = pgTable(
	'cars',
	{
		id: serial('id').primaryKey(),
		make: text('make').notNull(),
		model: text('model').notNull(),
		variant: text('variant'),
		slug: text('slug').notNull().unique(),
		acConnector: connectorTypeEnum('ac_connector'),
		maxAcKw: doublePrecision('max_ac_kw'),
		dcConnector: connectorTypeEnum('dc_connector'),
		maxDcKw: doublePrecision('max_dc_kw')
	},
	(t) => [unique('cars_make_model_variant_idx').on(t.make, t.model, t.variant).nullsNotDistinct()]
);

export const scrapeRuns = pgTable('scrape_runs', {
	id: serial('id').primaryKey(),
	networkId: integer('network_id')
		.notNull()
		.references(() => networks.id),
	startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
	status: text('status', { enum: ['ok', 'changed', 'failed'] }).notNull(),
	message: text('message')
});
```

- [x] **Step 3: Generate the migration**

Run: `npx drizzle-kit generate`
Expected: one SQL file in `drizzle/` creating all 7 tables + enum. Open it and verify `location` is `geometry(point, 4326)` and the gist index exists.

- [x] **Step 4: Apply the migration to both databases**

```bash
npx drizzle-kit migrate
DATABASE_URL=postgres://localhost:5432/hledsluverd_test npx drizzle-kit migrate
```

Expected: no errors. Verify: `psql -d hledsluverd -c '\dt'` lists the 7 tables.

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add full database schema (7 tables) and initial migration"
```

---

### Task 4: Test-DB helper

**Files:**

- Create: `tests/helpers/db.ts`

DB-touching tests run against `DATABASE_URL_TEST` and are skipped when it's unset. Vitest loads `.env` only if told to — the helper uses `dotenv`.

- [x] **Step 1: Write the helper**

`tests/helpers/db.ts` (TRUNCATE list is derived from the schema module so Phase 2+ tables can't be forgotten; the /test/ URL check keeps destructive helpers away from real databases):

```ts
import 'dotenv/config';
import { getTableName, sql } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import * as schema from '../../src/lib/server/db/schema';
import { createDb, type Db } from '../../src/lib/server/db/client';

export const TEST_DB_URL = process.env.DATABASE_URL_TEST;

export async function setupTestDb(): Promise<Db> {
	if (!TEST_DB_URL) {
		throw new Error('DATABASE_URL_TEST not set — guard suites with describe.skipIf(!TEST_DB_URL)');
	}
	if (!/test/i.test(TEST_DB_URL)) {
		throw new Error(`Refusing destructive test helpers against non-test database: ${TEST_DB_URL}`);
	}
	const db = createDb(TEST_DB_URL);
	await migrate(db, { migrationsFolder: './drizzle' });
	return db;
}

export async function truncateAll(db: Db) {
	const tables = Object.values(schema)
		.filter((t): t is PgTable => t instanceof PgTable)
		.map((t) => `"${getTableName(t)}"`);
	await db.execute(sql.raw(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`));
}

export async function closeTestDb(db: Db) {
	await db.$client.end();
}
```

Note: `$lib` aliases don't resolve from `tests/` by default — the helper deliberately uses a relative import. `src/lib/server/db/schema.ts` imports `$lib/types`; vitest resolves `$lib` inside `src/` via the SvelteKit vite plugin, which is already active in `vite.config.ts`. If the relative import of `client.ts` fails on the `$lib/types` alias when run from `tests/`, change `schema.ts` to import from `'../../types'` instead — both are acceptable.

- [x] **Step 2: Verify it compiles and connects**

`tsx -e` cannot use top-level await (cjs eval context — discovered in Task 2). Write a throwaway file `tmp-verify.ts` in the repo root:

```ts
import { setupTestDb, truncateAll, closeTestDb } from './tests/helpers/db';
const db = await setupTestDb();
await truncateAll(db);
await closeTestDb(db);
console.log('ok');
```

Run: `npx tsx tmp-verify.ts && rm tmp-verify.ts`
Expected: `ok` (and the process exits on its own — proves the pool teardown works).

- [x] **Step 3: Commit**

```bash
git add tests/helpers/db.ts
git commit -m "test: add test-database helper (migrate + truncate)"
```

---

### Task 5: Slug utility (TDD)

**Files:**

- Create: `src/lib/server/slug.ts`, `src/lib/server/slug.test.ts`

- [x] **Step 1: Write the failing test**

`src/lib/server/slug.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { slugify } from './slug';

describe('slugify', () => {
	it('transliterates Icelandic characters', () => {
		expect(slugify('Hellisheiði')).toBe('hellisheidi');
		expect(slugify('Þórshöfn')).toBe('thorshofn');
		expect(slugify('Ártúnshöfði')).toBe('artunshofdi');
		expect(slugify('Æsuvellir')).toBe('aesuvellir');
	});
	it('collapses non-alphanumerics into single dashes and trims them', () => {
		expect(slugify('Olís – Norðlingaholt (v/Austurveg)')).toBe('olis-nordlingaholt-v-austurveg');
	});
	it('handles uppercase Icelandic letters', () => {
		expect(slugify('ÐÆÖÁ')).toBe('daeoa');
	});
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/server/slug.test.ts`
Expected: FAIL — cannot find module `./slug`.

- [x] **Step 3: Write the implementation**

First remove `passWithNoTests: true` from `vite.config.ts` — a real test exists from this task on, so vitest must fail if it ever finds zero tests (guards against include-pattern typos).

`src/lib/server/slug.ts`:

```ts
const MAP: Record<string, string> = {
	á: 'a',
	é: 'e',
	í: 'i',
	ó: 'o',
	ú: 'u',
	ý: 'y',
	ð: 'd',
	þ: 'th',
	æ: 'ae',
	ö: 'o'
};

export function slugify(input: string): string {
	return input
		.toLowerCase()
		.split('')
		.map((c) => MAP[c] ?? c)
		.join('')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/server/slug.test.ts`
Expected: PASS (3 tests).

- [x] **Step 5: Commit**

```bash
git add src/lib/server/slug.ts src/lib/server/slug.test.ts vite.config.ts
git commit -m "feat: add slugify with Icelandic transliteration"
```

---

### Task 6: Tariff derivation (TDD)

**Files:**

- Create: `src/lib/server/matching.ts`, `src/lib/server/matching.test.ts`

Spec rule (Gagnalíkan note): Type2 → `AC`; CCS2/CHAdeMO → `DC_150` when `power_kw ≥ 150` **and** the network defines that tier, otherwise `DC`.

- [x] **Step 1: Write the failing test**

`src/lib/server/matching.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deriveTariffKey } from './matching';
import type { TariffKey } from '$lib/types';

const withTier = new Set<TariffKey>(['AC', 'DC', 'DC_150']);
const withoutTier = new Set<TariffKey>(['AC', 'DC']);

describe('deriveTariffKey', () => {
	it('maps Type2 to AC regardless of power', () => {
		expect(deriveTariffKey('Type2', 22, withTier)).toBe('AC');
	});
	it('maps DC connectors to DC below 150 kW', () => {
		expect(deriveTariffKey('CCS2', 60, withTier)).toBe('DC');
		expect(deriveTariffKey('CHAdeMO', 50, withTier)).toBe('DC');
	});
	it('maps ≥150 kW to DC_150 when the network defines the tier', () => {
		expect(deriveTariffKey('CCS2', 150, withTier)).toBe('DC_150');
		expect(deriveTariffKey('CCS2', 250, withTier)).toBe('DC_150');
	});
	it('falls back to DC at ≥150 kW when the network has no tier', () => {
		expect(deriveTariffKey('CCS2', 250, withoutTier)).toBe('DC');
	});
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/server/matching.test.ts`
Expected: FAIL — cannot find module `./matching`.

- [x] **Step 3: Write the implementation**

`src/lib/server/matching.ts`:

```ts
import type { ConnectorType, TariffKey } from '$lib/types';

export function deriveTariffKey(
	type: ConnectorType,
	powerKw: number,
	networkTariffs: ReadonlySet<TariffKey>
): TariffKey {
	if (type === 'Type2') return 'AC';
	if (powerKw >= 150 && networkTariffs.has('DC_150')) return 'DC_150';
	return 'DC';
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/server/matching.test.ts`
Expected: PASS (4 tests).

- [x] **Step 5: Commit**

```bash
git add src/lib/server/matching.ts src/lib/server/matching.test.ts
git commit -m "feat: add tariff derivation rule"
```

---

### Task 7: Networks seed data + script

**Files:**

- Create: `seeds/networks.json`, `scripts/seed-networks.ts`
- Modify: `package.json` (scripts)

- [x] **Step 1: Write the seed data**

`seeds/networks.json` — `ocmMatchers` are fallback title matchers for Task 8 (matched case-insensitively on Unicode word boundaries; Task 8 Step 0 adds `ocmOperatorIds` as the primary matching key):

```json
[
	{
		"name": "ON",
		"slug": "on",
		"websiteUrl": "https://www.on.is",
		"ocmMatchers": ["orka náttúrunnar", "on power", "on -"]
	},
	{
		"name": "Ísorka",
		"slug": "isorka",
		"websiteUrl": "https://www.isorka.is",
		"ocmMatchers": ["ísorka", "isorka"]
	},
	{ "name": "N1", "slug": "n1", "websiteUrl": "https://www.n1.is", "ocmMatchers": ["n1"] },
	{ "name": "e1", "slug": "e1", "websiteUrl": "https://www.e1.is", "ocmMatchers": ["e1", "eone"] },
	{
		"name": "Orkan",
		"slug": "orkan",
		"websiteUrl": "https://www.orkan.is",
		"ocmMatchers": ["orkan"]
	},
	{
		"name": "Tesla",
		"slug": "tesla",
		"websiteUrl": "https://www.tesla.com/findus",
		"ocmMatchers": ["tesla"]
	}
]
```

- [x] **Step 2: Write the seed script (idempotent upsert by slug)**

`scripts/seed-networks.ts`:

```ts
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createDb } from '../src/lib/server/db/client';
import { networks } from '../src/lib/server/db/schema';

const data: { name: string; slug: string; websiteUrl: string }[] = JSON.parse(
	readFileSync(new URL('../seeds/networks.json', import.meta.url), 'utf8')
);

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const db = createDb(process.env.DATABASE_URL);
for (const n of data) {
	await db
		.insert(networks)
		.values({ name: n.name, slug: n.slug, websiteUrl: n.websiteUrl })
		.onConflictDoUpdate({
			target: networks.slug,
			set: { name: n.name, websiteUrl: n.websiteUrl }
		});
}
console.log(`Seeded ${data.length} networks.`);
await db.$client.end();
```

- [x] **Step 3: Add npm scripts**

In `package.json` `"scripts"`, add:

```json
"db:migrate": "drizzle-kit migrate",
"seed:networks": "tsx scripts/seed-networks.ts",
"seed:ocm": "tsx scripts/seed-ocm.ts",
"seed:prices": "tsx scripts/seed-prices.ts"
```

(`seed:ocm` / `seed:prices` targets are created in Tasks 8–9.)

- [x] **Step 4: Run it twice (idempotency check)**

Run: `npm run seed:networks && npm run seed:networks && psql -d hledsluverd -c "SELECT slug FROM networks ORDER BY slug;"`
Expected: 6 rows (`e1, isorka, n1, on, orkan, tesla`) — not 12.

- [x] **Step 5: Commit**

```bash
git add seeds/networks.json scripts/seed-networks.ts package.json
git commit -m "feat: seed the six charging networks"
```

---

### Task 8: OCM parser (fixture TDD) + station seed script

**Files:**

- Create: `tests/fixtures/ocm-sample.json`, `src/lib/server/ocm.ts`, `src/lib/server/ocm.test.ts`, `scripts/seed-ocm.ts`
- Modify: `seeds/networks.json` (add `ocmOperatorIds`)

**Matching strategy (amended after Task 7 quality review):** match POIs to networks by **OCM operator ID first** (exact, stable), with title matchers as a reviewable fallback for operators whose IDs we haven't recorded yet. Title matching uses case-insensitive Unicode word-boundary regexes, never `includes()` — bare substrings like `n1`/`on` false-positive inside unrelated operator names. The parser reports every matched operator → slug pair (not just skips) so false positives are visible.

**Live-data amendments (found in Step 7, 2026-07-03):** OCM Iceland is mostly unattributed — of our six networks only ON (operator id 102) and Tesla (23, 3534) carry an operator; N1/Ísorka/Orkan stations exist only as unattributed or generic-operator POIs with branded station titles ("Ísorka - Olís X", "Staðarskáli (N1)"), and e1 has no OCM presence at all. So the parser adds two guarded fallbacks: (a) for POIs with **no operator or a generic one** (ids 1, 44, 45 — never a real third-party operator), the same word-boundary matchers run against the **station title**, each match reported per station; (b) the dataset was bulk-imported several times, so **exact re-import duplicates** (same network, title and coordinates) are dropped, keeping the newest POI, with every dropped group reported. `compact=false` is required on the API call — compact mode strips `OperatorInfo`.

- [x] **Step 0: Add operator IDs to the networks seed**

In `seeds/networks.json`, add an `"ocmOperatorIds"` number array to every network: `[102]` for ON and `[23, 3534]` for Tesla (verified against the live API — Tesla has two operator entries), `[]` for the others (OCM has no operator attribution for them; their stations arrive via the station-title fallback).

- [x] **Step 1: Write the fixture**

`tests/fixtures/ocm-sample.json` — trimmed to the fields we read; 5 POIs: an ON fast-charge site (CCS2 ×2 + CHAdeMO, mixed), an Ísorka AC site (Type2 socket ×4), one with an unknown operator (must be skipped), an unattributed N1 site (station-title fallback), and its exact bulk-import duplicate (must be dropped):

```json
[
	{
		"ID": 111001,
		"OperatorInfo": { "ID": 102, "Title": "Orka Náttúrunnar" },
		"AddressInfo": {
			"Title": "Hellisheiði",
			"AddressLine1": "Hellisheiðarvirkjun",
			"Town": "Ölfus",
			"Latitude": 64.0374,
			"Longitude": -21.4009
		},
		"Connections": [
			{ "ConnectionTypeID": 33, "PowerKW": 150, "Quantity": 2 },
			{ "ConnectionTypeID": 2, "PowerKW": 50, "Quantity": 1 },
			{ "ConnectionTypeID": 25, "PowerKW": 22, "Quantity": null }
		]
	},
	{
		"ID": 111002,
		"OperatorInfo": { "ID": 3400, "Title": "Ísorka" },
		"AddressInfo": {
			"Title": "Olís Norðlingaholt",
			"AddressLine1": "Norðlingabraut 2",
			"Town": "Reykjavík",
			"Latitude": 64.1101,
			"Longitude": -21.7702
		},
		"Connections": [
			{ "ConnectionTypeID": 25, "PowerKW": 22, "Quantity": 2 },
			{ "ConnectionTypeID": 1036, "PowerKW": 22, "Quantity": 2 }
		]
	},
	{
		"ID": 111003,
		"OperatorInfo": { "ID": 1, "Title": "Some Hotel Chain" },
		"AddressInfo": {
			"Title": "Hótel X",
			"AddressLine1": "Gata 1",
			"Town": "Akureyri",
			"Latitude": 65.6835,
			"Longitude": -18.1002
		},
		"Connections": [{ "ConnectionTypeID": 25, "PowerKW": 11, "Quantity": 1 }]
	},
	{
		"ID": 111004,
		"AddressInfo": {
			"Title": "Staðarskáli (N1)",
			"AddressLine1": "Þjóðvegur 1",
			"Town": "Hrútafjörður",
			"Latitude": 65.1213,
			"Longitude": -21.0805
		},
		"Connections": [{ "ConnectionTypeID": 33, "PowerKW": 150, "Quantity": 2 }]
	},
	{
		"ID": 111000,
		"AddressInfo": {
			"Title": "Staðarskáli (N1)",
			"AddressLine1": "Þjóðvegur 1",
			"Town": "Hrútafjörður",
			"Latitude": 65.1213,
			"Longitude": -21.0805
		},
		"Connections": [{ "ConnectionTypeID": 33, "PowerKW": 150, "Quantity": 2 }]
	}
]
```

- [x] **Step 2: Write the failing test**

`src/lib/server/ocm.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseOcm, type NetworkMatcher } from './ocm';

const pois = JSON.parse(readFileSync('tests/fixtures/ocm-sample.json', 'utf8'));
const matchers: NetworkMatcher[] = [
	{ slug: 'on', ocmOperatorIds: [102], ocmMatchers: ['orka náttúrunnar', 'on power'] },
	{ slug: 'isorka', ocmOperatorIds: [], ocmMatchers: ['ísorka', 'isorka'] }
];

describe('parseOcm', () => {
	it('maps matched operators to network slugs and extracts location', () => {
		const { drafts } = parseOcm(pois, matchers);
		expect(drafts).toHaveLength(2);
		const on = drafts.find((d) => d.networkSlug === 'on')!;
		expect(on.name).toBe('Hellisheiði');
		expect(on.address).toBe('Hellisheiðarvirkjun, Ölfus');
		expect(on.lat).toBeCloseTo(64.0374);
		expect(on.lng).toBeCloseTo(-21.4009);
		expect(on.ocmId).toBe(111001);
	});

	it('matches by operator ID even when no title matcher would hit', () => {
		const { drafts } = parseOcm(pois, [{ slug: 'on', ocmOperatorIds: [102], ocmMatchers: [] }]);
		expect(drafts.map((d) => d.networkSlug)).toEqual(['on']);
	});

	it('matches unattributed POIs by station title and reports them per station', () => {
		const withN1 = [...matchers, { slug: 'n1', ocmOperatorIds: [], ocmMatchers: ['n1'] }];
		const { drafts, titleMatched } = parseOcm(pois, withN1);
		const n1 = drafts.find((d) => d.networkSlug === 'n1')!;
		expect(n1.ocmId).toBe(111004);
		expect(titleMatched).toEqual([{ station: 'Staðarskáli (N1)', ocmId: 111004, slug: 'n1' }]);
	});

	it('drops exact re-import duplicates, keeping the newest POI', () => {
		// 111000 and 111004 share network, title and coordinates — OCM bulk-import copies
		const withN1 = [...matchers, { slug: 'n1', ocmOperatorIds: [], ocmMatchers: ['n1'] }];
		const { drafts, duplicates } = parseOcm(pois, withN1);
		expect(drafts.filter((d) => d.networkSlug === 'n1')).toHaveLength(1);
		expect(duplicates).toEqual([
			{ station: 'Staðarskáli (N1)', slug: 'n1', keptOcmId: 111004, droppedOcmIds: [111000] }
		]);
	});

	it('never station-title matches a POI attributed to a real third-party operator', () => {
		const attributed = { ...pois[3], OperatorInfo: { ID: 3708, Title: 'Orkubú Vestfjarða' } };
		const { drafts, skipped } = parseOcm(
			[attributed],
			[{ slug: 'n1', ocmOperatorIds: [], ocmMatchers: ['n1'] }]
		);
		expect(drafts).toHaveLength(0);
		expect(skipped).toEqual([{ operator: 'Orkubú Vestfjarða', count: 1 }]);
	});

	it('falls back to title matching on Unicode word boundaries only', () => {
		// contains the substring 'on' but not the word 'on' — must NOT match
		const decoy = { ...pois[2], OperatorInfo: { ID: 9999, Title: 'Onion Hotels' } };
		const { drafts, skipped } = parseOcm(
			[decoy],
			[{ slug: 'on', ocmOperatorIds: [], ocmMatchers: ['on'] }]
		);
		expect(drafts).toHaveLength(0);
		expect(skipped).toEqual([{ operator: 'Onion Hotels', count: 1 }]);
	});

	it('reports matched operator → slug pairs for review', () => {
		const { matched } = parseOcm(pois, matchers);
		expect(matched).toEqual(
			expect.arrayContaining([
				{ operator: 'Orka Náttúrunnar', operatorId: 102, slug: 'on', via: 'id' },
				{ operator: 'Ísorka', operatorId: 3400, slug: 'isorka', via: 'title' }
			])
		);
	});

	it('aggregates connections by (type, power), defaulting quantity to 1', () => {
		const { drafts } = parseOcm(pois, matchers);
		const on = drafts.find((d) => d.networkSlug === 'on')!;
		expect(on.connectors).toEqual(
			expect.arrayContaining([
				{ type: 'CCS2', powerKw: 150, count: 2 },
				{ type: 'CHAdeMO', powerKw: 50, count: 1 },
				{ type: 'Type2', powerKw: 22, count: 1 }
			])
		);
		const isorka = drafts.find((d) => d.networkSlug === 'isorka')!;
		// two Type2 entries (socket 25 + tethered 1036) at same power merge: 2 + 2 = 4
		expect(isorka.connectors).toEqual([{ type: 'Type2', powerKw: 22, count: 4 }]);
	});

	it('skips unmatched operators and reports them', () => {
		// 111003: generic operator, unbranded title; 111004/111000: no operator, no N1 matcher here
		const { skipped } = parseOcm(pois, matchers);
		expect(skipped).toEqual([
			{ operator: 'Some Hotel Chain', count: 1 },
			{ operator: '(no operator)', count: 2 }
		]);
	});
});
```

- [x] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/server/ocm.test.ts`
Expected: FAIL — cannot find module `./ocm`.

- [x] **Step 4: Write the implementation**

`src/lib/server/ocm.ts`:

```ts
import type { ConnectorType } from '$lib/types';

// Open Charge Map connection-type ids → our connector types.
// 33 = CCS (Type 2 combo), 2 = CHAdeMO, 25 = Type 2 socket, 1036 = Type 2 tethered.
// Unknown ids are ignored (OCM has many exotic types irrelevant in Iceland).
const CONNECTION_TYPE_MAP: Record<number, ConnectorType> = {
	33: 'CCS2',
	2: 'CHAdeMO',
	25: 'Type2',
	1036: 'Type2'
};

export interface NetworkMatcher {
	slug: string;
	ocmOperatorIds: number[];
	ocmMatchers: string[];
}

export interface MatchedOperator {
	operator: string;
	operatorId: number | null;
	slug: string;
	via: 'id' | 'title';
}

export interface StationTitleMatch {
	station: string;
	ocmId: number;
	slug: string;
}

export interface DuplicateGroup {
	station: string;
	slug: string;
	keptOcmId: number;
	droppedOcmIds: number[];
}

// OCM catch-all operators that carry no network information:
// 1 = (Unknown Operator), 44 = (Private Residence/Individual), 45 = (Business Owner at Location).
const GENERIC_OPERATOR_IDS = new Set([1, 44, 45]);

export interface StationDraft {
	ocmId: number;
	networkSlug: string;
	name: string;
	address: string | null;
	lat: number;
	lng: number;
	connectors: { type: ConnectorType; powerKw: number; count: number }[];
}

interface OcmPoi {
	ID: number;
	OperatorInfo?: { ID?: number; Title?: string } | null;
	AddressInfo?: {
		Title?: string;
		AddressLine1?: string | null;
		Town?: string | null;
		Latitude?: number;
		Longitude?: number;
	} | null;
	Connections?:
		{ ConnectionTypeID?: number; PowerKW?: number | null; Quantity?: number | null }[] | null;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whole-word, case-insensitive title match. \b is ASCII-only, so use Unicode property classes.
const wordRegex = (m: string) =>
	new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(m)}(?![\\p{L}\\p{N}])`, 'iu');

export function parseOcm(
	pois: OcmPoi[],
	matchers: NetworkMatcher[]
): {
	drafts: StationDraft[];
	skipped: { operator: string; count: number }[];
	matched: MatchedOperator[];
	titleMatched: StationTitleMatch[];
	duplicates: DuplicateGroup[];
} {
	const compiled = matchers.map((m) => ({ ...m, regexes: m.ocmMatchers.map(wordRegex) }));
	const candidates: { draft: StationDraft; viaStationTitle: boolean }[] = [];
	const skippedCounts = new Map<string, number>();
	const matchedByKey = new Map<string, MatchedOperator>();

	for (const poi of pois) {
		const operator = poi.OperatorInfo?.Title ?? '(no operator)';
		const operatorId = poi.OperatorInfo?.ID ?? null;
		const a = poi.AddressInfo;
		const stationTitle = a?.Title;
		const byId =
			operatorId != null ? compiled.find((m) => m.ocmOperatorIds.includes(operatorId)) : undefined;
		let network = byId ?? compiled.find((m) => m.regexes.some((r) => r.test(operator)));
		let viaStationTitle = false;
		// Iceland's OCM data is mostly unattributed — of our networks only ON and Tesla
		// carry an operator. Branded station titles ("Ísorka - Olís X", "Staðarskáli (N1)")
		// are the only signal for the rest, so fall back to them, but never override a POI
		// attributed to a real third-party operator.
		if (!network && stationTitle && (operatorId == null || GENERIC_OPERATOR_IDS.has(operatorId))) {
			network = compiled.find((m) => m.regexes.some((r) => r.test(stationTitle)));
			viaStationTitle = network != null;
		}
		if (!network || !stationTitle || a?.Latitude == null || a?.Longitude == null) {
			skippedCounts.set(operator, (skippedCounts.get(operator) ?? 0) + 1);
			continue;
		}
		if (!viaStationTitle) {
			matchedByKey.set(`${operatorId}:${operator}`, {
				operator,
				operatorId,
				slug: network.slug,
				via: byId ? 'id' : 'title'
			});
		}

		const byKey = new Map<string, { type: ConnectorType; powerKw: number; count: number }>();
		for (const c of poi.Connections ?? []) {
			const type = c.ConnectionTypeID != null ? CONNECTION_TYPE_MAP[c.ConnectionTypeID] : undefined;
			// 0/negative PowerKW is OCM data noise — treat like an unknown connection type.
			if (!type || c.PowerKW == null || c.PowerKW <= 0) continue;
			const key = `${type}:${c.PowerKW}`;
			const entry = byKey.get(key) ?? { type, powerKw: c.PowerKW, count: 0 };
			entry.count += c.Quantity ?? 1;
			byKey.set(key, entry);
		}

		candidates.push({
			draft: {
				ocmId: poi.ID,
				networkSlug: network.slug,
				name: stationTitle,
				address: [a.AddressLine1, a.Town].filter(Boolean).join(', ') || null,
				lat: a.Latitude,
				lng: a.Longitude,
				connectors: [...byKey.values()]
			},
			viaStationTitle
		});
	}

	// OCM Iceland was bulk-imported several times, so the same station appears under
	// multiple POI ids with identical name and coordinates. Keep the newest copy.
	const byStation = new Map<string, { draft: StationDraft; viaStationTitle: boolean }[]>();
	for (const c of candidates) {
		const key = `${c.draft.networkSlug}|${c.draft.name}|${c.draft.lat}|${c.draft.lng}`;
		byStation.set(key, [...(byStation.get(key) ?? []), c]);
	}

	const drafts: StationDraft[] = [];
	const titleMatched: StationTitleMatch[] = [];
	const duplicates: DuplicateGroup[] = [];
	for (const group of byStation.values()) {
		const kept = group.reduce((a, b) => (b.draft.ocmId > a.draft.ocmId ? b : a));
		if (group.length > 1) {
			duplicates.push({
				station: kept.draft.name,
				slug: kept.draft.networkSlug,
				keptOcmId: kept.draft.ocmId,
				droppedOcmIds: group
					.filter((g) => g !== kept)
					.map((g) => g.draft.ocmId)
					.sort((x, y) => x - y)
			});
		}
		drafts.push(kept.draft);
		if (kept.viaStationTitle) {
			titleMatched.push({
				station: kept.draft.name,
				ocmId: kept.draft.ocmId,
				slug: kept.draft.networkSlug
			});
		}
	}

	return {
		drafts,
		skipped: [...skippedCounts.entries()].map(([operator, count]) => ({ operator, count })),
		matched: [...matchedByKey.values()],
		titleMatched,
		duplicates
	};
}
```

- [x] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/server/ocm.test.ts`
Expected: PASS (9 tests).

- [x] **Step 6: Write the seed script**

`scripts/seed-ocm.ts` — fetches Iceland POIs, parses, upserts by `external_ids->>'ocm'`, replaces connectors on update, ensures slug uniqueness:

```ts
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { createDb } from '../src/lib/server/db/client';
import { connectors, networks, stations } from '../src/lib/server/db/schema';
import { parseOcm, type NetworkMatcher } from '../src/lib/server/ocm';
import { slugify } from '../src/lib/server/slug';

const key = process.env.OCM_API_KEY;
if (!key) throw new Error('OCM_API_KEY missing — register free at openchargemap.org');

// compact=false: compact mode strips nested OperatorInfo (only a top-level OperatorID
// remains), which breaks operator matching and the matched/skipped review reports.
const res = await fetch(
	`https://api.openchargemap.io/v3/poi?countrycode=IS&maxresults=2000&compact=false&verbose=false&key=${key}`
);
if (!res.ok) throw new Error(`OCM request failed: ${res.status}`);
const pois = await res.json();
if (!Array.isArray(pois))
	throw new Error(`OCM response is not a POI array: ${JSON.stringify(pois).slice(0, 200)}`);
if (pois.length >= 2000)
	throw new Error('OCM result truncated at maxresults=2000 — raise the limit');

const seedNetworks: (NetworkMatcher & { name: string })[] = JSON.parse(
	readFileSync(new URL('../seeds/networks.json', import.meta.url), 'utf8')
);
const { drafts, skipped, matched, titleMatched, duplicates } = parseOcm(pois, seedNetworks);

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const db = createDb(process.env.DATABASE_URL);
const dbNetworks = await db.select().from(networks);
const idBySlug = new Map(dbNetworks.map((n) => [n.slug, n.id]));

let inserted = 0,
	updated = 0;
for (const d of drafts) {
	const networkId = idBySlug.get(d.networkSlug);
	if (!networkId) throw new Error(`Network not seeded: ${d.networkSlug} (run seed:networks first)`);

	// One transaction per station so a mid-run failure can't leave a station without connectors.
	await db.transaction(async (tx) => {
		const existing = await tx
			.select({ id: stations.id })
			.from(stations)
			.where(sql`${stations.externalIds}->>'ocm' = ${String(d.ocmId)}`);

		let stationId: number;
		if (existing.length > 0) {
			stationId = existing[0].id;
			await tx
				.update(stations)
				.set({
					name: d.name,
					address: d.address,
					location: { x: d.lng, y: d.lat }
				})
				.where(eq(stations.id, stationId));
			updated++;
		} else {
			let slug = slugify(`${d.name}-${d.networkSlug}`);
			const clash = await tx
				.select({ id: stations.id })
				.from(stations)
				.where(eq(stations.slug, slug));
			if (clash.length > 0) slug = `${slug}-${d.ocmId}`;
			const [row] = await tx
				.insert(stations)
				.values({
					networkId,
					slug,
					name: d.name,
					address: d.address,
					location: { x: d.lng, y: d.lat },
					externalIds: { ocm: d.ocmId }
				})
				.returning({ id: stations.id });
			stationId = row.id;
			inserted++;
		}

		await tx.delete(connectors).where(eq(connectors.stationId, stationId));
		if (d.connectors.length > 0) {
			await tx.insert(connectors).values(d.connectors.map((c) => ({ stationId, ...c })));
		}
	});
}

console.log(`OCM seed: ${inserted} inserted, ${updated} updated, ${drafts.length} total.`);
console.log('Matched operators (verify each mapping; backfill ids for ones matched via title):');
for (const m of matched)
	console.log(`  ${m.operator} (OCM id ${m.operatorId}) → ${m.slug} [${m.via}]`);
console.log(
	'Station-title matches on unattributed POIs (verify each station belongs to its network):'
);
for (const t of titleMatched) console.log(`  ${t.station} (OCM ${t.ocmId}) → ${t.slug}`);
console.log('Re-import duplicates dropped (same network, title and coordinates):');
for (const d of duplicates)
	console.log(`  ${d.station} → kept OCM ${d.keptOcmId}, dropped ${d.droppedOcmIds.join(', ')}`);
console.log(
	'Skipped operators (review — add ids/matchers to seeds/networks.json if any belong to our networks):'
);
for (const s of skipped.sort((a, b) => b.count - a.count))
	console.log(`  ${s.count}× ${s.operator}`);
await db.$client.end();
```

- [x] **Step 7: Run against the real API**

Register a free API key at https://openchargemap.org (My Profile → API keys), put it in `.env` as `OCM_API_KEY`, then:

Run: `npm run seed:ocm && psql -d hledsluverd -c "SELECT n.slug, count(*) FROM stations s JOIN networks n ON n.id = s.network_id GROUP BY 1 ORDER BY 2 DESC;"`
Expected (as of 2026-07-03): **94 stations** — on 33, isorka 27, tesla 15, n1 13, orkan 6, e1 0 (e1 does not exist in OCM; its stations must come from another source later). Four review reports print: matched operators (3 entries, all `[id]`), station-title matches (~63 stations), re-import duplicate groups dropped (~31), and skipped operators (dominated by 643× unattributed third-party POIs — hotels, municipalities, Orkubú Vestfjarða, VIRTA; leaving those out is correct). **Read all four lists** — anything matched `[title]` should have its operator id backfilled into `ocmOperatorIds`; anything skipped that clearly belongs to our six networks gets its id added too.

Run it twice to confirm the second run reports `0 inserted, 94 updated`.

Known data-quality leftovers (deliberately NOT handled — revisit in Phase 3 station pages): near-duplicates with different names/coords (e.g. "N1 Ísafirði" ~50 m from "Ísafjörður (N1)"), and stale OCM entries are never deleted by the seed (append/update only).

- [x] **Step 8: Commit**

```bash
git add tests/fixtures/ocm-sample.json src/lib/server/ocm.ts src/lib/server/ocm.test.ts scripts/seed-ocm.ts seeds/networks.json
git commit -m "feat: import stations and connectors from Open Charge Map"
```

---

### Task 9: Price writing (TDD) + initial price seed

**Files:**

- Create: `src/lib/server/db/prices.ts`, `src/lib/server/db/prices.test.ts`, `seeds/prices-initial.json`, `scripts/seed-prices.ts`

`insertPriceIfChanged` is THE price-write path — Phase 2 scrapers will call this exact function. Rules (spec: Gagnasöfnun note): plausibility guard 10–200 ISK/kWh **and finiteness — NaN compares false everywhere, so an unguarded NaN both bypasses the bounds and defeats the dedupe, appending a poison row every run (quality-review finding)**; changed value → new row; unchanged → bump `verified_at` only.

**As-built notes (2026-07-03):** tests grew from 5 to 10 (NaN rejection, inclusive boundaries, minute-fee-only change, station-scoped prices). Step 4's expected count is 10. The initial seed holds only what was verifiable from public operator pages on 2026-07-03: ON AC 48 kr/kWh + 0,5 kr/mín and ON DC 62 kr/kWh (temporary reduction, per https://www.on.is/verdskrar). Ísorka, N1, e1 and Orkan publish prices only in their apps or on JS-only pages — rows dropped rather than guessed; Phase 2 scrapers (headless/API) must fill them, and until then those networks render "verð óþekkt" like Tesla.

- [x] **Step 1: Write the failing test**

`src/lib/server/db/prices.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { desc } from 'drizzle-orm';
import { TEST_DB_URL, closeTestDb, setupTestDb, truncateAll } from '../../../../tests/helpers/db';
import type { Db } from './client';
import { networks, prices, stations } from './schema';
import { insertPriceIfChanged } from './prices';

describe.skipIf(!TEST_DB_URL)('insertPriceIfChanged', () => {
	let db: Db;
	let networkId: number;

	beforeAll(async () => {
		db = await setupTestDb();
	});
	afterAll(async () => {
		await closeTestDb(db);
	});
	beforeEach(async () => {
		await truncateAll(db);
		const [n] = await db.insert(networks).values({ name: 'ON', slug: 'on' }).returning();
		networkId = n.id;
	});

	it('inserts a first price row', async () => {
		const r = await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'DC',
			priceIskPerKwh: 49,
			source: 'manual'
		});
		expect(r).toBe('inserted');
		expect(await db.select().from(prices)).toHaveLength(1);
	});

	it('bumps verified_at without a new row when unchanged', async () => {
		await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'DC',
			priceIskPerKwh: 49,
			source: 'manual'
		});
		const [before] = await db.select().from(prices);
		await new Promise((r) => setTimeout(r, 20));
		const r = await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'DC',
			priceIskPerKwh: 49,
			source: 'scraper'
		});
		expect(r).toBe('verified');
		const rows = await db.select().from(prices);
		expect(rows).toHaveLength(1);
		expect(rows[0].verifiedAt.getTime()).toBeGreaterThan(before.verifiedAt.getTime());
	});

	it('appends a new row when the price changes, keeping history', async () => {
		await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'DC',
			priceIskPerKwh: 49,
			source: 'manual'
		});
		const r = await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'DC',
			priceIskPerKwh: 55,
			source: 'scraper'
		});
		expect(r).toBe('inserted');
		const rows = await db.select().from(prices).orderBy(desc(prices.validFrom), desc(prices.id));
		expect(rows).toHaveLength(2);
		expect(rows[0].priceIskPerKwh).toBe(55);
	});

	it('treats separate tariff keys independently', async () => {
		await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'DC',
			priceIskPerKwh: 49,
			source: 'manual'
		});
		const r = await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'AC',
			priceIskPerKwh: 39,
			source: 'manual'
		});
		expect(r).toBe('inserted');
		expect(await db.select().from(prices)).toHaveLength(2);
	});

	it('rejects implausible prices', async () => {
		await expect(
			insertPriceIfChanged(db, {
				networkId,
				tariffKey: 'DC',
				priceIskPerKwh: 4900,
				source: 'scraper'
			})
		).rejects.toThrow(/implausible/i);
		expect(await db.select().from(prices)).toHaveLength(0);
	});

	it('rejects NaN prices and minute fees (parse failures must not enter history)', async () => {
		await expect(
			insertPriceIfChanged(db, {
				networkId,
				tariffKey: 'DC',
				priceIskPerKwh: NaN,
				source: 'scraper'
			})
		).rejects.toThrow(/implausible/i);
		await expect(
			insertPriceIfChanged(db, {
				networkId,
				tariffKey: 'DC',
				priceIskPerKwh: 49,
				minuteFeeIsk: NaN,
				source: 'scraper'
			})
		).rejects.toThrow(/implausible/i);
		expect(await db.select().from(prices)).toHaveLength(0);
	});

	it('accepts the plausibility boundaries 10 and 200 inclusive', async () => {
		await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'AC',
			priceIskPerKwh: 10,
			source: 'manual'
		});
		await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'DC',
			priceIskPerKwh: 200,
			source: 'manual'
		});
		expect(await db.select().from(prices)).toHaveLength(2);
	});

	it('appends a new row when only the minute fee changes', async () => {
		await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'AC',
			priceIskPerKwh: 48,
			minuteFeeIsk: 0.5,
			source: 'manual'
		});
		const r = await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'AC',
			priceIskPerKwh: 48,
			minuteFeeIsk: 0,
			source: 'scraper'
		});
		expect(r).toBe('inserted');
		expect(await db.select().from(prices)).toHaveLength(2);
	});

	it('keeps station-scoped prices independent of the network-wide price', async () => {
		const [st] = await db
			.insert(stations)
			.values({
				networkId,
				slug: 'hellisheidi-on',
				name: 'Hellisheiði',
				location: { x: -21.4009, y: 64.0374 }
			})
			.returning();
		await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'DC',
			priceIskPerKwh: 49,
			source: 'manual'
		});
		const r = await insertPriceIfChanged(db, {
			networkId,
			stationId: st.id,
			tariffKey: 'DC',
			priceIskPerKwh: 55,
			source: 'manual'
		});
		expect(r).toBe('inserted');
		// re-sending the network-wide price must still dedupe against its own scope
		const again = await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'DC',
			priceIskPerKwh: 49,
			source: 'scraper'
		});
		expect(again).toBe('verified');
		expect(await db.select().from(prices)).toHaveLength(2);
	});
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/server/db/prices.test.ts`
Expected: FAIL — cannot find module `./prices`.

- [x] **Step 3: Write the implementation**

First, in `vite.config.ts`, add `fileParallelism: false` to the server project's `test` block: DB suites share one test database, and vitest's parallel workers would truncate each other mid-test once the second DB suite arrives in Task 10. (The drizzle migrator also takes no advisory lock, so concurrent `migrate()` races on a fresh DB.)

`src/lib/server/db/prices.ts`:

```ts
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { TariffKey } from '$lib/types';
import type { Db } from './client';
import { prices } from './schema';

export interface PriceReading {
	networkId: number;
	stationId?: number | null;
	tariffKey: TariffKey;
	priceIskPerKwh: number;
	/**
	 * Omitted/null means the network charges no minute fee — not "unknown".
	 * Scrapers must always pass the full reading: leaving this out when the
	 * network has a fee writes a new history row that erases the fee.
	 */
	minuteFeeIsk?: number | null;
	source: 'scraper' | 'manual';
}

const MIN_PLAUSIBLE = 10;
const MAX_PLAUSIBLE = 200;

/**
 * The single price-write path (Phase 2 scrapers call this exact function).
 * Changed value → new history row; unchanged → bump verified_at only.
 * Assumes a single sequential writer per (network, tariff, station);
 * concurrent writers may create duplicate history rows.
 */
export async function insertPriceIfChanged(
	db: Db,
	reading: PriceReading
): Promise<'inserted' | 'verified'> {
	if (
		!Number.isFinite(reading.priceIskPerKwh) ||
		reading.priceIskPerKwh < MIN_PLAUSIBLE ||
		reading.priceIskPerKwh > MAX_PLAUSIBLE
	) {
		throw new Error(
			`Implausible price ${reading.priceIskPerKwh} ISK/kWh for network ${reading.networkId} ${reading.tariffKey} — treated as a parse error, not stored`
		);
	}
	if (reading.minuteFeeIsk != null && !Number.isFinite(reading.minuteFeeIsk)) {
		throw new Error(
			`Implausible minute fee ${reading.minuteFeeIsk} ISK for network ${reading.networkId} ${reading.tariffKey} — treated as a parse error, not stored`
		);
	}

	// normalize to 2 decimals — derived scraper prices (VAT math etc.) must not create
	// spurious history rows via float noise
	const priceIskPerKwh = Math.round(reading.priceIskPerKwh * 100) / 100;
	const minuteFeeIsk =
		reading.minuteFeeIsk == null ? null : Math.round(reading.minuteFeeIsk * 100) / 100;

	const stationCond =
		reading.stationId == null ? isNull(prices.stationId) : eq(prices.stationId, reading.stationId);

	const [current] = await db
		.select()
		.from(prices)
		.where(
			and(
				eq(prices.networkId, reading.networkId),
				eq(prices.tariffKey, reading.tariffKey),
				stationCond
			)
		)
		.orderBy(desc(prices.validFrom), desc(prices.id))
		.limit(1);

	if (
		current &&
		current.priceIskPerKwh === priceIskPerKwh &&
		(current.minuteFeeIsk ?? null) === minuteFeeIsk
	) {
		await db
			.update(prices)
			.set({ verifiedAt: sql`now()` })
			.where(eq(prices.id, current.id));
		return 'verified';
	}

	await db.insert(prices).values({
		networkId: reading.networkId,
		stationId: reading.stationId ?? null,
		tariffKey: reading.tariffKey,
		priceIskPerKwh,
		minuteFeeIsk,
		source: reading.source
	});
	return 'inserted';
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/server/db/prices.test.ts`
Expected: PASS (10 tests).

- [x] **Step 5: Write the initial price data — THEN VERIFY IT BY HAND**

`seeds/prices-initial.json` (values below came from research articles and are probably stale — the verification step is mandatory):

```json
[
	{ "network": "on", "tariffKey": "AC", "priceIskPerKwh": 39.9 },
	{ "network": "on", "tariffKey": "DC", "priceIskPerKwh": 49.9 },
	{ "network": "on", "tariffKey": "DC_150", "priceIskPerKwh": 54.9 },
	{ "network": "isorka", "tariffKey": "AC", "priceIskPerKwh": 39.0 },
	{ "network": "isorka", "tariffKey": "DC", "priceIskPerKwh": 70.0 },
	{ "network": "n1", "tariffKey": "DC", "priceIskPerKwh": 70.0 },
	{ "network": "e1", "tariffKey": "DC", "priceIskPerKwh": 50.0 },
	{ "network": "orkan", "tariffKey": "DC", "priceIskPerKwh": 65.0 }
]
```

**Verification (do not skip):** open each operator's price page — https://www.on.is , https://www.isorka.is , https://www.n1.is , https://www.e1.is , https://www.orkan.is — and correct every value, add missing tariffs (AC rates, per-minute fees as `"minuteFeeIsk"`), delete tariffs an operator doesn't offer. Tesla is intentionally absent (in-app pricing; its stations show "verð óþekkt" until Phase 2 resolves it). Record what you verified in the commit message.

- [x] **Step 6: Write the seed script**

`scripts/seed-prices.ts`:

```ts
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createDb } from '../src/lib/server/db/client';
import { networks } from '../src/lib/server/db/schema';
import { insertPriceIfChanged, type PriceReading } from '../src/lib/server/db/prices';
import type { TariffKey } from '../src/lib/types';

const rows: {
	network: string;
	tariffKey: TariffKey;
	priceIskPerKwh: number;
	minuteFeeIsk?: number;
}[] = JSON.parse(readFileSync('seeds/prices-initial.json', 'utf8'));

const db = createDb(process.env.DATABASE_URL!);
const nets = await db.select().from(networks);
const idBySlug = new Map(nets.map((n) => [n.slug, n.id]));

for (const r of rows) {
	const networkId = idBySlug.get(r.network);
	if (!networkId) throw new Error(`Unknown network slug: ${r.network}`);
	const reading: PriceReading = {
		networkId,
		tariffKey: r.tariffKey,
		priceIskPerKwh: r.priceIskPerKwh,
		minuteFeeIsk: r.minuteFeeIsk ?? null,
		source: 'manual'
	};
	console.log(`${r.network}/${r.tariffKey}: ${await insertPriceIfChanged(db, reading)}`);
}
await db.$client.end();
```

- [x] **Step 7: Run it twice**

Run: `npm run seed:prices && npm run seed:prices`
Expected: first run all `inserted`, second run all `verified` (idempotent — this also proves the changed/unchanged logic against the dev DB).

- [x] **Step 8: Commit**

```bash
git add src/lib/server/db/prices.ts src/lib/server/db/prices.test.ts seeds/prices-initial.json scripts/seed-prices.ts vite.config.ts
git commit -m "feat: add price write path with plausibility guard, seed verified launch prices"
```

---

### Task 10: Read queries — current prices, rate card, station list (TDD)

**Files:**

- Create: `src/lib/server/db/queries.ts`, `src/lib/server/db/queries.test.ts`

- [x] **Step 1: Write the failing test**

`src/lib/server/db/queries.test.ts`:

```ts
import { eq } from 'drizzle-orm';
import type { ConnectorType, TariffKey } from '$lib/types';
import { deriveTariffKey } from '../matching';
import type { Db } from './client';
import { connectors, networks, prices, stations } from './schema';

export interface CurrentPrice {
	networkId: number;
	tariffKey: TariffKey;
	priceIskPerKwh: number;
	minuteFeeIsk: number | null;
	verifiedAt: Date;
	validFrom: Date;
}

/**
 * Newest network-wide price per (network, tariff), computed in TS —
 * the prices table stays small (a few rows per network per year).
 * Station-specific overrides (stationId != null) are ignored until a later phase needs them.
 */
export async function currentPrices(db: Db): Promise<CurrentPrice[]> {
	const all = await db.select().from(prices);
	const best = new Map<string, (typeof all)[number]>();
	for (const p of all) {
		if (p.stationId != null) continue;
		const key = `${p.networkId}:${p.tariffKey}`;
		const cur = best.get(key);
		if (
			!cur ||
			p.validFrom > cur.validFrom ||
			(p.validFrom.getTime() === cur.validFrom.getTime() && p.id > cur.id)
		) {
			best.set(key, p);
		}
	}
	return [...best.values()].map((p) => ({
		networkId: p.networkId,
		tariffKey: p.tariffKey as TariffKey,
		priceIskPerKwh: p.priceIskPerKwh,
		minuteFeeIsk: p.minuteFeeIsk,
		verifiedAt: p.verifiedAt,
		validFrom: p.validFrom
	}));
}

export interface RateCardEntry {
	networkSlug: string;
	networkName: string;
	dc: number | null;
	dcVerifiedAt: Date | null;
	ac: number | null;
	acVerifiedAt: Date | null;
}

/** One entry per network that has any current price; sorted by DC price asc (nulls last), then AC. */
export async function rateCard(db: Db): Promise<RateCardEntry[]> {
	const [nets, cp] = await Promise.all([db.select().from(networks), currentPrices(db)]);
	const entries: RateCardEntry[] = [];
	for (const n of nets) {
		const forNet = cp.filter((p) => p.networkId === n.id);
		if (forNet.length === 0) continue;
		// a network pricing only the ≥150 kW tier still has a fast-charge price — fall back
		// to DC_150 so the network doesn't vanish from the card
		const dc =
			forNet.find((p) => p.tariffKey === 'DC') ?? forNet.find((p) => p.tariffKey === 'DC_150');
		const ac = forNet.find((p) => p.tariffKey === 'AC');
		entries.push({
			networkSlug: n.slug,
			networkName: n.name,
			dc: dc?.priceIskPerKwh ?? null,
			dcVerifiedAt: dc?.verifiedAt ?? null,
			ac: ac?.priceIskPerKwh ?? null,
			acVerifiedAt: ac?.verifiedAt ?? null
		});
	}
	return entries.sort(
		(a, b) => (a.dc ?? Infinity) - (b.dc ?? Infinity) || (a.ac ?? Infinity) - (b.ac ?? Infinity)
	);
}

export interface StationRow {
	slug: string;
	name: string;
	networkSlug: string;
	networkName: string;
	price: number | null;
	minuteFeeIsk: number | null;
	verifiedAt: Date | null;
	connectors: { type: ConnectorType; powerKw: number; count: number }[];
}

/**
 * Active stations that have a connector for the mode (AC → Type2; DC → CCS2/CHAdeMO),
 * priced via the tariff of their highest-power connector of that mode,
 * sorted by price asc (unknown price last), then name.
 */
export async function stationList(db: Db, mode: 'AC' | 'DC'): Promise<StationRow[]> {
	const [sts, cons, nets, cp] = await Promise.all([
		db.select().from(stations).where(eq(stations.isActive, true)),
		db.select().from(connectors),
		db.select().from(networks),
		currentPrices(db)
	]);
	const netById = new Map(nets.map((n) => [n.id, n]));
	const consByStation = new Map<number, (typeof cons)[number][]>();
	for (const c of cons) {
		let arr = consByStation.get(c.stationId);
		if (!arr) consByStation.set(c.stationId, (arr = []));
		arr.push(c);
	}
	const tariffsByNetwork = new Map<number, Set<TariffKey>>();
	for (const p of cp) {
		let set = tariffsByNetwork.get(p.networkId);
		if (!set) tariffsByNetwork.set(p.networkId, (set = new Set()));
		set.add(p.tariffKey);
	}

	const rows: StationRow[] = [];
	for (const s of sts) {
		const all = consByStation.get(s.id) ?? [];
		const ofMode = all.filter((c) => (mode === 'AC' ? c.type === 'Type2' : c.type !== 'Type2'));
		if (ofMode.length === 0) continue;

		const top = ofMode.reduce((a, b) => (b.powerKw > a.powerKw ? b : a));
		const tariffs = tariffsByNetwork.get(s.networkId) ?? new Set<TariffKey>();
		const key = deriveTariffKey(top.type as ConnectorType, top.powerKw, tariffs);
		const price = cp.find((p) => p.networkId === s.networkId && p.tariffKey === key) ?? null;
		const net = netById.get(s.networkId)!;

		rows.push({
			slug: s.slug,
			name: s.name,
			networkSlug: net.slug,
			networkName: net.name,
			price: price?.priceIskPerKwh ?? null,
			minuteFeeIsk: price?.minuteFeeIsk ?? null,
			verifiedAt: price?.verifiedAt ?? null,
			connectors: all.map((c) => ({
				type: c.type as ConnectorType,
				powerKw: c.powerKw,
				count: c.count
			}))
		});
	}
	return rows.sort(
		(a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || a.name.localeCompare(b.name, 'is')
	);
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/server/db/queries.test.ts`
Expected: FAIL — cannot find module `./queries`.

- [x] **Step 3: Write the implementation**

`src/lib/server/db/queries.ts` (current-price resolution is done in TS rather than SQL `DISTINCT ON` — the prices table stays tiny, a few rows per network per year, and the TS version is unambiguous about tie-breaking):

```ts
import { asc, eq } from 'drizzle-orm';
import type { ConnectorType, TariffKey } from '$lib/types';
import { deriveTariffKey } from '../matching';
import type { Db } from './client';
import { connectors, networks, prices, stations } from './schema';

export interface CurrentPrice {
	networkId: number;
	tariffKey: TariffKey;
	priceIskPerKwh: number;
	minuteFeeIsk: number | null;
	verifiedAt: Date;
	validFrom: Date;
}

/**
 * Newest network-wide price per (network, tariff), computed in TS —
 * the prices table stays small (a few rows per network per year).
 * Station-specific overrides (stationId != null) are ignored until a later phase needs them.
 */
export async function currentPrices(db: Db): Promise<CurrentPrice[]> {
	const all = await db.select().from(prices);
	const best = new Map<string, (typeof all)[number]>();
	for (const p of all) {
		if (p.stationId != null) continue;
		const key = `${p.networkId}:${p.tariffKey}`;
		const cur = best.get(key);
		if (
			!cur ||
			p.validFrom > cur.validFrom ||
			(p.validFrom.getTime() === cur.validFrom.getTime() && p.id > cur.id)
		) {
			best.set(key, p);
		}
	}
	return [...best.values()].map((p) => ({
		networkId: p.networkId,
		tariffKey: p.tariffKey as TariffKey,
		priceIskPerKwh: p.priceIskPerKwh,
		minuteFeeIsk: p.minuteFeeIsk,
		verifiedAt: p.verifiedAt,
		validFrom: p.validFrom
	}));
}

export interface RateCardEntry {
	networkSlug: string;
	networkName: string;
	dc: number | null;
	dcVerifiedAt: Date | null;
	ac: number | null;
	acVerifiedAt: Date | null;
}

/** One entry per network that has any price; sorted by DC price asc (nulls last), then AC. */
export async function rateCard(db: Db): Promise<RateCardEntry[]> {
	const [nets, cp] = await Promise.all([db.select().from(networks), currentPrices(db)]);
	const entries: RateCardEntry[] = [];
	for (const n of nets) {
		const dc = cp.find((p) => p.networkId === n.id && p.tariffKey === 'DC');
		const ac = cp.find((p) => p.networkId === n.id && p.tariffKey === 'AC');
		if (!dc && !ac) continue;
		entries.push({
			networkSlug: n.slug,
			networkName: n.name,
			dc: dc?.priceIskPerKwh ?? null,
			dcVerifiedAt: dc?.verifiedAt ?? null,
			ac: ac?.priceIskPerKwh ?? null,
			acVerifiedAt: ac?.verifiedAt ?? null
		});
	}
	return entries.sort(
		(a, b) => (a.dc ?? Infinity) - (b.dc ?? Infinity) || (a.ac ?? Infinity) - (b.ac ?? Infinity)
	);
}

export interface StationRow {
	slug: string;
	name: string;
	networkSlug: string;
	networkName: string;
	price: number | null;
	minuteFeeIsk: number | null;
	verifiedAt: Date | null;
	connectors: { type: ConnectorType; powerKw: number; count: number }[];
}

/**
 * Active stations that have a connector for the mode (AC → Type2; DC → CCS2/CHAdeMO),
 * priced via the tariff of their highest-power connector of that mode,
 * sorted by price asc (unknown price last), then name.
 */
export async function stationList(db: Db, mode: 'AC' | 'DC'): Promise<StationRow[]> {
	const [sts, cons, nets, cp] = await Promise.all([
		db.select().from(stations).where(eq(stations.isActive, true)).orderBy(asc(stations.name)),
		db.select().from(connectors),
		db.select().from(networks),
		currentPrices(db)
	]);
	const netById = new Map(nets.map((n) => [n.id, n]));
	const consByStation = new Map<number, (typeof cons)[number][]>();
	for (const c of cons) {
		(consByStation.get(c.stationId) ?? consByStation.set(c.stationId, []).get(c.stationId)!).push(
			c
		);
	}
	const tariffsByNetwork = new Map<number, Set<TariffKey>>();
	for (const p of cp) {
		(
			tariffsByNetwork.get(p.networkId) ??
			tariffsByNetwork.set(p.networkId, new Set()).get(p.networkId)!
		).add(p.tariffKey);
	}

	const rows: StationRow[] = [];
	for (const s of sts) {
		const all = consByStation.get(s.id) ?? [];
		const ofMode = all.filter((c) => (mode === 'AC' ? c.type === 'Type2' : c.type !== 'Type2'));
		if (ofMode.length === 0) continue;

		const top = ofMode.reduce((a, b) => (b.powerKw > a.powerKw ? b : a));
		const tariffs = tariffsByNetwork.get(s.networkId) ?? new Set<TariffKey>();
		const key = deriveTariffKey(top.type as ConnectorType, top.powerKw, tariffs);
		const price = cp.find((p) => p.networkId === s.networkId && p.tariffKey === key) ?? null;
		const net = netById.get(s.networkId)!;

		rows.push({
			slug: s.slug,
			name: s.name,
			networkSlug: net.slug,
			networkName: net.name,
			price: price?.priceIskPerKwh ?? null,
			minuteFeeIsk: price?.minuteFeeIsk ?? null,
			verifiedAt: price?.verifiedAt ?? null,
			connectors: all.map((c) => ({
				type: c.type as ConnectorType,
				powerKw: c.powerKw,
				count: c.count
			}))
		});
	}
	return rows.sort(
		(a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || a.name.localeCompare(b.name, 'is')
	);
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/server/db/queries.test.ts`
Expected: PASS (8 tests — quality review added: station-scoped exclusion + id tie-break, DC_150-only rate-card fallback, unpriced-network station path).

- [x] **Step 5: Run the whole unit suite**

Run: `npx vitest run`
Expected: all tests green (slug, matching, ocm, prices, queries).

- [x] **Step 6: Commit**

```bash
git add src/lib/server/db/queries.ts src/lib/server/db/queries.test.ts
git commit -m "feat: add rate-card and station-list read queries"
```

---

### Task 11: i18n with Paraglide (IS base, EN toggle)

**Files:**

- Create: `project.inlang/settings.json`, `messages/is.json`, `messages/en.json`, `src/routes/lang/+server.ts`, `src/hooks.server.ts`
- Modify: `vite.config.ts`

- [x] **Step 1: Install and configure Paraglide**

```bash
npm i -D @inlang/paraglide-js
mkdir -p project.inlang messages
```

`project.inlang/settings.json`:

```json
{
	"$schema": "https://inlang.com/schema/project-settings",
	"baseLocale": "is",
	"locales": ["is", "en"],
	"modules": ["https://cdn.jsdelivr.net/npm/@inlang/plugin-message-format@4.4.0/dist/index.js"],
	"plugin.inlang.messageFormat": { "pathPattern": "./messages/{locale}.json" }
}
```

In `vite.config.ts`, add to the plugins array (before `sveltekit()`):

```ts
import { paraglideVitePlugin } from '@inlang/paraglide-js';
// inside plugins: [...]
paraglideVitePlugin({
	project: './project.inlang',
	outdir: './src/lib/paraglide',
	strategy: ['cookie', 'baseLocale']
});
```

Add `src/lib/paraglide/` to `.gitignore` (generated code).

- [x] **Step 2: Write the messages**

`messages/is.json`:

```json
{
	"$schema": "https://inlang.com/schema/inlang-message-format",
	"site_title": "Hleðsluverð",
	"site_tagline": "Verð á hleðslu rafbíla á Íslandi — á einum stað",
	"mode_dc": "Hraðhleðsla (DC)",
	"mode_ac": "Hæg hleðsla (AC)",
	"filter_mode": "Afl",
	"th_station": "Stöð",
	"th_network": "Fyrirtæki",
	"th_price": "Verð/kWh",
	"th_connectors": "Tengi",
	"th_free": "Laust",
	"filter_all_connectors": "Öll tengi",
	"filter_all_networks": "Öll fyrirtæki",
	"price_unknown": "verð óþekkt",
	"no_results": "Engar stöðvar fundust með þessum síum.",
	"cheapest": "ódýrast",
	"verified_on": "staðfest {date}",
	"minute_fee": "+ {fee} kr/mín",
	"rate_card_title": "Verðskrá fyrirtækja",
	"stations_title": "Allar hleðslustöðvar",
	"lang_switch": "English"
}
```

`messages/en.json`:

```json
{
	"$schema": "https://inlang.com/schema/inlang-message-format",
	"site_title": "Hleðsluverð",
	"site_tagline": "EV charging prices in Iceland — in one place",
	"mode_dc": "Fast charging (DC)",
	"mode_ac": "Slow charging (AC)",
	"filter_mode": "Charging speed",
	"th_station": "Station",
	"th_network": "Network",
	"th_price": "Price/kWh",
	"th_connectors": "Connectors",
	"th_free": "Available",
	"filter_all_connectors": "All connectors",
	"filter_all_networks": "All networks",
	"price_unknown": "price unknown",
	"no_results": "No stations match these filters.",
	"cheapest": "cheapest",
	"verified_on": "verified {date}",
	"minute_fee": "+ {fee} kr/min",
	"rate_card_title": "Network price list",
	"stations_title": "All charging stations",
	"lang_switch": "Íslenska"
}
```

- [x] **Step 3: Wire the server hook**

`src/hooks.server.ts`:

```ts
import type { Handle } from '@sveltejs/kit';
import { paraglideMiddleware } from '$lib/paraglide/server';

export const handle: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request, locale }) => {
		event.request = request;
		return resolve(event, {
			transformPageChunk: ({ html }) => html.replace('%paraglide.lang%', locale)
		});
	});
```

In `src/app.html`, change `<html lang="en">` to `<html lang="%paraglide.lang%">`.

- [x] **Step 4: No-JS language toggle route**

`src/routes/lang/+server.ts`:

```ts
import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// Deliberate tradeoff: a GET that sets a cookie, so the toggle works without JS.
// A forged request can only flip the display language (cosmetic). Note the SSR output
// varies by this cookie — any future CDN/proxy caching needs Vary: Cookie handling.
export const GET: RequestHandler = ({ url, cookies }) => {
	const to = url.searchParams.get('to') === 'en' ? 'en' : 'is';
	cookies.set('PARAGLIDE_LOCALE', to, { path: '/', maxAge: 60 * 60 * 24 * 365 });
	const target = url.searchParams.get('redirect') ?? '/';
	// Only same-origin relative paths: require a leading '/' NOT followed by '/' or '\\' —
	// browsers treat both '//host' and '/\\host' as protocol-relative, i.e. an open redirect.
	redirect(303, /^\/(?![/\\])/.test(target) ? target : '/');
};
```

- [x] **Step 5: Verify build compiles messages**

Run: `npm run dev -- --open=false & sleep 5 && ls src/lib/paraglide/messages 2>/dev/null | head -3; kill %1`
Expected: generated message modules exist; dev server starts without errors.

- [x] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add Paraglide i18n (is base, en) with no-JS cookie toggle"
```

---

### Task 12: Formatting utilities (TDD)

**Files:**

- Create: `src/lib/format.ts`, `src/lib/format.test.ts`

- [x] **Step 1: Write the failing test**

`src/lib/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatIsk, formatDate, formatNumber } from './format';

describe('formatNumber', () => {
	it('formats fractional values with an Icelandic comma', () => {
		expect(formatNumber(0.5)).toBe('0,5');
	});
	it('formats whole numbers without decimals', () => {
		expect(formatNumber(2)).toBe('2');
	});
});

describe('formatIsk', () => {
	it('shows whole ISK without decimals', () => {
		expect(formatIsk(70)).toBe('70 kr');
	});
	it('shows one decimal with Icelandic comma when fractional', () => {
		expect(formatIsk(49.9)).toBe('49,9 kr');
	});
});

describe('formatDate', () => {
	it('formats as D.M.YYYY', () => {
		expect(formatDate(new Date('2026-07-02T12:00:00Z'))).toBe('2.7.2026');
	});
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/format.test.ts`
Expected: FAIL — cannot find module `./format`.

- [x] **Step 3: Write the implementation**

`src/lib/format.ts`:

```ts
export function formatNumber(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1).replace('.', ',');
}

export function formatIsk(value: number): string {
	return `${formatNumber(value)} kr`;
}

export function formatDate(d: Date): string {
	return `${d.getUTCDate()}.${d.getUTCMonth() + 1}.${d.getUTCFullYear()}`;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/format.test.ts`
Expected: PASS (3 tests).

- [x] **Step 5: Commit**

```bash
git add src/lib/format.ts src/lib/format.test.ts
git commit -m "feat: add ISK and date formatting"
```

---

### Task 13: Homepage — load function, rate card, station table

**Files:**

- Create: `src/routes/+page.server.ts`, `src/lib/components/RateCard.svelte`, `src/lib/components/StationTable.svelte`
- Modify: `src/routes/+page.svelte`, `src/routes/+layout.svelte`

Everything is links + query params — zero client JS required. URL contract: `?afl=AC|DC` (mode, default DC), `?tengi=CCS2|CHAdeMO|Type2` (connector filter), `?fyrirtaeki=<slug>` (network filter).

**As-built notes (2026-07-03, from quality review):** favicon link restored in the layout; minute fees format via a new `formatNumber` (Icelandic comma; en `minute_fee` unified to "kr/min"); `no_results` empty state; `fyrirtaeki` validated against — and filter options derived from — the stations in view (not the rate card, which only lists priced networks); `aria-current` + translated `aria-label`s (new key `filter_mode`) on filter links; site title is an `<h1>`. Snippets below are as-built.

- [x] **Step 1: Write the load function**

`src/routes/+page.server.ts`:

```ts
import { db } from '$lib/server/db';
import { rateCard, stationList } from '$lib/server/db/queries';
import { CONNECTOR_TYPES, type ConnectorType } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const mode = url.searchParams.get('afl') === 'AC' ? ('AC' as const) : ('DC' as const);
	const tengi = url.searchParams.get('tengi');
	const connector = (CONNECTOR_TYPES as readonly string[]).includes(tengi ?? '')
		? (tengi as ConnectorType)
		: null;
	const rawNetwork = url.searchParams.get('fyrirtaeki');

	const [cards, allStations] = await Promise.all([rateCard(db), stationList(db, mode)]);

	// filter options come from the stations in view, not the rate card — most networks
	// have stations long before they have verified prices
	const networkOptions = [...new Map(allStations.map((s) => [s.networkSlug, s.networkName]))]
		.map(([slug, name]) => ({ slug, name }))
		.sort((a, b) => a.name.localeCompare(b.name, 'is'));
	const network = networkOptions.some((n) => n.slug === rawNetwork) ? rawNetwork : null;

	const stations = allStations.filter(
		(s) =>
			(!connector || s.connectors.some((c) => c.type === connector)) &&
			(!network || s.networkSlug === network)
	);

	return {
		mode,
		connector,
		network,
		cards,
		stations,
		networkOptions
	};
};
```

- [x] **Step 2: Write the RateCard component**

`src/lib/components/RateCard.svelte`:

```svelte
<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { formatIsk } from '$lib/format';
	import type { RateCardEntry } from '$lib/server/db/queries';

	let { cards }: { cards: RateCardEntry[] } = $props();
</script>

<section aria-label={m.rate_card_title()}>
	<h2>{m.rate_card_title()}</h2>
	<ul class="cards">
		{#each cards as card, i}
			<li class="card" class:best={i === 0 && card.dc !== null} data-testid="rate-card">
				<span class="network">{card.networkName}</span>
				<span class="dc">
					{#if card.dc !== null}<strong data-testid="rate-dc">{formatIsk(card.dc)}</strong> DC{/if}
				</span>
				<span class="ac">
					{#if card.ac !== null}{formatIsk(card.ac)} AC{/if}
				</span>
				{#if i === 0 && card.dc !== null}<span class="badge">{m.cheapest()}</span>{/if}
			</li>
		{/each}
	</ul>
</section>

<style>
	.cards {
		display: flex;
		gap: 0.5rem;
		padding: 0;
		list-style: none;
		overflow-x: auto;
	}
	.card {
		flex: 1 1 8rem;
		min-width: 7rem;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		border: 1px solid var(--border, #ccc);
		border-radius: 0.5rem;
		padding: 0.6rem 0.8rem;
	}
	.card.best {
		border-color: var(--accent, #2e7d32);
	}
	.network {
		font-weight: 600;
	}
	.dc strong {
		font-size: 1.25rem;
	}
	.ac {
		opacity: 0.75;
		font-size: 0.9rem;
	}
	.badge {
		color: var(--accent, #2e7d32);
		font-size: 0.8rem;
		font-weight: 600;
	}
</style>
```

- [x] **Step 3: Write the StationTable component**

`src/lib/components/StationTable.svelte`:

```svelte
<script lang="ts">
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';
	import { formatIsk, formatDate, formatNumber } from '$lib/format';
	import { CONNECTOR_TYPES } from '$lib/types';
	import type { StationRow } from '$lib/server/db/queries';

	let {
		stations,
		mode,
		connector,
		network,
		networkOptions
	}: {
		stations: StationRow[];
		mode: 'AC' | 'DC';
		connector: string | null;
		network: string | null;
		networkOptions: { slug: string; name: string }[];
	} = $props();

	function href(params: Record<string, string | null>): string {
		const u = new URL(page.url);
		for (const [k, v] of Object.entries(params)) {
			if (v === null) u.searchParams.delete(k);
			else u.searchParams.set(k, v);
		}
		return u.pathname + u.search;
	}
</script>

<section aria-label={m.stations_title()}>
	<h2>{m.stations_title()}</h2>

	<nav class="filters">
		<span class="group" role="group" aria-label={m.filter_mode()}>
			<a
				href={href({ afl: null })}
				class:active={mode === 'DC'}
				aria-current={mode === 'DC' ? 'page' : undefined}>{m.mode_dc()}</a
			>
			<a
				href={href({ afl: 'AC' })}
				class:active={mode === 'AC'}
				aria-current={mode === 'AC' ? 'page' : undefined}>{m.mode_ac()}</a
			>
		</span>
		<span class="group" role="group" aria-label={m.th_connectors()}>
			<a
				href={href({ tengi: null })}
				class:active={!connector}
				aria-current={!connector ? 'page' : undefined}>{m.filter_all_connectors()}</a
			>
			{#each CONNECTOR_TYPES as t}
				<a
					href={href({ tengi: t })}
					class:active={connector === t}
					aria-current={connector === t ? 'page' : undefined}>{t}</a
				>
			{/each}
		</span>
		<span class="group" role="group" aria-label={m.th_network()}>
			<a
				href={href({ fyrirtaeki: null })}
				class:active={!network}
				aria-current={!network ? 'page' : undefined}>{m.filter_all_networks()}</a
			>
			{#each networkOptions as n}
				<a
					href={href({ fyrirtaeki: n.slug })}
					class:active={network === n.slug}
					aria-current={network === n.slug ? 'page' : undefined}>{n.name}</a
				>
			{/each}
		</span>
	</nav>

	{#if stations.length === 0}
		<p class="empty">{m.no_results()}</p>
	{:else}
		<table>
			<thead>
				<tr>
					<th>{m.th_station()}</th>
					<th>{m.th_network()}</th>
					<th>{m.th_price()}</th>
					<th>{m.th_connectors()}</th>
					<th>{m.th_free()}</th>
				</tr>
			</thead>
			<tbody>
				{#each stations as s (s.slug)}
					<tr data-testid="station-row">
						<td data-label={m.th_station()}>{s.name}</td>
						<td data-label={m.th_network()}>{s.networkName}</td>
						<td data-label={m.th_price()}>
							{#if s.price !== null}
								<strong data-testid="price">{formatIsk(s.price)}</strong>
								{#if s.minuteFeeIsk}<small
										>{m.minute_fee({ fee: formatNumber(s.minuteFeeIsk) })}</small
									>{/if}
								{#if s.verifiedAt}<small class="verified"
										>{m.verified_on({ date: formatDate(s.verifiedAt) })}</small
									>{/if}
							{:else}
								<em>{m.price_unknown()}</em>
							{/if}
						</td>
						<td data-label={m.th_connectors()}>
							{#each s.connectors as c}
								<span class="chip">{c.type} ×{c.count} · {c.powerKw} kW</span>
							{/each}
						</td>
						<td data-label={m.th_free()}>—</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

<style>
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}
	.group {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.group a {
		border: 1px solid var(--border, #ccc);
		border-radius: 1rem;
		padding: 0.15rem 0.7rem;
		text-decoration: none;
		color: inherit;
		font-size: 0.9rem;
	}
	.group a.active {
		background: var(--accent, #2e7d32);
		border-color: var(--accent, #2e7d32);
		color: #fff;
	}
	.empty {
		opacity: 0.7;
		padding: 1rem 0;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th {
		text-align: left;
		font-size: 0.85rem;
		opacity: 0.7;
		border-bottom: 2px solid var(--border, #ccc);
		padding: 0.4rem 0.5rem;
	}
	td {
		padding: 0.5rem;
		border-bottom: 1px solid var(--border, #e2e2e2);
		vertical-align: top;
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
	.verified {
		display: block;
		opacity: 0.6;
		font-size: 0.75rem;
	}
	small {
		display: block;
	}

	@media (max-width: 640px) {
		thead {
			display: none;
		}
		tr {
			display: block;
			border-bottom: 2px solid var(--border, #ccc);
			padding: 0.4rem 0;
		}
		td {
			display: flex;
			gap: 0.5rem;
			border: none;
			padding: 0.15rem 0.25rem;
		}
		td::before {
			content: attr(data-label);
			flex: 0 0 6rem;
			font-size: 0.8rem;
			opacity: 0.6;
		}
	}
</style>
```

- [x] **Step 4: Write the page and layout**

`src/routes/+page.svelte`:

```svelte
<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import RateCard from '$lib/components/RateCard.svelte';
	import StationTable from '$lib/components/StationTable.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>{m.site_title()} — {m.site_tagline()}</title>
	<meta name="description" content={m.site_tagline()} />
</svelte:head>

<RateCard cards={data.cards} />
<StationTable
	stations={data.stations}
	mode={data.mode}
	connector={data.connector}
	network={data.network}
	networkOptions={data.networkOptions}
/>
```

`src/routes/+layout.svelte`:

```svelte
<script lang="ts">
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';

	let { children } = $props();
	const other = () => (getLocale() === 'is' ? 'en' : 'is');
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<header>
	<h1 class="logo"><a href="/">{m.site_title()}</a></h1>
	<p class="tagline">{m.site_tagline()}</p>
	<a
		class="lang"
		data-testid="lang-toggle"
		href="/lang?to={other()}&redirect={encodeURIComponent(page.url.pathname + page.url.search)}"
	>
		{m.lang_switch()}
	</a>
</header>

<main>
	{@render children()}
</main>

<style>
	:global(body) {
		font-family: system-ui, sans-serif;
		margin: 0;
		color: #1b1b1b;
	}
	header {
		display: flex;
		align-items: baseline;
		gap: 1rem;
		flex-wrap: wrap;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid #e2e2e2;
	}
	.logo {
		font-size: 1.3rem;
		font-weight: 700;
		margin: 0;
	}
	.logo a {
		text-decoration: none;
		color: inherit;
	}
	.tagline {
		margin: 0;
		opacity: 0.7;
		font-size: 0.9rem;
	}
	.lang {
		margin-left: auto;
		font-size: 0.9rem;
	}
	main {
		max-width: 68rem;
		margin: 0 auto;
		padding: 1rem;
	}
</style>
```

- [x] **Step 5: Manual verification**

Run: `npm run dev -- --open=false` and check in a browser (or with curl):

```bash
curl -s "http://localhost:5173/" | grep -o 'data-testid="station-row"' | wc -l   # > 0 rows
curl -s "http://localhost:5173/?afl=AC" | grep -c 'Hæg'                          # AC mode active
curl -s "http://localhost:5173/?tengi=CHAdeMO" | grep -o 'data-testid="station-row"' | wc -l  # fewer rows
```

Expected: station rows render server-side; filters change the row set; prices display with "staðfest" dates. Kill the dev server after.

- [x] **Step 6: Commit**

```bash
git add src/routes src/lib/components
git commit -m "feat: server-rendered homepage with rate card, station table, link-based filters"
```

---

### Task 14: End-to-end tests (Playwright)

**Files:**

- Create: `e2e/homepage.test.ts`
- Modify: `playwright.config.ts` (REPLACE the generated config — see Step 1), `package.json` (trim `test:e2e` script)

E2E runs against the dev DB — Tasks 7–9 seeds must have been run. Tests assert structure (sortedness, filter behavior), not exact prices, so they survive price changes.

- [x] **Step 1: Replace the playwright config**

The sv-generated config has `testMatch: '**/*.e2e.{ts,js}'` and no `testDir` — it will find ZERO tests in `e2e/homepage.test.ts` — and it lacks `reuseExistingServer`. Replace the whole file with:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
	testDir: 'e2e',
	webServer: {
		command: 'npm run build && npm run preview',
		port: 4173,
		reuseExistingServer: true
	},
	use: { baseURL: 'http://localhost:4173' }
});
```

Also change `package.json`'s `test:e2e` script from `playwright install && playwright test` to just `playwright test` — browser install is a one-time manual step, not something to run on every invocation.

- [x] **Step 2: Write the failing tests**

`e2e/homepage.test.ts`:

```ts
import { expect, test } from '@playwright/test';

function parsePrice(text: string): number {
	return parseFloat(text.replace(',', '.').replace(/[^\d.]/g, ''));
}

test('homepage renders the rate card and a station list sorted by price', async ({ page }) => {
	await page.goto('/');
	expect(await page.locator('[data-testid="rate-card"]').count()).toBeGreaterThan(0);

	const prices = await page
		.locator('[data-testid="station-row"] [data-testid="price"]')
		.allTextContents();
	expect(prices.length).toBeGreaterThan(0);
	const nums = prices.map(parsePrice);
	// NaN === NaN under toEqual, so a formatter change must not slip past as NaN
	for (const n of nums) expect(Number.isFinite(n)).toBe(true);
	expect(nums).toEqual([...nums].sort((a, b) => a - b));

	// unknown-price rows render no price cell and must sort last; some networks
	// (Tesla) stay app-priced indefinitely, so such rows always exist
	const rows = page.locator('[data-testid="station-row"]');
	await expect(rows.first().locator('[data-testid="price"]')).toHaveCount(1);
	await expect(rows.last().locator('[data-testid="price"]')).toHaveCount(0);
});

test('rate card is sorted cheapest-first', async ({ page }) => {
	await page.goto('/');
	const dcs = await page.locator('[data-testid="rate-dc"]').allTextContents();
	expect(dcs.length).toBeGreaterThan(0);
	const nums = dcs.map(parsePrice);
	expect(nums).toEqual([...nums].sort((a, b) => a - b));
});

test('connector filter reduces or keeps the row count and every row matches', async ({ page }) => {
	await page.goto('/');
	const all = await page.locator('[data-testid="station-row"]').count();
	await page.goto('/?tengi=CHAdeMO');
	const filtered = await page.locator('[data-testid="station-row"]').count();
	expect(filtered).toBeGreaterThan(0);
	expect(filtered).toBeLessThanOrEqual(all);
	const rows = page.locator('[data-testid="station-row"]');
	for (let i = 0; i < Math.min(filtered, 10); i++) {
		await expect(rows.nth(i)).toContainText('CHAdeMO');
	}
});

test('language toggle switches to English and back, without JavaScript', async ({ browser }) => {
	const ctx = await browser.newContext({ javaScriptEnabled: false });
	const page = await ctx.newPage();
	await page.goto('/');
	await expect(page.locator('header .tagline')).toContainText('á einum stað');
	await page.locator('[data-testid="lang-toggle"]').click();
	await expect(page.locator('header .tagline')).toContainText('in one place');
	await page.locator('[data-testid="lang-toggle"]').click();
	await expect(page.locator('header .tagline')).toContainText('á einum stað');
	await ctx.close();
});

test('station list renders without JavaScript', async ({ browser }) => {
	const ctx = await browser.newContext({ javaScriptEnabled: false });
	const page = await ctx.newPage();
	await page.goto('/');
	expect(await page.locator('[data-testid="station-row"]').count()).toBeGreaterThan(0);
	await ctx.close();
});
```

- [x] **Step 3: Run the E2E suite**

Run: `npx playwright install chromium` (first time), then `npx playwright test`
Expected: 5 tests PASS. If the sortedness test fails, debug the query — do not loosen the test.

- [x] **Step 4: Commit**

```bash
git add e2e/homepage.test.ts playwright.config.ts package.json
git commit -m "test: add homepage E2E suite (sorting, filters, no-JS, language toggle)"
```

---

### Task 15: README + final green run

**Files:**

- Create: `README.md`

- [x] **Step 1: Write the README**

`README.md`:

```markdown
# Hleðsluverð

Verðsamanburður á hleðslu rafbíla á Íslandi — hledsluverd.is

Full documentation lives in the owner's Obsidian vault (notes tagged #hledsluverd).

## Development setup

Requires Node ≥ 20 and PostgreSQL ≥ 16 with PostGIS.

    createdb hledsluverd && createdb hledsluverd_test
    sudo -u postgres psql -d hledsluverd -c "CREATE EXTENSION postgis;"
    sudo -u postgres psql -d hledsluverd_test -c "CREATE EXTENSION postgis;"
    cp .env.example .env       # fill in OCM_API_KEY (free: openchargemap.org)
    npm install
    npm run db:migrate
    DATABASE_URL=postgres://localhost:5432/hledsluverd_test npm run db:migrate
    npm run seed:networks && npm run seed:ocm && npm run seed:prices
    npm run dev

## Tests

    npx vitest run        # unit + DB tests (DB tests skip if DATABASE_URL_TEST unset)
    npx playwright test   # E2E against a production build (needs seeded dev DB)

## Data notes

- `prices` is append-only — it doubles as the price-history/trend dataset. All price
  writes go through `insertPriceIfChanged` (plausibility guard, change detection).
- Station data seeds from Open Charge Map; re-running `seed:ocm` is idempotent and
  prints unmatched operators for review.
- Initial prices in `seeds/prices-initial.json` were verified by hand against operator
  websites on the date in git history. Scrapers arrive in Phase 2.
```

- [x] **Step 2: Full verification run**

```bash
npx vitest run && npx playwright test && npm run build
```

Expected: everything green, build succeeds.

- [x] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README with dev setup"
```

---

## Self-review notes (already applied)

- **Spec coverage (Phase 1 slice):** schema = Gagnalíkan note ✓; seeding = Gagnasöfnun §station-seeding + §car-data-deferred ✓ (cars table exists, seeding is Phase 3); homepage = Síður og UX §homepage ✓ (rate card, table columns incl. empty "Laust" column, mode toggle, filters, verified labels, minute fees, mobile collapse, no-JS); i18n ✓; price write rules = Gagnasöfnun §scrapers rules 2–3 ✓ (runner + per-network scrapers are Phase 2, but the write path they'll call is built and tested now); degraded states covered in Phase 1: "—" never "0" ✓, price_unknown for Tesla ✓, verified labels ✓.
- **Deliberate deviations:** stations get a `slug` column (needed by `/stod/[slug]` in Phase 3; cheap now, painful later). `availability`, `cars`, `scrape_runs` created empty (single coherent migration).
- **Type consistency check:** `ConnectorType`/`TariffKey` defined once in `src/lib/types.ts`; `Db` type from `client.ts` used in helpers/queries/prices; `StationRow`/`RateCardEntry` defined in `queries.ts` and imported by components; `insertPriceIfChanged(db, reading)` signature identical in Tasks 9 and 10 usage. ✓
- **Placeholder scan:** the only "later" items are explicitly scoped to Phases 2–4; every code step contains complete code. ✓
