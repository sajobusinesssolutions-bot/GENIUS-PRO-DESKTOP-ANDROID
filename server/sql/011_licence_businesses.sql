-- How many businesses an account may run. Empty means the plan's own number:
-- Starter (and a trial) one, Pro five. The developer console sets it higher
-- for an owner who needs more.
alter table licences add column if not exists max_businesses integer;
