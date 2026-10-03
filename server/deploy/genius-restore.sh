#!/usr/bin/env bash
#
# Brings Genius back on a NEW server from the off-site copies that
# genius-offsite.sh made: the secrets and licence key into /etc/genius, and
# the newest database dump into a fresh "genius" database.
#
# Run as root on the new server, after rclone is set up with the same remote
# and the backup passphrase is in /root/.genius-backup-pass. Full steps:
# RECOVERY.md, "Moving to a new server".
#
#   genius-restore.sh                 newest copies
#   genius-restore.sh 2026-10-03      the copies from that day
#
set -euo pipefail

REMOTE=${GENIUS_OFFSITE:-gdrive:genius-backups}
PASSFILE=${GENIUS_BACKUP_PASSFILE:-/root/.genius-backup-pass}
SECRETS_DIR=${GENIUS_SECRETS_DIR:-/etc/genius}
DAY=${1:-}

say() { echo; echo "== $*"; }
die() { echo "FAILED: $*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "run as root"
for c in rclone gpg psql pg_restore; do command -v "$c" >/dev/null || die "$c is not installed"; done
[ -s "$PASSFILE" ] || die "put the backup passphrase in $PASSFILE first"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

pick() { # newest file in a remote folder, or the one from $DAY
  local folder=$1 pattern=$2
  rclone lsf "$REMOTE/$folder/" --files-only | grep -E "$pattern" | { if [ -n "$DAY" ]; then grep "$DAY"; else cat; fi; } | sort | tail -n 1
}

say "Finding the copies on $REMOTE"
DUMP=$(pick db '^genius-.*\.dump$')
SECRETS=$(pick secrets '^genius-secrets-.*\.gpg$')
[ -n "$DUMP" ] || die "no database dump found${DAY:+ for $DAY}"
[ -n "$SECRETS" ] || die "no secrets archive found${DAY:+ for $DAY}"
echo "database: $DUMP"
echo "secrets:  $SECRETS"
rclone copy "$REMOTE/db/$DUMP" "$WORK/"
rclone copy "$REMOTE/secrets/$SECRETS" "$WORK/"

say "Restoring the secrets to $SECRETS_DIR"
if [ -d "$SECRETS_DIR" ] && [ -n "$(ls -A "$SECRETS_DIR" 2>/dev/null)" ]; then
  mv "$SECRETS_DIR" "$SECRETS_DIR.before-restore.$(date +%s)"
  echo "(the old $SECRETS_DIR was kept beside it)"
fi
gpg --batch --pinentry-mode loopback --passphrase-file "$PASSFILE" -d "$WORK/$SECRETS" > "$WORK/secrets.tar.gz" \
  || die "could not decrypt the secrets — is the passphrase right?"
tar -C "$(dirname "$SECRETS_DIR")" -xzf "$WORK/secrets.tar.gz"
chmod 700 "$SECRETS_DIR"; chmod 600 "$SECRETS_DIR"/* || true

say "Reading the database settings"
set -a
for f in "$SECRETS_DIR"/*.env; do [ -e "$f" ] && . "$f"; done
set +a
[ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL is not in $SECRETS_DIR/*.env"
# postgres://USER:PASS@HOST:PORT/DB
re='^postgres(ql)?://([^:]+):([^@]*)@[^/]+/([^?]+)'
[[ "$DATABASE_URL" =~ $re ]] || die "could not read DATABASE_URL"
DB_USER=${BASH_REMATCH[2]}; DB_PASS=${BASH_REMATCH[3]}; DB_NAME=${BASH_REMATCH[4]}

say "Creating user '$DB_USER' and database '$DB_NAME'"
if sudo -u postgres psql -tAc "select 1 from pg_database where datname = '$DB_NAME'" | grep -q 1; then
  die "database '$DB_NAME' already exists here — restore into an empty server, or drop it first"
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

say "Loading $DUMP"
cp "$WORK/$DUMP" /tmp/genius-restore.dump && chmod 644 /tmp/genius-restore.dump
sudo -u postgres pg_restore --no-owner --role="$DB_USER" --exit-on-error -d "$DB_NAME" /tmp/genius-restore.dump
rm -f /tmp/genius-restore.dump

say "Checking"
sudo -u postgres psql -d "$DB_NAME" -tAc "select 'accounts: ' || count(*) from accounts union all select 'businesses: ' || count(*) from businesses union all select 'ops: ' || count(*) from ops"

echo
echo "Done. Next: install the API (RECOVERY.md step 5), point the domain here (step 6), and check /health."
