#!/usr/bin/env bash
# Nightly pg_dump (systemd: hledsluverd-backup.service). Runs as the
# hledsluverd user over the unix socket (peer auth — no password involved).
# Keeps 14 days locally; off-box copy procedure lives in docs/deploy.md.
# The price history is irreplaceable — it exists only because we recorded it.
set -euo pipefail

BACKUP_DIR=/srv/hledsluverd/backups
OUT="$BACKUP_DIR/hledsluverd_$(date +%Y-%m-%d_%H%M).dump"

hc() { # $1: "" (success) | /start | /fail
	[ -n "${HEALTHCHECKS_BACKUP_URL:-}" ] || return 0
	curl -fsS -m 10 --retry 3 -o /dev/null "${HEALTHCHECKS_BACKUP_URL}$1" || true
}

fail() {
	rm -f "$OUT.tmp"
	hc /fail
	exit 1
}
trap fail ERR

hc /start
# tmp + mv so the retention sweep never keeps a truncated dump
pg_dump -Fc --dbname=hledsluverd --file="$OUT.tmp"
mv "$OUT.tmp" "$OUT"
find "$BACKUP_DIR" -name 'hledsluverd_*.dump' -type f -mtime +14 -delete
hc ""
