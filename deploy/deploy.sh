#!/usr/bin/env bash
# Deploys the latest origin/main ON the server. Runs as the hledsluverd user —
# invoked by GitHub Actions over SSH, or manually:
#   sudo -u hledsluverd bash /srv/hledsluverd/app/deploy/deploy.sh
#
# NEVER add `git clean` here: .env and node_modules live untracked inside the
# checkout. Wrapped in main() so a mid-run self-update can't corrupt execution.
set -euo pipefail

main() {
	cd /srv/hledsluverd/app

	# Shared lock with scrape-run.sh: wait out an in-flight scrape (and block
	# concurrent deploys) so npm ci never swaps node_modules under Playwright.
	exec 9>/srv/hledsluverd/deploy.lock
	flock -w 900 9

	git fetch origin main
	git reset --hard origin/main

	npm ci
	npx playwright install chromium # instant no-op unless playwright was bumped
	npm run build
	npm run db:migrate # drizzle.config.ts reads .env via dotenv from cwd

	# The old process may briefly serve replaced build/ chunks until this
	# restart — accepted for v1 (no zero-downtime requirement).
	sudo /usr/bin/systemctl restart hledsluverd.service

	for _ in $(seq 1 30); do
		if curl -fsS -o /dev/null http://127.0.0.1:3000/; then
			echo "deploy OK: $(git rev-parse --short HEAD)"
			return 0
		fi
		sleep 1
	done

	echo "deploy FAILED: app did not answer on :3000 within 30s" >&2
	journalctl -u hledsluverd.service -n 50 --no-pager >&2 || true
	exit 1
}

main "$@"
