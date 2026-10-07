-- Each licence is for one edition of the app: Retail, Restaurant or
-- Pharmacy. The edition decides the price list and what the plan includes;
-- the plan (trial / starter / pro) decides how much of it. Existing licences
-- are Retail, which is what every licence was before editions existed.
alter table licences add column if not exists edition text not null default 'retail';
