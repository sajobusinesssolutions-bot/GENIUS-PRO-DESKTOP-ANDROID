/**
 * SACCO Manager on the account server: its licences, the SACCOs using it,
 * prices, and buying a licence by mobile money — as Tallix has (schoolbooks.js),
 * kept apart so neither product's licences can touch the other's.
 *
 * A SACCO links an account (an email); the licence is granted to it. Tiers are
 * SACCO Manager's own: Basic (savings, loans, reports; up to 100 members),
 * Professional (everything) and Money lending (loans, accounting, payroll, SMS,
 * email, reports), each for one year, three years or for life. A new account
 * gets a 30-day Professional trial. /v1/sacco/licence hands back the licence
 * signed with the account server's Ed25519 key (aud "sacco", good for 90 days),
 * which the app checks offline with the public half.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SignJWT, importPKCS8 } from 'jose';
import { q } from './db.js';
import { whoami } from './sync.js';
import { developer } from './admin.js';
import * as momopay from './momopay.js';
import { sendRanged } from './sendranged.js';

/* SACCO Manager's updates: latest.yml, the installer and its blockmap (scripts/publish-sacco.sh in the app uploads them) */
const SACCO_DIR = path.join(process.env.RELEASES_DIR || '/opt/genius/releases', 'sacco');
const SACCO_FILE = /^(latest\.yml|SACCOManager-Setup-[0-9.]+\.exe(\.blockmap)?)$/;

const TRIAL_DAYS = 30;
const OFFLINE_DAYS = Number(process.env.SACCO_OFFLINE_DAYS || 90);
const ALL = ['savings', 'loans', 'shares', 'accounting', 'payroll', 'groups', 'sms', 'email', 'reports'];
export const TIERS = {
  basic: { label: 'Basic', about: 'Savings, loans and reports; up to 100 members', features: ['savings', 'loans', 'reports'], maxCustomers: 100 },
  professional: { label: 'Professional', about: 'Everything, no limit on members', features: ALL, maxCustomers: 0 },
  money_lending: { label: 'Money lending', about: 'Loans, accounting, payroll, SMS and email, reports', features: ['loans', 'accounting', 'payroll', 'sms', 'email', 'reports'], maxCustomers: 0 },
};
const TERMS = { '1y': { label: 'One year', days: 365 }, '3y': { label: 'Three years', days: 1095 }, lifetime: { label: 'Lifetime', days: null } };
const fail = (reply, status, error, message) => reply.code(status).send({ error, message });

let key = null;
async function signingKey() {
  if (!key) key = await importPKCS8(fs.readFileSync(process.env.LICENCE_PRIVATE_KEY_PATH, 'utf8'), 'EdDSA');
  return key;
}
async function signLicence(acc, lic) {
  const now = Math.floor(Date.now() / 1000);
  const t = TIERS[lic.tier] || TIERS.professional;
  return new SignJWT({ email: acc.email, state: lic.state, tier: lic.tier, term: lic.term || null, features: t.features, maxCustomers: lic.maxCustomers ?? t.maxCustomers,
    until: lic.expires_at ? new Date(lic.expires_at).toISOString() : null, institution: lic.institution || null })
    .setProtectedHeader({ alg: 'EdDSA' }).setSubject(acc.id).setAudience('sacco').setIssuedAt(now)
    .setExpirationTime(now + OFFLINE_DAYS * 86400).setJti(crypto.randomBytes(9).toString('hex')).sign(await signingKey());
}

