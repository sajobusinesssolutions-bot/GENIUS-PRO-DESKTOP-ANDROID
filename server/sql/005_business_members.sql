-- Account users may be assigned to individual businesses.
-- Owners remain implicit members through businesses.account_id.
create table if not exists business_members (
  business_id uuid not null references businesses(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade,
  role text not null default 'staff',
  created_at timestamptz not null default now(),
  primary key (business_id, account_id)
);
create index if not exists business_members_account_idx on business_members(account_id);
