#!/bin/sh
# Private download links (privatelinks.js): a secret key in api.env, two lines
# in index.js, a restart, then the two links are printed. Safe to run twice;
# run with "new" to replace the key and retire every link handed out before.
set -eu
API=/opt/genius/api/src
ENVF=/etc/genius/api.env
[ -f /tmp/privatelinks.js ] || { echo "copy privatelinks.js to /tmp first"; exit 1; }
cp /tmp/privatelinks.js /tmp/privatelinks-check.mjs && node --check /tmp/privatelinks-check.mjs
B=/opt/genius/backup-src-$(date +%Y%m%d-%H%M)-links; mkdir -p "$B"; cp "$API/index.js" "$ENVF" "$B/"
install -m 644 /tmp/privatelinks.js "$API/privatelinks.js"

if [ "${1:-}" = "new" ] || ! grep -q '^DOWNLOAD_KEY=' "$ENVF"; then
  sed -i '/^DOWNLOAD_KEY=/d' "$ENVF"
  echo "DOWNLOAD_KEY=$(openssl rand -hex 16)" >> "$ENVF"
fi
KEY=$(grep '^DOWNLOAD_KEY=' "$ENVF" | cut -d= -f2-)

if ! grep -q privateLinkRoutes "$API/index.js"; then
  sed -i "s|^import updateRoutes from './updates.js';|&\nimport privateLinkRoutes from './privatelinks.js';|" "$API/index.js"
  sed -i "s|^await app.register(updateRoutes);|&\nawait app.register(privateLinkRoutes);|" "$API/index.js"
fi
grep -n privateLink "$API/index.js"

systemctl restart genius-api; sleep 4
if systemctl is-active --quiet genius-api; then
  echo
  echo "Phone (Android):  https://api.saljoetech.tech/v1/get/$KEY/android"
  echo "Computer (Windows): https://api.saljoetech.tech/v1/get/$KEY/windows"
  echo
  echo "Old files kept in $B"
else
  echo "the API did not start — putting index.js back"
  cp "$B/index.js" "$API/index.js"; cp "$B/api.env" "$ENVF"; rm -f "$API/privatelinks.js"
  systemctl restart genius-api; exit 1
fi
