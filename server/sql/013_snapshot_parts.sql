-- A big book arrives in parts (gzip, base64) and is put together on commit:
-- one 45 MB request timed out and froze the Windows till.
create table if not exists snapshot_parts (
  business_id uuid not null,
  upload_id   text not null,
  idx         int  not null,
  chunk       bytea not null,
  created_at  timestamptz not null default now(),
  primary key (business_id, upload_id, idx)
);
