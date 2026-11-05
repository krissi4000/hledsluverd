# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Hleðsluverð (hledsluverd.is) compares the prices of EV charging in Iceland. It is built with SvelteKit (Svelte 5 runes, adapter-node), Drizzle ORM and PostgreSQL/PostGIS. The UI is Icelandic first: the routes are Icelandic words (`/kort` map, `/stod/[slug]` station, `/verdthroun` price history, `/admin`). The car finder is a filter on the homepage (`?bill=<car slug>`); the old `/bilaleit` page redirects there.

## Commands

```sh
npm run dev                      # vite dev server
npm run build                    # adapter-node build → build/ (needs DATABASE_URL set, any value)
npm run check                    # svelte-kit sync + svelte-check (types)
npm run lint                     # prettier --check (the only linter); npm run format to fix
npx vitest run                   # all unit + DB tests
npx vitest run src/lib/server/scrapers/on.test.ts   # single file
npx vitest run -t "name pattern" # single test by name
npx playwright test              # E2E against a production build (needs seeded dev DB + chromium)
npm run db:migrate               # apply drizzle/ migrations to DATABASE_URL
npx drizzle-kit generate         # create a migration after editing schema.ts (no npm script)
npm run scrape                   # run all price scrapers once against DATABASE_URL
```

CI (`.github/workflows/deploy.yml`) runs build → lint → check → `test:unit --run` on every push and PR. It does not run E2E. Pushing to `main` deploys over SSH when the repo variable `DEPLOY_ENABLED` is `true`. CI runs `build` first because it generates `src/lib/paraglide/` (gitignored), and both `check` and vitest import from it.

## Environment notes

- `src/lib/server/db/index.ts` throws at import time if `DATABASE_URL` is unset. The build's post-build analysis imports it, so `npm run build` needs a dummy value even when no DB exists. The postgres pool is lazy and never connects during the build.
- DB test suites use `describe.skipIf(!TEST_DB_URL)` and skip silently when `DATABASE_URL_TEST` is unset. `tests/helpers/db.ts` refuses to run against any URL that doesn't contain "test" because it truncates every table. Vitest runs with `fileParallelism: false` since all DB suites share one test database. `expect.requireAssertions` is on.
- Scripts in `scripts/` run under `tsx` and load `.env` via `dotenv/config`. They use relative imports, but the code they import uses `$lib/...`, which resolves through the generated `.svelte-kit/tsconfig.json`. Run `svelte-kit sync` (it runs on `npm install` via `prepare`) if those imports fail.
- In production `.env` is read by both dotenv and systemd `EnvironmentFile=`, so it must contain plain `KEY=value` lines only (no quotes, `export` or `$VAR`).

## Architecture

**Data model** (`src/lib/server/db/schema.ts`): `networks` (operators) → `stations` (PostGIS location, external ids for OCM, Virta, N1, TomTom, supercharge.info and e1) → `connectors`. `prices` belong to a network and optionally a station: `station_id` NULL means the network-wide price, keyed by `tariffKey` (`AC` | `DC` | `DC_150`). There are also `availability` (TomTom cache), `cars` (OpenEV Data) and `scrape_runs`.

**Prices are append-only and form the price history.** `/verdthroun` reads trends from them. Every price write must go through `insertPriceIfChanged` (`src/lib/server/db/prices.ts`). It rejects implausible values (outside 10–200 kr/kWh) by throwing, rounds to 2 decimals, inserts a new row when the value changes and only bumps `verified_at` when it doesn't. Writers must always pass the full reading. Leaving `minuteFeeIsk` out means "no fee" and writes a row that erases an existing fee.

**Minute fees:** `minuteFeeIsk` is a per-minute charge. `minuteFeeAfterMin` is the number of minutes before that charge starts, with null meaning it applies from minute 0. For example, ON has 0,5 kr/mín from the start, while Ísorka and Orkan charge an idle fee after 60 min.

**Scrapers** (`src/lib/server/scrapers/`): there is one module per network implementing `Scraper` (`types.ts`), and each is registered in `index.ts`. Its `id` must equal `networks.scraper_id`. `runner.ts` runs them, records `scrape_runs`, and sends an ntfy push after 3 consecutive failures per network. **Fail loud, never guess:** a scraper that can't parse confidently must throw, so yesterday's price stays in place. Every parser is tested against saved real pages in `tests/fixtures/`. When a site is redesigned, add a new fixture and keep the old ones as regression guards. Orkan is a Blazor site, so its scraper drives headless Chromium through Playwright. e1 and Tesla have no scraper and get prices through the manual form at `/admin`. The admin page has no auth in app code; Caddy basic-auth protects it in production.

**Station matching:** stations seed from Open Charge Map (`seed:ocm`, idempotent). The one-off `match:virta`, `match:n1` and `match:tomtom` scripts stamp external ids onto stations by coordinates and name (`src/lib/server/matching.ts`). Their output lists unmatched or ambiguous stations that need human review. OCM misses newer Tesla Superchargers, so `sync:superchargers` (after `seed:ocm`, `--dry-run` to preview) adds the missing ones from supercharge.info and refreshes their stall counts. Likewise `sync:e1` adds stations and real connector data from e1's public map (`src/lib/server/e1map.ts`) for networks with `e1PartnerIds` in `seeds/networks.json` (Orkan = 145). Both use `planSiteSync` (`site-sync.ts`) and must run after `seed:ocm`, which would overwrite their connectors. Tesla prices are per-station app prices for Tesla cars, and the UI labels them with `ownBrandPriceOnly()` (`src/lib/networks.ts`).

**Availability:** TomTom data is cached in `availability` for 5 minutes and refreshed during page loads within an in-process daily budget (`availability-refresh.ts`, 2000 of the free 2500 requests per day). It is best-effort and never surfaces errors.

**Honesty rules (binding product constraints):** unknown availability renders as `—` and never as `0`, because 0 means "all busy". Shown availability always includes its age ("fyrir 2 mín"). Prices unverified for more than 30 days are shown in amber. Showing a wrong price or availability with confidence is the worst failure this app can have.

**i18n:** Paraglide (`project.inlang`, `messages/is.json` and `messages/en.json`). Locale comes from a cookie with Icelandic as the base, set via `/lang`. Every user-facing string goes in both message files and is used as `m.key()`.

**Deployment:** a single VPS runs Caddy → `node build/index.js` under systemd → Postgres. An hourly systemd timer runs `npm run scrape`, and backups are a nightly `pg_dump`. The units and scripts are in `deploy/`, and the runbook is `docs/deploy.md`.

`docs/superpowers/plans/` holds the original phase plans (1: foundation, 2: scrapers/history/admin, 3: map/finder/availability). They are useful for understanding why things were built the way they were.