async function ensureTables() {
  await q(`create table if not exists sacco_licences (id bigserial primary key, account_id uuid not null, tier text not null, term text, max_customers int,
    status text not null default 'active', started_at timestamptz not null default now(), expires_at timestamptz, issued_by text, note text, amount bigint)`);
  await q('create index if not exists sacco_licences_account on sacco_licences(account_id)');
  await q('create table if not exists sacco_trials (account_id uuid primary key, started_at timestamptz not null default now())');
  await q(`create table if not exists sacco_seen (account_id uuid not null, device text not null, institution text, version text,
    first_seen timestamptz not null default now(), last_seen timestamptz not null default now(), primary key (account_id, device))`);
  await q(`create table if not exists sacco_prices (tier text not null, term text not null, price bigint not null default 0, currency text not null default 'UGX',
    updated_at timestamptz not null default now(), updated_by text, primary key (tier, term))`);
  for (const t of Object.keys(TIERS)) for (const m of Object.keys(TERMS)) await q('insert into sacco_prices (tier, term) values ($1, $2) on conflict do nothing', [t, m]);
  await q(`create table if not exists sacco_purchases (id bigserial primary key, account_id uuid not null, tier text not null, term text not null, amount bigint not null,
    phone text not null, network text not null, ref text not null unique, status text not null default 'pending', reason text, licence_id bigint,
    at timestamptz not null default now(), done_at timestamptz)`);
  /* the SACCO's books in the cloud (as Tallix's): a whole copy, and the changes sent since it */
  await q(`create table if not exists sacco_books (
    id uuid primary key, account_id uuid not null, name text not null, version int not null default 0, snapshot_version int not null default 0,
    data bytea, size int not null default 0, hash text, updated_at timestamptz not null default now(), updated_from text,
    created_at timestamptz not null default now(), status text not null default 'active')`);
  await q('create index if not exists sacco_books_account on sacco_books(account_id)');
  await q(`create table if not exists sacco_book_ops (book_id uuid not null, version int not null, data bytea not null, count int not null default 0,
    device text, at timestamptz not null default now(), primary key (book_id, version))`);
  /* member photos and scanned documents: files, not in the books (SACCO Manager 1.10.5) */
  await q(`create table if not exists sacco_book_files (book_id uuid not null, path text not null, size int not null, hash text, data bytea not null,
    device text, at timestamptz not null default now(), primary key (book_id, path))`);
}
const MAX_FILE = 8 * 1024 * 1024;
const FILES_PER_BOOK = 4 * 1024 * 1024 * 1024;   // 4 GB of photos and documents per set of books
const okPath = (p) => typeof p === 'string' && p.length < 300 && /^private\/[A-Za-z0-9_./-]+$/.test(p) && !p.includes('..');

const MAX_BOOK = 250 * 1024 * 1024;
const BOOKS_PER_ACCOUNT = 3;   // a SACCO and up to two branches kept as their own books
const bookMeta = (b) => ({ id: b.id, name: b.name, version: b.version, snapshot_version: b.snapshot_version, size: b.size, hash: b.hash, updated_at: b.updated_at, updated_from: b.updated_from });
const CONFLICT = 'Another computer saved the SACCO\'s books since this one last took them.';

