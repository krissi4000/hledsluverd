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

## Data notes

- `prices` is append-only — it doubles as the price-history/trend dataset. All price
  writes go through `insertPriceIfChanged` (plausibility guard, change detection).
- Station data seeds from Open Charge Map; re-running `seed:ocm` is idempotent and
  prints unmatched operators for review.
- Initial prices in `seeds/prices-initial.json` were verified by hand against operator
  websites on the date in git history. Scrapers arrive in Phase 2.
