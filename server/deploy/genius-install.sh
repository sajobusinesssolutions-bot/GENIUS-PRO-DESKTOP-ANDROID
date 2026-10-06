#!/usr/bin/env bash
#
# REBUILDS the Genius API on a NEW, empty Ubuntu server from the nightly
# GitHub backup (genius-github-backup.sh). One command, as root:
#
#   bash genius-install.sh               newest backup
#   bash genius-install.sh 2026-10-05    the backup from that day
#
# It asks for two things only a person can give: two keys added on GitHub,
# and the backup passphrase. Everything else — packages, database, secrets,
# licence key, web server and HTTPS, the API and its nightly routines — comes
# back by itself. The last step, pointing the domain at this machine, is
# printed at the end.
#
set -euo pipefail

CODE_REPO=${GENIUS_CODE_REPO:-sajobusinesssolutions-bot/GENIUS-PRO-ANDROID}
BACKUP_REPO=${GENIUS_BACKUP_REPO_NAME:-sajobusinesssolutions-bot/GENIUS-SERVER-BACKUP}
REPO_DIR=/opt/genius/repo
APP_DIR=/opt/genius/api
WORKTREE=/var/lib/genius-github-backup
SECRETS_DIR=/etc/genius
PASSFILE=/root/.genius-backup-pass
DAY=${1:-}

