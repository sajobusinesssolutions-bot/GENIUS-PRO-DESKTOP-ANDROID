-- Backups to Google Drive. An account links its own Google Drive once (the
-- drive.file scope: the app sees only the files it made), and the refresh
-- token Google hands back is kept here so backups can go up without asking
-- again. Removing the row unlinks Drive.
create table if not exists drive_links (
  account_id uuid primary key references accounts(id) on delete cascade,
  refresh_token text not null,
  google_email text,
  folder_id text,
  linked_at timestamptz not null default now(),
  last_backup_at timestamptz
);
