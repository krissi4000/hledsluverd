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

    npx vitest run                    # unit + DB tests (skip if DATABASE_URL_TEST unset)
    npx playwright install chromium   # one-time browser download, before the first E2E run
    npx playwright test               # E2E against a production build (needs seeded dev DB)

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

## Data notes

- `prices` is append-only — it doubles as the price-history/trend dataset. All price
  writes go through `insertPriceIfChanged` (plausibility guard, change detection).
- Station data seeds from Open Charge Map; re-running `seed:ocm` is idempotent and
  prints unmatched operators for review.
- Initial prices in `seeds/prices-initial.json` were verified by hand against operator
  websites on the date in git history. The scrapers above keep prices current.
