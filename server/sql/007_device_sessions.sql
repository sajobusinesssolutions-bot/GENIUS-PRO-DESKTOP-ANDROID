-- A device is linked by signing in on it, and only that way: each device row
-- belongs to the session that claimed it. Removing the device ends that
-- session, and the reason is kept so the phone can say "this device was
-- removed" rather than a bare "sign in again".
alter table devices add column if not exists session_id uuid;
create index if not exists devices_session_idx on devices(session_id);
alter table sessions add column if not exists revoked_reason text;
