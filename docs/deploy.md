# Deployment runbook — hledsluverd.is

From zero to a running production site. Every server-side file referenced here
lives in `deploy/` in this repo. The deployed price history is irreplaceable —
treat the database (and its backups) accordingly.

## 1. Architecture

```
ISNIC (hledsluverd.is) → Cloudflare DNS (grey-cloud, DNS only)
                              │ A @ → VPS IP, CNAME www → @
                              ▼
                 Hetzner VPS (Debian, 4 GB)
  ┌─────────────────────────────────────────────────────┐
  │ Caddy :443  — auto-HTTPS, basic_auth /admin*,       │
  │               www → bare-domain redirect            │
  │    └─→ node build/index.js :3000  (systemd:         │
  │         hledsluverd.service, EnvironmentFile=.env)  │
  │            └─→ PostgreSQL 17 + PostGIS (localhost)  │
  │ hledsluverd-scrape.timer  — hourly npm run scrape   │
  │ hledsluverd-backup.timer  — nightly pg_dump, 14 d   │
  └─────────────────────────────────────────────────────┘
              ▲
  GitHub Actions (push to main) — ssh → deploy/deploy.sh
```

App layout on the server: user `hledsluverd`, home `/srv/hledsluverd`,
checkout at `/srv/hledsluverd/app`, backups at `/srv/hledsluverd/backups`,
Playwright browsers at `/srv/hledsluverd/.cache/ms-playwright`.

## 2. Provision the VPS

- Hetzner Cloud → **CX22** (2 vCPU, 4 GB, x86 — avoid Arm/CAX so Playwright
  Chromium stays boring), image **Debian 13** (12 also works).
- Add your personal SSH key at creation.
- Attach a **Hetzner Cloud Firewall**: inbound TCP 22, 80, 443 only. (No ufw
  on the box — one less way to lock yourself out; Postgres binds localhost.)

## 3. DNS (ISNIC → Cloudflare)

1. Create a free Cloudflare account, add zone `hledsluverd.is`.
2. Records: `A @ → <VPS IP>` and `CNAME www → hledsluverd.is`, both
   **DNS only (grey cloud)** — orange-cloud proxying would put Cloudflare
   certs/caching in front of Caddy's ACME and basic_auth.
