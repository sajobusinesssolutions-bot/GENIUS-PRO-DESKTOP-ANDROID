#!/usr/bin/env bash
#
# Brings the API on this server up to the latest commit on GitHub.
#
# Run every few minutes by genius-update.timer. When the branch has not moved
# it does nothing. When it has, it copies server/ over the running API,
# installs dependencies if they changed, applies any SQL file it has not
# applied before, restarts the service and checks /health. If the new version
# does not come up healthy it puts the previous commit back and restarts that,
# so a bad push costs a minute rather than an outage.
#
# Secrets never come from the repository: they stay in /etc/genius/*.env.
#
set -euo pipefail

REPO_DIR=${GENIUS_REPO_DIR:-/opt/genius/repo}   # a clone used only for deploying
APP_DIR=${GENIUS_APP_DIR:-/opt/genius/api}      # what genius-api.service runs
BRANCH=${GENIUS_BRANCH:-main}
SERVICE=genius-api
HEALTH=http://127.0.0.1:8080/health
LOG_TAG=genius-update

log() { logger -t "$LOG_TAG" -- "$*"; echo "$*"; }

cd "$REPO_DIR"
git fetch --quiet origin "$BRANCH"
OLD=$(git rev-parse HEAD)
NEW=$(git rev-parse "origin/$BRANCH")
if [ "$OLD" = "$NEW" ] && [ "${1:-}" != "--force" ]; then
  exit 0
fi

deploy() {
  local rev=$1
  git -C "$REPO_DIR" reset --quiet --hard "$rev"

  # dependencies only when they changed — npm ci is slow and needs the network
  local lock_changed=1
  if [ -f "$APP_DIR/package-lock.json" ] && cmp -s "$REPO_DIR/server/package-lock.json" "$APP_DIR/package-lock.json"; then
    lock_changed=0
  fi

  rsync -a --delete \
    --exclude node_modules --exclude test \
    "$REPO_DIR/server/" "$APP_DIR/"
  chown -R genius:genius "$APP_DIR"

  if [ "$lock_changed" = 1 ] || [ ! -d "$APP_DIR/node_modules" ]; then
    log "installing dependencies"
    sudo -u genius -H bash -c "cd '$APP_DIR' && npm ci --omit=dev --no-audit --no-fund --silent"
  fi

  for f in "$APP_DIR"/src/*.js; do node --check "$f"; done
}

migrate() {
  # Each SQL file runs once, in name order, as the database owner, recorded in
  # schema_files so it is never run twice.
  sudo -u postgres psql -d genius -v ON_ERROR_STOP=1 -q -c \
    "create table if not exists schema_files (name text primary key, applied_at timestamptz not null default now()); alter table schema_files owner to genius;"
  for f in "$APP_DIR"/sql/*.sql; do
    [ -e "$f" ] || continue
    local name
    name=$(basename "$f")
    local done_already
    done_already=$(sudo -u postgres psql -d genius -tAc "select 1 from schema_files where name = '$name'")
    if [ "$done_already" != "1" ]; then
      log "applying $name"
      sudo -u postgres psql -d genius -v ON_ERROR_STOP=1 -q \
        -c "set role genius" -f "$f" \
        -c "insert into schema_files (name) values ('$name')"
    fi
  done
}

healthy() {
  for _ in $(seq 1 15); do
    sleep 2
    if curl -fsS -m 3 "$HEALTH" >/dev/null 2>&1; then return 0; fi
  done
  return 1
}

log "updating ${OLD:0:7} -> ${NEW:0:7}"
if deploy "$NEW" && migrate && systemctl restart "$SERVICE" && healthy; then
  log "now running ${NEW:0:7}"
  exit 0
fi

log "update to ${NEW:0:7} failed health checks; going back to ${OLD:0:7}"
deploy "$OLD"
systemctl restart "$SERVICE"
healthy && log "back on ${OLD:0:7}" || log "ROLLBACK ALSO UNHEALTHY — check journalctl -u $SERVICE"
exit 1
