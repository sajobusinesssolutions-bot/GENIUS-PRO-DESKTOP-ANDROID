#!/usr/bin/env bash
#
# Copies everything this server needs to come back to life into a PRIVATE
# GitHub repository, encrypted, every night. genius-install.sh rebuilds a new
# server from it in one go.
#
# Each night's copy, in days/<YYYY-MM-DD>/:
#
#   genius-db.dump.gpg            the whole database (pg_dump, custom format)
#   genius-secrets.tar.gz.gpg     /etc/genius: every .env and the licence key
#   genius-config.tar.gz.gpg      web server, HTTPS certificates, service files
#   genius-schema.sql             the table structure, readable, unencrypted
#   MANIFEST.txt                  what is in it, sizes and checksums
#
# Everything but the schema is encrypted with the backup passphrase before it
# leaves the machine: the database holds every shop's books and password
# hashes, and the licence key cannot be recreated. Keep that passphrase in a
# password manager — without it the copies cannot be opened.
#
# The repository keeps the last KEEP_DAYS days as ONE commit, force-pushed, so
# it never grows night after night. Files over 95 MB are split into parts
# (GitHub refuses single files over 100 MB); genius-install.sh joins them.
#
# One-time setup: RECOVERY.md, "Back up to GitHub".
#
set -Eeuo pipefail

REPO=${GENIUS_BACKUP_REPO:-git@github-genius-backup:sajobusinesssolutions-bot/GENIUS-SERVER-BACKUP.git}
WORKTREE=${GENIUS_BACKUP_WORKTREE:-/var/lib/genius-github-backup}
SECRETS_DIR=${GENIUS_SECRETS_DIR:-/etc/genius}
PASSFILE=${GENIUS_BACKUP_PASSFILE:-/root/.genius-backup-pass}
KEEP_DAYS=${GENIUS_BACKUP_KEEP_DAYS:-7}
LOG_TAG=genius-github-backup

log() { logger -t "$LOG_TAG" -- "$*"; echo "$*"; }
die() { log "FAILED: $*"; exit 1; }
# any command that fails on its own still leaves a line saying which one
trap 'rc=$?; [ $rc -ne 0 ] && log "FAILED (exit $rc) at line $LINENO: $BASH_COMMAND"' ERR

for c in git gpg pg_dump pg_restore tar split sha256sum; do command -v "$c" >/dev/null || die "$c is not installed"; done
[ -s "$PASSFILE" ] || die "no passphrase at $PASSFILE — see RECOVERY.md"

# the same database the API uses
# DATABASE_URL, read the way systemd reads its EnvironmentFile: KEY=value
# lines, optionally quoted. The .env files are not shell scripts — a value
# such as `Genius <no-reply@…>` is fine for systemd and a syntax error to bash,
# so they are never sourced.
env_value() {
  grep -h -E "^[[:space:]]*(export[[:space:]]+)?$1=" "$SECRETS_DIR"/*.env 2>/dev/null | tail -n 1 \
    | sed -E "s/^[[:space:]]*(export[[:space:]]+)?$1=//; s/\r$//; s/^\"(.*)\"$/\1/; s/^'(.*)'$/\1/"
}
DATABASE_URL=$(env_value DATABASE_URL || true)
[ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL is not in $SECRETS_DIR/*.env"

DAY=$(date -u +%Y-%m-%d)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

encrypt() { # file -> file.gpg, then removes the plain file
  gpg --batch --yes --pinentry-mode loopback --passphrase-file "$PASSFILE" \
    --symmetric --cipher-algo AES256 -o "$1.gpg" "$1"
  rm -f "$1"
}

# 1. the database, checked before it counts as a backup
pg_dump --format=custom --no-owner --file="$WORK/genius-db.dump" "$DATABASE_URL"
pg_restore --list "$WORK/genius-db.dump" >/dev/null || die "the dump does not read back"
COUNTS=$(psql "$DATABASE_URL" -tAc "select 'accounts=' || count(*) from accounts union all select 'businesses=' || count(*) from businesses union all select 'ops=' || count(*) from ops" | tr '\n' ' ')
encrypt "$WORK/genius-db.dump"

# 2. the secrets and the licence key
tar -C "$(dirname "$SECRETS_DIR")" -czf "$WORK/genius-secrets.tar.gz" "$(basename "$SECRETS_DIR")"
encrypt "$WORK/genius-secrets.tar.gz"

# 3. how the machine is set up around the API: whichever of these exist
CONFIG=()
for p in /etc/caddy /etc/nginx /etc/letsencrypt \
         /etc/systemd/system/genius-api.service /etc/systemd/system/genius-api.service.d \
         /etc/systemd/system/genius-update.service /etc/systemd/system/genius-update.timer \
         /etc/systemd/system/genius-github-backup.service /etc/systemd/system/genius-github-backup.timer; do
  [ -e "$p" ] && CONFIG+=("${p#/}")
done
tar -C / -czf "$WORK/genius-config.tar.gz" "${CONFIG[@]}"
encrypt "$WORK/genius-config.tar.gz"

# 4. the structure alone, readable without the passphrase
pg_dump --schema-only --no-owner "$DATABASE_URL" > "$WORK/genius-schema.sql"

# what is in it, with checksums of the whole files (taken before any split)
{
  echo "Genius server backup — $DAY ($(date -u +%H:%M) UTC) from $(hostname)"
  echo "API code: $(git -C /opt/genius/repo log --oneline -1 2>/dev/null || echo unknown)"
  echo "Database: $COUNTS"
  echo "Config:   ${CONFIG[*]}"
  echo
  (cd "$WORK" && sha256sum -- *)
} > "$WORK.manifest"
mv "$WORK.manifest" "$WORK/MANIFEST.txt"   # written beside, so it is not in its own list

# into today's folder, splitting anything GitHub would refuse
mkdir -p "$WORKTREE"
if [ ! -d "$WORKTREE/.git" ]; then
  git -C "$WORKTREE" init -q -b main
  git -C "$WORKTREE" remote add origin "$REPO"
fi
OUT="$WORKTREE/days/$DAY"
rm -rf "$OUT"; mkdir -p "$OUT"
for f in "$WORK"/*; do
  if [ "$(stat -c %s "$f")" -gt $((95 * 1024 * 1024)) ]; then
    split -b 95M -d -a 3 "$f" "$OUT/$(basename "$f").part-"
  else
    cp "$f" "$OUT/"
  fi
done

# keep the newest KEEP_DAYS days
ls -1d "$WORKTREE"/days/*/ 2>/dev/null | sort | head -n -"$KEEP_DAYS" | xargs -r rm -rf

cat > "$WORKTREE/README.md" <<EOF
# Genius server backups

Encrypted nightly copies of the Genius API server, the last $KEEP_DAYS days.
Newest: \`days/$DAY\`. To rebuild a server from them, follow "Rebuild from
GitHub" in server/deploy/RECOVERY.md of the app repository — it is one
command, genius-install.sh, and it needs the backup passphrase.
EOF

# one commit holding just these days, so the repository never grows
cd "$WORKTREE"
git branch -D next >/dev/null 2>&1 || true   # left by a run that stopped halfway
git checkout -q --orphan next
git add -A
git -c user.name="Genius backup" -c user.email="backup@$(hostname)" commit -q -m "Backup $DAY"
git branch -D main >/dev/null 2>&1 || true
git branch -m main
git push -q -f origin main || die "could not push to $REPO"
git gc -q --prune=now

log "backup for $DAY pushed: $COUNTS ($(du -sh "$OUT" | cut -f1))"
