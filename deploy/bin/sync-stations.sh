#!/usr/bin/env bash
# Daily station sync (systemd: hledsluverd-sync.service): adds new Tesla
# Superchargers (supercharge.info) and new stations of e1-platform networks
# (e1 public map), refreshes their connectors. The scripts push an ntfy note
# when something needs a human (a new Tesla station to price, a station that
# disappeared from its source). Shares deploy.lock with deploy.sh and scrapes.
set -u
cd /srv/hledsluverd/app || exit 1

rc=0
for job in sync:superchargers sync:e1; do
	if ! flock -w 900 /srv/hledsluverd/deploy.lock npm run --silent "$job"; then
		rc=1
		if [ -n "${NTFY_TOPIC:-}" ]; then
			curl -fsS -m 10 -o /dev/null -d "Stöðvasamstilling ($job) brást — journalctl -u hledsluverd-sync" \
				"https://ntfy.sh/${NTFY_TOPIC}" || true
		fi
	fi
done
exit "$rc"
