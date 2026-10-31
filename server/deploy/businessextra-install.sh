#!/bin/sh
# Adds Your businesses extras (businessextra.js) to the live API:
# vouchers this week and rename on Your businesses. Two lines in index.js,
# a backup first, then a restart. Safe to run twice.
set -e
cd /opt/genius/api/src
[ -f businessextra.js ] || { echo "businessextra.js is not in /opt/genius/api/src"; exit 1; }
if grep -q businessExtraRoutes index.js; then echo "already installed"; else
  cp index.js index.js.bak-bizextra
  sed -i "0,/^import adminRoutes/s||import businessExtraRoutes from './businessextra.js';\n&|" index.js
  sed -i "s|^await app.register(adminRoutes);|&\nawait app.register(businessExtraRoutes);|" index.js
fi
grep -n businessExtra index.js
systemctl restart genius-api
sleep 3
if systemctl is-active --quiet genius-api; then echo "OK — genius-api is running with the business extras"
else echo "genius-api did not start — putting index.js back"; cp index.js.bak-bizextra index.js; systemctl restart genius-api; exit 1; fi
