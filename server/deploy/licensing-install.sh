#!/bin/sh
# Adds the console's subscription tools (licensing.js) to the live API:
# payments received, client fees, reset and reinstate. Two lines in index.js,
# a backup first, then a restart. Safe to run twice.
set -e
cd /opt/genius/api/src
[ -f licensing.js ] || { echo "licensing.js is not in /opt/genius/api/src"; exit 1; }
# licensing.js uses the developer check admin.js exports; an older admin.js does not
grep -q "export async function developer" admin.js || { echo "admin.js here has no exported developer() — install the newer admin.js first"; exit 1; }
if grep -q licensingRoutes index.js; then echo "already installed"; else
  cp index.js index.js.bak-licensing
  sed -i "0,/^import adminRoutes/s||import licensingRoutes from './licensing.js';\n&|" index.js
  sed -i "s|^await app.register(adminRoutes);|&\nawait app.register(licensingRoutes);|" index.js
fi
grep -n licensing index.js
systemctl restart genius-api
sleep 3
if systemctl is-active --quiet genius-api; then echo "OK — genius-api is running with the subscription tools"
else echo "genius-api did not start — putting index.js back"; cp index.js.bak-licensing index.js; systemctl restart genius-api; exit 1; fi