3. At ISNIC, set the two nameservers Cloudflare assigned (Cloudflare answers
   authoritatively immediately, which passes ISNIC's zone checks).
4. Caddy retries ACME automatically until the delegation propagates — no need
   to wait before continuing.

## 4. Bootstrap the server

```sh
scp deploy/setup-server.sh root@<ip>:
ssh root@<ip> bash setup-server.sh
```

The **first run stops on purpose** after printing an ed25519 public key: add
it on GitHub → repo Settings → Deploy keys → "Add deploy key" (read-only,
name it `hledsluverd-vps`), then **re-run the script** — it continues where it
left off (every step is guarded; the script is safe to re-run any time).

The script installs PGDG PostgreSQL 17 + PostGIS, NodeSource Node 24, Caddy,
creates the `hledsluverd` user/db/role, clones the repo, installs deps +
Chromium, installs the systemd units and enables the timers, and copies the
Caddyfile template. It does **not** start the app (nothing is built yet) and
Caddy will warn until the basic-auth hash is set — both by design.

## 5. Create `.env`

As root (or via `sudo -u hledsluverd -i`):

```sh
openssl rand -hex 24   # → <dbpass>, used twice below
sudo -u postgres psql -c "ALTER ROLE hledsluverd PASSWORD '<dbpass>'"

cat >/srv/hledsluverd/app/.env <<'EOF'
DATABASE_URL=postgres://hledsluverd:<dbpass>@127.0.0.1:5432/hledsluverd
OCM_API_KEY=<key from openchargemap.org>
NTFY_TOPIC=<your ntfy.sh topic>
TOMTOM_API_KEY=<key from developer.tomtom.com, free tier>
HEALTHCHECKS_URL=<scrape check ping URL, §9 — add later is fine>
HEALTHCHECKS_BACKUP_URL=<backup check ping URL, §9 — add later is fine>
EOF
chown hledsluverd:hledsluverd /srv/hledsluverd/app/.env
chmod 600 /srv/hledsluverd/app/.env
```

Formatting rules (this file is parsed by BOTH dotenv and systemd
`EnvironmentFile=`): plain `KEY=value` lines only — no `export`, no quotes,
no `$VAR` expansion, no `#` or spaces inside values. Hex secrets satisfy this
automatically. `HOST`/`PORT`/`ORIGIN` have correct defaults baked into the
systemd unit; only set them here to override.

## 6. Caddy: admin password + TLS

```sh
caddy hash-password          # prompts; outputs $2a$14$...
nano /etc/caddy/Caddyfile    # paste the hash over REPLACE_WITH_BCRYPT_HASH
systemctl reload caddy
```

Paste by editing the file — never pass the `$2a$...` hash through a
double-quoted shell string (the `$` fragments get expanded). Caddy refuses to
load the config until the placeholder is replaced; that is the guarantee that
`/admin` can never go live unprotected.

Verify (after DNS resolves):

```sh
curl -I  https://hledsluverd.is           # 200
curl -I  https://www.hledsluverd.is       # 308 → https://hledsluverd.is/
curl -I  https://hledsluverd.is/admin     # 401
curl -I -u admin:<pw> https://hledsluverd.is/admin   # 200
```

## 7. First deploy + seed

```sh
sudo -u hledsluverd bash /srv/hledsluverd/app/deploy/deploy.sh
```

That builds, migrates, starts the app and health-checks :3000. Then seed, as
`hledsluverd`, in `/srv/hledsluverd/app`, **in this order**:

```sh
npm run seed:networks
npm run seed:ocm        # needs OCM_API_KEY; prints unmatched operators — review
npm run seed:prices
npm run seed:cars
npm run match:virta
npm run match:n1        # REVIEW the printed matches before trusting them
npm run match:tomtom    # needs TOMTOM_API_KEY; prints ~24 AMBIGUOUS stations
```

Hand-stamping the AMBIGUOUS TomTom stations (each line lists the candidate
POI ids with distances — pick the right one, e.g. via the TomTom map):

```sh
psql -d hledsluverd   # peer auth as the hledsluverd user, no password
```

```sql
UPDATE stations
SET external_ids = external_ids || jsonb_build_object('tomtom', '<poi-id>')
WHERE slug = '<station-slug>';
```

Re-running `match:tomtom` any time regenerates the AMBIGUOUS list; stations
already stamped (by the script or by hand) are kept, never re-stamped.

## 8. CI auto-deploy (GitHub Actions)

Two keypairs are involved — do not mix them up:

| Keypair         | Private key lives       | Public key goes to                  |
| --------------- | ----------------------- | ----------------------------------- |
| server → GitHub | VPS `~/.ssh/id_ed25519` | GitHub repo Deploy keys (read-only) |
| CI → server     | GitHub secret           | VPS `~/.ssh/authorized_keys`        |

The first one was created by `setup-server.sh` in §4. Create the second one
locally:

```sh
ssh-keygen -t ed25519 -N '' -f ci_deploy_key -C hledsluverd-ci
ssh root@<ip> 'cat >> /srv/hledsluverd/.ssh/authorized_keys && chown hledsluverd:hledsluverd /srv/hledsluverd/.ssh/authorized_keys && chmod 600 /srv/hledsluverd/.ssh/authorized_keys' < ci_deploy_key.pub
ssh-keyscan -H <ip>       # → value for SSH_KNOWN_HOSTS
```

GitHub → repo Settings → Secrets and variables → Actions:

- Secrets: `SSH_HOST` = VPS IP, `SSH_USER` = `hledsluverd`,
  `SSH_PRIVATE_KEY` = contents of `ci_deploy_key`,
  `SSH_KNOWN_HOSTS` = the `ssh-keyscan -H` output.
- **Variable** `DEPLOY_ENABLED` = `true` — arms the deploy job (set to
  anything else to pause deploys; the test job always runs). Delete the local
  `ci_deploy_key` files once the secret is stored.

From then on: push to `main` → lint/check/tests/build → ssh → `deploy.sh`
(fetch, `npm ci`, build, migrate, restart, health check). Manual deploy is the
same script: `sudo -u hledsluverd bash /srv/hledsluverd/app/deploy/deploy.sh`.

## 9. Monitoring

- **healthchecks.io** (free, passive dead-man switches — it cannot probe the
  site): check `hledsluverd-scrape`, period 1 h, grace 30 min (must exceed the
  timer's 5-min RandomizedDelaySec + scrape runtime); check
  `hledsluverd-backup`, period 1 day, grace 2 h. Paste the two ping URLs into
  `.env` (§5) — the wrapper scripts ping start/success/fail automatically.
- **Site uptime**: an active prober, e.g. UptimeRobot free — HTTPS monitor on
  `https://hledsluverd.is/`.
- **Scraper failures**: ntfy push after 3 consecutive failures per network is
  already built into the app (`NTFY_TOPIC`); scraper health is also on
  `/admin`.

## 10. Backups: off-box copy + restore

Nightly `pg_dump -Fc` → `/srv/hledsluverd/backups/`, 14 days retained. Copy
off-box regularly (from your machine — your key is in root's
`authorized_keys`; add it to hledsluverd's to scp as that user):

```sh
scp root@<ip>:'/srv/hledsluverd/backups/hledsluverd_*.dump' ./offsite/
```

Restore drill (practice this once before launch):

```sh
systemctl stop hledsluverd hledsluverd-scrape.timer hledsluverd-backup.timer
sudo -u hledsluverd pg_restore --clean --if-exists -d hledsluverd <file>.dump
systemctl start hledsluverd hledsluverd-scrape.timer hledsluverd-backup.timer
```

`pg_restore --list <file>.dump` sanity-checks a dump without touching the db.

## 11. Ops cheatsheet

```sh
journalctl -u hledsluverd -f                     # app logs (live)
journalctl -u hledsluverd-scrape --since -2h     # last scrape output
systemctl status hledsluverd                     # app state
systemctl list-timers 'hledsluverd*'             # next scrape/backup runs
systemctl start hledsluverd-scrape.service       # run a scrape right now
systemctl start hledsluverd-backup.service       # run a backup right now
sudo -u hledsluverd bash /srv/hledsluverd/app/deploy/deploy.sh   # manual deploy
```

Notes:

- Changed a systemd unit or the Caddyfile template in the repo? They are NOT
  applied by deploy.sh (its sudo is restricted to exactly one restart
  command). As root: `cp /srv/hledsluverd/app/deploy/systemd/* /etc/systemd/system/ && systemctl daemon-reload`
  (and for Caddy, merge changes into `/etc/caddy/Caddyfile` by hand — it holds
  the real password hash).
- Never run `git` in the checkout as root (ownership breaks the deploy user);
  never install nvm (systemd units expect `/usr/bin/node`).
- Migrations run before the app restart in deploy.sh — fine for additive
  changes; a destructive migration needs a manual maintenance moment (stop
  timers, deploy, verify, restart).
- The TomTom availability budget counter is in-memory in the app process; runs
  fine because exactly one instance exists. Don't scale out without moving it.
- e1 and Tesla prices are maintained by hand on `/admin`; the >30-day amber
  staleness label on the site is the honesty backstop.
