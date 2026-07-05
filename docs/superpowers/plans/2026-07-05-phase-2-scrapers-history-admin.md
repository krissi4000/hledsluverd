# Phase 2: Scrapers, Price History, Trend Graph & Admin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hourly price scrapers for ON, Ísorka, N1 and Orkan feeding the append-only `prices` history, a `/verdthroun` stepped-line trend page, and a `/admin` page for manual prices, verification and scraper health.

**Architecture:** One scraper module per network behind a common `Scraper` interface, executed by a shared runner that writes through the existing `insertPriceIfChanged` guard and logs every run to `scrape_runs` (fail loud, never guess — a failed parse leaves yesterday's price standing). Entry point `scripts/scrape.ts` runs via tsx (a systemd timer calls it in Phase 4). The trend page and admin read only from Postgres.

**Tech Stack:** SvelteKit (Svelte 5 runes) + TypeScript, Drizzle ORM + postgres.js, cheerio (HTML parsing), playwright (headless Chromium — Orkan only), chart.js (trend graph), Paraglide (i18n), Vitest + Playwright test.

---

## Design deltas from the approved spec (research findings, 2026-07-05)

Live research against all five operator sites forced these changes; each is the least-bad honest option:

1. **Per-station prices are the norm, not the exception.** Ísorka (Virta API), N1 (per-station bands 50/65 kr) and Orkan (49/58/61 kr per station) all price per station. The `prices.station_id` column already supports this. New resolution rule everywhere: *a station's price = its own current price row if one exists, else its network's network-wide row*.
2. **New column `prices.minute_fee_after_min`** (integer, nullable). Ísorka charges 60 kr/min *after 60 free minutes*; Orkan charges a biðgjald equal to one kWh per minute *after 60 minutes*. Storing those as a flat minute fee would misrepresent the tariff (ON's 0,5 kr/mín applies from minute 0). NULL = fee applies from the start.
3. **Rate card shows "frá X kr"** (with `dcFrom`/`acFrom` flags) when a network's stations have differing prices; the value shown is the cheapest. Sorting stays by that minimum.
4. **Trend line per network = cheapest current price over time** (min across its network-wide + station rows), since three networks have no single network price. The page says so ("lægsta verð").
5. **e1 gets no scraper.** e1 publishes no consumer prices anywhere on the web (verified: prices are host-set, app-only; the public `publicMap` JSON has tariff IDs but no amounts). e1 joins Tesla as app-priced; the admin manual path covers both if prices ever surface.
6. **Orkan requires headless Chromium.** orkan.is is Blazor Server — prices arrive over a websocket, raw HTML is an empty shell (the gasvaktin project hit the same wall and runs a headless browser). Parser stays fixture-tested cheerio; only the fetch uses playwright.
7. **Scope moved to Phase 3:** station add/edit forms and OCM re-sync diff review (they belong with the map/station-page work). Phase 2 admin = scraper health + manual prices + verified-at bump + station activate/deactivate toggle.

**Scrape-target facts pinned by research** (fixtures in tasks below are verbatim captures from 2026-07-05):

| Network | Source | Shape | Traps |
|---|---|---|---|
| ON | `https://www.on.is/verdskrar` (server-rendered Framer HTML, plain fetch) | rows `div[data-framer-name="Row"]`, values only in `p.framer-text` text | `data-framer-name` attrs hold STALE prices (says 69, renders 62); every cell duplicated in responsive `ssr-variant` wrappers; exclude "– Vildarkjör" loyalty rows; English page is stale |
| Ísorka | `https://isorka.poweredbyvirta.com/api/core/v4/stations/{id}` (unauthenticated JSON) | `evses[].pricing[]`, `priceCents / 100` = ISK incl. VSK; `minutesWithoutTimeCharge` = free minutes | list endpoint rejects whole-Iceland bbox (tile it); filter `provider=="Virta"` (roaming pollution); use account `pricing`, not `oneTimePricing` (ad-hoc = 1.1×) |
| N1 | `https://n1.is/is/verdtafla` — list price in escaped-JSON blob in raw HTML; per-station via Next.js server action POST | blob: `\"title\":\"Rafmagn\"...\"price\":N`; action response line `1:{"success":true,"items":[...]}` | `Next-Action` id rotates every deploy — derive from JS chunks via `getFuelPricesForStation` reference; flat kr/kWh (no AC/DC split, no fees) |
| Orkan | `https://www.orkan.is/orkustodvar/` rendered DOM, `.prices__list` | per-card label/value pairs, match heading text `Rafmagn`, decimal comma, `-` = none | Blazor: must wait for selector, not page load; `<!--!-->` comment nodes everywhere; biðgjald rule (1 kWh price per min after 60 min) is prose on /rafmagn — hardcoded with source comment |

**Current live values for smoke checks** (will drift — treat as "expected order of magnitude"): ON AC 48 + 0,5 kr/mín, DC 62; Ísorka DC 45–73 by site, AC 19–34; N1 list 56, stations 50/65; Orkan 49/58/61.

## File structure

```
src/lib/server/scrapers/
	types.ts          # Scraper + ScrapedReading interfaces
	runner.ts         # shared runner: insertPriceIfChanged, scrape_runs, ntfy
	on.ts             # parseOnVerdskra + onScraper
	isorka.ts         # parseVirtaStation + isorkaScraper
	n1.ts             # parseN1* + extractActionId + n1Scraper
	orkan.ts          # parseOrkanPrices + fetchOrkanHtml + orkanScraper
	index.ts          # allScrapers registry
src/lib/server/admin.ts        # form-level admin logic (unit-testable)
src/lib/server/db/schema.ts    # + minute_fee_after_min; externalIds type + virta/n1
src/lib/server/db/prices.ts    # PriceReading + minuteFeeAfterMin
src/lib/server/db/queries.ts   # station-scoped currentPrices, override resolution, frá, trendSeries
src/routes/verdthroun/+page.server.ts, +page.svelte
src/routes/admin/+page.server.ts, +page.svelte
scripts/scrape.ts, match-virta.ts, match-n1.ts
tests/fixtures/on-verdskrar.html, virta-station-{dc,ac,conflict}.json,
	n1-blob.txt, n1-action-response.txt, n1-chunk-snippet.js, orkan-orkustodvar.html
drizzle/0001_*.sql             # generated migration
messages/{is,en}.json          # new keys
```

Non-goals here (Phase 4): systemd timer, deployment, Caddy basic-auth in front of `/admin` (the route ships with a `noindex` meta and a loud comment; it must not go live without Caddy auth).

---

### Task 1: Branch and dependencies

**Files:** `package.json` (via npm)

- [x] **Step 1: Create the feature branch**

```bash
git checkout -b phase-2-scrapers
```

- [x] **Step 2: Install runtime dependencies**

cheerio parses ON/Orkan HTML; chart.js renders the trend graph client-side; playwright (same major as the existing @playwright/test) drives Chromium for Orkan and shares its downloaded browser.

```bash
npm install cheerio chart.js playwright
```

- [x] **Step 3: Verify install and existing suite still green**

```bash
npx vitest run
```
Expected: 40 tests pass (6 files).

- [x] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add cheerio, chart.js, playwright for phase 2 scrapers"
```

---

### Task 2: `minute_fee_after_min` column + `PriceReading` extension

**Files:**
- Modify: `src/lib/server/db/schema.ts` (prices table + externalIds type)
- Modify: `src/lib/server/db/prices.ts`
- Modify: `src/lib/types.ts` (no change needed — verify only)
- Test: `src/lib/server/db/prices.test.ts`
- Create: `drizzle/0001_*.sql` (generated)

- [x] **Step 1: Write the failing test**

Add inside the existing `describe.skipIf(!TEST_DB_URL)('insertPriceIfChanged', ...)` block in `src/lib/server/db/prices.test.ts` (it provides `db` and `networkId`):

```ts
	it('appends a new row when only the fee-free period changes', async () => {
		await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'DC',
			priceIskPerKwh: 73,
			minuteFeeIsk: 60,
			minuteFeeAfterMin: 60,
			source: 'scraper'
		});
		const same = await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'DC',
			priceIskPerKwh: 73,
			minuteFeeIsk: 60,
			minuteFeeAfterMin: 60,
			source: 'scraper'
		});
		expect(same).toBe('verified');
		const changed = await insertPriceIfChanged(db, {
			networkId,
			tariffKey: 'DC',
			priceIskPerKwh: 73,
			minuteFeeIsk: 60,
			minuteFeeAfterMin: 30,
			source: 'scraper'
		});
		expect(changed).toBe('inserted');
		expect(await db.select().from(prices)).toHaveLength(2);
	});

	it('rejects a non-integer or negative fee-free period', async () => {
		await expect(
			insertPriceIfChanged(db, {
				networkId,
				tariffKey: 'DC',
				priceIskPerKwh: 73,
				minuteFeeIsk: 60,
				minuteFeeAfterMin: 1.5,
				source: 'scraper'
			})
		).rejects.toThrow(/implausible/i);
		await expect(
			insertPriceIfChanged(db, {
				networkId,
				tariffKey: 'DC',
				priceIskPerKwh: 73,
				minuteFeeIsk: 60,
				minuteFeeAfterMin: -5,
				source: 'scraper'
			})
		).rejects.toThrow(/implausible/i);
		expect(await db.select().from(prices)).toHaveLength(0);
	});
```

- [x] **Step 2: Run to verify failure**

```bash
npx vitest run src/lib/server/db/prices.test.ts
```
Expected: FAIL — TypeScript error (`minuteFeeAfterMin` not in `PriceReading`) or unknown-column at runtime.

- [x] **Step 3: Schema change**

In `src/lib/server/db/schema.ts`, add to the `prices` table between `minuteFeeIsk` and `validFrom`:

```ts
		minuteFeeIsk: doublePrecision('minute_fee_isk'),
		// Minutes of charging before minute_fee_isk starts to apply (Ísorka free period,
		// Orkan biðgjald). NULL = the fee runs from the first minute (ON).
		minuteFeeAfterMin: integer('minute_fee_after_min'),
		validFrom: timestamp('valid_from', { withTimezone: true }).notNull().defaultNow(),
```

And extend the stations `externalIds` type for the Phase 2 matchers:

```ts
		externalIds: jsonb('external_ids')
			.$type<{ ocm?: number; tomtom?: string; virta?: number; n1?: string }>()
			.notNull()
			.default({}),
```

- [x] **Step 4: Generate and apply the migration**

```bash
npx drizzle-kit generate --name minute_fee_after_min
npm run db:migrate
```
Expected: new `drizzle/0001_minute_fee_after_min.sql` containing `ALTER TABLE "prices" ADD COLUMN "minute_fee_after_min" integer;`. The test DB migrates itself in `setupTestDb`.

- [x] **Step 5: Extend `PriceReading` and `insertPriceIfChanged`**

In `src/lib/server/db/prices.ts` — add the field to the interface:

```ts
	/**
	 * Omitted/null means the network charges no minute fee — not "unknown".
	 * Scrapers must always pass the full reading: leaving this out when the
	 * network has a fee writes a new history row that erases the fee.
	 */
	minuteFeeIsk?: number | null;
	/** Minutes of charging before minuteFeeIsk applies; null = from the first minute. */
	minuteFeeAfterMin?: number | null;
```

Add validation after the existing minute-fee check:

```ts
	if (
		reading.minuteFeeAfterMin != null &&
		(!Number.isInteger(reading.minuteFeeAfterMin) || reading.minuteFeeAfterMin < 0)
	) {
		throw new Error(
			`Implausible fee-free period ${reading.minuteFeeAfterMin} min for network ${reading.networkId} ${reading.tariffKey} — treated as a parse error, not stored`
		);
	}
```

Add normalization next to the fee normalization, extend the unchanged-comparison, and the insert:

```ts
	const minuteFeeAfterMin = reading.minuteFeeAfterMin ?? null;
