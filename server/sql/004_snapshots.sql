-- A whole copy of each business's books, as the phone last had them.
--
-- The op log is the record of what happened; this is what lets a phone that
-- has never seen a business open it — choosing a shop after signing in, or a
-- new phone replacing a broken one. Only the latest copy is kept.
create table if not exists business_snapshots (
  business_id uuid primary key references businesses(id) on delete cascade,
  data        jsonb not null,
  bytes       integer not null,
  device_id   uuid,
  version     integer not null default 0,
  updated_at  timestamptz not null default now()
);

create index if not exists business_snapshots_updated_idx on business_snapshots(updated_at desc);
