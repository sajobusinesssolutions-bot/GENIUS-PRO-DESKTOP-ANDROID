-- Crash and error reports from the apps (server/src/crash.js creates this on start too).
create table if not exists crash_reports (
  id          bigserial primary key,
  received_at timestamptz not null default now(),
  happened_at timestamptz,
  account_id  uuid,
  fatal       boolean not null default false,
  kind        text,
  message     text,
  stack       text,
  route       text,
  app_version text,
  platform    text,
  os_version  text,
  device      text,
  business_id text,
  extra       jsonb,
  ip          text
);
create index if not exists crash_reports_received on crash_reports (received_at desc);
