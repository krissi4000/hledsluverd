#!/usr/bin/env bash
# One-time (but re-runnable) server bootstrap for hledsluverd.is.
# Run as root on a fresh Debian 12/13 Hetzner VPS:
#   scp deploy/setup-server.sh root@<ip>: && ssh root@<ip> bash setup-server.sh
#
# The FIRST run stops after printing the GitHub deploy key — add it to the
# repo (Settings → Deploy keys, read-only) and re-run to completion. Every
# step is guarded, so re-running is always safe. Full runbook: docs/deploy.md.
set -euo pipefail

REPO=git@github.com:krissi4000/hledsluverd.git
APP_USER=hledsluverd
HOME_DIR=/srv/hledsluverd
APP_DIR=$HOME_DIR/app
DB_NAME=hledsluverd

[ "$(id -u)" -eq 0 ] || {
	echo "run as root" >&2
	exit 1
}
. /etc/os-release
[ "$ID" = debian ] || {
	echo "Debian only (got $ID)" >&2
	exit 1
}

echo "== base packages"
apt-get update
apt-get install -y curl git gnupg ca-certificates apt-transport-https \
	debian-keyring debian-archive-keyring

echo "== 2G swapfile (vite-build insurance on a 4 GB box)"
if [ ! -f /swapfile ]; then
	fallocate -l 2G /swapfile
	chmod 600 /swapfile
	mkswap /swapfile
	swapon /swapfile
	echo '/swapfile none swap sw 0 0' >>/etc/fstab
fi

echo "== PostgreSQL 17 + PostGIS (PGDG repo — Debian 12 only ships pg15)"
PGDG_KEY=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
if [ ! -f "$PGDG_KEY" ]; then
	install -d /usr/share/postgresql-common/pgdg
	curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o "$PGDG_KEY"
	echo "deb [signed-by=$PGDG_KEY] https://apt.postgresql.org/pub/repos/apt $VERSION_CODENAME-pgdg main" \
		>/etc/apt/sources.list.d/pgdg.list
	apt-get update
fi
apt-get install -y postgresql-17 postgresql-17-postgis-3

echo "== Node 24 (NodeSource → /usr/bin/node; never install nvm on this box)"
if ! command -v node >/dev/null 2>&1 ||
	! node -e 'process.exit(+process.versions.node.split(".")[0] >= 20 ? 0 : 1)'; then
	curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
	apt-get install -y nodejs
fi

echo "== Caddy (official apt repo)"
if [ ! -f /usr/share/keyrings/caddy-stable-archive-keyring.gpg ]; then
	curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' |
		gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
	curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
		>/etc/apt/sources.list.d/caddy-stable.list
	apt-get update
fi
apt-get install -y caddy

echo "== service user + directories"
id $APP_USER >/dev/null 2>&1 ||
	useradd --system --create-home --home-dir $HOME_DIR --shell /bin/bash $APP_USER
# deploy.sh prints app logs into the Action output on a failed health check
usermod -aG systemd-journal $APP_USER
install -d -o $APP_USER -g $APP_USER -m 700 $HOME_DIR/backups

echo "== postgres role + database (password is set manually — see runbook)"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$APP_USER'" | grep -q 1 ||
	sudo -u postgres psql -c "CREATE ROLE $APP_USER LOGIN"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 ||
	sudo -u postgres createdb -O $APP_USER $DB_NAME
# superuser creates the extension so migrations never need elevated rights
sudo -u postgres psql -d $DB_NAME -c "CREATE EXTENSION IF NOT EXISTS postgis"

echo "== deploy key + clone"
sudo -u $APP_USER install -d -m 700 $HOME_DIR/.ssh
if [ ! -f $HOME_DIR/.ssh/id_ed25519 ]; then
	sudo -u $APP_USER ssh-keygen -t ed25519 -N '' -f $HOME_DIR/.ssh/id_ed25519 -C hledsluverd-deploy
fi
sudo -u $APP_USER bash -c \
	"ssh-keyscan github.com 2>/dev/null >>$HOME_DIR/.ssh/known_hosts &&
	 sort -u -o $HOME_DIR/.ssh/known_hosts $HOME_DIR/.ssh/known_hosts"
if [ ! -d $APP_DIR/.git ]; then
	if ! sudo -u $APP_USER git clone $REPO $APP_DIR; then
		echo
		echo "Clone failed. Add this READ-ONLY deploy key to the GitHub repo"
		echo "(Settings → Deploy keys), then re-run this script:"
		echo
		cat $HOME_DIR/.ssh/id_ed25519.pub
		exit 1
	fi
fi

echo "== app dependencies + Playwright Chromium (Orkan scraper)"
sudo -u $APP_USER bash -lc "cd $APP_DIR && npm ci"
# system libraries as root; the browser itself as the service user
# (lands in $HOME_DIR/.cache/ms-playwright — survives npm ci and git reset)
"$APP_DIR/node_modules/.bin/playwright" install-deps chromium
sudo -u $APP_USER bash -lc "cd $APP_DIR && npx playwright install chromium"

echo "== sudoers: allow exactly one restart command"
SUDOERS_TMP=$(mktemp)
echo "$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart hledsluverd.service" >"$SUDOERS_TMP"
visudo -cf "$SUDOERS_TMP"
install -m 440 "$SUDOERS_TMP" /etc/sudoers.d/hledsluverd
rm -f "$SUDOERS_TMP"

echo "== systemd units + timers"
cp $APP_DIR/deploy/systemd/hledsluverd.service \
	$APP_DIR/deploy/systemd/hledsluverd-scrape.service \
	$APP_DIR/deploy/systemd/hledsluverd-scrape.timer \
	$APP_DIR/deploy/systemd/hledsluverd-backup.service \
	$APP_DIR/deploy/systemd/hledsluverd-backup.timer \
	/etc/systemd/system/
systemctl daemon-reload
# NOT --now: there is no build yet — the first deploy.sh run builds and starts
systemctl enable hledsluverd.service
systemctl enable --now hledsluverd-scrape.timer hledsluverd-backup.timer

echo "== Caddyfile"
grep -q hledsluverd.is /etc/caddy/Caddyfile 2>/dev/null ||
	cp $APP_DIR/deploy/Caddyfile /etc/caddy/Caddyfile
if caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1; then
	systemctl reload caddy
else
	echo "WARN: /etc/caddy/Caddyfile does not validate yet — replace the"
	echo "      REPLACE_WITH_BCRYPT_HASH placeholder (caddy hash-password),"
	echo "      then: systemctl reload caddy"
fi

echo
echo "Setup done. Next steps (details in docs/deploy.md):"
echo "  1. create $APP_DIR/.env (owner $APP_USER, chmod 600)"
echo "  2. set the DB password:"
echo "       sudo -u postgres psql -c \"ALTER ROLE $APP_USER PASSWORD '<hex>'\""
echo "  3. caddy hash-password → edit /etc/caddy/Caddyfile → systemctl reload caddy"
echo "  4. first deploy: sudo -u $APP_USER bash $APP_DIR/deploy/deploy.sh"
echo "  5. seed the database (runbook §7)"