say() { echo; echo "== $*"; }
die() { echo; echo "FAILED: $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "run as root"
export DEBIAN_FRONTEND=noninteractive

say "1/9  Installing the basics"
apt-get update -qq
apt-get install -y -qq postgresql postgresql-contrib gnupg curl rsync git openssh-client >/dev/null
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
id genius >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin genius
echo "node $(node -v), $(psql --version)"

say "2/9  Keys for GitHub"
mkdir -p /root/.ssh && chmod 700 /root/.ssh
[ -f /root/.ssh/genius_deploy ] || ssh-keygen -q -t ed25519 -N '' -f /root/.ssh/genius_deploy -C "genius-code-$(hostname)"
[ -f /root/.ssh/genius_backup ] || ssh-keygen -q -t ed25519 -N '' -f /root/.ssh/genius_backup -C "genius-backup-$(hostname)"
grep -q "Host github-genius$" /root/.ssh/config 2>/dev/null || cat >> /root/.ssh/config <<'EOF'
Host github-genius
  HostName github.com
  User git
  IdentityFile /root/.ssh/genius_deploy
  IdentitiesOnly yes
EOF
grep -q "Host github-genius-backup$" /root/.ssh/config 2>/dev/null || cat >> /root/.ssh/config <<'EOF'
Host github-genius-backup
  HostName github.com
  User git
  IdentityFile /root/.ssh/genius_backup
  IdentitiesOnly yes
EOF
ssh-keyscan -q github.com >> /root/.ssh/known_hosts 2>/dev/null

reachable() { git ls-remote "$1" >/dev/null 2>&1; }
CODE_URL="git@github-genius:$CODE_REPO.git"
BACKUP_URL="git@github-genius-backup:$BACKUP_REPO.git"
while ! reachable "$CODE_URL" || ! reachable "$BACKUP_URL"; do
  echo
  echo "Add these two keys on GitHub (repository → Settings → Deploy keys → Add deploy key):"
  echo
  echo "  $CODE_REPO   — leave \"Allow write access\" OFF:"
  echo "    $(cat /root/.ssh/genius_deploy.pub)"
  echo
  echo "  $BACKUP_REPO — tick \"Allow write access\" ON (the nightly backup writes here):"
  echo "    $(cat /root/.ssh/genius_backup.pub)"
  echo
  read -rp "Press Enter once both are added… " _
done
echo "GitHub: both repositories reachable"

say "3/9  The backup passphrase"
if [ ! -s "$PASSFILE" ]; then
  umask 077
  read -rsp "Backup passphrase (from your password manager): " P; echo
  printf '%s' "$P" > "$PASSFILE"; unset P
  umask 022
fi

say "4/9  Fetching the code and the backups"
[ -d "$REPO_DIR/.git" ] || git clone -q -b main "$CODE_URL" "$REPO_DIR"
rm -rf "$WORKTREE"
git clone -q --depth 1 "$BACKUP_URL" "$WORKTREE"
if [ -n "$DAY" ]; then SRC="$WORKTREE/days/$DAY"; else SRC=$(ls -1d "$WORKTREE"/days/*/ | sort | tail -n 1); SRC=${SRC%/}; fi
[ -d "$SRC" ] || die "no backup found${DAY:+ for $DAY}"
cat "$SRC/MANIFEST.txt"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
# put split files back together, then check every checksum
for f in "$SRC"/*; do
  case "$f" in
    *.part-000) cat "${f%.part-000}".part-* > "$WORK/$(basename "${f%.part-000}")" ;;
    *.part-*) ;;
    *) cp "$f" "$WORK/" ;;
  esac
done
(cd "$WORK" && grep -E '^[0-9a-f]{64} [ *]' MANIFEST.txt | sha256sum -c --quiet) || die "a backup file is damaged (checksum)"
decrypt() {
  gpg --batch --quiet --pinentry-mode loopback --passphrase-file "$PASSFILE" -d "$1" > "$2" \
    || die "could not decrypt $(basename "$1") — is the passphrase right? (delete $PASSFILE to type it again)"
}
decrypt "$WORK/genius-secrets.tar.gz.gpg" "$WORK/secrets.tar.gz"
decrypt "$WORK/genius-config.tar.gz.gpg" "$WORK/config.tar.gz"
decrypt "$WORK/genius-db.dump.gpg" "$WORK/genius.dump"

say "5/9  Web server and HTTPS"
# installed before its settings go back, so the package does not ask about them
if tar -tzf "$WORK/config.tar.gz" | grep -q '^etc/caddy/'; then apt-get install -y -qq caddy >/dev/null; echo "caddy"; fi
if tar -tzf "$WORK/config.tar.gz" | grep -q '^etc/nginx/'; then apt-get install -y -qq nginx certbot python3-certbot-nginx >/dev/null; echo "nginx + certbot"; fi
tar -C / -xzpf "$WORK/config.tar.gz"

say "6/9  Secrets and licence key"
if [ -d "$SECRETS_DIR" ] && [ -n "$(ls -A "$SECRETS_DIR" 2>/dev/null)" ]; then
  mv "$SECRETS_DIR" "$SECRETS_DIR.before-install.$(date +%s)"
fi
tar -C "$(dirname "$SECRETS_DIR")" -xzpf "$WORK/secrets.tar.gz"
# owners and modes come back exactly as they were (tar as root keeps them):
# the API reads the licence key as the genius user, so they must not change

say "7/9  Database"
# DATABASE_URL, read the way systemd reads its EnvironmentFile: KEY=value
# lines, optionally quoted. The .env files are not shell scripts — a value
# such as `Genius <no-reply@…>` is fine for systemd and a syntax error to bash,
# so they are never sourced.
env_value() {
  grep -h -E "^[[:space:]]*(export[[:space:]]+)?$1=" "$SECRETS_DIR"/*.env 2>/dev/null | tail -n 1 \
    | sed -E "s/^[[:space:]]*(export[[:space:]]+)?$1=//; s/\r$//; s/^\"(.*)\"$/\1/; s/^'(.*)'$/\1/"
}
DATABASE_URL=$(env_value DATABASE_URL || true)
re='^postgres(ql)?://([^:]+):([^@]*)@[^/]+/([^?]+)'
[[ "${DATABASE_URL:-}" =~ $re ]] || die "could not read DATABASE_URL from $SECRETS_DIR"
DB_USER=${BASH_REMATCH[2]}; DB_PASS=${BASH_REMATCH[3]}; DB_NAME=${BASH_REMATCH[4]}
if sudo -u postgres psql -tAc "select 1 from pg_database where datname = '$DB_NAME'" | grep -q 1; then
  die "database '$DB_NAME' already exists here — this script is for an empty server"
fi
sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
do \$\$ begin
  if not exists (select from pg_roles where rolname = '$DB_USER') then
    create role "$DB_USER" login password '$DB_PASS';
  else
    alter role "$DB_USER" login password '$DB_PASS';
  end if;
end \$\$;
create database "$DB_NAME" owner "$DB_USER";
SQL
sudo -u postgres psql -d "$DB_NAME" -v ON_ERROR_STOP=1 -q -c "create extension if not exists citext; create extension if not exists pgcrypto;"
install -m 644 "$WORK/genius.dump" /tmp/genius-install.dump
sudo -u postgres pg_restore --no-owner --role="$DB_USER" --exit-on-error -d "$DB_NAME" /tmp/genius-install.dump
rm -f /tmp/genius-install.dump
sudo -u postgres psql -d "$DB_NAME" -tAc "select 'accounts: ' || count(*) from accounts union all select 'businesses: ' || count(*) from businesses union all select 'ops: ' || count(*) from ops"

say "8/9  The API"
mkdir -p "$APP_DIR" /var/backups/genius
rsync -a --delete --exclude node_modules --exclude test "$REPO_DIR/server/" "$APP_DIR/"
chown -R genius:genius "$APP_DIR" /var/backups/genius
sudo -u genius -H bash -c "cd '$APP_DIR' && npm ci --omit=dev --no-audit --no-fund --silent"
# the service file from the backup when there is one: it names this server's .env files
[ -f /etc/systemd/system/genius-api.service ] || cp "$REPO_DIR/server/deploy/genius-api.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now genius-api
ok=""
for _ in $(seq 1 15); do sleep 2; if curl -fsS -m 3 http://127.0.0.1:8080/health >/dev/null 2>&1; then ok=1; break; fi; done
[ -n "$ok" ] || die "the API did not come up — journalctl -u genius-api -n 50"
curl -s http://127.0.0.1:8080/health; echo
systemctl is-active --quiet caddy 2>/dev/null && systemctl reload caddy || true
if command -v nginx >/dev/null; then nginx -t && systemctl reload nginx; fi

say "9/9  Nightly routines"
chmod +x "$REPO_DIR"/server/deploy/*.sh
cp "$REPO_DIR"/server/deploy/genius-update.{service,timer} "$REPO_DIR"/server/deploy/genius-github-backup.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now genius-update.timer genius-github-backup.timer
echo "automatic updates: on · nightly GitHub backup: on"

IP=$(curl -fsS -m 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
cat <<EOF

=====================================================================
 Genius is running on this server.

 Last step: in your DNS, point the A record of api.saljoetech.tech to
     $IP
 HTTPS comes back by itself once the name points here. Then open
 https://api.saljoetech.tech/health and sign in on a phone.
=====================================================================
EOF
