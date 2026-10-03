# The full table structure

`schema.sql` here is the whole database structure, exported from the live
server, so an EMPTY server can be built from this repository alone (for
example, if a server had to be started with no backup at all).

It lives in this folder, not in `server/sql/`, on purpose: the updater runs
every file in `server/sql/*.sql` against the live database, and this file
would fail there because every table already exists.

## Refresh it (on the server)

```sh
sudo -u postgres pg_dump --schema-only --no-owner genius > /tmp/schema.sql
```

then copy `/tmp/schema.sql` here as `schema.sql` and commit it. The nightly
off-site backup also saves a fresh copy each day (`schema/` on the remote).

## Use it (only for an empty server with no backup)

```sh
sudo -u postgres createdb -O genius genius
sudo -u postgres psql -d genius -c "create extension if not exists citext; create extension if not exists pgcrypto;"
sudo -u postgres psql -d genius -c "set role genius" -f schema.sql
```

With a backup, use `deploy/genius-restore.sh` instead — the dump carries the
structure and the data together.