/** Where this account stands: a licence in force, a trial, or neither. */
async function licenceOf(accountId) {
  const l = (await q(`select * from sacco_licences where account_id = $1 and status = 'active' and (expires_at is null or expires_at > now())
    order by expires_at desc nulls first limit 1`, [accountId])).rows[0];
  if (l) return { state: 'licensed', tier: l.tier, term: l.term || (l.expires_at ? null : 'lifetime'), maxCustomers: l.max_customers, expires_at: l.expires_at };
  await q('insert into sacco_trials (account_id) values ($1) on conflict do nothing', [accountId]);
  const t = (await q('select started_at from sacco_trials where account_id = $1', [accountId])).rows[0];
  const ends = new Date(new Date(t.started_at).getTime() + TRIAL_DAYS * 864e5);
  if (ends > new Date()) return { state: 'trial', tier: 'professional', term: 'trial', expires_at: ends.toISOString() };
  const last = (await q('select expires_at from sacco_licences where account_id = $1 order by started_at desc limit 1', [accountId])).rows[0];
  return { state: 'expired', tier: null, expires_at: last ? last.expires_at : ends.toISOString() };
}
/** Granted by the developer, or bought: a renewal runs on from the licence in force, so no paid day is lost. */
async function grantLicence(accountId, { tier: tr, term: tm, maxCustomers, amount, note, by }) {
  const tier = TIERS[tr] ? tr : 'professional', term = TERMS[tm] ? tm : '1y';
  const days = TERMS[term].days;
  const cur = (await q(`select expires_at from sacco_licences where account_id = $1 and status = 'active' and expires_at > now() order by expires_at desc limit 1`, [accountId])).rows[0];
  const from = cur ? new Date(cur.expires_at) : new Date();
  const until = days === null ? null : new Date(from.getTime() + days * 864e5);
  const max = maxCustomers === undefined || maxCustomers === null || maxCustomers === '' ? TIERS[tier].maxCustomers : Math.max(0, Number(maxCustomers) || 0);
  const r = await q(`insert into sacco_licences (account_id, tier, term, max_customers, expires_at, issued_by, note, amount) values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
    [accountId, tier, term, max, until, by || null, String(note || '').slice(0, 300) || null, amount ?? null]);
  return { ...r.rows[0], amount: r.rows[0].amount === null ? null : Number(r.rows[0].amount) };
}
const sellKeys = () => ({
  mtn: process.env.MTN_MOMO_KEY ? { key: process.env.MTN_MOMO_KEY, user: process.env.MTN_MOMO_USER, secret: process.env.MTN_MOMO_SECRET, env: process.env.MTN_MOMO_ENV || 'live', target: process.env.MTN_MOMO_TARGET } : null,
  airtel: process.env.AIRTEL_CLIENT_ID ? { id: process.env.AIRTEL_CLIENT_ID, secret: process.env.AIRTEL_CLIENT_SECRET, env: process.env.AIRTEL_ENV || 'live' } : null,
});
const prices = async () => (await q('select tier, term, price, currency, updated_at, updated_by from sacco_prices order by tier, term')).rows.map((r) => ({ ...r, price: Number(r.price) }));

export default async function saccoLicenceRoutes(app) {
  await ensureTables();

  /* the SACCO's licence, signed; the computer that asks is recorded, so the developer console lists the SACCO */
  app.get('/v1/sacco/licence', async (req, reply) => {
    const me = await whoami(req, reply); if (!me) return reply;
    const lic = await licenceOf(me.id);
    const device = String(req.query?.device || '').slice(0, 80);
    if (device) {
      await q(`insert into sacco_seen (account_id, device, institution, version) values ($1, $2, $3, $4)
        on conflict (account_id, device) do update set institution = $3, version = $4, last_seen = now()`,
      [me.id, device, String(req.query?.institution || '').slice(0, 160) || null, String(req.query?.version || '').slice(0, 20) || null]).catch(() => null);
    }
    let token = null;
    try { token = await signLicence(me, { ...lic, institution: String(req.query?.institution || '').slice(0, 160) || null }); } catch (e) { req.log.error({ err: e.message }, 'sacco licence not signed'); }
    return { ...lic, now: new Date().toISOString(), email: me.email, token, offline_days: OFFLINE_DAYS };
  });
  app.get('/v1/sacco/prices', async (req) => ({ buy: !!(sellKeys().mtn || sellKeys().airtel) && !(await momopay.testOnly(req, developer)), tiers: Object.fromEntries(Object.entries(TIERS).map(([k, v]) => [k, { label: v.label, about: v.about }])),
    terms: Object.fromEntries(Object.entries(TERMS).map(([k, v]) => [k, v.label])), prices: await prices(), offline_days: OFFLINE_DAYS, trial_days: TRIAL_DAYS }));

  /* buying in the app: a prompt for the price to the phone given; paid → the licence granted once */
  app.post('/v1/sacco/buy', async (req, reply) => {
    const me = await whoami(req, reply); if (!me) return reply;
    const keys = sellKeys();
    if (!keys.mtn && !keys.airtel) return fail(reply, 503, 'closed', 'Paying in the app is not open yet. Buy or renew on WhatsApp with SALJOE TECH.');
    if (await momopay.testOnly(req, developer)) return fail(reply, 503, 'closed', 'Paying in the app is not open yet. Buy or renew on WhatsApp with SALJOE TECH.');
    const tier = TIERS[req.body?.tier] ? req.body.tier : null, term = TERMS[req.body?.term] ? req.body.term : null;
    if (!tier || !term) return fail(reply, 400, 'malformed', 'Choose the tier and how long.');
    const price = (await q('select price from sacco_prices where tier = $1 and term = $2', [tier, term])).rows[0];
    if (!price || !(Number(price.price) > 0)) return fail(reply, 409, 'price', 'That tier has no price yet. Contact SALJOE TECH.');
    const phone = String(req.body?.phone || '');
    const net = momopay.networkOf(phone);
    if (!net) return fail(reply, 400, 'phone', 'Give an MTN or Airtel number to pay from.');
    if ((net === 'mtn' && !keys.mtn) || (net === 'airtel' && !keys.airtel)) return fail(reply, 409, 'network', `Paying with ${net === 'mtn' ? 'MTN' : 'Airtel'} is not open yet: use the other network, or WhatsApp.`);
    let r;
    try { r = await momopay.request(keys, { amount: Number(price.price), phone, note: `SACCO Manager ${TIERS[tier].label} ${TERMS[term].label}` }); }
    catch (e) { return fail(reply, 502, 'provider', String(e.message || e)); }
    const row = (await q(`insert into sacco_purchases (account_id, tier, term, amount, phone, network, ref) values ($1, $2, $3, $4, $5, $6, $7) returning id, status, amount`,
      [me.id, tier, term, Number(price.price), momopay.msisdn(phone), r.network, r.ref])).rows[0];
    return { id: Number(row.id), status: row.status, amount: Number(row.amount), network: r.network };
  });
  app.get('/v1/sacco/buy/:id', async (req, reply) => {
    const me = await whoami(req, reply); if (!me) return reply;
    const p = (await q('select * from sacco_purchases where id = $1 and account_id = $2', [Number(req.params.id), me.id])).rows[0];
    if (!p) return fail(reply, 404, 'notFound', 'No such purchase.');
    if (p.status === 'pending') {
      let st;
      try { st = await momopay.status(sellKeys(), p.network, p.ref); } catch (e) { return { id: Number(p.id), status: 'pending', note: String(e.message || e) }; }
      if (st.state === 'paid') {
        const won = (await q(`update sacco_purchases set status = 'paid', done_at = now() where id = $1 and status = 'pending' returning id`, [p.id])).rows[0];
        if (won) {
          const lic = await grantLicence(p.account_id, { tier: p.tier, term: p.term, amount: Number(p.amount), note: `Bought in the app: ${p.network === 'mtn' ? 'MTN' : 'Airtel'} ${p.phone}, ${st.txn || p.ref}`, by: 'mobile money' });
          await q('update sacco_purchases set licence_id = $2 where id = $1', [p.id, lic.id]);
        }
        p.status = 'paid';
      } else if (st.state === 'failed') {
        await q(`update sacco_purchases set status = 'failed', reason = $2, done_at = now() where id = $1 and status = 'pending'`, [p.id, String(st.reason || 'Not approved').slice(0, 200)]);
        p.status = 'failed'; p.reason = st.reason || 'Not approved';
      }
    }
    return { id: Number(p.id), status: p.status, reason: p.reason || null, tier: p.tier, term: p.term, amount: Number(p.amount) };
  });

  /* ── the developer console ── */
  app.get('/v1/admin/sacco/licences', async (req, reply) => {
    if (!(await developer(req, reply))) return reply;
    return (await q('select l.*, a.email from sacco_licences l join accounts a on a.id = l.account_id order by l.started_at desc limit 500')).rows
      .map((l) => ({ ...l, amount: l.amount === null ? null : Number(l.amount) }));
  });
  app.post('/v1/admin/sacco/licences', async (req, reply) => {
    const dev = await developer(req, reply); if (!dev) return reply;
    const email = String(req.body?.email || '').trim().toLowerCase();
    const acc = (await q('select id from accounts where lower(email) = $1', [email])).rows[0];
    if (!acc) return fail(reply, 404, 'notFound', 'No account with that email.');
    const tier = TIERS[req.body?.tier] ? req.body.tier : 'professional', term = TERMS[req.body?.term] ? req.body.term : '1y';
    const listed = (await q('select price from sacco_prices where tier = $1 and term = $2', [tier, term])).rows[0];
    const amount = req.body?.amount === undefined || req.body?.amount === null || req.body?.amount === '' ? (listed ? Number(listed.price) : null) : Math.max(0, Math.round(Number(req.body.amount) || 0));
    return grantLicence(acc.id, { tier, term, maxCustomers: req.body?.maxCustomers, amount, note: req.body?.note, by: dev.email });
  });
  app.post('/v1/admin/sacco/licences/:id/revoke', async (req, reply) => {
    if (!(await developer(req, reply))) return reply;
    await q(`update sacco_licences set status = 'revoked' where id = $1`, [Number(req.params.id)]);
    return { ok: true };
  });
  app.get('/v1/admin/sacco/prices', async (req, reply) => { if (!(await developer(req, reply))) return reply; return prices(); });
  app.put('/v1/admin/sacco/prices', async (req, reply) => {
    const dev = await developer(req, reply); if (!dev) return reply;
    for (const p of Array.isArray(req.body?.prices) ? req.body.prices : []) {
      if (!TIERS[p.tier] || !TERMS[p.term]) continue;
      await q(`insert into sacco_prices (tier, term, price, currency, updated_at, updated_by) values ($1, $2, $3, 'UGX', now(), $4)
        on conflict (tier, term) do update set price = $3, updated_at = now(), updated_by = $4`, [p.tier, p.term, Math.max(0, Math.round(Number(p.price) || 0)), dev.email]);
    }
    return prices();
  });
  /* every account using SACCO Manager: its SACCOs, computers, version, when last seen, and its licence */
  app.get('/v1/admin/sacco/saccos', async (req, reply) => {
    if (!(await developer(req, reply))) return reply;
    const ids = (await q('select account_id from sacco_seen union select account_id from sacco_trials union select account_id from sacco_licences')).rows.map((r) => r.account_id);
    const out = [];
    for (const id of ids.slice(0, 1000)) {
      const acc = (await q('select id, email, name from accounts where id = $1', [id])).rows[0];
      if (!acc) continue;
      const seen = (await q('select device, institution, version, last_seen from sacco_seen where account_id = $1 order by last_seen desc', [id])).rows;
      const lic = await licenceOf(id);
      out.push({ account_id: id, email: acc.email, name: acc.name, institutions: [...new Set(seen.map((x) => x.institution).filter(Boolean))], computers: seen.length,
        version: seen[0] ? seen[0].version : null, last_seen: seen[0] ? seen[0].last_seen : null, state: lic.state, tier: lic.state === 'licensed' ? lic.tier : lic.state === 'trial' ? 'trial' : null,
        term: lic.term || null, expires_at: lic.expires_at || null });
    }
    return out.sort((a, b) => String(b.last_seen || '').localeCompare(String(a.last_seen || '')));
  });

  /* ── the SACCO's books in the cloud: as Tallix's, kept apart from them ──
     A whole copy (gzipped SQLite) at a version, and the changes sent since, each
     the next version. A computer sends from the version it has (base_version):
     anything else is a 409, and the SACCO chooses which copy to keep. */
  const ownBook = async (req, me, cols = '*') => (await q(`select ${cols} from sacco_books where id = $1 and account_id = $2 and status = 'active'`, [String(req.params.id), me.id]).catch(() => ({ rows: [] }))).rows[0];
  const lapsed = async (me) => (await licenceOf(me.id)).state === 'expired';
  app.get('/v1/sacco/books', async (req, reply) => {
    const me = await whoami(req, reply); if (!me) return reply;
    return { books: (await q(`select id, name, version, snapshot_version, size, hash, updated_at, updated_from from sacco_books where account_id = $1 and status = 'active' order by created_at`, [me.id])).rows.map(bookMeta) };
  });
  app.post('/v1/sacco/books', async (req, reply) => {
    const me = await whoami(req, reply); if (!me) return reply;
    if (await lapsed(me)) return fail(reply, 402, 'licence', 'The SACCO Manager licence has run out. Renew it to keep the books in the cloud.');
    const have = Number((await q(`select count(*) n from sacco_books where account_id = $1 and status = 'active'`, [me.id])).rows[0].n);
    if (have >= BOOKS_PER_ACCOUNT) return fail(reply, 409, 'limit', `An account keeps up to ${BOOKS_PER_ACCOUNT} sets of books in the cloud.`);
    const name = String(req.body?.name || '').trim().slice(0, 120);
    if (!name) return fail(reply, 400, 'name', 'Name the SACCO.');
    const id = crypto.randomUUID();
    await q('insert into sacco_books (id, account_id, name) values ($1, $2, $3)', [id, me.id, name]);
    return bookMeta((await q('select * from sacco_books where id = $1', [id])).rows[0]);
  });
  /* ?meta=1: only the version (a computer checking whether anything changed) */
  app.get('/v1/sacco/books/:id', { config: { rateLimit: { max: 240, timeWindow: '1 hour' } } }, async (req, reply) => {
    const me = await whoami(req, reply); if (!me) return reply;
    const b = await ownBook(req, me);
    if (!b) return fail(reply, 404, 'notFound', 'No such books on this account.');
    if (req.query?.meta) return bookMeta(b);
    return { ...bookMeta(b), data: b.data ? Buffer.from(b.data).toString('base64') : null };
  });
  app.put('/v1/sacco/books/:id', { bodyLimit: MAX_BOOK * 1.4, config: { rateLimit: { max: 120, timeWindow: '1 hour' } } }, async (req, reply) => {
    const me = await whoami(req, reply); if (!me) return reply;
    if (await lapsed(me)) return fail(reply, 402, 'licence', 'The SACCO Manager licence has run out. Renew it to keep the books in the cloud.');
    const b = await ownBook(req, me, 'id, version');
    if (!b) return fail(reply, 404, 'notFound', 'No such books on this account.');
    const base = Number(req.body?.base_version);
    if (!Number.isInteger(base) || base !== b.version) return reply.code(409).send({ error: 'conflict', message: CONFLICT, version: b.version });
    let data;
    try { data = Buffer.from(String(req.body?.data || ''), 'base64'); } catch { data = null; }
    if (!data || data.length < 32 || data.length > MAX_BOOK) return fail(reply, 400, 'data', 'The books did not arrive whole.');
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    if (req.body?.hash && req.body.hash !== hash) return fail(reply, 400, 'data', 'The books did not arrive whole.');
    const r = await q(`update sacco_books set data = $1, size = $2, hash = $3, version = version + 1, snapshot_version = version + 1, updated_at = now(), updated_from = $4
      where id = $5 and version = $6 returning *`, [data, data.length, hash, String(req.body?.device || '').slice(0, 80) || null, b.id, base]);
    if (!r.rows[0]) return reply.code(409).send({ error: 'conflict', message: CONFLICT });
    await q('delete from sacco_book_ops where book_id = $1 and version <= $2', [b.id, r.rows[0].version]);   // the whole copy holds them
    return bookMeta(r.rows[0]);
  });
  app.post('/v1/sacco/books/:id/ops', { bodyLimit: 20 * 1024 * 1024, config: { rateLimit: { max: 600, timeWindow: '1 hour' } } }, async (req, reply) => {
    const me = await whoami(req, reply); if (!me) return reply;
    if (await lapsed(me)) return fail(reply, 402, 'licence', 'The SACCO Manager licence has run out. Renew it to keep the books in the cloud.');
    const b = await ownBook(req, me, 'id, version, snapshot_version, data is not null as has_data');
    if (!b) return fail(reply, 404, 'notFound', 'No such books on this account.');
    if (!b.has_data) return fail(reply, 409, 'snapshot', 'No whole copy is kept here yet: send the whole books first.');
    const base = Number(req.body?.base_version);
    if (!Number.isInteger(base) || base !== b.version) return reply.code(409).send({ error: 'conflict', message: CONFLICT, version: b.version });
    let data;
    try { data = Buffer.from(String(req.body?.data || ''), 'base64'); } catch { data = null; }
    if (!data || data.length < 10) return fail(reply, 400, 'data', 'The changes did not arrive whole.');
    const next = b.version + 1, dev = String(req.body?.device || '').slice(0, 80) || null;
    const up = await q('update sacco_books set version = $1, updated_at = now(), updated_from = $2 where id = $3 and version = $4 returning version', [next, dev, b.id, base]);
    if (!up.rows[0]) return reply.code(409).send({ error: 'conflict', message: CONFLICT });
    await q('insert into sacco_book_ops (book_id, version, data, count, device) values ($1, $2, $3, $4, $5)', [b.id, next, data, Math.max(0, Number(req.body?.count) || 0), dev]);
    const n = Number((await q('select count(*) n from sacco_book_ops where book_id = $1', [b.id])).rows[0].n);
    return { version: next, snapshot_version: b.snapshot_version, ops_since_snapshot: n };
  });
  /* the changes after a version (410 when the whole copy is newer than that: take it whole) */
  app.get('/v1/sacco/books/:id/ops', { config: { rateLimit: { max: 600, timeWindow: '1 hour' } } }, async (req, reply) => {
    const me = await whoami(req, reply); if (!me) return reply;
    const b = await ownBook(req, me, 'id, version, snapshot_version, data is not null as has_data');
    if (!b) return fail(reply, 404, 'notFound', 'No such books on this account.');
    if (!b.has_data) return fail(reply, 410, 'snapshot', 'Nothing is kept here yet: send the whole books first.');
    const since = Number(req.query?.since);
    if (!Number.isInteger(since) || since < b.snapshot_version) return fail(reply, 410, 'snapshot', 'Take the whole books: this computer is behind the last whole copy.');
    const rows = (await q('select version, data from sacco_book_ops where book_id = $1 and version > $2 order by version', [b.id, since])).rows;
    return { version: b.version, ops: rows.map((r) => ({ version: r.version, data: Buffer.from(r.data).toString('base64') })) };
  });

  /* ── the photos and documents that go with the books (1.10.5): listed, sent one at a time, taken one at a time ── */
  app.get('/v1/sacco/books/:id/files', async (req, reply) => {
    const me = await whoami(req, reply); if (!me) return reply;
    const b = await ownBook(req, me, 'id'); if (!b) return fail(reply, 404, 'notFound', 'No such books on this account.');
    const rows = (await q('select path, size, hash from sacco_book_files where book_id = $1 order by path', [b.id])).rows;
    return { files: rows.map((r) => ({ path: r.path, size: Number(r.size), hash: r.hash })) };
  });
  app.put('/v1/sacco/books/:id/files', { bodyLimit: Math.ceil(MAX_FILE * 1.4), config: { rateLimit: { max: 3000, timeWindow: '1 hour' } } }, async (req, reply) => {
    const me = await whoami(req, reply); if (!me) return reply;
    if (await lapsed(me)) return fail(reply, 402, 'licence', 'The SACCO Manager licence has run out. Renew it to keep the books in the cloud.');
    const b = await ownBook(req, me, 'id'); if (!b) return fail(reply, 404, 'notFound', 'No such books on this account.');
    const p = String(req.body?.path || '');
    if (!okPath(p)) return fail(reply, 400, 'path', 'Not a photo or document path.');
    let data; try { data = Buffer.from(String(req.body?.data || ''), 'base64'); } catch { data = null; }
    if (!data || !data.length || data.length > MAX_FILE) return fail(reply, 400, 'data', 'The file did not arrive whole, or is over 8 MB.');
    const used = Number((await q('select coalesce(sum(size),0) n from sacco_book_files where book_id = $1', [b.id])).rows[0].n);
    if (used + data.length > FILES_PER_BOOK) return fail(reply, 507, 'full', 'The cloud copy holds 4 GB of photos and documents, and it is full.');
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    await q(`insert into sacco_book_files (book_id, path, size, hash, data, device) values ($1,$2,$3,$4,$5,$6)
      on conflict (book_id, path) do update set size = $3, hash = $4, data = $5, device = $6, at = now()`, [b.id, p, data.length, hash, data, String(req.body?.device || '').slice(0, 80) || null]);
    return { path: p, size: data.length, hash };
  });
  app.get('/v1/sacco/books/:id/file', { config: { rateLimit: { max: 3000, timeWindow: '1 hour' } } }, async (req, reply) => {
    const me = await whoami(req, reply); if (!me) return reply;
    const b = await ownBook(req, me, 'id'); if (!b) return fail(reply, 404, 'notFound', 'No such books on this account.');
    const p = String(req.query?.path || '');
    if (!okPath(p)) return fail(reply, 400, 'path', 'Not a photo or document path.');
    const f = (await q('select data, hash from sacco_book_files where book_id = $1 and path = $2', [b.id, p])).rows[0];
    if (!f) return fail(reply, 404, 'notFound', 'No such file in the cloud copy.');
    return { path: p, hash: f.hash, data: Buffer.from(f.data).toString('base64') };
  });

  /* ── updates, as electron-updater's generic provider asks; ranges are served, so a
     computer downloads only the blocks that changed (sendranged.js). Public, like any
     software download, but only these shapes of name, from one folder. ── */
  app.get('/v1/sacco-desktop/:file', {
    config: { rateLimit: { max: 240, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const name = String(req.params.file || '');
    if (!SACCO_FILE.test(name)) return reply.code(404).send({ error: 'notFound' });
    const full = path.join(SACCO_DIR, name);
    let st;
    try { st = fs.statSync(full); } catch { return reply.code(404).send({ error: 'notFound' }); }
    return sendRanged(req, reply, full, st.size, {
      'content-type': name.endsWith('.yml') ? 'text/yaml; charset=utf-8' : 'application/octet-stream',
      'cache-control': name.endsWith('.yml') ? 'no-cache' : 'public, max-age=86400',
    });
  });
}
