#!/usr/bin/env bash
# School Manager on the account server: licences, the book kept in the cloud, updates.
# Copy schoolbooks.js, index.js and this script to /tmp, then run:  bash /tmp/schoolbooks-install.sh
set -euo pipefail
SRC=/opt/genius/api/src
STAMP=$(date +%Y%m%d-%H%M%S)
BK=/opt/genius/backup-src-$STAMP-schoolbooks

[ -f /tmp/schoolbooks.js ] || { echo "missing /tmp/schoolbooks.js"; exit 1; }
[ -f /tmp/index.js ] || { echo "missing /tmp/index.js"; exit 1; }
grep -q "schoolBookRoutes" /tmp/index.js || { echo "/tmp/index.js is not the new one"; exit 1; }

echo "1/5 backing up to $BK"
mkdir -p "$BK"
cp -a "$SRC/index.js" "$BK/"
[ -f "$SRC/schoolbooks.js" ] && cp -a "$SRC/schoolbooks.js" "$BK/" || true

echo "2/5 installing the module"
node --check /tmp/schoolbooks.js
install -o "$(stat -c %U "$SRC/index.js")" -g "$(stat -c %G "$SRC/index.js")" -m 644 /tmp/schoolbooks.js "$SRC/schoolbooks.js"
install -o "$(stat -c %U "$SRC/index.js")" -g "$(stat -c %G "$SRC/index.js")" -m 644 /tmp/index.js "$SRC/index.js"

echo "3/5 the folder School Manager's updates are served from"
REL=$(grep -h '^RELEASES_DIR=' /etc/genius/api.env 2>/dev/null | cut -d= -f2 || true)
REL=${REL:-/opt/genius/releases}
mkdir -p "$REL/school"

echo "4/5 letting a school's book through nginx (it goes up whole, gzipped)"
if ! grep -rqs "client_max_body_size" /etc/nginx/conf.d/ /etc/nginx/nginx.conf /etc/nginx/sites-enabled/; then
  echo "client_max_body_size 200m;" > /etc/nginx/conf.d/school-books.conf
  nginx -t && systemctl reload nginx
else
  echo "   a client_max_body_size is already set; leaving nginx alone"
fi

echo "5/5 restarting the API"
systemctl restart genius-api
sleep 4
if curl -fsS http://127.0.0.1:${PORT:-8080}/health >/dev/null 2>&1 || curl -fsS https://api.saljoe.tech/health >/dev/null; then
  echo "API is up."
else
  echo "API did not answer /health — rolling back"
  cp -a "$BK/index.js" "$SRC/index.js"; rm -f "$SRC/schoolbooks.js"
  systemctl restart genius-api
  journalctl -u genius-api -n 40 --no-pager
  exit 1
fi
curl -s -o /dev/null -w "school licence route answers %{http_code} (401 = there, needs sign-in)\n" https://api.saljoe.tech/v1/school/licence
echo "Done. Backup: $BK"
