#!/bin/sh
# Three speed-ups for the account server, installed together:
#
#   1. Saved copies kept gzipped and served as they are, and the small facts
#      (minimum app version, sync on/off, business type) in columns of their
#      own, so a sync pull no longer unpacks a whole book to read one version.
#      Files: snapshotstore.js (new), sync.js, snapshotparts.js, db.js.
#   2. PgBouncer in front of PostgreSQL (transaction pooling on 127.0.0.1:6432):
#      hundreds of API connections share a dozen real ones.
#   3. The sync log's indexes are checked (they exist: ops (business_id, seq)
#      and (business_id, op_id)), and the tables analysed.
#
# Copy the four files to /tmp/speedup/ first. A backup of the API is made, and
# if the API does not come back healthy everything is put back as it was.
# Backups (pg_dump) keep using DATABASE_URL straight to PostgreSQL.
set -eu
NEW=/tmp/speedup
API=/opt/genius/api/src
ENVF=/etc/genius/api.env
B=/opt/genius/backup-src-$(date +%Y%m%d-%H%M)-speedup
for f in snapshotstore.js sync.js snapshotparts.js db.js; do [ -f "$NEW/$f" ] || { echo "missing $NEW/$f"; exit 1; }; done

# the database address, as the API has it
DBURL=$(grep -h '^DATABASE_URL=' "$ENVF" /etc/genius/db.env 2>/dev/null | head -1 | cut -d= -f2- | sed 's/^"//; s/"$//')
[ -n "$DBURL" ] || { echo "DATABASE_URL not found in $ENVF or /etc/genius/db.env"; exit 1; }
part() { node -e 'const u = new URL(process.argv[1]); const v = { user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password), host: u.hostname || "127.0.0.1", port: u.port || "5432", db: u.pathname.replace(/^\//, "") }; process.stdout.write(v[process.argv[2]])' "$DBURL" "$1"; }
PGU=$(part user); PGP=$(part pass); PGH=$(part host); PGPORT_=$(part port); PGD=$(part db)
echo "database $PGD as $PGU on $PGH:$PGPORT_"

echo "== 1. checking the new files"
for f in snapshotstore.js sync.js snapshotparts.js db.js; do cp "$NEW/$f" /tmp/speedup-check.mjs; node --check /tmp/speedup-check.mjs; done

echo "== 2. PgBouncer"
if ! command -v pgbouncer >/dev/null 2>&1; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y pgbouncer >/dev/null
fi
SECRET=$(runuser -u postgres -- psql -Atc "select rolpassword from pg_authid where rolname = '$PGU'")
[ -n "$SECRET" ] || { echo "could not read the password hash for $PGU"; exit 1; }
case "$SECRET" in SCRAM-SHA-256*) AUTH=scram-sha-256 ;; md5*) AUTH=md5 ;; *) AUTH=scram-sha-256; SECRET="$PGP" ;; esac
printf '"%s" "%s"\n' "$PGU" "$SECRET" > /etc/pgbouncer/userlist.txt
chown postgres:postgres /etc/pgbouncer/userlist.txt; chmod 640 /etc/pgbouncer/userlist.txt
[ -f /etc/pgbouncer/pgbouncer.ini.orig ] || cp /etc/pgbouncer/pgbouncer.ini /etc/pgbouncer/pgbouncer.ini.orig 2>/dev/null || true
cat > /etc/pgbouncer/pgbouncer.ini <<INI
[databases]
$PGD = host=$PGH port=$PGPORT_ dbname=$PGD

[pgbouncer]
listen_addr = 127.0.0.1
listen_port = 6432
auth_type = $AUTH
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 12
reserve_pool_size = 4
reserve_pool_timeout = 3
max_prepared_statements = 200
server_idle_timeout = 120
ignore_startup_parameters = extra_float_digits,options
logfile = /var/log/postgresql/pgbouncer.log
pidfile = /var/run/postgresql/pgbouncer.pid
unix_socket_dir = /var/run/postgresql
INI
systemctl enable pgbouncer >/dev/null 2>&1 || true
systemctl restart pgbouncer
sleep 2
BOUNCER="postgres://$(node -e 'const e = (s) => encodeURIComponent(s).replace(/[!\x27()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()); console.log(e(process.argv[1]) + ":" + e(process.argv[2]))' "$PGU" "$PGP")@127.0.0.1:6432/$PGD"
psql "$BOUNCER" -Atc "select 'pgbouncer answers: ' || current_database()" || { echo "PgBouncer did not answer; the API is left as it was"; exit 1; }

echo "== 3. the sync log's indexes"
psql "$DBURL" -Atc "select indexname from pg_indexes where tablename = 'ops' order by 1"
psql "$DBURL" -c "analyze ops; analyze business_snapshots; analyze records" >/dev/null

echo "== 4. the API"
mkdir -p "$B"
cp "$API"/snapshotparts.js "$API"/sync.js "$API"/db.js "$B"/
cp "$ENVF" "$B"/api.env
for f in snapshotstore.js sync.js snapshotparts.js db.js; do install -m 644 "$NEW/$f" "$API/$f"; done
sed -i '/^PGBOUNCER_URL=/d; /^PG_POOL_MAX=/d' "$ENVF"
echo "PGBOUNCER_URL=$BOUNCER" >> "$ENVF"
echo "PG_POOL_MAX=40" >> "$ENVF"
systemctl restart genius-api
sleep 5
if systemctl is-active --quiet genius-api && curl -fs -m 10 http://127.0.0.1:${PORT:-8080}/health >/dev/null 2>&1 || curl -fs -m 10 https://api.saljoetech.tech/health >/dev/null 2>&1; then
  curl -s -m 10 https://api.saljoetech.tech/health; echo
  psql "$DBURL" -Atc "select 'copies with facts in columns: ' || count(*) filter (where meta_v = 1) || ' of ' || count(*) from business_snapshots"
  echo "OK — saved copies gzipped, PgBouncer in front. Old files kept in $B"
else
  echo "the API did not come back — putting everything back"
  cp "$B"/snapshotparts.js "$B"/sync.js "$B"/db.js "$API"/; rm -f "$API"/snapshotstore.js
  cp "$B"/api.env "$ENVF"
  systemctl restart genius-api
  exit 1
fi