```

```ts
	if (
		current &&
		current.priceIskPerKwh === priceIskPerKwh &&
		(current.minuteFeeIsk ?? null) === minuteFeeIsk &&
		(current.minuteFeeAfterMin ?? null) === minuteFeeAfterMin
	) {
```

```ts
	await db.insert(prices).values({
		networkId: reading.networkId,
		stationId: reading.stationId ?? null,
		tariffKey: reading.tariffKey,
		priceIskPerKwh,
		minuteFeeIsk,
		minuteFeeAfterMin,
		source: reading.source
	});
```

- [x] **Step 6: Run tests**

```bash
npx vitest run src/lib/server/db/prices.test.ts
```
Expected: PASS (all, including the two new).

- [x] **Step 7: Commit**

```bash
git add src/lib/server/db/schema.ts src/lib/server/db/prices.ts src/lib/server/db/prices.test.ts drizzle/
git commit -m "feat: minute_fee_after_min on prices — fees with free periods (Ísorka, Orkan)"
```

---

### Task 3: Station-scoped current prices, override resolution, "frá" rate card

**Files:**
- Modify: `src/lib/server/db/queries.ts`
- Test: `src/lib/server/db/queries.test.ts`

- [x] **Step 1: Write the failing tests**

In `src/lib/server/db/queries.test.ts`, **replace** the test `'currentPrices ignores station-scoped rows and breaks validFrom ties by id'` with:

```ts
	it('currentPrices keys station-scoped rows separately and breaks validFrom ties by id', async () => {
		const [st] = await db.select().from(stations);
		await insertPriceIfChanged(db, {
			networkId: on,
			stationId: st.id,
			tariffKey: 'DC',
			priceIskPerKwh: 99,
			source: 'manual'
		});
		// two rows with identical validFrom — the higher id (later insert) must win
		const validFrom = new Date('2026-01-01T00:00:00Z');
		await db.insert(prices).values([
			{ networkId: n1, tariffKey: 'AC', priceIskPerKwh: 30, source: 'manual', validFrom },
			{ networkId: n1, tariffKey: 'AC', priceIskPerKwh: 32, source: 'manual', validFrom }
		]);
		const cp = await currentPrices(db);
		const netWideDc = cp.find(
			(p) => p.networkId === on && p.tariffKey === 'DC' && p.stationId === null
		)!;
		expect(netWideDc.priceIskPerKwh).toBe(44);
		const stationDc = cp.find((p) => p.networkId === on && p.stationId === st.id)!;
		expect(stationDc.priceIskPerKwh).toBe(99);
		expect(cp.find((p) => p.networkId === n1 && p.tariffKey === 'AC')!.priceIskPerKwh).toBe(32);
	});
```

Then add these new tests at the end of the describe block:

```ts
	it('stationList: a station-specific price overrides the network-wide price', async () => {
		const st = await db.select().from(stations);
		const stadarskali = st.find((s) => s.slug === 'stadarskali-n1')!;
		await insertPriceIfChanged(db, {
			networkId: n1,
			stationId: stadarskali.id,
			tariffKey: 'DC',
			priceIskPerKwh: 50,
			source: 'scraper'
		});
		const list = await stationList(db, 'DC');
		const row = list.find((s) => s.slug === 'stadarskali-n1')!;
		expect(row.price).toBe(50);
		// override sorts by its own value: 44/55 ON station keeps place by DC_150=55
		expect(list.map((s) => s.slug)).toEqual(['stadarskali-n1', 'hellisheidi-on']);
	});

	it('stationList: station-only pricing works with no network-wide row at all', async () => {
		const [isorka] = await db
			.insert(networks)
			.values({ name: 'Ísorka', slug: 'isorka' })
			.returning();
		const st = await db
			.insert(stations)
			.values([
				{ networkId: isorka.id, slug: 'olis-ananaust', name: 'Olís Ánanaust', location: { x: -21.95, y: 64.15 } },
				{ networkId: isorka.id, slug: 'kfc-moso', name: 'KFC Mosó', location: { x: -21.7, y: 64.16 } }
			])
			.returning();
		await db.insert(connectors).values([
			{ stationId: st[0].id, type: 'CCS2', powerKw: 150, count: 1 },
			{ stationId: st[1].id, type: 'CCS2', powerKw: 150, count: 1 }
		]);
		await insertPriceIfChanged(db, {
			networkId: isorka.id,
			stationId: st[0].id,
			tariffKey: 'DC',
			priceIskPerKwh: 73,
			minuteFeeIsk: 60,
			minuteFeeAfterMin: 60,
			source: 'scraper'
		});
		const list = await stationList(db, 'DC');
		const priced = list.find((s) => s.slug === 'olis-ananaust')!;
		expect(priced.price).toBe(73);
		expect(priced.minuteFeeAfterMin).toBe(60);
		const unpriced = list.find((s) => s.slug === 'kfc-moso')!;
		expect(unpriced.price).toBeNull();
	});

	it('rateCard: per-station variance yields the minimum price and a frá flag', async () => {
		const st = await db.select().from(stations);
		const stadarskali = st.find((s) => s.slug === 'stadarskali-n1')!;
		await insertPriceIfChanged(db, {
			networkId: n1,
			stationId: stadarskali.id,
			tariffKey: 'DC',
			priceIskPerKwh: 50,
			source: 'scraper'
		});
		const cards = await rateCard(db);
		const n1Card = cards.find((c) => c.networkSlug === 'n1')!;
		expect(n1Card.dc).toBe(50); // min(70 network-wide, 50 station)
		expect(n1Card.dcFrom).toBe(true);
		const onCard = cards.find((c) => c.networkSlug === 'on')!;
		// ON prices DC (44) and DC_150 (55) differently — that variance is also "frá"
		expect(onCard.dcFrom).toBe(true);
		// n1 now sorts ahead of ON's DC 44? no — 44 < 50, ON stays first
		expect(cards.map((c) => c.networkSlug)).toEqual(['on', 'n1']);
	});
```

- [x] **Step 2: Run to verify failure**

```bash
npx vitest run src/lib/server/db/queries.test.ts
```
Expected: FAIL — `dcFrom`/`minuteFeeAfterMin`/`stationId` missing, override not applied.

- [x] **Step 3: Rewrite the three queries in `src/lib/server/db/queries.ts`**

Replace `CurrentPrice` and `currentPrices`:

```ts
export interface CurrentPrice {
	/** prices.id of the current row — admin uses it to bump verified_at */
	id: number;
	networkId: number;
	stationId: number | null;
	tariffKey: TariffKey;
	priceIskPerKwh: number;
	minuteFeeIsk: number | null;
	minuteFeeAfterMin: number | null;
	verifiedAt: Date;
	validFrom: Date;
}

/**
 * Newest price per (network, station-or-network-wide, tariff), computed in TS —
 * the prices table stays small (a few rows per network/station per year).
 */
export async function currentPrices(db: Db): Promise<CurrentPrice[]> {
	const all = await db.select().from(prices);
	const best = new Map<string, (typeof all)[number]>();
	for (const p of all) {
		const key = `${p.networkId}:${p.stationId ?? 'net'}:${p.tariffKey}`;
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
		id: p.id,
		networkId: p.networkId,
		stationId: p.stationId,
		tariffKey: p.tariffKey as TariffKey,
		priceIskPerKwh: p.priceIskPerKwh,
		minuteFeeIsk: p.minuteFeeIsk,
		minuteFeeAfterMin: p.minuteFeeAfterMin,
		verifiedAt: p.verifiedAt,
		validFrom: p.validFrom
	}));
}
```

Replace `RateCardEntry` and `rateCard`:

```ts
export interface RateCardEntry {
	networkSlug: string;
	networkName: string;
	dc: number | null;
	/** true when stations of this network currently have differing DC prices — display "frá" */
	dcFrom: boolean;
	dcVerifiedAt: Date | null;
	ac: number | null;
	acFrom: boolean;
	acVerifiedAt: Date | null;
}

/** One entry per network that has any current price; cheapest (min) per mode, sorted by DC asc. */
export async function rateCard(db: Db): Promise<RateCardEntry[]> {
	const [nets, cp] = await Promise.all([db.select().from(networks), currentPrices(db)]);
	const entries: RateCardEntry[] = [];
	for (const n of nets) {
		const forNet = cp.filter((p) => p.networkId === n.id);
		if (forNet.length === 0) continue;
		const pick = (keys: TariffKey[]) => {
			const rows = forNet.filter((p) => keys.includes(p.tariffKey));
			if (rows.length === 0) return null;
			const min = rows.reduce((a, b) => (b.priceIskPerKwh < a.priceIskPerKwh ? b : a));
			return { min, from: new Set(rows.map((r) => r.priceIskPerKwh)).size > 1 };
		};
		// DC_150 included so a network pricing only the ≥150 kW tier keeps a fast-charge price
		const dc = pick(['DC', 'DC_150']);
		const ac = pick(['AC']);
		entries.push({
			networkSlug: n.slug,
			networkName: n.name,
			dc: dc?.min.priceIskPerKwh ?? null,
			dcFrom: dc?.from ?? false,
			dcVerifiedAt: dc?.min.verifiedAt ?? null,
			ac: ac?.min.priceIskPerKwh ?? null,
			acFrom: ac?.from ?? false,
			acVerifiedAt: ac?.min.verifiedAt ?? null
		});
	}
	return entries.sort(
		(a, b) => (a.dc ?? Infinity) - (b.dc ?? Infinity) || (a.ac ?? Infinity) - (b.ac ?? Infinity)
	);
}
```

In `StationRow` add after `minuteFeeIsk`:

```ts
	minuteFeeAfterMin: number | null;
```

In `stationList`, replace the price-resolution part of the station loop (from `const top = ...` to the `rows.push` call) with:

```ts
		const top = ofMode.reduce((a, b) => (b.powerKw > a.powerKw ? b : a));
		const own = cp.filter((p) => p.stationId === s.id);
		const netWide = cp.filter((p) => p.networkId === s.networkId && p.stationId === null);
		const tariffs = new Set<TariffKey>([...own, ...netWide].map((p) => p.tariffKey));
		const key = deriveTariffKey(top.type as ConnectorType, top.powerKw, tariffs);
		// station-specific current price wins; network-wide price is the fallback
		const price = own.find((p) => p.tariffKey === key) ?? netWide.find((p) => p.tariffKey === key) ?? null;
		const net = netById.get(s.networkId)!;

		rows.push({
			slug: s.slug,
			name: s.name,
			networkSlug: net.slug,
			networkName: net.name,
			price: price?.priceIskPerKwh ?? null,
			minuteFeeIsk: price?.minuteFeeIsk ?? null,
			minuteFeeAfterMin: price?.minuteFeeAfterMin ?? null,
			verifiedAt: price?.verifiedAt ?? null,
			connectors: all.map((c) => ({
				type: c.type as ConnectorType,
				powerKw: c.powerKw,
				count: c.count
			}))
		});
```

The `tariffsByNetwork` map built before the loop is no longer used — delete it.

- [x] **Step 4: Run tests**

```bash
npx vitest run src/lib/server/db/queries.test.ts && npx svelte-kit sync && npx svelte-check --tsconfig ./tsconfig.json
```
Expected: tests PASS; svelte-check clean (nothing consumes the changed fields yet — UI updates come in Task 13).

- [x] **Step 5: Commit**

```bash
git add src/lib/server/db/queries.ts src/lib/server/db/queries.test.ts
git commit -m "feat: per-station price resolution — station rows override network-wide, rate card shows minimum with frá flag"
```

---

### Task 4: `trendSeries` — stepped history per network

**Files:**
- Modify: `src/lib/server/db/queries.ts`
- Test: `src/lib/server/db/queries.test.ts`

- [x] **Step 1: Write the failing tests**

Add at the end of the describe block in `queries.test.ts` (import `trendSeries` alongside the other query imports):

```ts
	it('trendSeries: one stepped series per network of its cheapest price over time', async () => {
		const series = await trendSeries(db, 'DC');
		// beforeEach seeded ON DC 49→44 (two points) and N1 DC 70 (one point);
		// ON's DC_150 at 55 never undercuts the DC price so it adds no point
		const onSeries = series.find((s) => s.networkSlug === 'on')!;
		expect(onSeries.points.map((p) => p.y)).toEqual([49, 44]);
		expect(onSeries.points[0].t).toBeLessThanOrEqual(onSeries.points[1].t);
		const n1Series = series.find((s) => s.networkSlug === 'n1')!;
		expect(n1Series.points.map((p) => p.y)).toEqual([70]);
	});

	it('trendSeries: a cheaper station-scoped row lowers the network minimum', async () => {
		const st = await db.select().from(stations);
		const stadarskali = st.find((s) => s.slug === 'stadarskali-n1')!;
		await insertPriceIfChanged(db, {
			networkId: n1,
			stationId: stadarskali.id,
			tariffKey: 'DC',
			priceIskPerKwh: 50,
			source: 'scraper'
		});
		const series = await trendSeries(db, 'DC');
		const n1Series = series.find((s) => s.networkSlug === 'n1')!;
		expect(n1Series.points.map((p) => p.y)).toEqual([70, 50]);
	});

	it('trendSeries: AC mode excludes DC rows and vice versa', async () => {
		const ac = await trendSeries(db, 'AC');
		expect(ac.find((s) => s.networkSlug === 'on')!.points.map((p) => p.y)).toEqual([39]);
		expect(ac.find((s) => s.networkSlug === 'n1')).toBeUndefined();
	});
```

- [x] **Step 2: Run to verify failure**

```bash
npx vitest run src/lib/server/db/queries.test.ts
```
Expected: FAIL — `trendSeries` not exported.

- [x] **Step 3: Implement `trendSeries` at the end of `queries.ts`**

```ts
export interface TrendSeries {
	networkSlug: string;
	networkName: string;
	/** stepped points: t = epoch ms of valid_from, y = the network's cheapest price then */
	points: { t: number; y: number }[];
}

/**
 * Price history for the trend graph. With three networks priced per station there is
 * no single "network price" — each line plots the network's CHEAPEST current price
 * (min across its network-wide + station rows) at every change point.
 */
export async function trendSeries(db: Db, mode: 'AC' | 'DC'): Promise<TrendSeries[]> {
	const keys: TariffKey[] = mode === 'AC' ? ['AC'] : ['DC', 'DC_150'];
	const [nets, all] = await Promise.all([db.select().from(networks), db.select().from(prices)]);
	const rows = all
		.filter((p) => (keys as string[]).includes(p.tariffKey))
		.sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime() || a.id - b.id);
	const state = new Map<string, number>(); // "network:station-or-net:tariff" → latest price
	const byNetwork = new Map<number, { t: number; y: number }[]>();
	for (const p of rows) {
		state.set(`${p.networkId}:${p.stationId ?? 'net'}:${p.tariffKey}`, p.priceIskPerKwh);
		let min = Infinity;
		for (const [k, v] of state) if (k.startsWith(`${p.networkId}:`)) min = Math.min(min, v);
		const pts = byNetwork.get(p.networkId) ?? [];
		if (pts.length === 0 || pts[pts.length - 1].y !== min) {
			pts.push({ t: p.validFrom.getTime(), y: min });
		}
		byNetwork.set(p.networkId, pts);
	}
	return nets
		.filter((n) => byNetwork.has(n.id))
		.map((n) => ({ networkSlug: n.slug, networkName: n.name, points: byNetwork.get(n.id)! }))
		.sort((a, b) => a.networkName.localeCompare(b.networkName, 'is'));
}
```

- [x] **Step 4: Run tests**

```bash
npx vitest run src/lib/server/db/queries.test.ts
```
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/lib/server/db/queries.ts src/lib/server/db/queries.test.ts
git commit -m "feat: trendSeries — cheapest-price-per-network stepped history for the trend graph"
```

---

### Task 5: Scraper interface + shared runner + ntfy alert

**Files:**
- Create: `src/lib/server/scrapers/types.ts`
- Create: `src/lib/server/scrapers/runner.ts`
- Test: `src/lib/server/scrapers/runner.test.ts`

**Constraint:** nothing under `src/lib/server/scrapers/` may import `$env/*` — `scripts/scrape.ts` runs these modules under tsx where SvelteKit's virtual modules do not exist (`$lib/...` path aliases are fine; the seed scripts already rely on them).

- [ ] **Step 1: Create the interfaces**

`src/lib/server/scrapers/types.ts`:

```ts
import type { TariffKey } from '$lib/types';
import type { Db } from '../db/client';

export interface ScrapedReading {
	/** our stations.id; omitted = network-wide price */
	stationId?: number;
	tariffKey: TariffKey;
	priceIskPerKwh: number;
	minuteFeeIsk?: number | null;
	minuteFeeAfterMin?: number | null;
}

export interface ScrapeResult {
	readings: ScrapedReading[];
	/** non-fatal oddities (unmatched stations, skipped rows) — end up in scrape_runs.message */
	warnings: string[];
}

/**
 * One module per network. Fail loudly, never guess: a scraper that cannot
 * confidently parse must THROW — the runner records a failed run and yesterday's
 * price stays in place. Returning a guessed price is the one unforgivable failure.
 */
export interface Scraper {
	/** must equal networks.scraper_id */
	id: string;
	scrape(db: Db): Promise<ScrapeResult>;
}
```

- [ ] **Step 2: Write the failing runner tests**

