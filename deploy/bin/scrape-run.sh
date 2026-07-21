#!/usr/bin/env bash
# Hourly scrape wrapper (systemd: hledsluverd-scrape.service).
# Shares /srv/hledsluverd/deploy.lock with deploy.sh so `npm ci` never rips
# node_modules out from under a running scrape. Optional healthchecks.io
# pings when HEALTHCHECKS_URL is set (comes via the unit's EnvironmentFile).
set -u
cd /srv/hledsluverd/app

hc() { # $1: "" (success) | /start | /fail
	[ -n "${HEALTHCHECKS_URL:-}" ] || return 0
	curl -fsS -m 10 --retry 3 -o /dev/null "${HEALTHCHECKS_URL}$1" || true
}

hc /start
flock -w 900 /srv/hledsluverd/deploy.lock npm run scrape
rc=$?
# scripts/scrape.ts exits 1 when any scraper failed, so the fail ping and the
# unit's failed state come for free; detailed ntfy alerts fire in the runner.
if [ "$rc" -eq 0 ]; then hc ""; else hc /fail; fi
exit "$rc"
