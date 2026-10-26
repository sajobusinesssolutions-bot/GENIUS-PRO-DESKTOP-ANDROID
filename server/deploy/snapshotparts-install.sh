#!/bin/sh
# Adds the parts upload (snapshotparts.js) to the live API: two lines in
# index.js, a backup first, then a restart. Safe to run twice.
set -e
cd /opt/genius/api/src
[ -f snapshotparts.js ] || { echo "snapshotparts.js is not in /opt/genius/api/src"; exit 1; }
if grep -q snapshotPartRoutes index.js; then echo "already installed"; else
  cp index.js index.js.bak
  sed -i "s|^import transferRoutes from './transfers.js';|&\nimport snapshotPartRoutes from './snapshotparts.js';|" index.js
  sed -i "s|^await app.register(transferRoutes);|&\nawait app.register(snapshotPartRoutes);|" index.js
fi
grep -n snapshotPart index.js
systemctl restart genius-api
sleep 3
if systemctl is-active --quiet genius-api; then echo "OK — genius-api is running with the parts upload"
else echo "genius-api did not start — putting index.js back"; cp index.js.bak index.js; systemctl restart genius-api; exit 1; fi