`src/lib/server/scrapers/runner.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { desc } from 'drizzle-orm';
import { TEST_DB_URL, closeTestDb, setupTestDb, truncateAll } from '../../../../tests/helpers/db';
import type { Db } from '../db/client';
import { networks, prices, scrapeRuns } from '../db/schema';
import type { Scraper } from './types';
import { runScrapers } from './runner';

const good = (id: string, price: number): Scraper => ({
	id,
	scrape: async () => ({ readings: [{ tariffKey: 'DC', priceIskPerKwh: price }], warnings: [] })
});
const broken = (id: string): Scraper => ({
	id,
	scrape: async () => {
		throw new Error('layout changed');
	}
});

describe.skipIf(!TEST_DB_URL)('runScrapers', () => {
	let db: Db;
	let onId: number;

	beforeAll(async () => {
		db = await setupTestDb();
	});
	afterAll(async () => {
		await closeTestDb(db);
	});
	beforeEach(async () => {
		await truncateAll(db);
		const rows = await db
			.insert(networks)
			.values([
				{ name: 'ON', slug: 'on', scraperId: 'on' },
				{ name: 'Orkan', slug: 'orkan', scraperId: 'orkan' },
				{ name: 'Tesla', slug: 'tesla', scraperId: null }
			])
			.returning();
		onId = rows[0].id;
	});

	it('first run inserts and reports changed; identical rerun reports ok and bumps verified', async () => {
		const first = await runScrapers(db, [good('on', 62), good('orkan', 49)]);
		expect(first.map((s) => s.status)).toEqual(['changed', 'changed']);
		const second = await runScrapers(db, [good('on', 62), good('orkan', 49)]);
		expect(second.map((s) => s.status)).toEqual(['ok', 'ok']);
		expect(await db.select().from(prices)).toHaveLength(2);
		expect(await db.select().from(scrapeRuns)).toHaveLength(4);
	});

	it('skips networks without a scraper_id (Tesla)', async () => {
		const summaries = await runScrapers(db, [good('on', 62), good('orkan', 49)]);
		expect(summaries.map((s) => s.networkSlug).sort()).toEqual(['on', 'orkan']);
	});

	it('isolates failures: one broken scraper never blocks the others', async () => {
		const summaries = await runScrapers(db, [broken('on'), good('orkan', 49)]);
		expect(summaries.find((s) => s.networkSlug === 'on')!.status).toBe('failed');
		expect(summaries.find((s) => s.networkSlug === 'orkan')!.status).toBe('changed');
		expect(await db.select().from(prices)).toHaveLength(1);
		const runs = await db.select().from(scrapeRuns);
		expect(runs.find((r) => r.networkId === onId)!.message).toMatch(/layout changed/);
	});

	it('an empty reading list is a failure, not a silent ok', async () => {
		const empty: Scraper = { id: 'on', scrape: async () => ({ readings: [], warnings: [] }) };
		const [s] = await runScrapers(db, [empty]);
		expect(s.status).toBe('failed');
	});

	it('an implausible price fails the run and stores nothing for it', async () => {
		const [s] = await runScrapers(db, [good('on', 4900)]);
		expect(s.status).toBe('failed');
		expect(s.message).toMatch(/implausible/i);
		expect(await db.select().from(prices)).toHaveLength(0);
	});

	it('a scraper_id with no registered module records a failed run', async () => {
		const summaries = await runScrapers(db, [good('orkan', 49)]);
		expect(summaries.find((s) => s.networkSlug === 'on')!.status).toBe('failed');
		expect(summaries.find((s) => s.networkSlug === 'on')!.message).toMatch(/no scraper module/);
	});

	it('notifies exactly once, when the 3rd consecutive failure lands', async () => {
		const calls: string[] = [];
		const notify = async (_topic: string, message: string) => {
			calls.push(message);
		};
		const opts = { ntfyTopic: 'test-topic', notify };
		await runScrapers(db, [broken('on'), good('orkan', 49)], opts);
		await runScrapers(db, [broken('on'), good('orkan', 49)], opts);
		expect(calls).toHaveLength(0);
		await runScrapers(db, [broken('on'), good('orkan', 49)], opts);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatch(/ON/);
		await runScrapers(db, [broken('on'), good('orkan', 49)], opts);
		expect(calls).toHaveLength(1); // 4th failure: no re-notification
	});

	it('warnings from a successful scrape land in the run message', async () => {
		const warny: Scraper = {
			id: 'on',
			scrape: async () => ({
				readings: [{ tariffKey: 'DC', priceIskPerKwh: 62 }],
				warnings: ['óþekkt stöð í verðtöflu: Baula']
			})
		};
		await runScrapers(db, [warny]);
		const runs = await db.select().from(scrapeRuns).orderBy(desc(scrapeRuns.id));
		expect(runs[0].message).toMatch(/Baula/);
	});
});
```

- [ ] **Step 3: Run to verify failure**

```bash
npx vitest run src/lib/server/scrapers/runner.test.ts
```
Expected: FAIL — `./runner` does not exist.

- [ ] **Step 4: Implement the runner**

`src/lib/server/scrapers/runner.ts`:

```ts
import { desc, eq } from 'drizzle-orm';
import { insertPriceIfChanged } from '../db/prices';
import { networks, scrapeRuns } from '../db/schema';
import type { Db } from '../db/client';
import type { Scraper } from './types';

export interface RunnerOptions {
	/** ntfy.sh topic for failure alerts; unset = no notifications */
	ntfyTopic?: string;
	/** injectable for tests */
	notify?: (topic: string, message: string) => Promise<void>;
}

export interface RunSummary {
	networkSlug: string;
	status: 'ok' | 'changed' | 'failed';
	message: string;
}

async function ntfy(topic: string, message: string): Promise<void> {
	await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, { method: 'POST', body: message });
}

/**
 * Runs every network's scraper sequentially, isolated: one broken scraper never
 * blocks the others, and a failure leaves the previous price standing (correct
 * behavior — better stale than wrong). Every run is logged to scrape_runs; the
 * 3rd consecutive failure for a network triggers a single ntfy push.
 */
export async function runScrapers(
	db: Db,
	scrapers: Scraper[],
	opts: RunnerOptions = {}
): Promise<RunSummary[]> {
	const notify = opts.notify ?? ntfy;
	const byId = new Map(scrapers.map((s) => [s.id, s]));
	const nets = (await db.select().from(networks)).filter((n) => n.scraperId !== null);
	const summaries: RunSummary[] = [];
	for (const net of nets) {
		let status: RunSummary['status'];
		let message: string;
		try {
			const scraper = byId.get(net.scraperId!);
			if (!scraper) throw new Error(`no scraper module registered for '${net.scraperId}'`);
			const { readings, warnings } = await scraper.scrape(db);
			if (readings.length === 0) throw new Error('scraper returned no readings');
			let inserted = 0;
			let verified = 0;
			for (const r of readings) {
				const res = await insertPriceIfChanged(db, { ...r, networkId: net.id, source: 'scraper' });
				if (res === 'inserted') inserted++;
				else verified++;
			}
			status = inserted > 0 ? 'changed' : 'ok';
			message =
				`${inserted} inserted, ${verified} verified` +
				(warnings.length ? `; ${warnings.join(' | ')}` : '');
		} catch (e) {
			status = 'failed';
			message = e instanceof Error ? e.message : String(e);
		}
		await db.insert(scrapeRuns).values({ networkId: net.id, status, message });
		summaries.push({ networkSlug: net.slug, status, message });

		if (status === 'failed' && opts.ntfyTopic) {
			const last = await db
				.select()
				.from(scrapeRuns)
				.where(eq(scrapeRuns.networkId, net.id))
				.orderBy(desc(scrapeRuns.startedAt), desc(scrapeRuns.id))
				.limit(4);
			let streak = 0;
			for (const run of last) {
				if (run.status !== 'failed') break;
				streak++;
			}
			// exactly 3: alert once when the streak starts, not on every later run
			if (streak === 3) {
				try {
					await notify(
						opts.ntfyTopic,
						`${net.name}: skrapari hefur brugðist 3 keyrslur í röð — ${message}`
					);
				} catch {
					// alerting must never break the run loop
				}
			}
		}
	}
	return summaries;
}
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run src/lib/server/scrapers/runner.test.ts
```
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/scrapers/
git commit -m "feat: scraper interface + shared runner — scrape_runs logging, failure isolation, ntfy on 3rd consecutive failure"
```

---

### Task 6: ON scraper

**Files:**
- Create: `tests/fixtures/on-verdskrar.html`
- Create: `src/lib/server/scrapers/on.ts`
- Test: `src/lib/server/scrapers/on.test.ts`

- [ ] **Step 1: Create the fixture**

`tests/fixtures/on-verdskrar.html` — verbatim cell markup captured from on.is/verdskrar on 2026-07-05 (the live page is one ~747 KB minified line; this keeps the four relevant rows plus a home-subscription row that must be ignored). Note the deliberately STALE `data-framer-name` attributes ("45 kr/kWh", "69 kr/kWh") — they are the trap this parser must not fall into:

```html
<!-- trimmed from https://www.on.is/verdskrar 2026-07-05; structure verbatim, stale data-framer-name attrs included on purpose -->
<div data-framer-name="Table">
<div data-framer-name="Header"><div><p class="framer-text">Vöruheiti</p></div><div><p class="framer-text">Orkugjald m.vsk.</p></div><div><p class="framer-text">Tímagjald m.vsk.</p></div></div>
<div class="framer-1abcdef" data-framer-name="Row"><div class="ssr-variant hidden-1a5uxfh"><div class="framer-198wcv4" data-framer-name="Ferðahleðsla AC" data-framer-component-type="RichTextContainer"><p class="framer-text framer-styles-preset-vdxlxd">Ferðahleðsla AC</p></div></div><div class="ssr-variant hidden-qsldkf hidden-2qe8i4 hidden-1ohw6wg"><div class="framer-198wcv4" data-framer-name="Ferðahleðsla AC" data-framer-component-type="RichTextContainer"><p class="framer-text framer-styles-preset-gltiqe">Ferðahleðsla AC</p></div></div><div class="ssr-variant hidden-1a5uxfh"><div class="framer-ezer1u" data-framer-name="45 kr/kWh" data-framer-component-type="RichTextContainer"><p class="framer-text framer-styles-preset-kpugid">48 kr/kWh</p></div></div><div class="ssr-variant hidden-qsldkf hidden-2qe8i4 hidden-1ohw6wg"><div class="framer-ezer1u" data-framer-name="45 kr/kWh" data-framer-component-type="RichTextContainer"><p class="framer-text framer-styles-preset-1r9nh0p">48 kr/kWh</p></div></div><div class="ssr-variant hidden-1a5uxfh"><div class="framer-oscekn" data-framer-name="0,5 kr/mín" data-framer-component-type="RichTextContainer"><p class="framer-text framer-styles-preset-kpugid">0,5 kr/mín</p></div></div><div class="ssr-variant hidden-qsldkf hidden-2qe8i4 hidden-1ohw6wg"><div class="framer-oscekn" data-framer-name="0,5 kr/mín" data-framer-component-type="RichTextContainer"><p class="framer-text framer-styles-preset-1r9nh0p">0,5 kr/mín</p></div></div></div>
<div class="framer-2abcdef" data-framer-name="Row"><div class="ssr-variant hidden-1a5uxfh"><div data-framer-name="Ferðahleðsla AC – Vildarkjör" data-framer-component-type="RichTextContainer"><p class="framer-text">Ferðahleðsla AC – Vildarkjör</p></div></div><div class="ssr-variant hidden-1a5uxfh"><div data-framer-name="39 kr/kWh" data-framer-component-type="RichTextContainer"><p class="framer-text">39 kr/kWh</p></div></div><div class="ssr-variant hidden-1a5uxfh"><div data-framer-name="0,4 kr/mín" data-framer-component-type="RichTextContainer"><p class="framer-text">0,4 kr/mín</p></div></div></div>
<div class="framer-1dwklo0" data-framer-name="Row"><div class="ssr-variant hidden-1a5uxfh"><div class="framer-1ei5go7" data-framer-name="Hraðhleðsla DC" data-framer-component-type="RichTextContainer"><p class="framer-text framer-styles-preset-vdxlxd" dir="auto">Hraðhleðsla DC <strong class="framer-text">*tímabundin lækkun, mótvægisaðgerð við lækkun stjórnvalda á eldsneyti</strong></p></div></div><div class="ssr-variant hidden-qsldkf hidden-2qe8i4 hidden-1ohw6wg"><div class="framer-1ei5go7" data-framer-name="Hraðhleðsla DC" data-framer-component-type="RichTextContainer"><p class="framer-text framer-styles-preset-gltiqe" dir="auto">Hraðhleðsla DC <strong class="framer-text">*tímabundin lækkun, mótvægis-aðgerð við lækkun stjórnvalda á eldsneyti</strong></p></div></div><div class="ssr-variant hidden-1a5uxfh"><div class="framer-u1miz3" data-framer-name="69 kr/kWh" data-framer-component-type="RichTextContainer"><p class="framer-text framer-styles-preset-kpugid" dir="auto">62 kr/kWh</p></div></div><div class="ssr-variant hidden-qsldkf hidden-2qe8i4 hidden-1ohw6wg"><div class="framer-u1miz3" data-framer-name="69 kr/kWh" data-framer-component-type="RichTextContainer"><p class="framer-text framer-styles-preset-1r9nh0p" dir="auto">62 kr/kWh</p></div></div><div class="ssr-variant hidden-1a5uxfh"><div class="framer-18pylbt" data-framer-name="0" data-framer-component-type="RichTextContainer"><p class="framer-text framer-styles-preset-kpugid">0</p></div></div><div class="ssr-variant hidden-qsldkf hidden-2qe8i4 hidden-1ohw6wg"><div class="framer-18pylbt" data-framer-name="0" data-framer-component-type="RichTextContainer"><p class="framer-text framer-styles-preset-1r9nh0p" dir="auto">0</p></div></div></div>
<div class="framer-3abcdef" data-framer-name="Row"><div class="ssr-variant hidden-1a5uxfh"><div data-framer-name="Hraðhleðsla DC – Vildarkjör" data-framer-component-type="RichTextContainer"><p class="framer-text">Hraðhleðsla DC – Vildarkjör</p></div></div><div class="ssr-variant hidden-1a5uxfh"><div data-framer-name="55 kr/kWh" data-framer-component-type="RichTextContainer"><p class="framer-text">55 kr/kWh</p></div></div><div class="ssr-variant hidden-1a5uxfh"><div data-framer-name="0" data-framer-component-type="RichTextContainer"><p class="framer-text">0</p></div></div></div>
</div>
<div data-framer-name="Table">
<div data-framer-name="Row"><div><p class="framer-text">Heimahleðsla áskrift</p></div><div><p class="framer-text">2.900 kr/mán</p></div></div>
</div>
```

- [ ] **Step 2: Write the failing tests**

`src/lib/server/scrapers/on.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseOnVerdskra } from './on';

const html = readFileSync(new URL('../../../../tests/fixtures/on-verdskrar.html', import.meta.url), 'utf8');

describe('parseOnVerdskra', () => {
	it('extracts Ferðahleðsla AC and Hraðhleðsla DC from the rendered text, not the stale attrs', () => {
		const readings = parseOnVerdskra(html);
		expect(readings).toEqual([
			{ tariffKey: 'AC', priceIskPerKwh: 48, minuteFeeIsk: 0.5, minuteFeeAfterMin: null },
			{ tariffKey: 'DC', priceIskPerKwh: 62, minuteFeeIsk: null, minuteFeeAfterMin: null }
		]);
	});

	it('never picks the Vildarkjör loyalty prices (39/55)', () => {
		const prices = parseOnVerdskra(html).map((r) => r.priceIskPerKwh);
		expect(prices).not.toContain(39);
		expect(prices).not.toContain(55);
	});

	it('throws on a page without the expected rows (fail loud, never guess)', () => {
		expect(() => parseOnVerdskra('<html><body><p>Framar redesign!</p></body></html>')).toThrow(
			/ON parse failed/
		);
	});
});
```

- [ ] **Step 3: Run to verify failure**

```bash
npx vitest run src/lib/server/scrapers/on.test.ts
```
Expected: FAIL — `./on` does not exist.

- [ ] **Step 4: Implement**

`src/lib/server/scrapers/on.ts`:

```ts
import * as cheerio from 'cheerio';
import type { ScrapedReading, Scraper } from './types';

export const ON_URL = 'https://www.on.is/verdskrar';

/** "48 kr/kWh" → 48, "0,5 kr/mín" → 0.5 (Icelandic decimal comma; thousands dots stripped) */
function iskNumber(text: string): number {
	return parseFloat(text.replace(/\./g, '').replace(',', '.'));
}

/**
 * The verðskrá is Framer-rendered rich text (verified 2026-07-05). Traps:
 * - data-framer-name attributes hold STALE layer names (the DC cell says
 *   "69 kr/kWh" but renders 62) — only <p class="framer-text"> text is real.
 * - Every cell renders twice in responsive ssr-variant wrappers → first match wins.
 * - "– Vildarkjör" loyalty rows and the home-subscription tables must be skipped.
 * Only the Icelandic page is scraped; the English one lags behind.
 */
