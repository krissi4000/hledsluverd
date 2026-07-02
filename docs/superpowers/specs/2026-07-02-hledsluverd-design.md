# Hleðsluverð — Design Document

**Date:** 2026-07-02
**Status:** Approved pending final review
**Scope:** v1 of a public website comparing EV charging prices in Iceland

## 1. Overview

Hleðsluverð is a public website for EV drivers in Iceland (locals and tourists) that answers three questions:

1. **Who charges what?** — current price per kWh for every charging network, and a list of all stations sorted by cheapest.
2. **How have prices moved?** — a price-history graph per network.
3. **Where can *my* car charge near me?** — a map finder that filters stations by the user's car model (connector compatibility) and shows the price and the car's effective charging speed at each station.

No Icelandic operator publishes a pricing API, and nobody publishes price history. The site's core asset is therefore its own database: scrapers record operator prices over time, which simultaneously powers the "current price" comparison and the trend graph.

**Networks covered:** ON (Orka náttúrunnar), Ísorka, N1, e1, Orkan, Tesla.

**Languages:** Icelandic (default) and English, via a toggle. Built in from the start.

**Prices shown** are standard pay-as-you-go consumer rates including VAT. Subscription/membership discounts are out of scope for v1 (listed in §12).

## 2. Architecture

Everything runs on one small VPS (Hetzner, ~€5/mo, Debian):

