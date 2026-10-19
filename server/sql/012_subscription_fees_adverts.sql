-- Subscription fees and sidebar adverts (2026-10-19).
-- src/admin.js makes these itself when it starts (migrate()); this file is the record.

alter table licences add column if not exists edition text default 'retail';
alter table licences add column if not exists max_businesses int;
alter table licences add column if not exists renewal_fee numeric;
alter table licences add column if not exists installation_fee numeric;
alter table licences add column if not exists vat_rate numeric default 18;
alter table licences add column if not exists currency text default 'UGX';

create table if not exists adverts (
  id serial primary key,
  title text not null,
  body text,
  image_url text,
  link_url text,
  cta text,
  audience text not null default 'all',      -- all | trial | paying | expired
  edition text,                               -- null for every edition
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  active boolean not null default true,
  impressions int not null default 0,
  clicks int not null default 0,
  created_by text,
  created_at timestamptz not null default now()
);