export function parseOnVerdskra(html: string): ScrapedReading[] {
	const $ = cheerio.load(html);
	let ac: ScrapedReading | undefined;
	let dc: ScrapedReading | undefined;
	$('div[data-framer-name="Row"]').each((_, row) => {
		const texts = $(row)
			.find('p.framer-text')
			.toArray()
			.map((el) => $(el).text().trim());
		if (texts.length === 0) return;
		const label = texts[0];
		if (label.includes('Vildarkjör')) return;
		const tariff = label.startsWith('Ferðahleðsla AC')
			? ('AC' as const)
			: label.startsWith('Hraðhleðsla DC')
				? ('DC' as const)
				: null;
		const energy = texts.find((t) => /kr\/kWh/.test(t));
		if (!tariff || !energy) return;
		const minute = texts.find((t) => /kr\/mín/.test(t));
		const fee = minute ? iskNumber(minute) : null;
		const reading: ScrapedReading = {
			tariffKey: tariff,
			priceIskPerKwh: iskNumber(energy),
			minuteFeeIsk: fee && fee > 0 ? fee : null,
			minuteFeeAfterMin: null
		};
		if (tariff === 'AC') ac ??= reading;
		else dc ??= reading;
	});
	if (!ac || !dc) {
		throw new Error(`ON parse failed: AC=${!!ac} DC=${!!dc} — did the verðskrá layout change?`);
	}
	return [ac, dc];
}

export const onScraper: Scraper = {
	id: 'on',
	async scrape() {
		const res = await fetch(ON_URL);
		if (!res.ok) throw new Error(`ON fetch failed: HTTP ${res.status}`);
		return { readings: parseOnVerdskra(await res.text()), warnings: [] };
	}
};
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run src/lib/server/scrapers/on.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add tests/fixtures/on-verdskrar.html src/lib/server/scrapers/on.ts src/lib/server/scrapers/on.test.ts
git commit -m "feat: ON scraper — Framer verðskrá parser with stale-attribute and Vildarkjör traps covered"
```

---

### Task 7: Registry, `scripts/scrape.ts`, enable ON, first live run

**Files:**
- Create: `src/lib/server/scrapers/index.ts`
- Create: `scripts/scrape.ts`
- Modify: `seeds/networks.json` (scraperId for ON), `scripts/seed-networks.ts`, `package.json`, `.env.example`

- [ ] **Step 1: Registry**

`src/lib/server/scrapers/index.ts` (grows by one line per scraper task):

```ts
import type { Scraper } from './types';
import { onScraper } from './on';

export const allScrapers: Scraper[] = [onScraper];
```

- [ ] **Step 2: Seed scraperId**

In `seeds/networks.json` add `"scraperId": "on"` to the ON entry (leave the others without the key for now; each scraper task adds its own):

```json
	{
		"name": "ON",
		"slug": "on",
		"websiteUrl": "https://www.on.is",
		"scraperId": "on",
		"ocmOperatorIds": [102],
		"ocmMatchers": ["orka náttúrunnar", "on power", "on -"]
	},
```

In `scripts/seed-networks.ts`, carry the field through the upsert (explicit `?? null` so removing the key in the JSON also clears it in the DB):

```ts
const data: { name: string; slug: string; websiteUrl: string; scraperId?: string }[] = JSON.parse(
	readFileSync(new URL('../seeds/networks.json', import.meta.url), 'utf8')
);
```

```ts
	await db
		.insert(networks)
		.values({ name: n.name, slug: n.slug, websiteUrl: n.websiteUrl, scraperId: n.scraperId ?? null })
		.onConflictDoUpdate({
			target: networks.slug,
			set: { name: n.name, websiteUrl: n.websiteUrl, scraperId: n.scraperId ?? null }
		});
```

- [ ] **Step 3: Entry point**

`scripts/scrape.ts`:

```ts
import 'dotenv/config';
import { createDb } from '../src/lib/server/db/client';
import { allScrapers } from '../src/lib/server/scrapers';
import { runScrapers } from '../src/lib/server/scrapers/runner';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const db = createDb(process.env.DATABASE_URL);
const summaries = await runScrapers(db, allScrapers, {
	ntfyTopic: process.env.NTFY_TOPIC || undefined
});
for (const s of summaries) console.log(`${s.networkSlug}: ${s.status} — ${s.message}`);
await db.$client.end();
if (summaries.some((s) => s.status === 'failed')) process.exitCode = 1;
```

Add to `package.json` scripts:

```json
		"scrape": "tsx scripts/scrape.ts",
```

Append to `.env.example`:

```
NTFY_TOPIC=
```

- [ ] **Step 4: Live smoke run against the dev DB**

```bash
npm run seed:networks && npm run scrape
```
Expected: `Seeded 6 networks.` then `on: ok — 0 inserted, 2 verified` (the Phase 1 seed matches today's live prices AC 48+0,5 / DC 62). If ON changed prices since 2026-07-05, `changed — N inserted` is equally correct — eyeball that the values printed by `psql $DATABASE_URL -c "SELECT tariff_key, price_isk_per_kwh, minute_fee_isk, source FROM prices ORDER BY id"` look sane before continuing.

- [ ] **Step 5: Full unit suite, then commit**

```bash
npx vitest run
git add src/lib/server/scrapers/index.ts scripts/scrape.ts scripts/seed-networks.ts seeds/networks.json package.json .env.example
git commit -m "feat: scrape entry point + registry; ON scraper live"
```

---

### Task 8: Ísorka station matcher (`match:virta`)

**Files:**
- Create: `scripts/match-virta.ts`
- Modify: `package.json`

Virta's station-list endpoint (verified 2026-07-05) returns items shaped
`{"id":10360,"latitude":64.14592,"longitude":-21.92096,"name":"RVK-Borg Vitatorg","address":"Vitatorg/Lindargata","provider":"Virta","evses":[...],"isRemoved":false}`.
It rejects a whole-Iceland bounding box ("distance too large"), so the script tiles Iceland into four 2°×6° boxes.

- [ ] **Step 1: Write the script**

`scripts/match-virta.ts`:

```ts
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { createDb } from '../src/lib/server/db/client';
import { networks, stations } from '../src/lib/server/db/schema';

const BASE = 'https://isorka.poweredbyvirta.com/api/core/v4';
const HEADERS = { Accept: 'application/json', 'X-Brand': 'isorka', 'X-Source': 'isorka-web-map' };
// the API rejects bboxes much larger than ~2°×6°
const TILES = [
	{ latMin: 63.2, latMax: 65.2, longMin: -24.6, longMax: -18.6 },
	{ latMin: 63.2, latMax: 65.2, longMin: -18.6, longMax: -13.4 },
	{ latMin: 65.2, latMax: 66.8, longMin: -24.6, longMax: -18.6 },
	{ latMin: 65.2, latMax: 66.8, longMin: -18.6, longMax: -13.4 }
];
const MAX_DISTANCE_M = 150;

interface VirtaListStation {
	id: number;
	latitude: number;
	longitude: number;
	name: string;
	provider: string;
	isRemoved?: boolean;
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const R = 6371000;
	const toRad = (d: number) => (d * Math.PI) / 180;
	const dLat = toRad(lat2 - lat1);
	const dLon = toRad(lon2 - lon1);
	const a =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(a));
}

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const db = createDb(process.env.DATABASE_URL);

const virta: VirtaListStation[] = [];
for (const t of TILES) {
	const url = `${BASE}/stations?latMin=${t.latMin}&latMax=${t.latMax}&longMin=${t.longMin}&longMax=${t.longMax}`;
	const res = await fetch(url, { headers: HEADERS });
	if (!res.ok) throw new Error(`Virta list fetch failed: HTTP ${res.status} for ${url}`);
	virta.push(...((await res.json()) as VirtaListStation[]));
}
// roaming partners (provider "Hubject" etc.) return zeroed pricing — Ísorka network only
const own = virta.filter((v) => v.provider === 'Virta' && !v.isRemoved);
console.log(`Virta list: ${virta.length} stations, ${own.length} provider=Virta`);

const [isorka] = await db.select().from(networks).where(eq(networks.slug, 'isorka'));
if (!isorka) throw new Error('isorka network missing — run seed:networks');
const ours = await db.select().from(stations).where(eq(stations.networkId, isorka.id));

let matched = 0;
for (const s of ours) {
	let best: { v: VirtaListStation; d: number } | null = null;
	for (const v of own) {
		const d = haversineM(s.location.y, s.location.x, v.latitude, v.longitude);
		if (d <= MAX_DISTANCE_M && (!best || d < best.d)) best = { v, d };
	}
	if (!best) {
		console.log(`UNMATCHED (ours): ${s.name} — no Virta station within ${MAX_DISTANCE_M} m`);
		continue;
	}
	await db
		.update(stations)
		.set({ externalIds: { ...s.externalIds, virta: best.v.id } })
		.where(eq(stations.id, s.id));
	matched++;
	console.log(`${s.name}  ←→  ${best.v.name} (virta ${best.v.id}, ${Math.round(best.d)} m)`);
}
console.log(`Stamped externalIds.virta on ${matched}/${ours.length} Ísorka stations.`);
await db.$client.end();
```

Add to `package.json` scripts:

```json
		"match:virta": "tsx scripts/match-virta.ts",
```

- [ ] **Step 2: Run it live**

```bash
npm run match:virta
```
Expected: a match line per station, `Stamped externalIds.virta on N/27` with N ≥ 15. UNMATCHED lines are fine (OCM-only sites, stale OCM coordinates) — those stations simply keep "verð óþekkt". If N is far lower (< 10), stop and investigate coordinates before continuing.

- [ ] **Step 3: Idempotency check + commit**

```bash
npm run match:virta   # second run must produce the same result, no errors
git add scripts/match-virta.ts package.json
git commit -m "feat: match:virta — stamp Virta station ids onto Ísorka stations by coordinates"
```

---

### Task 9: Ísorka scraper

**Files:**
- Create: `tests/fixtures/virta-station-dc.json`, `tests/fixtures/virta-station-ac.json`, `tests/fixtures/virta-station-conflict.json`
- Create: `src/lib/server/scrapers/isorka.ts`
- Test: `src/lib/server/scrapers/isorka.test.ts`
- Modify: `src/lib/server/scrapers/index.ts`, `seeds/networks.json`

- [ ] **Step 1: Fixtures**

`tests/fixtures/virta-station-dc.json` — subset of the live `GET /api/core/v4/stations/165718` response (2026-07-05), zero-fee pricing entries kept to prove they read as "no fee":

```json
{
	"id": 165718,
	"name": "Ísorka - Olís Ánanaustum",
	"operatorName": "Isorka",
	"evses": [
		{
			"id": 165718,
			"connectors": [
				{
					"connectorID": 1,
					"type": "CCS",
					"maxKwh": 150,
					"maxKw": 150,
					"currentType": "DC",
					"operativeStatus": "Charging",
					"status": "Operative"
				}
			],
			"currency": "ISK",
			"pricing": [
				{ "name": "price_per_kwh", "priceCents": 7300, "currency": "ISK", "priceCentsWithoutVat": 5887.1, "priceCentsVat": 1412.9, "freePeriod": null },
				{ "name": "price_per_minute", "priceCents": 6000, "currency": "ISK", "priceCentsWithoutVat": 4838.71, "priceCentsVat": 1161.29, "freePeriod": null },
				{ "name": "price_initial_charge_fee", "priceCents": 0, "currency": "ISK", "priceCentsWithoutVat": 0, "priceCentsVat": 0, "freePeriod": null },
				{ "name": "price_reservation_per_minute", "priceCents": 0, "currency": "ISK", "priceCentsWithoutVat": 0, "priceCentsVat": 0, "freePeriod": null }
			],
			"oneTimePricing": [
				{ "name": "price_per_kwh", "priceCents": 8030, "currency": "ISK", "priceCentsWithoutVat": 6475.81, "priceCentsVat": 1554.19, "freePeriod": null },
				{ "name": "price_per_minute", "priceCents": 6600, "currency": "ISK", "priceCentsWithoutVat": 5322.58, "priceCentsVat": 1277.42, "freePeriod": null }
			],
			"oneTimePricingRatio": 1.1,
			"minutesWithoutTimeCharge": 60,
			"isFree": false
		}
	]
}
```

`tests/fixtures/virta-station-ac.json` — shape-faithful AC city post (values from the live RVK-Borg tariff: 24 kr/kWh, no minute fee, 180 free min):

```json
{
	"id": 10360,
	"name": "RVK-Borg Vitatorg",
	"operatorName": "Isorka",
	"evses": [
		{
			"id": 10360,
			"connectors": [{ "connectorID": 1, "type": "Type 2", "maxKw": 22, "currentType": "AC", "status": "Operative" }],
			"currency": "ISK",
			"pricing": [
				{ "name": "price_per_kwh", "priceCents": 2400, "currency": "ISK", "priceCentsWithoutVat": 1935.48, "priceCentsVat": 464.52, "freePeriod": null },
				{ "name": "price_per_minute", "priceCents": 0, "currency": "ISK", "priceCentsWithoutVat": 0, "priceCentsVat": 0, "freePeriod": null }
			],
			"minutesWithoutTimeCharge": 180,
			"isFree": false
		}
	]
}
```

`tests/fixtures/virta-station-conflict.json` — two DC evses that disagree (constructed; the API allows it, so the parser must refuse to pick):

```json
{
	"id": 999999,
	"name": "Tilbúin stöð með ósamræmi",
	"operatorName": "Isorka",
	"evses": [
		{
			"id": 1,
			"connectors": [{ "connectorID": 1, "type": "CCS", "maxKw": 150, "currentType": "DC" }],
			"currency": "ISK",
			"pricing": [
				{ "name": "price_per_kwh", "priceCents": 7300, "currency": "ISK" },
				{ "name": "price_per_minute", "priceCents": 0, "currency": "ISK" }
			],
			"minutesWithoutTimeCharge": 60
		},
		{
			"id": 2,
			"connectors": [{ "connectorID": 1, "type": "CCS", "maxKw": 50, "currentType": "DC" }],
			"currency": "ISK",
			"pricing": [
				{ "name": "price_per_kwh", "priceCents": 6700, "currency": "ISK" },
				{ "name": "price_per_minute", "priceCents": 0, "currency": "ISK" }
			],
			"minutesWithoutTimeCharge": 60
		}
	]
}
```

- [ ] **Step 2: Write the failing tests**

`src/lib/server/scrapers/isorka.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseVirtaStation, type VirtaStation } from './isorka';

const load = (name: string): VirtaStation =>
	JSON.parse(readFileSync(new URL(`../../../../tests/fixtures/${name}`, import.meta.url), 'utf8'));

describe('parseVirtaStation', () => {
	it('reads the account tariff of a DC station: kWh price, minute fee, free period', () => {
		const { readings, warnings } = parseVirtaStation(load('virta-station-dc.json'));
		expect(warnings).toEqual([]);
		expect(readings).toEqual([
			{ tariffKey: 'DC', priceIskPerKwh: 73, minuteFeeIsk: 60, minuteFeeAfterMin: 60 }
		]);
	});

	it('reads an AC post with a zero minute fee as fee-less', () => {
		const { readings } = parseVirtaStation(load('virta-station-ac.json'));
		expect(readings).toEqual([
			{ tariffKey: 'AC', priceIskPerKwh: 24, minuteFeeIsk: null, minuteFeeAfterMin: null }
		]);
	});

	it('refuses to pick a price when evses of the same mode disagree', () => {
		const { readings, warnings } = parseVirtaStation(load('virta-station-conflict.json'));
		expect(readings).toEqual([]);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatch(/disagree/);
	});

	it('warns instead of guessing when price_per_kwh is missing', () => {
		const st = load('virta-station-dc.json');
		st.evses[0].pricing = st.evses[0].pricing.filter((p) => p.name !== 'price_per_kwh');
		const { readings, warnings } = parseVirtaStation(st);
		expect(readings).toEqual([]);
		expect(warnings[0]).toMatch(/price_per_kwh/);
	});
});
```

- [ ] **Step 3: Run to verify failure**

```bash
npx vitest run src/lib/server/scrapers/isorka.test.ts
```
Expected: FAIL — `./isorka` does not exist.

- [ ] **Step 4: Implement**

`src/lib/server/scrapers/isorka.ts`:

```ts
import { eq } from 'drizzle-orm';
import { networks, stations } from '../db/schema';
import type { ScrapedReading, Scraper } from './types';

