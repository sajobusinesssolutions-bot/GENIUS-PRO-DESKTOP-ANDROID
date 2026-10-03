#!/usr/bin/env bash
#
# Copies the server's backups OFF the server, so losing the VPS loses nothing.
#
# The API already writes a nightly database dump to /var/backups/genius (see
# runBackup in src/admin.js). A copy on the same machine does not survive the
# machine, so this sends, each night:
#
#   - the newest database dump            genius-<time>.dump
#   - the secrets and licence key, encrypted   genius-secrets-<date>.tar.gz.gpg
#   - the table structure on its own      genius-schema-<date>.sql
#
# to an rclone remote (Google Drive, Dropbox, OneDrive, another server…), and
# keeps the last KEEP_DAYS days there. Run by genius-offsite.timer.
#
# One-time setup: see RECOVERY.md, "Set up off-site backups".
#
set -euo pipefail

REMOTE=${GENIUS_OFFSITE:-gdrive:genius-backups}        # rclone remote:folder
BACKUP_DIR=${BACKUP_DIR:-/var/backups/genius}           # where the API writes dumps
SECRETS_DIR=${GENIUS_SECRETS_DIR:-/etc/genius}          # *.env and licence.*
PASSFILE=${GENIUS_BACKUP_PASSFILE:-/root/.genius-backup-pass}  # encrypts the secrets
KEEP_DAYS=${GENIUS_OFFSITE_KEEP_DAYS:-30}
LOG_TAG=genius-offsite

log() { logger -t "$LOG_TAG" -- "$*"; echo "$*"; }
die() { log "FAILED: $*"; exit 1; }

command -v rclone >/dev/null || die "rclone is not installed (apt install rclone)"
command -v gpg >/dev/null || die "gpg is not installed (apt install gnupg)"
[ -s "$PASSFILE" ] || die "no passphrase at $PASSFILE — see RECOVERY.md"

# the same database address the API uses
set -a
for f in "$SECRETS_DIR"/*.env; do [ -e "$f" ] && . "$f"; done
set +a
[ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL is not in $SECRETS_DIR/*.env"

DAY=$(date -u +%Y-%m-%d)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# 1. the newest database dump — made now if tonight's is missing
NEWEST=$(ls -1t "$BACKUP_DIR"/genius-*.dump 2>/dev/null | head -n 1 || true)
if [ -z "$NEWEST" ] || [ "$(find "$NEWEST" -mmin -1440 | wc -l)" = "0" ]; then
  log "no dump from the last 24 hours; making one"
  mkdir -p "$BACKUP_DIR"
  NEWEST="$BACKUP_DIR/genius-$(date -u +%Y-%m-%dT%H-%M-%S).dump"
  pg_dump --format=custom --no-owner --file="$NEWEST" "$DATABASE_URL"
fi
# a dump that will not list its own contents is not a backup
pg_restore --list "$NEWEST" >/dev/null || die "$NEWEST is not a readable dump"

# 2. the secrets and licence key, encrypted before they leave the machine
tar -C "$(dirname "$SECRETS_DIR")" -czf "$WORK/genius-secrets-$DAY.tar.gz" "$(basename "$SECRETS_DIR")"
gpg --batch --yes --pinentry-mode loopback --passphrase-file "$PASSFILE" \
  --symmetric --cipher-algo AES256 -o "$WORK/genius-secrets-$DAY.tar.gz.gpg" "$WORK/genius-secrets-$DAY.tar.gz"
rm -f "$WORK/genius-secrets-$DAY.tar.gz"

# 3. the table structure alone, to build an empty server from if ever needed
pg_dump --schema-only --no-owner "$DATABASE_URL" > "$WORK/genius-schema-$DAY.sql"

# send all three
rclone copy "$NEWEST" "$REMOTE/db/" --quiet || die "could not upload the database dump"
rclone copy "$WORK/genius-secrets-$DAY.tar.gz.gpg" "$REMOTE/secrets/" --quiet || die "could not upload the secrets"
rclone copy "$WORK/genius-schema-$DAY.sql" "$REMOTE/schema/" --quiet || die "could not upload the schema"

# keep the last KEEP_DAYS days off the server
rclone delete "$REMOTE" --min-age "${KEEP_DAYS}d" --quiet || log "could not trim old copies (not fatal)"

SIZE=$(du -h "$NEWEST" | cut -f1)
log "off-site copy done: $(basename "$NEWEST") ($SIZE), secrets and schema for $DAY → $REMOTE"