- **Caddy** — reverse proxy; automatic HTTPS (Let's Encrypt); serves the self-hosted map tile file directly.
- **SvelteKit app** (TypeScript, one Node process, systemd service) — server-rendered pages, JSON API, and admin page.
- **PostgreSQL + PostGIS** — all data. Nightly `pg_dump` backups.
- **Scraper job** — a separate entry point in the same codebase, run hourly by a systemd timer.
- **Map tiles** — a PMTiles extract of Iceland from OpenStreetMap (~100 MB, one file, self-hosted; no tile-provider keys, limits, or fees), rendered client-side with MapLibre GL.

**Core principle: visitors never wait on external services.** Every page reads only from Postgres. Scrapers and the availability fetcher write into Postgres on their own schedules. If an operator's website or TomTom is down, the site stays up and serves the last known data with honest freshness labels.

Key libraries: Drizzle ORM (Postgres access), cheerio (HTML parsing in scrapers), MapLibre GL + PMTiles (map), Chart.js (trend graph, stepped-line), Paraglide (i18n).

## 3. Data model

Seven tables. `→` marks a foreign key.

**networks** — the ~6 charging companies.
`id, name, slug, website_url, scraper_id`

**stations** — ~350 physical locations.
`id, network_id →, name, address, location (PostGIS point), external_ids (jsonb: {ocm, tomtom}), is_active, created_at, updated_at`

**connectors** — what plugs a station has, aggregated (e.g. "4× CCS2 @ 150 kW"), not individual plug records.
`id, station_id →, type (CCS2 | CHAdeMO | Type2), power_kw, count`

**prices** — append-only price history. This table **is** the trend graph.
`id, network_id →, station_id → (nullable; NULL = network-wide, set only for rare per-location exceptions), tariff_key, price_isk_per_kwh, minute_fee_isk (nullable), valid_from, source (scraper | manual), verified_at, created_at`

- Rows are never updated except `verified_at` (bumped when a scrape or human confirms the price is still correct).
- Current price = newest row per (network, tariff_key). History = all rows, plotted as a stepped line.
- `tariff_key` convention: `'AC'`, `'DC'`, `'DC_150'` (150 kW and above, for networks that price high-power charging differently).

**availability** — cache of live charger status; latest only, no history.
`station_id → (primary key), free_count, total_count, per_type (jsonb), fetched_at, source`

**cars** — standalone lookup, seeded from open-ev-data.
`id, make, model, variant, ac_connector, max_ac_kw, dc_connector (CCS2 | CHAdeMO | none), max_dc_kw, slug`

**scrape_runs** — ops log; powers freshness labels and admin alerts.
`id, network_id →, started_at, status (ok | changed | failed), message`

**Derivation rules:**
- A station's displayed price = its network's current price for the tariff matching the connector in question (Type2 → `AC`; CCS2/CHAdeMO → `DC`, or `DC_150` when `power_kw ≥ 150` and the network defines that tier; otherwise fall back to `DC`).
- Car ↔ station match = station has ≥1 connector whose `type` equals the car's `ac_connector` or `dc_connector`.
- Effective charging speed = `min(car max kW, connector power_kw)` for the matching connector kind.

## 4. Data collection

### 4.1 Price scrapers

One module per network, common interface: `scrape(): Promise<TariffReading[]>` where a reading is `{tariff_key, price_isk_per_kwh, minute_fee_isk?}`.

Hourly runner, per network:
1. Run the scraper (prefer operators' internal JSON endpoints over HTML parsing where they exist — far more robust).
2. **Plausibility guard:** any price outside 10–200 ISK/kWh is treated as a parse error, not a price.
3. If a reading differs from the current price → insert a new `prices` row (`source='scraper'`, `valid_from=now`, `verified_at=now`). If unchanged → bump `verified_at` on the current row.
4. Log the run to `scrape_runs` (ok/changed/failed + message).

**Fail loudly, never guess:** a scraper that cannot confidently parse returns failure. A failed run leaves yesterday's price in place (correct behavior); a guessed parse could publish a wrong price (the one unforgivable failure for a comparison site).

Manual path: the admin page inserts `source='manual'` rows — both for overrides while a scraper is broken and for corrections.

### 4.2 Station seeding and upkeep

- One-time import from Open Charge Map (Iceland, ~350 stations) into `stations` + `connectors`, storing OCM ids in `external_ids`.
- OCM is crowdsourced and imperfect → admin page supports editing, deactivating, and adding stations.
- Weekly OCM re-sync **proposes diffs** (new/changed stations) as an admin review list; it never silently overwrites curated data.

### 4.3 Availability (best-effort, via TomTom)

- Seed-time script matches stations to TomTom ids by coordinates; ambiguous matches go to a manual review list. Unmatched stations simply never show availability.
- Runtime: when a user opens the map or a station page, availability entries older than 5 minutes for the stations in view are refreshed from TomTom's EV availability API and written to the `availability` cache.
- A daily request-budget counter stops calls just short of the free-tier limit; after that, cached values are served with their age label.

### 4.4 Car data

One-time import of the open-ev-data dataset (make, model, variant, connectors, max AC/DC power); re-run occasionally by hand. Verify the dataset's license permits this use before shipping (task in the implementation plan).

## 5. Pages & UX

Layout decision (from mockup review): **rate card + station list** homepage.

**Homepage `/`** — server-rendered, works without JavaScript:
- Top: rate-card strip — one card per network with its current DC and AC prices, sorted cheapest-first, cheapest highlighted.
- Below: full station table — columns: station, network, price/kWh, connectors (type × count chips), free chargers. Default sort: price under the selected mode. Mode toggle DC (default) / AC. Filters: connector type, network, "near me" (geolocation, optional).
- Every price shows compactly when it was last verified. Where a network charges a per-minute fee, it is shown next to the kWh price (sorting is always by kWh price).
- Mobile-first: the table collapses to stacked rows on narrow screens.

**Station page `/stod/[slug]`** — name, network, address, mini-map, connectors with power, current price(s), availability ("3/4 free, as of 2 min ago") when known, the network's price-trend graph, directions link (hands off to Google Maps).

**Map page `/kort`** — full-screen MapLibre map of Iceland, every active station as a pin labeled with its price; pin tap opens a mini-card (name, network, price, connectors, availability, link to station page).

**Finder `/bilaleit`** —
1. Pick car: searchable make/model list; remembered in localStorage. Fallback for missing cars: pick a plug type directly (CCS2/CHAdeMO/Type2) instead.
2. Location: browser geolocation if granted; if denied, tap the map to set a location. No geocoding service in v1; nothing about location is stored server-side.
3. Map shows only compatible stations, pins labeled with price; mini-card additionally shows the car's effective charging speed at that station ("up to 130 kW for your car").

**Trends `/verdthroun`** — stepped-line chart of price history, one line per network (DC by default, AC toggle), built from the `prices` table.

**Admin `/admin`** — protected by basic-auth configured in Caddy (auth stays out of app code). Capabilities: insert manual price rows, bump `verified_at`, edit/deactivate/add stations, review OCM sync diffs, view `scrape_runs` health per network.

**i18n:** Icelandic default, English toggle; all UI strings via Paraglide message files. Station/network names are proper nouns and untranslated. URLs stay Icelandic.

## 6. Degraded states (the honesty rules)

| Situation | Behavior |
|---|---|
| Price unverified > 30 days | Price still shown, with an amber "last verified" warning |
| Scraper failing | Site serves last known price; admin shows red badge with days-since-success; ntfy push notification after 3 consecutive failures |
| No availability data for a station | Show "—", never "0" (0 would mean "all busy") |
| Availability present | Always shown with its age ("as of 2 min ago") |
| TomTom down / budget spent | Serve cached values with age label; no errors surfaced |
| Geolocation denied | Manual location by tapping the map |
| Car not in list | Direct plug-type picker fallback |
| JavaScript disabled | Homepage fully works (SSR); map/finder require JS |

## 7. Testing

- **Scraper fixtures (highest priority):** each scraper is tested against saved snapshots of the operator's real pages; the parser must extract known values. Site redesign → save new fixture, fix parser, old fixtures guard against regression. Also: plausibility guard rejects garbage; parse failure never writes a price.
- **Logic tests:** current-price and history queries, car↔station matching, effective-speed calculation, nearest-station sorting.
- **E2E (Playwright, ~5 flows):** homepage renders sorted list; filters work; finder flow with mocked geolocation; language toggle; station page renders graph.
- The hourly scrape acts as a continuous live test — failures land in `scrape_runs` and notify.
- TDD throughout implementation.

## 8. Deployment & operations

- **Server:** smallest Hetzner VPS (4 GB), Debian. Caddy, Node, Postgres installed natively (no Docker); app and scraper run under systemd (service + timer). A re-runnable, documented setup script lives in the repo.
- **Deploys:** push to GitHub → GitHub Action builds and deploys over SSH, restarts the service.
- **Backups:** nightly `pg_dump`, 14 days retained locally, documented off-box copy procedure. The price history is irreplaceable — it exists only because we recorded it.
- **Monitoring:** healthchecks.io (or similar) pings for site uptime and scrape-job liveness; scraper-failure notifications per §6.
- **Domain:** registered by owner (e.g. `hledsluverd.is` via ISNIC); Caddy auto-provisions the certificate.
- **Analytics (optional, any time):** GoatCounter or Plausible — privacy-friendly, no cookie banner.

## 9. Project structure

One SvelteKit repo:

```
src/
  lib/
    server/
      db/          # Drizzle schema + queries
      scrapers/    # one module per network + shared runner
      tomtom.ts    # availability fetcher + budget counter
      matching.ts  # car↔station rules, effective speed
    i18n/          # Paraglide messages (is, en)
    components/    # rate card, station table, map, graph, mini-card
  routes/
    +page.svelte           # homepage
    stod/[slug]/
    kort/
    bilaleit/
    verdthroun/
    admin/
    api/availability/
scripts/
  seed-ocm.ts, seed-cars.ts, match-tomtom.ts, setup-server.sh
static/            # PMTiles file lives on the server, not in git
```

## 10. Risks

1. **TomTom coverage of Icelandic networks is unverified.** Mitigation: validate as the first availability task (spike); the feature is best-effort by design and the site is valuable without it.
2. **Scraper maintenance is forever.** Every operator redesign breaks a parser. Mitigation: fail-loud design, fixtures, manual-override path, staleness labels.
3. **Open Charge Map data quality.** Mitigation: admin curation, review-based re-sync.
4. **open-ev-data license** must be confirmed before shipping.
5. **Tesla specifics:** some Icelandic Superchargers are non-Tesla-accessible, some not; Tesla pricing is app-based and may resist scraping. Verify during seeding; worst case, Tesla prices are maintained manually.

## 11. Success criteria

- Homepage shows a correct, price-sorted station list with no JavaScript and loads fast on mobile.
- Prices match operator websites (spot-check), and every price shows when it was last verified.
- Trend graph reflects every price change since launch.
- A user with any common EV model can find compatible nearby stations with prices and their effective charge speed.
- A broken scraper never publishes a wrong price and always notifies the operator.

## 12. Out of scope for v1

- Accounts, favorites, saved locations
- Subscription/membership tariff comparison
- Charging-session cost/time calculator (10→80%)
- Route planning; geocoded place search
- Availability history/statistics
- Native mobile apps
- Operator partnerships / official data feeds (worth pursuing later — a small market where operators might cooperate)