export const VIRTA_BASE = 'https://isorka.poweredbyvirta.com/api/core/v4';
const HEADERS = { Accept: 'application/json', 'X-Brand': 'isorka', 'X-Source': 'isorka-web-map' };

export interface VirtaPricingEntry {
	name: string;
	priceCents: number;
}
export interface VirtaEvse {
	connectors: { currentType?: 'AC' | 'DC' }[];
	pricing?: VirtaPricingEntry[];
	minutesWithoutTimeCharge?: number | null;
}
export interface VirtaStation {
	id: number;
	name: string;
	evses: VirtaEvse[];
}

function centPrice(e: VirtaEvse, name: string): number | null {
	const entry = e.pricing?.find((p) => p.name === name);
	return entry ? entry.priceCents / 100 : null; // priceCents/100 = ISK incl. VSK (verified 24% ratio)
}

/**
 * Ísorka has no public price page; tariffs come per station from the Virta
 * platform API the isorka web map uses. We record the ACCOUNT tariff
 * (`pricing`), not `oneTimePricing` — the ad-hoc no-account rate is a fixed
 * 1.1× surcharge, and "almenn neytendaverð" is the app/account price.
 * Prices are per-EVSE; if EVSEs of one mode disagree we skip the station
 * rather than pick (never publish a price we can't stand behind).
 */
export function parseVirtaStation(st: VirtaStation): {
	readings: Omit<ScrapedReading, 'stationId'>[];
	warnings: string[];
} {
	const readings: Omit<ScrapedReading, 'stationId'>[] = [];
	const warnings: string[] = [];
	for (const mode of ['AC', 'DC'] as const) {
		const evses = st.evses.filter((e) => e.connectors.some((c) => c.currentType === mode));
		if (evses.length === 0) continue;
		const kwh = new Set(evses.map((e) => centPrice(e, 'price_per_kwh')));
		const fee = new Set(evses.map((e) => centPrice(e, 'price_per_minute')));
		const after = new Set(evses.map((e) => e.minutesWithoutTimeCharge ?? 0));
		if (kwh.size > 1 || fee.size > 1 || after.size > 1) {
			warnings.push(`${st.name}: ${mode} evses disagree on tariff — skipped`);
			continue;
		}
		const price = [...kwh][0];
		if (price == null) {
			warnings.push(`${st.name}: no price_per_kwh for ${mode} — skipped`);
			continue;
		}
		const minuteFee = [...fee][0];
		const hasFee = minuteFee != null && minuteFee > 0;
		readings.push({
			tariffKey: mode,
			priceIskPerKwh: price,
			minuteFeeIsk: hasFee ? minuteFee : null,
			minuteFeeAfterMin: hasFee ? [...after][0] || null : null
		});
	}
	return { readings, warnings };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const isorkaScraper: Scraper = {
	id: 'isorka',
	async scrape(db) {
		const [net] = await db.select().from(networks).where(eq(networks.slug, 'isorka'));
		if (!net) throw new Error('isorka network missing');
		const sts = (await db.select().from(stations).where(eq(stations.networkId, net.id))).filter(
			(s) => s.externalIds.virta != null
		);
		if (sts.length === 0) throw new Error('no stations have externalIds.virta — run npm run match:virta');
		const readings: ScrapedReading[] = [];
		const warnings: string[] = [];
		let fetched = 0;
		for (const s of sts) {
			const res = await fetch(`${VIRTA_BASE}/stations/${s.externalIds.virta}`, { headers: HEADERS });
			if (!res.ok) {
				warnings.push(`${s.name}: HTTP ${res.status}`);
				continue;
			}
			fetched++;
			const parsed = parseVirtaStation((await res.json()) as VirtaStation);
			warnings.push(...parsed.warnings);
			readings.push(...parsed.readings.map((r) => ({ ...r, stationId: s.id })));
			await sleep(150);
		}
		if (fetched === 0) throw new Error(`all ${sts.length} Virta detail fetches failed`);
		return { readings, warnings };
	}
};
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run src/lib/server/scrapers/isorka.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 6: Enable + live smoke**

Add to `src/lib/server/scrapers/index.ts`:

```ts
import { isorkaScraper } from './isorka';
```
and extend the array: `export const allScrapers: Scraper[] = [onScraper, isorkaScraper];`

Add `"scraperId": "isorka"` to the Ísorka entry in `seeds/networks.json`. Then:

```bash
npm run seed:networks && npm run scrape
```
Expected: `isorka: changed — N inserted, 0 verified` (first run inserts one or two readings per matched station; warnings about disagreeing or fee-less stations are fine). Sanity-check: `psql $DATABASE_URL -c "SELECT s.name, p.tariff_key, p.price_isk_per_kwh, p.minute_fee_isk, p.minute_fee_after_min FROM prices p JOIN stations s ON s.id = p.station_id ORDER BY p.id DESC LIMIT 10"` — DC prices should sit in the 45–75 kr range seen in research.

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures/virta-station-*.json src/lib/server/scrapers/isorka.ts src/lib/server/scrapers/isorka.test.ts src/lib/server/scrapers/index.ts seeds/networks.json
git commit -m "feat: Ísorka scraper — per-station tariffs from the Virta API"
```

---

### Task 10: N1 station matcher (`match:n1`)

**Files:**
- Create: `scripts/match-n1.ts`
- Modify: `package.json`

The locations list lives escaped inside the raw HTML of `https://n1.is/is/verdtafla`:
`\"locations\":[{\"value\":\"40_service\",\"label\":\"N1 Borgartúni - Borgartún 39 - 105 Reykjavík\"},...]` (verified 2026-07-05). Labels decline place names (Blönduós → "N1 Blönduósi"), so matching uses a 6-character lowercase stem of the first word of our station name (or of the address, for generic names like "N1"). Ambiguous stations are reported, not guessed.

- [ ] **Step 1: Write the script**

`scripts/match-n1.ts`:

```ts
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { createDb } from '../src/lib/server/db/client';
import { networks, stations } from '../src/lib/server/db/schema';

const N1_URL = 'https://n1.is/is/verdtafla';
const UA = { 'User-Agent': 'Mozilla/5.0 (hledsluverd.is price comparison)' };

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
const db = createDb(process.env.DATABASE_URL);

const res = await fetch(N1_URL, { headers: UA });
if (!res.ok) throw new Error(`N1 fetch failed: HTTP ${res.status}`);
const html = await res.text();
const m = html.match(/\\"locations\\":(\[.*?\]),\\"defaultLocation/);
if (!m) throw new Error('N1 locations blob not found — page layout changed?');
const locations: { value: string; label: string }[] = JSON.parse(m[1].replace(/\\"/g, '"'));
const usable = locations.filter((l) => /_(service|self)$/.test(l.value));
console.log(`N1 locations: ${locations.length} total, ${usable.length} service/self`);

/** 6-char lowercase stem survives Icelandic declension: blönduós→blöndu ⊂ "n1 blönduósi" */
function stem(word: string): string | null {
	const w = word.toLowerCase().replace(/[^a-záðéíóúýþæö]/g, '');
	return w.length >= 4 ? w.slice(0, 6) : null;
}

const [n1] = await db.select().from(networks).where(eq(networks.slug, 'n1'));
if (!n1) throw new Error('n1 network missing — run seed:networks');
const ours = await db.select().from(stations).where(eq(stations.networkId, n1.id));

for (const s of ours) {
	// name stem first; address stems only as fallback — address words like
	// "norðurlandsvegur" stem to "norður" and would match half the country
	const nameStem = stem(s.name.replace(/\(N1\)/i, '').trim().split(/\s+/)[0] ?? '');
	const addressStems = (s.address ?? '').split(/[\s,]+/).map(stem).filter((x): x is string => x !== null);
	const byStems = (stems: string[]) =>
		usable.filter((l) => stems.some((c) => l.label.toLowerCase().includes(c)));
	const hits = nameStem && byStems([nameStem]).length > 0 ? byStems([nameStem]) : byStems(addressStems);
	const uniqueIds = [...new Set(hits.map((h) => h.value))];
	if (uniqueIds.length === 1) {
		await db
			.update(stations)
			.set({ externalIds: { ...s.externalIds, n1: uniqueIds[0] } })
			.where(eq(stations.id, s.id));
		console.log(`${s.name}  ←→  ${hits[0].label} (${uniqueIds[0]})`);
	} else if (uniqueIds.length === 0) {
		console.log(`UNMATCHED (ours): ${s.name} — ${s.address ?? ''}`);
	} else {
		console.log(`AMBIGUOUS (skipped): ${s.name} → ${hits.map((h) => h.label).join(' | ')}`);
	}
}
console.log('Review the lines above; fix any wrong stamp with psql (external_ids is plain jsonb).');
await db.$client.end();
```

Add to `package.json` scripts:

```json
		"match:n1": "tsx scripts/match-n1.ts",
```

- [ ] **Step 2: Run it live and review**

```bash
npm run match:n1
```
Expected: matches for Blönduós, Egilsstaðir, Hvolsvöllur (both OCM duplicates), Ísafjörður (both), Sauðárkrókur, Staðarskáli (both); UNMATCHED/AMBIGUOUS for the rest is fine. **Read every `←→` line** — a wrong match here would put a wrong price on a station, which is the failure this site must never commit. Correct any bad stamp via `psql` before continuing, and re-run to confirm idempotency.

- [ ] **Step 3: Commit**

```bash
git add scripts/match-n1.ts package.json
git commit -m "feat: match:n1 — stamp N1 verdtafla location ids onto stations via declension-safe stems"
```

---

### Task 11: N1 scraper

**Files:**
- Create: `tests/fixtures/n1-blob.txt`, `tests/fixtures/n1-action-response.txt`, `tests/fixtures/n1-chunk-snippet.js`
- Create: `src/lib/server/scrapers/n1.ts`
- Test: `src/lib/server/scrapers/n1.test.ts`
- Modify: `src/lib/server/scrapers/index.ts`, `seeds/networks.json`

- [ ] **Step 1: Fixtures (all verbatim captures, 2026-07-05)**

`tests/fixtures/n1-blob.txt` — one line, exactly as found inside the raw HTML (quotes are backslash-escaped there):

```
\"listPriceItems\":[{\"title\":\"Bensín 95 okt\",\"shortTitle\":\"95\",\"theme\":\"brand\",\"icon\":\"$undefined\",\"unit\":\"$undefined\",\"price\":234.9},{\"title\":\"Bensín 98 okt\",\"shortTitle\":\"98\",\"theme\":\"brand\",\"icon\":\"$undefined\",\"unit\":\"$undefined\",\"price\":291.9},{\"title\":\"Dísel\",\"shortTitle\":\"D\",\"theme\":\"$undefined\",\"icon\":\"$undefined\",\"unit\":\"$undefined\",\"price\":257.9},{\"title\":\"AdBlue\",\"shortTitle\":\"Ab\",\"theme\":\"blue\",\"icon\":\"$undefined\",\"unit\":\"$undefined\",\"price\":188},{\"title\":\"Rafmagn\",\"shortTitle\":\"$undefined\",\"theme\":\"green\",\"icon\":\"zap\",\"unit\":\"kr./kWh\",\"price\":56}]
```

`tests/fixtures/n1-action-response.txt` — full server-action response body for `["2341_service"]` (two lines):

```
0:{"a":"$@1","f":"","b":"qoEjazWBm-g0JU6TkQlAi","q":"","i":false}
1:{"success":true,"items":[{"title":"Bensín 95 okt","shortTitle":"95","theme":"brand","icon":"$undefined","unit":"$undefined","price":215.9},{"title":"Bensín 98 okt","shortTitle":"98","theme":"brand","icon":"$undefined","unit":"$undefined","price":283.9},{"title":"Dísel","shortTitle":"D","theme":"$undefined","icon":"$undefined","unit":"$undefined","price":243.9},{"title":"AdBlue","shortTitle":"Ab","theme":"blue","icon":"$undefined","unit":"$undefined","price":182},{"title":"Rafmagn","shortTitle":"$undefined","theme":"green","icon":"zap","unit":"kr./kWh","price":50}]}
```

`tests/fixtures/n1-chunk-snippet.js` — window around the server-action reference in chunk `a026a019dcf69a15.js`:

```
=e.i(785029),i=e.i(751540),l=e.i(486186);let a=(0,l.createServerReference)("4051f8163eecdb5165ae60c3c94541d4e3cb624d2b",l.callServer,void 0,l.findSourceMapURL,"getFuelPricesForStation");va
```

- [ ] **Step 2: Write the failing tests**

`src/lib/server/scrapers/n1.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractActionId, parseN1ActionResponse, parseN1ListPrice } from './n1';

const fx = (name: string) =>
	readFileSync(new URL(`../../../../tests/fixtures/${name}`, import.meta.url), 'utf8');

describe('N1 parsers', () => {
	it('finds the Rafmagn list price in the escaped HTML blob', () => {
		expect(parseN1ListPrice(fx('n1-blob.txt'))).toBe(56);
	});

	it('throws when Rafmagn is missing from the blob (fail loud)', () => {
		expect(() => parseN1ListPrice(fx('n1-blob.txt').replace(/Rafmagn/g, 'Vetni'))).toThrow(
			/N1 parse failed/
		);
	});

	it('reads the per-station Rafmagn price from an action response', () => {
		expect(parseN1ActionResponse(fx('n1-action-response.txt'))).toBe(50);
	});

	it('returns null when a station publishes no Rafmagn price', () => {
		const noEv = fx('n1-action-response.txt').replace('"title":"Rafmagn"', '"title":"Rafmagn2"');
		expect(parseN1ActionResponse(noEv)).toBeNull();
	});

	it('throws on an unexpected action-response shape', () => {
		expect(() => parseN1ActionResponse('0:{}\n')).toThrow(/N1 action response/);
		expect(() => parseN1ActionResponse('1:{"success":false}\n')).toThrow(/N1 action response/);
	});

	it('extracts the server-action id from a JS chunk', () => {
		expect(extractActionId(fx('n1-chunk-snippet.js'))).toBe(
			'4051f8163eecdb5165ae60c3c94541d4e3cb624d2b'
		);
		expect(extractActionId('var x = 1;')).toBeNull();
	});
});
```

- [ ] **Step 3: Run to verify failure**

```bash
npx vitest run src/lib/server/scrapers/n1.test.ts
```
Expected: FAIL — `./n1` does not exist.

- [ ] **Step 4: Implement**

`src/lib/server/scrapers/n1.ts`:

```ts
import { eq } from 'drizzle-orm';
import { networks, stations } from '../db/schema';
import type { ScrapedReading, Scraper } from './types';

export const N1_URL = 'https://n1.is/is/verdtafla';
const UA = { 'User-Agent': 'Mozilla/5.0 (hledsluverd.is price comparison)' };

/**
 * N1 embeds the price table as backslash-escaped JSON inside the raw HTML
 * (Next.js RSC payload — no __NEXT_DATA__, hashed CSS). The "Rafmagn" list
 * price is N1's published default; stations with their own published price
 * get a station-scoped reading via the getFuelPricesForStation server action.
 * N1 prices energy flat per station (no AC/DC split, no fees); their public
 * chargers are DC fast chargers, so readings go under the DC tariff. The page
 * shows consumer display prices (like pump prices) — treated as incl. VSK.
 */
export function parseN1ListPrice(html: string): number {
	const m = html.match(/\\"title\\":\\"Rafmagn\\"[^}]*?\\"unit\\":\\"kr\.\/kWh\\",\\"price\\":([0-9.]+)/);
	if (!m) throw new Error('N1 parse failed: Rafmagn list price not found — page layout changed?');
	return parseFloat(m[1]);
}

/** RSC flight response: the payload line starts "1:". Returns null when the station has no Rafmagn row. */
export function parseN1ActionResponse(body: string): number | null {
	const line = body.split('\n').find((l) => l.startsWith('1:'));
	if (!line) throw new Error('N1 action response: no payload line');
	const obj = JSON.parse(line.slice(2)) as {
		success?: boolean;
		items?: { title: string; unit?: string; price: number }[];
	};
	if (!obj.success || !Array.isArray(obj.items)) {
		throw new Error('N1 action response: unexpected shape');
	}
	const raf = obj.items.find((i) => i.title === 'Rafmagn');
	return raf ? raf.price : null;
}

/** The Next-Action id rotates every deploy; it sits next to "getFuelPricesForStation" in one JS chunk. */
export function extractActionId(chunkJs: string): string | null {
	const m = chunkJs.match(/\(\s*"([0-9a-f]{40,})"[^)]*?"getFuelPricesForStation"\s*\)/);
	return m ? m[1] : null;
}

async function deriveActionId(html: string): Promise<string> {
	const urls = [...new Set(html.match(/\/_next\/static\/chunks\/[a-zA-Z0-9_.-]+\.js/g) ?? [])];
	for (const url of urls.slice(0, 40)) {
		const res = await fetch(`https://n1.is${url}`, { headers: UA });
		if (!res.ok) continue;
		const id = extractActionId(await res.text());
		if (id) return id;
	}
	throw new Error('N1: getFuelPricesForStation action id not found in any chunk — build changed?');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const n1Scraper: Scraper = {
	id: 'n1',
	async scrape(db) {
		const res = await fetch(N1_URL, { headers: UA });
		if (!res.ok) throw new Error(`N1 fetch failed: HTTP ${res.status}`);
		const html = await res.text();
		const readings: ScrapedReading[] = [
			{ tariffKey: 'DC', priceIskPerKwh: parseN1ListPrice(html) } // network-wide Listaverð
		];
		const warnings: string[] = [];
		const [net] = await db.select().from(networks).where(eq(networks.slug, 'n1'));
		if (!net) throw new Error('n1 network missing');
		const sts = (await db.select().from(stations).where(eq(stations.networkId, net.id))).filter(
			(s) => s.externalIds.n1 != null
		);
		if (sts.length > 0) {
			const actionId = await deriveActionId(html);
			for (const s of sts) {
				const post = await fetch(N1_URL, {
					method: 'POST',
					headers: {
						...UA,
						Accept: 'text/x-component',
						'Next-Action': actionId,
						'Content-Type': 'text/plain;charset=UTF-8'
					},
					body: JSON.stringify([s.externalIds.n1])
				});
				if (!post.ok) {
					warnings.push(`${s.name}: HTTP ${post.status}`);
					continue;
				}
				const price = parseN1ActionResponse(await post.text());
				if (price === null) {
					warnings.push(`${s.name}: no Rafmagn published — falls back to list price`);
					continue;
				}
				readings.push({ stationId: s.id, tariffKey: 'DC', priceIskPerKwh: price });
				await sleep(150);
			}
		}
		return { readings, warnings };
	}
};
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run src/lib/server/scrapers/n1.test.ts
```
Expected: PASS (6 tests).

- [ ] **Step 6: Enable + live smoke**

Add `n1Scraper` to `src/lib/server/scrapers/index.ts` (import + array). Add `"scraperId": "n1"` to the N1 entry in `seeds/networks.json`. Then:

```bash
npm run seed:networks && npm run scrape
```
Expected: `n1: changed — N inserted, 0 verified` with the list price (≈56) plus a station row per stamped station (50 or 65 as of research); "no Rafmagn published" warnings are normal for some stations.

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures/n1-*.txt tests/fixtures/n1-chunk-snippet.js src/lib/server/scrapers/n1.ts src/lib/server/scrapers/n1.test.ts src/lib/server/scrapers/index.ts seeds/networks.json
git commit -m "feat: N1 scraper — Listaverð from RSC blob + per-station prices via server action"
```

