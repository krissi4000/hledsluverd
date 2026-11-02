#!/usr/bin/env bash
# One-time (but re-runnable) server bootstrap for hledsluverd.is.
# Run as root on a fresh Debian 13 (or 12) netcup VPS (x86):
#   ssh-copy-id root@<ip>   # FIRST — the script disables SSH password auth
#   scp deploy/setup-server.sh root@<ip>: && ssh root@<ip> bash setup-server.sh
#
# netcup has no cloud firewall in front of the box, so this script sets up a
# host firewall (nftables: inbound 22/80/443 only) and SSH key-only login.
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
	debian-keyring debian-archive-keyring nftables

echo "== host firewall (nftables: inbound 22/80/443 only, IPv4 + IPv6)"
# netcup offers no cloud firewall we rely on, so the box filters itself.
# Lockout safety: the ruleset is loaded atomically (nft -f), and the same
# transaction that sets policy drop also accepts established/related traffic
# (= this SSH session) and every port sshd actually listens on (22 unless
# changed). It is validated with nft -c before loading. Postgres listens on
# localhost only, so it is unreachable from outside regardless. `flush ruleset`
# owns the whole ruleset — fine on this single-purpose box (no Docker etc.).
# udp/443 is HTTP/3, which Caddy serves by default.
SSH_PORTS=$({ sshd -T 2>/dev/null || true; } | awk '$1 == "port" { print $2 }' | sort -un | paste -sd, -)
SSH_PORTS=${SSH_PORTS:-22}
case ",$SSH_PORTS," in *,22,*) ;; *) SSH_PORTS="22,$SSH_PORTS" ;; esac
NFT_TMP=$(mktemp)
cat >"$NFT_TMP" <<EOF
#!/usr/sbin/nft -f
# Managed by hledsluverd deploy/setup-server.sh — re-running it overwrites this.
flush ruleset

table inet filter {
	chain input {
		type filter hook input priority filter; policy drop;
		ct state established,related accept
		ct state invalid drop
		iif lo accept
		meta l4proto icmp accept
		meta l4proto ipv6-icmp accept
		tcp dport { $SSH_PORTS, 80, 443 } accept
		udp dport 443 accept comment "HTTP/3 (Caddy)"
	}
	chain forward {
		type filter hook forward priority filter; policy drop;
	}
	chain output {
		type filter hook output priority filter; policy accept;
	}
}
EOF
nft -c -f "$NFT_TMP"
if ! cmp -s "$NFT_TMP" /etc/nftables.conf || ! nft list table inet filter >/dev/null 2>&1; then
	install -m 755 "$NFT_TMP" /etc/nftables.conf
	nft -f /etc/nftables.conf
fi
rm -f "$NFT_TMP"
systemctl enable nftables.service
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep 'Status: active' >/dev/null; then
	echo "WARN: ufw is also active — disable it (ufw disable) so only nftables.conf applies"
fi

echo "== SSH: key-only login (only if root has an authorized key)"
# netcup mails a root password; once your key is installed (ssh-copy-id,
# runbook §4) password logins are just a brute-force target. 00- sorts before
# any image/cloud-init drop-in, and sshd keeps the first value it reads.
SSHD_DROPIN=/etc/ssh/sshd_config.d/00-hledsluverd.conf
if grep -qE '^[[:space:]]*(ssh-|ecdsa-|sk-)' /root/.ssh/authorized_keys 2>/dev/null; then
	SSHD_TMP=$(mktemp)
	printf '%s\n' \
		'# Managed by hledsluverd deploy/setup-server.sh' \
		'PasswordAuthentication no' \
		'KbdInteractiveAuthentication no' \
		'PermitRootLogin prohibit-password' >"$SSHD_TMP"
	if ! cmp -s "$SSHD_TMP" "$SSHD_DROPIN"; then
		install -m 644 "$SSHD_TMP" "$SSHD_DROPIN"
		if sshd -t; then
			# reload keeps existing sessions; only new logins see the change
			# (try-: with socket activation each login reads the config anew)
			systemctl try-reload-or-restart ssh.service
		else
			echo "WARN: sshd -t failed — removing $SSHD_DROPIN, SSH config unchanged" >&2
			rm -f "$SSHD_DROPIN"
		fi
	fi
	rm -f "$SSHD_TMP"
else
	echo "WARN: /root/.ssh/authorized_keys has no key — NOT disabling password"
	echo "      auth. Run ssh-copy-id root@<ip> from your machine, then re-run."
fi

# vite build + Playwright Chromium + Postgres can spike past RAM on small
# boxes; swap is OOM insurance, not working memory. ≤4 GB RAM (MemTotal reads
# a bit under nominal, hence the 5 GiB cutoff) → 2G; bigger boxes have the
# headroom already, so 1G just catches spikes without eating much disk.
MEM_KB=$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)
if [ "$MEM_KB" -le $((5 * 1024 * 1024)) ]; then SWAP_SIZE=2G; else SWAP_SIZE=1G; fi
echo "== swapfile ($SWAP_SIZE for $((MEM_KB / 1024)) MiB RAM; kept as-is if it exists)"
if [ ! -f /swapfile ]; then
	fallocate -l $SWAP_SIZE /swapfile
	chmod 600 /swapfile
	mkswap /swapfile
fi
swapon --show=NAME --noheadings | grep -x /swapfile >/dev/null || swapon /swapfile
grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab

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
# DRY RUN ONLY (.github/workflows/deploy-dryrun.yml, no GitHub deploy key in
# CI): HLEDSLUVERD_DRYRUN_SRC=<local git repo> clones its `main` from that path
# instead, so the deploy-key stop below never triggers (deploy.sh then fetches
# from the same path). Never set it on a real server — unset = unchanged.
if [ -n "${HLEDSLUVERD_DRYRUN_SRC:-}" ] && [ ! -d $APP_DIR/.git ]; then
	echo "DRY RUN: cloning $HLEDSLUVERD_DRYRUN_SRC instead of $REPO"
	sudo -u $APP_USER git clone --branch main "$HLEDSLUVERD_DRYRUN_SRC" $APP_DIR
fi
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
