-- business_snapshots existed before 004 gave it a version column, and
-- "create table if not exists" never adds a column to a table already there.
-- Without it every snapshot upload failed: column "version" does not exist.
alter table business_snapshots add column if not exists version integer not null default 0;
