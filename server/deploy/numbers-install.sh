#!/bin/sh
# Adds server-issued voucher numbers (numbers.js) to the live API:
# one running number per series for every device. Two lines in index.js,
# a backup first, then a restart. Safe to run twice.
set -e
cd /opt/genius/api/src
[ -f numbers.js ] || { echo "numbers.js is not in /opt/genius/api/src"; exit 1; }
if grep -q numberRoutes index.js; then echo "already installed"; else
  cp index.js index.js.bak-numbers
  sed -i "0,/^import adminRoutes/s||import numberRoutes from './numbers.js';\n&|" index.js
  sed -i "s|^await app.register(adminRoutes);|&\nawait app.register(numberRoutes);|" index.js
fi
grep -n numberRoutes index.js
systemctl restart genius-api
sleep 3
if systemctl is-active --quiet genius-api; then echo "OK — genius-api is running with voucher numbers"
else echo "genius-api did not start — putting index.js back"; cp index.js.bak-numbers index.js; systemctl restart genius-api; exit 1; fi