---

### Task 12: Orkan scraper (headless Chromium)

**Files:**
- Create: `tests/fixtures/orkan-orkustodvar.html`
- Create: `src/lib/server/scrapers/orkan.ts`
- Test: `src/lib/server/scrapers/orkan.test.ts`
- Modify: `src/lib/server/scrapers/index.ts`, `seeds/networks.json`

- [ ] **Step 1: Fixture**

`tests/fixtures/orkan-orkustodvar.html` — the rendered `.prices__list` DOM (header card + Baula verbatim from the live site 2026-07-05, SVG elided; plus a shape-faithful fuel-only "Húsavík" card proving `-` rows are skipped). Blazor's `<!--!-->` comment nodes are part of the real markup — keep them:

```html
<div class="prices__list"><div class="prices__card"><div class="prices__card-content heading"><!--!--><div><div class="prices__price-heading">Orkustöð</div></div>
                        <!--!--><div><div class="prices__price-heading">95 okt</div></div>
                        <!--!--><div><div class="prices__price-heading">Dísel</div></div>
                        <!--!--><div><div class="prices__price-heading">Rafmagn</div></div>
                        <!--!--><div><div class="prices__price-heading">Metan</div></div>
                        <!--!--><div><div class="prices__price-heading">Vetni</div></div>
                        <!--!--><div><div class="prices__price-heading">98 okt</div></div>
                        <!--!--><div><div class="prices__price-heading">AdBlue</div></div>
                        <!--!--><div><div class="prices__price-heading">Lífdísel</div></div>
                        <!--!--><div><div class="prices__price-heading">Rúðuvökvi á dælu</div></div></div></div><div class="prices__card" onclick="openCloseOrkustodvaCard(event)"><div class="prices__card-heading"><div>Baula</div><!--!-->
                        <!--!--><div></div></div><!--!-->
                    <div class="prices__card-content"><div><div class="prices__price-value">Baula</div></div><!--!-->
                            <div><!--!--><div class="prices__price-heading">95 okt</div>
                                <div class="prices__price-value">226,2</div></div><!--!-->
                            <div><!--!--><div class="prices__price-heading">Dísel</div>
                                <div class="prices__price-value">247,0</div></div><!--!-->
                            <div><!--!--><div class="prices__price-heading">Rafmagn</div>
                                <div class="prices__price-value">49,0</div></div><!--!-->
                            <div><!--!--><div class="prices__price-heading">Metan</div>
                                <div class="prices__price-value">-</div></div><!--!-->
                            <div><!--!--><div class="prices__price-heading">Vetni</div>
                                <div class="prices__price-value">-</div></div><!--!-->
                            <div><!--!--><div class="prices__price-heading">98 okt</div>
                                <div class="prices__price-value">-</div></div><!--!-->
                            <div><!--!--><div class="prices__price-heading">AdBlue</div>
                                <div class="prices__price-value">-</div></div><!--!-->
                            <div><!--!--><div class="prices__price-heading">Lífdísel</div>
                                <div class="prices__price-value">-</div></div><!--!-->
                            <div><!--!--><div class="prices__price-heading">Rúðuvökvi á dælu</div>
                                <div class="prices__price-value">-</div></div></div></div><div class="prices__card" onclick="openCloseOrkustodvaCard(event)"><div class="prices__card-heading"><div>Húsavík</div><!--!-->
                        <!--!--><div></div></div><!--!-->
                    <div class="prices__card-content"><div><div class="prices__price-value">Húsavík</div></div><!--!-->
                            <div><!--!--><div class="prices__price-heading">95 okt</div>
                                <div class="prices__price-value">229,9</div></div><!--!-->
                            <div><!--!--><div class="prices__price-heading">Rafmagn</div>
                                <div class="prices__price-value">-</div></div></div></div></div>
```

- [ ] **Step 2: Write the failing tests**

`src/lib/server/scrapers/orkan.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseOrkanPrices } from './orkan';

const html = readFileSync(
	new URL('../../../../tests/fixtures/orkan-orkustodvar.html', import.meta.url),
	'utf8'
);

describe('parseOrkanPrices', () => {
	it('pairs each station card with its Rafmagn column by heading text', () => {
		expect(parseOrkanPrices(html)).toEqual([{ name: 'Baula', priceIskPerKwh: 49 }]);
	});

	it('skips the header card and stations without a Rafmagn price (-)', () => {
		const names = parseOrkanPrices(html).map((r) => r.name);
		expect(names).not.toContain('Orkustöð');
		expect(names).not.toContain('Húsavík');
	});

	it('returns an empty list for foreign markup (scrape() turns that into a failure)', () => {
		expect(parseOrkanPrices('<div class="other"></div>')).toEqual([]);
	});
});
```

- [ ] **Step 3: Run to verify failure**

```bash
npx vitest run src/lib/server/scrapers/orkan.test.ts
```
Expected: FAIL — `./orkan` does not exist.

- [ ] **Step 4: Implement**

`src/lib/server/scrapers/orkan.ts`:

```ts
import * as cheerio from 'cheerio';
import { eq } from 'drizzle-orm';
import { networks, stations } from '../db/schema';
import type { ScrapedReading, Scraper } from './types';

export const ORKAN_URL = 'https://www.orkan.is/orkustodvar/';

/**
 * orkan.is is Blazor Server: prices stream over a websocket after page load,
 * raw HTML is an empty shell (Googlebot-SSR stopped including the table in
 * 2025 — see gasvaktin/gasvaktin#16, which scrapes it the same way). Only the
 * fetch needs a browser; parsing stays fixture-tested cheerio. Markup is full
 * of Blazor <!--!--> comment nodes — DOM queries, never regex on raw text.
 */
export function parseOrkanPrices(html: string): { name: string; priceIskPerKwh: number }[] {
	const $ = cheerio.load(html);
	const out: { name: string; priceIskPerKwh: number }[] = [];
	$('.prices__card').each((_, card) => {
		if ($(card).find('.prices__card-content.heading').length > 0) return; // column-header card
		const name = $(card).find('.prices__card-heading div').first().text().trim();
		if (!name) return;
		$(card)
			.find('.prices__card-content > div')
			.each((__, cell) => {
				const heading = $(cell).find('.prices__price-heading').text().trim();
				if (heading !== 'Rafmagn') return; // columns move around — match by label, never index
				const value = $(cell).find('.prices__price-value').text().trim();
				if (!value || value === '-') return;
				const price = parseFloat(value.replace(',', '.'));
				if (Number.isFinite(price)) out.push({ name, priceIskPerKwh: price });
			});
	});
	return out;
}

export async function fetchOrkanHtml(): Promise<string> {
	const { chromium } = await import('playwright'); // lazy: only Orkan needs a browser
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		await page.goto(ORKAN_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
		// content arrives over the Blazor websocket seconds later — wait for real cells
		await page.waitForSelector(
			'.prices__list .prices__card-content:not(.heading) .prices__price-value',
			{ timeout: 30_000 }
		);
		return await page.$eval('.prices__list', (el) => el.outerHTML);
	} finally {
		await browser.close();
	}
}

const norm = (s: string) => s.toLowerCase().normalize('NFC').trim();

export const orkanScraper: Scraper = {
	id: 'orkan',
	async scrape(db) {
		const rows = parseOrkanPrices(await fetchOrkanHtml());
		if (rows.length === 0) throw new Error('Orkan parse: no Rafmagn rows — layout changed?');
		const [net] = await db.select().from(networks).where(eq(networks.slug, 'orkan'));
		if (!net) throw new Error('orkan network missing');
		const sts = await db.select().from(stations).where(eq(stations.networkId, net.id));
		const readings: ScrapedReading[] = [];
		const warnings: string[] = [];
		const matchedStations = new Set<number>();
		for (const row of rows) {
			const rowName = norm(row.name);
			// price-table names are bare place names; ours carry "(Orkan)" and OCM
			// addresses — match by containment in name or address
			const matches = sts.filter(
				(s) => norm(s.name).includes(rowName) || norm(s.address ?? '').includes(rowName)
			);
			if (matches.length === 0) {
				warnings.push(`óþekkt stöð í verðtöflu: ${row.name}`);
				continue;
			}
			for (const s of matches) {
				matchedStations.add(s.id);
				readings.push({
					stationId: s.id,
					tariffKey: 'DC',
					priceIskPerKwh: row.priceIskPerKwh,
					// biðgjald: after 60 min of charging, each minute costs one kWh price
					// (published prose on https://www.orkan.is/rafmagn/, 2026-07-05)
					minuteFeeIsk: row.priceIskPerKwh,
					minuteFeeAfterMin: 60
				});
			}
		}
		for (const s of sts) {
			if (!matchedStations.has(s.id)) warnings.push(`${s.name}: ekki í verðtöflu Orkunnar`);
		}
		return { readings, warnings };
	}
};
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run src/lib/server/scrapers/orkan.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 6: Enable + live smoke (needs the Chromium E2E browser)**

Add `orkanScraper` to `src/lib/server/scrapers/index.ts`; add `"scraperId": "orkan"` to the Orkan entry in `seeds/networks.json`. Then:

```bash
npm run seed:networks && npm run scrape
```
Expected: `orkan: changed — N inserted` with warnings for price-table stations not in our DB (Baula, Hella, …) and for our fuel-only stations — both expected. Verify matched prices land in the 49–61 kr band. If playwright complains about a missing browser: `npx playwright install chromium`.

- [ ] **Step 7: Full suite + commit**

```bash
npx vitest run
git add tests/fixtures/orkan-orkustodvar.html src/lib/server/scrapers/orkan.ts src/lib/server/scrapers/orkan.test.ts src/lib/server/scrapers/index.ts seeds/networks.json
git commit -m "feat: Orkan scraper — headless-rendered Blazor price table, name/address matching, biðgjald as fee-after-60"
```

---

### Task 13: Homepage display — "frá" prices, fee-after-N-minutes, stale-verification amber

**Files:**
- Modify: `messages/is.json`, `messages/en.json`
- Modify: `src/lib/format.ts` + Test: `src/lib/format.test.ts`
- Modify: `src/lib/components/RateCard.svelte`, `src/lib/components/StationTable.svelte`

- [ ] **Step 1: Messages**

Add to `messages/is.json` (before `"lang_switch"`):

```json
	"minute_fee_after": "+ {fee} kr/mín eftir {min} mín",
	"price_from": "frá {price}",
```

Add to `messages/en.json` (same position):

```json
	"minute_fee_after": "+ {fee} kr/min after {min} min",
	"price_from": "from {price}",
```

- [ ] **Step 2: Staleness helper (TDD)**

Add to `src/lib/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isStale } from './format';

describe('isStale', () => {
	it('flags prices verified more than 30 days ago', () => {
		const now = new Date('2026-07-05T12:00:00Z');
		expect(isStale(new Date('2026-06-01T12:00:00Z'), now)).toBe(true);
		expect(isStale(new Date('2026-06-20T12:00:00Z'), now)).toBe(false);
	});
});
```

(Adapt the import line to the file's existing imports.) Run `npx vitest run src/lib/format.test.ts` — expect FAIL. Then add to `src/lib/format.ts`:

```ts
const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/** Honesty rule: a price unverified for >30 days is still shown, but amber-flagged. */
export function isStale(verifiedAt: Date, now = new Date()): boolean {
	return now.getTime() - verifiedAt.getTime() > STALE_AFTER_MS;
}
```

Run again — expect PASS.

- [ ] **Step 3: StationTable — fee-after variant + stale class**

In `src/lib/components/StationTable.svelte`, extend the format import:

```ts
	import { formatIsk, formatDate, formatNumber, isStale } from '$lib/format';
```

Replace the minute-fee and verified `<small>` block inside the price cell with:

```svelte
								{#if s.minuteFeeIsk}<small
										>{s.minuteFeeAfterMin
											? m.minute_fee_after({
													fee: formatNumber(s.minuteFeeIsk),
													min: s.minuteFeeAfterMin
												})
											: m.minute_fee({ fee: formatNumber(s.minuteFeeIsk) })}</small
									>{/if}
								{#if s.verifiedAt}<small class="verified" class:stale={isStale(s.verifiedAt)}
										>{m.verified_on({ date: formatDate(s.verifiedAt) })}</small
									>{/if}
```

Add to the component's `<style>` block:

```css
	.verified.stale {
		color: #b26a00;
		opacity: 1;
	}
```

- [ ] **Step 4: RateCard — "frá" prefix**

In `src/lib/components/RateCard.svelte`, replace the dc/ac spans:

```svelte
				<span class="dc">
					{#if card.dc !== null}<strong data-testid="rate-dc"
							>{card.dcFrom ? m.price_from({ price: formatIsk(card.dc) }) : formatIsk(card.dc)}</strong
						> DC{/if}
				</span>
				<span class="ac">
					{#if card.ac !== null}{card.acFrom
							? m.price_from({ price: formatIsk(card.ac) })
							: formatIsk(card.ac)} AC{/if}
				</span>
```

- [ ] **Step 5: Verify everything**

```bash
npx svelte-kit sync && npx svelte-check --tsconfig ./tsconfig.json && npx vitest run && npx playwright test
```
Expected: all green. The homepage E2E tests already tolerate the "frá" prefix (their `parsePrice` strips non-digits) and per-station price variance (server-side sort). If the connector-filter or ordering tests fail, that's a real regression — investigate, don't loosen the test.

- [ ] **Step 6: Commit**

```bash
git add messages/ src/lib/format.ts src/lib/format.test.ts src/lib/components/ src/lib/paraglide/
git commit -m "feat: display frá-prices, conditional minute fees, and amber stale-verification labels"
```

---

### Task 14: `/verdthroun` trend page + header nav

**Files:**
- Create: `src/routes/verdthroun/+page.server.ts`, `src/routes/verdthroun/+page.svelte`
- Modify: `messages/is.json`, `messages/en.json`, `src/routes/+layout.svelte`
- Test: `e2e/homepage.test.ts` (new tests)

- [ ] **Step 1: Messages**

`messages/is.json` (before `"lang_switch"`):

```json
	"nav_trends": "Verðþróun",
	"trends_title": "Verðþróun hleðsluverðs",
	"trends_note": "Hver lína sýnir lægsta verð fyrirtækis á kWst yfir tíma. Verðsagan hefst þegar söfnun hófst, 2026.",
	"trends_no_data": "Engin verðsaga enn.",
	"trends_current": "Núverandi lægsta verð",
	"trends_since": "síðan {date}",
```

`messages/en.json`:

```json
	"nav_trends": "Price trends",
	"trends_title": "Charging price trends",
	"trends_note": "Each line shows a network's lowest price per kWh over time. History begins when collection started, 2026.",
	"trends_no_data": "No price history yet.",
	"trends_current": "Current lowest price",
	"trends_since": "since {date}",
```

- [ ] **Step 2: Nav link**

In `src/routes/+layout.svelte`, insert between the tagline and the lang link:

```svelte
	<nav class="nav">
		<a href="/verdthroun">{m.nav_trends()}</a>
	</nav>
```

and add to the header styles:

```css
	.nav {
		font-size: 0.9rem;
	}
```

- [ ] **Step 3: Server load**

`src/routes/verdthroun/+page.server.ts`:

```ts
import { db } from '$lib/server/db';
import { trendSeries } from '$lib/server/db/queries';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const mode = url.searchParams.get('afl') === 'AC' ? ('AC' as const) : ('DC' as const);
	return { mode, series: await trendSeries(db, mode), now: Date.now() };
};
```

- [ ] **Step 4: Page**

`src/routes/verdthroun/+page.svelte`:

```svelte
<script lang="ts">
	import Chart from 'chart.js/auto';
	import * as m from '$lib/paraglide/messages';
	import { formatDate, formatIsk } from '$lib/format';

	let { data } = $props();
	let canvas = $state<HTMLCanvasElement | undefined>();

	const PALETTE = ['#2e7d32', '#1565c0', '#e65100', '#6a1b9a', '#c62828', '#00838f'];

	$effect(() => {
		if (!canvas || data.series.length === 0) return;
		const chart = new Chart(canvas, {
			type: 'line',
			data: {
				datasets: data.series.map((s, i) => ({
					label: s.networkName,
					// extend each stepped line to "now" so current prices read at the right edge
					data: [...s.points, { t: data.now, y: s.points[s.points.length - 1].y }].map((p) => ({
						x: p.t,
						y: p.y
					})),
					stepped: true,
					borderColor: PALETTE[i % PALETTE.length],
					backgroundColor: PALETTE[i % PALETTE.length],
					pointRadius: 2
				}))
			},
			options: {
				scales: {
					x: {
						type: 'linear',
						ticks: {
							maxTicksLimit: 8,
							callback: (v) => formatDate(new Date(Number(v)))
						}
					},
					y: { title: { display: true, text: 'kr/kWh' } }
				},
				interaction: { mode: 'nearest', intersect: false }
			}
		});
		return () => chart.destroy();
	});
</script>

<svelte:head>
	<title>{m.trends_title()} — {m.site_title()}</title>
	<meta name="description" content={m.trends_note()} />
</svelte:head>

<section aria-label={m.trends_title()}>
	<h2>{m.trends_title()}</h2>
	<p class="note">{m.trends_note()}</p>

	<nav class="filters">
		<span class="group" role="group" aria-label={m.filter_mode()}>
			<a href="/verdthroun" class:active={data.mode === 'DC'}>{m.mode_dc()}</a>
			<a href="/verdthroun?afl=AC" class:active={data.mode === 'AC'}>{m.mode_ac()}</a>
		</span>
	</nav>

	{#if data.series.length === 0}
		<p class="empty">{m.trends_no_data()}</p>
	{:else}
		<div class="chart"><canvas bind:this={canvas} data-testid="trend-chart"></canvas></div>
		<noscript>
			<table>
				<thead>
					<tr><th>{m.th_network()}</th><th>{m.trends_current()}</th><th></th></tr>
				</thead>
				<tbody>
					{#each data.series as s (s.networkSlug)}
						{@const last = s.points[s.points.length - 1]}
						<tr data-testid="trend-row">
							<td>{s.networkName}</td>
							<td>{formatIsk(last.y)}</td>
							<td>{m.trends_since({ date: formatDate(new Date(last.t)) })}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</noscript>
	{/if}
</section>

<style>
	.note {
		opacity: 0.7;
		font-size: 0.9rem;
	}
	.filters {
		display: flex;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}
	.group {
		display: inline-flex;
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
	.chart {
		position: relative;
		min-height: 20rem;
	}
	.empty {
		opacity: 0.7;
		padding: 1rem 0;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th,
	td {
		text-align: left;
		padding: 0.4rem 0.5rem;
		border-bottom: 1px solid var(--border, #e2e2e2);
	}
</style>
```

- [ ] **Step 5: E2E tests**

Add to `e2e/homepage.test.ts`:

```ts
test('trend page draws the chart and offers a no-JS table', async ({ page, browser }) => {
	await page.goto('/');
	await page.locator('nav a[href="/verdthroun"]').click();
	await expect(page.locator('[data-testid="trend-chart"]')).toBeVisible();

	const ctx = await browser.newContext({ javaScriptEnabled: false });
	const noJs = await ctx.newPage();
	await noJs.goto('/verdthroun');
	expect(await noJs.locator('[data-testid="trend-row"]').count()).toBeGreaterThan(0);
	await ctx.close();
});
```

- [ ] **Step 6: Verify**

```bash
npx svelte-kit sync && npx svelte-check --tsconfig ./tsconfig.json && npx playwright test
```
Expected: all E2E pass (7 now). The dev DB has real scraped history by this point, so the chart has data.

- [ ] **Step 7: Commit**

```bash
git add messages/ src/routes/+layout.svelte src/routes/verdthroun/ e2e/homepage.test.ts src/lib/paraglide/
git commit -m "feat: /verdthroun — stepped price-history chart per network with no-JS fallback table"
```

---

### Task 15: `/admin` — manual prices, verify bump, scraper health, station toggle

**Files:**
- Create: `src/lib/server/admin.ts` + Test: `src/lib/server/admin.test.ts`
- Create: `src/routes/admin/+page.server.ts`, `src/routes/admin/+page.svelte`
- Modify: `messages/is.json`, `messages/en.json`
- Test: `e2e/homepage.test.ts` (render-only test)

**Security note:** per the architecture note, auth stays out of app code — production puts Caddy basic-auth in front of `/admin` (Phase 4 checklist item). The page ships `noindex` and must never go live unprotected.

- [ ] **Step 1: Failing tests for the admin logic**

`src/lib/server/admin.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DB_URL, closeTestDb, setupTestDb, truncateAll } from '../../../tests/helpers/db';
import type { Db } from './db/client';
import { networks, prices, scrapeRuns, stations } from './db/schema';
import { insertPriceIfChanged } from './db/prices';
import { bumpVerified, scraperHealth, setStationActive, submitManualPrice } from './admin';

const form = (entries: Record<string, string>): FormData => {
	const f = new FormData();
	for (const [k, v] of Object.entries(entries)) f.set(k, v);
	return f;
};

describe.skipIf(!TEST_DB_URL)('admin logic', () => {
	let db: Db;
	let onId: number;
	let stationId: number;

	beforeAll(async () => {
		db = await setupTestDb();
	});
	afterAll(async () => {
		await closeTestDb(db);
	});
	beforeEach(async () => {
		await truncateAll(db);
		const [n] = await db.insert(networks).values({ name: 'ON', slug: 'on', scraperId: 'on' }).returning();
		onId = n.id;
		const [s] = await db
			.insert(stations)
			.values({ networkId: onId, slug: 'hellisheidi-on', name: 'Hellisheiði', location: { x: -21.4, y: 64.03 } })
			.returning();
		stationId = s.id;
	});

	it('submitManualPrice inserts a manual reading (decimal comma accepted)', async () => {
		const res = await submitManualPrice(
			db,
			form({ networkId: String(onId), tariffKey: 'AC', price: '48', minuteFee: '0,5' })
		);
		expect(res).toEqual({ ok: true });
		const [row] = await db.select().from(prices);
		expect(row).toMatchObject({ priceIskPerKwh: 48, minuteFeeIsk: 0.5, source: 'manual', stationId: null });
	});

	it('submitManualPrice accepts an optional station scope and fee-after', async () => {
		const res = await submitManualPrice(
			db,
			form({
				networkId: String(onId),
				stationId: String(stationId),
				tariffKey: 'DC',
				price: '73',
				minuteFee: '60',
				minuteFeeAfterMin: '60'
			})
		);
		expect(res).toEqual({ ok: true });
		const [row] = await db.select().from(prices);
		expect(row).toMatchObject({ stationId, minuteFeeAfterMin: 60 });
	});

	it('submitManualPrice rejects bad input without writing', async () => {
		expect((await submitManualPrice(db, form({ networkId: 'x', tariffKey: 'AC', price: '48' }))).ok).toBe(false);
		expect((await submitManualPrice(db, form({ networkId: String(onId), tariffKey: 'XX', price: '48' }))).ok).toBe(false);
		expect((await submitManualPrice(db, form({ networkId: String(onId), tariffKey: 'AC', price: '' }))).ok).toBe(false);
		const implausible = await submitManualPrice(db, form({ networkId: String(onId), tariffKey: 'AC', price: '4900' }));
		expect(implausible.ok).toBe(false);
		expect(implausible.error).toMatch(/implausible/i);
		expect(await db.select().from(prices)).toHaveLength(0);
	});

	it('bumpVerified touches only the targeted row', async () => {
		await insertPriceIfChanged(db, { networkId: onId, tariffKey: 'AC', priceIskPerKwh: 48, source: 'manual' });
		const [before] = await db.select().from(prices);
		await new Promise((r) => setTimeout(r, 20));
		expect(await bumpVerified(db, before.id)).toEqual({ ok: true });
		const [after] = await db.select().from(prices);
		expect(after.verifiedAt.getTime()).toBeGreaterThan(before.verifiedAt.getTime());
		expect((await bumpVerified(db, 999999)).ok).toBe(false);
	});

	it('setStationActive toggles visibility', async () => {
		expect(await setStationActive(db, stationId, false)).toEqual({ ok: true });
		const [s] = await db.select().from(stations);
		expect(s.isActive).toBe(false);
	});

	it('scraperHealth reports last run and consecutive failures per scraper network', async () => {
		await db.insert(scrapeRuns).values([
			{ networkId: onId, status: 'ok', message: '0 inserted, 2 verified' },
			{ networkId: onId, status: 'failed', message: 'layout changed' },
			{ networkId: onId, status: 'failed', message: 'layout changed' }
		]);
		const health = await scraperHealth(db);
		expect(health).toHaveLength(1);
		expect(health[0]).toMatchObject({
			networkName: 'ON',
			lastStatus: 'failed',
			consecutiveFailures: 2
		});
	});
});
```

- [ ] **Step 2: Run to verify failure, then implement**

```bash
npx vitest run src/lib/server/admin.test.ts
```
Expected: FAIL — `./admin` does not exist. Then create `src/lib/server/admin.ts`:

```ts
import { desc, eq, sql } from 'drizzle-orm';
import { TARIFF_KEYS, type TariffKey } from '$lib/types';
import type { Db } from './db/client';
import { insertPriceIfChanged } from './db/prices';
import { networks, prices, scrapeRuns, stations } from './db/schema';

export interface AdminResult {
	ok: boolean;
	error?: string;
}

/** "0,5" → 0.5; empty/missing → null; garbage → NaN (caller rejects) */
function num(v: FormDataEntryValue | null): number | null {
	if (typeof v !== 'string' || v.trim() === '') return null;
	return parseFloat(v.trim().replace(',', '.'));
}

export async function submitManualPrice(db: Db, form: FormData): Promise<AdminResult> {
	const networkId = num(form.get('networkId'));
	const stationId = num(form.get('stationId'));
	const tariffKey = String(form.get('tariffKey') ?? '');
	const price = num(form.get('price'));
	const minuteFee = num(form.get('minuteFee'));
	const minuteFeeAfterMin = num(form.get('minuteFeeAfterMin'));
	if (
		networkId === null ||
		!Number.isInteger(networkId) ||
		!(TARIFF_KEYS as readonly string[]).includes(tariffKey) ||
		price === null ||
		Number.isNaN(price)
	) {
		return { ok: false, error: 'ógilt form' };
	}
	try {
		await insertPriceIfChanged(db, {
			networkId,
			stationId: stationId === null ? null : stationId,
			tariffKey: tariffKey as TariffKey,
			priceIskPerKwh: price,
			minuteFeeIsk: minuteFee,
			minuteFeeAfterMin: minuteFeeAfterMin === null ? null : Math.round(minuteFeeAfterMin),
			source: 'manual'
		});
		return { ok: true };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}

export async function bumpVerified(db: Db, priceId: number): Promise<AdminResult> {
	const rows = await db
		.update(prices)
		.set({ verifiedAt: sql`now()` })
		.where(eq(prices.id, priceId))
		.returning({ id: prices.id });
	return rows.length === 1 ? { ok: true } : { ok: false, error: 'verðfærsla fannst ekki' };
}

export async function setStationActive(db: Db, stationId: number, isActive: boolean): Promise<AdminResult> {
	const rows = await db
		.update(stations)
		.set({ isActive })
		.where(eq(stations.id, stationId))
		.returning({ id: stations.id });
	return rows.length === 1 ? { ok: true } : { ok: false, error: 'stöð fannst ekki' };
}

export interface ScraperHealthEntry {
	networkSlug: string;
	networkName: string;
	lastStatus: 'ok' | 'changed' | 'failed' | null;
	lastRunAt: Date | null;
	lastMessage: string | null;
	consecutiveFailures: number;
}

export async function scraperHealth(db: Db): Promise<ScraperHealthEntry[]> {
	const nets = (await db.select().from(networks)).filter((n) => n.scraperId !== null);
	const out: ScraperHealthEntry[] = [];
	for (const net of nets) {
		const runs = await db
			.select()
			.from(scrapeRuns)
			.where(eq(scrapeRuns.networkId, net.id))
			.orderBy(desc(scrapeRuns.startedAt), desc(scrapeRuns.id))
			.limit(50);
		let consecutiveFailures = 0;
		for (const r of runs) {
			if (r.status !== 'failed') break;
			consecutiveFailures++;
		}
		out.push({
			networkSlug: net.slug,
			networkName: net.name,
			lastStatus: runs[0]?.status ?? null,
			lastRunAt: runs[0]?.startedAt ?? null,
			lastMessage: runs[0]?.message ?? null,
			consecutiveFailures
		});
	}
	return out.sort((a, b) => a.networkName.localeCompare(b.networkName, 'is'));
}
```

```bash
npx vitest run src/lib/server/admin.test.ts
```
Expected: PASS (6 tests).

- [ ] **Step 3: Messages**

`messages/is.json` (before `"lang_switch"`):

```json
	"admin_title": "Stjórnborð",
	"admin_scrapers": "Skraparar",
	"admin_last_run": "Síðasta keyrsla",
	"admin_failures": "bilanir í röð",
	"admin_never_ran": "hefur aldrei keyrt",
	"admin_prices": "Núverandi verð",
	"admin_verify": "Staðfesta",
	"admin_add_price": "Skrá verð handvirkt",
	"admin_station_optional": "Stöð (valfrjálst — annars fyrirtækjaverð)",
	"admin_tariff": "Gjaldflokkur",
	"admin_price_kwh": "Verð kr/kWh",
	"admin_minute_fee": "Mínútugjald kr",
	"admin_fee_after": "Gjald hefst eftir (mín)",
	"admin_save": "Vista",
	"admin_saved": "Vistað",
	"admin_stations": "Stöðvar",
	"admin_deactivate": "Slökkva",
	"admin_activate": "Kveikja",
	"admin_network_wide": "fyrirtækjaverð",
```

`messages/en.json`:

```json
	"admin_title": "Admin",
	"admin_scrapers": "Scrapers",
	"admin_last_run": "Last run",
	"admin_failures": "consecutive failures",
	"admin_never_ran": "has never run",
	"admin_prices": "Current prices",
	"admin_verify": "Verify",
	"admin_add_price": "Insert manual price",
	"admin_station_optional": "Station (optional — otherwise network-wide)",
	"admin_tariff": "Tariff",
	"admin_price_kwh": "Price kr/kWh",
	"admin_minute_fee": "Minute fee kr",
	"admin_fee_after": "Fee starts after (min)",
	"admin_save": "Save",
	"admin_saved": "Saved",
	"admin_stations": "Stations",
	"admin_deactivate": "Deactivate",
	"admin_activate": "Activate",
	"admin_network_wide": "network-wide",
```

- [ ] **Step 4: Route**

`src/routes/admin/+page.server.ts`:

```ts
// NO AUTH IN APP CODE by design: production MUST front /admin with Caddy
// basic-auth (Phase 4 checklist). Until then this page exists only on dev machines.
import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { bumpVerified, scraperHealth, setStationActive, submitManualPrice } from '$lib/server/admin';
import { currentPrices } from '$lib/server/db/queries';
import { networks, stations } from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [nets, sts, cp, health] = await Promise.all([
		db.select().from(networks),
		db.select().from(stations),
		currentPrices(db),
		scraperHealth(db)
	]);
	const netName = new Map(nets.map((n) => [n.id, n.name]));
	const stName = new Map(sts.map((s) => [s.id, s.name]));
	return {
		health,
		networks: nets
			.map((n) => ({ id: n.id, name: n.name }))
			.sort((a, b) => a.name.localeCompare(b.name, 'is')),
		stations: sts
			.map((s) => ({ id: s.id, name: s.name, networkName: netName.get(s.networkId) ?? '', isActive: s.isActive }))
			.sort((a, b) => a.networkName.localeCompare(b.networkName, 'is') || a.name.localeCompare(b.name, 'is')),
		prices: cp
			.map((p) => ({
				id: p.id,
				networkName: netName.get(p.networkId) ?? '',
				stationName: p.stationId === null ? null : (stName.get(p.stationId) ?? `#${p.stationId}`),
				tariffKey: p.tariffKey,
				priceIskPerKwh: p.priceIskPerKwh,
				minuteFeeIsk: p.minuteFeeIsk,
				minuteFeeAfterMin: p.minuteFeeAfterMin,
				verifiedAt: p.verifiedAt
			}))
			.sort(
				(a, b) =>
					a.networkName.localeCompare(b.networkName, 'is') ||
					(a.stationName ?? '').localeCompare(b.stationName ?? '', 'is') ||
					a.tariffKey.localeCompare(b.tariffKey)
			)
	};
};

export const actions: Actions = {
	price: async ({ request }) => {
		const res = await submitManualPrice(db, await request.formData());
		return res.ok ? { saved: true } : fail(400, { error: res.error });
	},
	verify: async ({ request }) => {
		const form = await request.formData();
		const res = await bumpVerified(db, Number(form.get('priceId')));
		return res.ok ? { saved: true } : fail(400, { error: res.error });
	},
	stationActive: async ({ request }) => {
		const form = await request.formData();
		const res = await setStationActive(
			db,
			Number(form.get('stationId')),
			form.get('isActive') === 'true'
		);
		return res.ok ? { saved: true } : fail(400, { error: res.error });
	}
};
```

`src/routes/admin/+page.svelte`:

```svelte
<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { formatDate, formatNumber, isStale } from '$lib/format';
	import { TARIFF_KEYS } from '$lib/types';

	let { data, form } = $props();
</script>

<svelte:head>
	<title>{m.admin_title()} — {m.site_title()}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<h2>{m.admin_title()}</h2>

{#if form?.saved}<p class="ok">{m.admin_saved()}</p>{/if}
{#if form?.error}<p class="err">{form.error}</p>{/if}

<section aria-label={m.admin_scrapers()}>
	<h3>{m.admin_scrapers()}</h3>
	<table data-testid="admin-health">
		<tbody>
			{#each data.health as h (h.networkSlug)}
				<tr>
					<td>{h.networkName}</td>
					<td class:bad={h.lastStatus === 'failed'}>
						{#if h.lastRunAt}
							{h.lastStatus} — {m.admin_last_run()}: {h.lastRunAt.toLocaleString('is-IS')}
						{:else}
							{m.admin_never_ran()}
						{/if}
					</td>
					<td>
						{#if h.consecutiveFailures >= 3}<strong class="bad"
								>{h.consecutiveFailures} {m.admin_failures()}</strong
							>{:else if h.consecutiveFailures > 0}{h.consecutiveFailures} {m.admin_failures()}{/if}
					</td>
					<td class="msg">{h.lastMessage ?? ''}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>

<section aria-label={m.admin_prices()}>
	<h3>{m.admin_prices()}</h3>
	<table data-testid="admin-prices">
		<tbody>
			{#each data.prices as p (p.id)}
				<tr>
					<td>{p.networkName}</td>
					<td>{p.stationName ?? m.admin_network_wide()}</td>
					<td>{p.tariffKey}</td>
					<td>
						{formatNumber(p.priceIskPerKwh)} kr{#if p.minuteFeeIsk}
							+ {formatNumber(p.minuteFeeIsk)} kr/mín{#if p.minuteFeeAfterMin}
								({p.minuteFeeAfterMin} mín){/if}{/if}
					</td>
					<td class:stale={isStale(p.verifiedAt)}>{formatDate(p.verifiedAt)}</td>
					<td>
						<form method="POST" action="?/verify">
							<input type="hidden" name="priceId" value={p.id} />
							<button>{m.admin_verify()}</button>
						</form>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>

	<h3>{m.admin_add_price()}</h3>
	<form method="POST" action="?/price" class="grid" data-testid="admin-price-form">
		<label
			>{m.th_network()}
			<select name="networkId" required>
				{#each data.networks as n (n.id)}<option value={n.id}>{n.name}</option>{/each}
			</select>
		</label>
		<label
			>{m.admin_station_optional()}
			<select name="stationId">
				<option value=""></option>
				{#each data.stations as s (s.id)}<option value={s.id}>{s.networkName} — {s.name}</option>{/each}
			</select>
		</label>
		<label
			>{m.admin_tariff()}
			<select name="tariffKey" required>
				{#each TARIFF_KEYS as t (t)}<option value={t}>{t}</option>{/each}
			</select>
		</label>
		<label>{m.admin_price_kwh()} <input name="price" required inputmode="decimal" /></label>
		<label>{m.admin_minute_fee()} <input name="minuteFee" inputmode="decimal" /></label>
		<label>{m.admin_fee_after()} <input name="minuteFeeAfterMin" inputmode="numeric" /></label>
		<button>{m.admin_save()}</button>
	</form>
</section>

<section aria-label={m.admin_stations()}>
	<h3>{m.admin_stations()}</h3>
	<table data-testid="admin-stations">
		<tbody>
			{#each data.stations as s (s.id)}
				<tr class:inactive={!s.isActive}>
					<td>{s.networkName}</td>
					<td>{s.name}</td>
					<td>
						<form method="POST" action="?/stationActive">
							<input type="hidden" name="stationId" value={s.id} />
							<input type="hidden" name="isActive" value={String(!s.isActive)} />
							<button>{s.isActive ? m.admin_deactivate() : m.admin_activate()}</button>
						</form>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>

<style>
	table {
		width: 100%;
		border-collapse: collapse;
		margin-bottom: 1.5rem;
	}
	td {
		padding: 0.35rem 0.5rem;
		border-bottom: 1px solid var(--border, #e2e2e2);
		vertical-align: top;
	}
	.bad {
		color: #c62828;
		font-weight: 600;
	}
	.stale {
		color: #b26a00;
	}
	.msg {
		font-size: 0.8rem;
		opacity: 0.7;
		max-width: 24rem;
	}
	.inactive {
		opacity: 0.45;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: 0.75rem;
		align-items: end;
		max-width: 60rem;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.9rem;
	}
	.ok {
		color: var(--accent, #2e7d32);
	}
	.err {
		color: #c62828;
	}
</style>
```

- [ ] **Step 5: Render-only E2E test** (admin actions are covered by the DB tests; E2E must not mutate the dev DB)

Add to `e2e/homepage.test.ts`:

```ts
test('admin page renders health, prices and forms', async ({ page }) => {
	await page.goto('/admin');
	await expect(page.locator('[data-testid="admin-health"]')).toBeVisible();
	await expect(page.locator('[data-testid="admin-prices"] tr').first()).toBeVisible();
	await expect(page.locator('[data-testid="admin-price-form"]')).toBeVisible();
	// never let the admin page leak into search results
	await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
});
```

- [ ] **Step 6: Verify**

```bash
npx svelte-kit sync && npx svelte-check --tsconfig ./tsconfig.json && npx vitest run && npx playwright test
```
Expected: all green (8 E2E).

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/admin.ts src/lib/server/admin.test.ts src/routes/admin/ messages/ e2e/homepage.test.ts src/lib/paraglide/
git commit -m "feat: /admin — scraper health, manual prices, verified-at bump, station toggle (Caddy-auth in prod)"
```

---

### Task 16: README, format check, full suite, wrap-up

**Files:**
- Modify: `README.md`
- Vault (outside repo): `Hleðsluverð.md` status + risk updates — done by the session owner at completion, never committed to the repo.

- [ ] **Step 1: README — add a Scrapers section after "Tests"**

```markdown
## Scrapers

    npm run match:virta   # one-time: stamp Virta ids onto Ísorka stations (coordinates)
    npm run match:n1      # one-time: stamp N1 location ids onto N1 stations (review output!)
    npm run scrape        # run all price scrapers once against DATABASE_URL

- One module per network in `src/lib/server/scrapers/`; every parser is tested
  against fixtures in `tests/fixtures/` (snapshots of the real pages/APIs).
  Site redesign → save a new fixture, fix the parser; old fixtures guard regressions.
- Fail loud, never guess: a scraper that cannot parse throws; the run is logged
  as `failed` in `scrape_runs` and yesterday's price stays. Set `NTFY_TOPIC` in
  `.env` to get a push via ntfy.sh after 3 consecutive failures per network.
- The Orkan scraper drives headless Chromium (Blazor site) — it reuses the
  browser from `npx playwright install chromium`.
- e1 and Tesla publish prices only in their apps — no scraper; `/admin` has a
  manual-price form.
- Production (Phase 4) runs `npm run scrape` from an hourly systemd timer and
  MUST front `/admin` with Caddy basic-auth.
```

- [ ] **Step 2: Full verification**

```bash
npm run lint && npx svelte-kit sync && npx svelte-check --tsconfig ./tsconfig.json && npx vitest run && npx playwright test
```
Expected: prettier clean, 0 svelte-check errors, all unit + 8 E2E pass. Fix any prettier drift with `npm run format` before committing.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README — scraper architecture, match scripts, ntfy, fail-loud policy"
```

- [ ] **Step 4: Process wrap-up (session owner)**

1. Run the final whole-branch review (superpowers:code-reviewer) before merging `phase-2-scrapers` → `main`.
2. Update the Obsidian vault (`Hleðsluverð.md`): tick Fasi 2 with date + summary; update risk register — e1 prices are app-only (no scraper possible, verified 2026-07-05), Orkan requires headless Chromium (Blazor), per-station pricing is the norm for Ísorka/N1/Orkan, N1's Rafmagn VSK status inferred not stated (periodic manual check).
3. Phase 4 checklist additions: hourly systemd timer for `npm run scrape`, `npx playwright install chromium --with-deps` on the VPS, Caddy basic-auth for `/admin`, `NTFY_TOPIC` in the server `.env`.

## Self-review notes (spec coverage)

- Gagnasöfnun: hourly runner ✓ (entry point; timer is Phase 4), plausibility guard ✓ (pre-existing, extended), changed/ok/failed logging ✓, fail-loud ✓, manual admin path ✓. OCM re-sync review → Phase 3 (delta 7).
- Gagnalíkan: append-only ✓, verified_at bump ✓, tariff derivation ✓ (now with station override), `minute_fee_after_min` is the one schema addition (delta 2).
- Síður og UX: `/verdthroun` ✓ (stepped, per network, DC default + AC toggle), `/admin` ✓ (scoped per delta 7), staleness amber ✓, red badge ≥3 failures ✓, ntfy ✓, station pages/map/finder → Phase 3.
- Prófanir: scraper fixtures highest priority ✓ (every parser fixture-tested, fixtures verbatim from research), logic tests ✓, E2E ✓ (8 flows).
