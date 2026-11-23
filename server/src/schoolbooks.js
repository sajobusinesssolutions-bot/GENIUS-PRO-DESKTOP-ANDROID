/**
 * School Manager on the account server: its licence, its book kept in the
 * cloud, and its updates.
 *
 * A school signs in with a Genius Pro account (the same /v1/auth/login). Its
 * book — the whole SQLite file, gzipped — is kept here so a second computer
 * in the bursar's office can take it up, and so a dead computer loses nothing.
 * Each upload names the version it was made from; if another computer has
 * uploaded since, it is refused with 409 and the app asks which to keep, so
 * one office never overwrites another's work without being told.
 *
 * Licences are School Manager's own (school_licences), granted from the
 * developer console's API below; a new account gets a 30-day trial on its
 * first call. Tables create themselves on start.
 *
 * Tallix 0.13: two plans, Basic (the money side: students, fees, accounts,
 * payroll) and Pro (everything: academics, timetable, attendance, school life,
 * SMS and email too), each for one year, three years or for life, at prices
 * the developer sets. /v1/school/licence also hands back the licence signed
 * with the account server's Ed25519 key (the same key Genius POS checks), good
 * for 90 days: a school's computer checks it offline with the public half and
 * needs the internet only once in three months to carry on.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { q } from './db.js';
import { whoami } from './sync.js';
import { developer } from './admin.js';
import { SignJWT, importPKCS8 } from 'jose';
import * as momopay from './momopay.js';
import { sendRanged } from './sendranged.js';

const RELEASES_DIR = process.env.RELEASES_DIR || '/opt/genius/releases';
const SCHOOL_DIR = path.join(RELEASES_DIR, 'school');
const SCHOOL_FILE = /^(latest\.yml|(School-Manager|Tallix)-Setup-[0-9.]+\.exe(\.blockmap)?)$/;
const TRIAL_DAYS = 30;
/* how long a school's computer may go without checking in: three months */
const OFFLINE_DAYS = Number(process.env.SCHOOL_OFFLINE_DAYS || 90);
const PLANS = { basic: 'Basic: finance (students, fees, accounts, payroll)', pro: 'Pro: everything' };
const TERMS = { '1y': { label: 'One year', days: 365 }, '3y': { label: 'Three years', days: 1095 }, lifetime: { label: 'Lifetime', days: null } };
/* licences granted before 0.13 named other plans: they read as Pro */
const planOf = (p) => (p === 'basic' ? 'basic' : 'pro');
const termOf = (l) => l.term || (!l.expires_at ? 'lifetime' : null);

let key = null;
async function signingKey() {
  if (!key) key = await importPKCS8(fs.readFileSync(process.env.LICENCE_PRIVATE_KEY_PATH, 'utf8'), 'EdDSA');
  return key;
}
/** The licence as a token only this server can make; aud "tallix" so a Genius POS token is no use to it. */
async function signLicence(acc, lic) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: acc.email, state: lic.state, plan: lic.plan, term: lic.term || null, edition: lic.edition,
    until: lic.expires_at ? new Date(lic.expires_at).toISOString() : null, schools: lic.schools })
    .setProtectedHeader({ alg: 'EdDSA' }).setSubject(acc.id).setAudience('tallix').setIssuedAt(now)
    .setExpirationTime(now + OFFLINE_DAYS * 86400).setJti(crypto.randomBytes(9).toString('hex')).sign(await signingKey());
}
const MAX_BOOK = 150 * 1024 * 1024;

const fail = (reply, status, error, message) => reply.code(status).send({ error, message });

async function ensureTables() {
  await q(`create table if not exists school_licences (
    id bigserial primary key, account_id uuid not null, plan text not null default 'premium', schools int not null default 1,
    status text not null default 'active', started_at timestamptz not null default now(), expires_at timestamptz,
    issued_by text, note text)`);
  await q('create index if not exists school_licences_account on school_licences(account_id)');
  /* Tallix 0.12: a licence covers finance, academics, or both */
  await q(`alter table school_licences add column if not exists edition text not null default 'both'`);
  /* Tallix 0.13: the term bought and what was paid */
  await q(`alter table school_licences add column if not exists term text`);
  await q(`alter table school_licences add column if not exists amount bigint`);
  await q(`create table if not exists school_prices (plan text not null, term text not null, price bigint not null default 0,
    currency text not null default 'UGX', updated_at timestamptz not null default now(), updated_by text, primary key (plan, term))`);
  for (const p of Object.keys(PLANS)) for (const t of Object.keys(TERMS)) await q('insert into school_prices (plan, term) values ($1, $2) on conflict do nothing', [p, t]);
  /* every computer that checks its licence: which school, which version, when last */
  await q(`create table if not exists school_seen (account_id uuid not null, device text not null, school text, version text,
    first_seen timestamptz not null default now(), last_seen timestamptz not null default now(), primary key (account_id, device))`);
  /* Tallix 0.14: SMS delivery reports from Africa's Talking (its callback), read back by the school's computer */
  await q(`create table if not exists school_sms_dlr (id text primary key, status text, reason text, phone text, at timestamptz not null default now())`);
  /* Tallix 0.14: a licence bought from the app, paid by mobile money */
  await q(`create table if not exists school_purchases (id bigserial primary key, account_id uuid not null, plan text not null, term text not null, amount bigint not null,
    phone text not null, network text not null, ref text not null unique, status text not null default 'pending', reason text, licence_id bigint,
    at timestamptz not null default now(), done_at timestamptz)`);
  await q(`create table if not exists school_trials (account_id uuid primary key, started_at timestamptz not null default now())`);
  await q(`create table if not exists school_books (
    id uuid primary key, account_id uuid not null, name text not null, version int not null default 0,
    data bytea, size int not null default 0, hash text, updated_at timestamptz not null default now(), updated_from text,
    created_at timestamptz not null default now(), status text not null default 'active')`);
  await q('create index if not exists school_books_account on school_books(account_id)');
  /* Tallix 0.14: the changes made since the last whole copy, so a computer sends and takes only what changed */
  await q(`alter table school_books add column if not exists snapshot_version int not null default 0`);
  await q(`create table if not exists school_book_ops (book_id uuid not null, version int not null, data bytea not null, count int not null default 0,
    device text, at timestamptz not null default now(), primary key (book_id, version))`);
  /* a book saved whole before this: its copy is the one at its version */
  await q(`update school_books set snapshot_version = version where snapshot_version = 0 and data is not null
    and id not in (select book_id from school_book_ops)`);
}

/** Where this account stands: a licence in force, a trial, or neither. */
async function licenceOf(accountId) {
  const l = (await q(`select * from school_licences where account_id = $1 and status = 'active'
    and (expires_at is null or expires_at > now()) order by expires_at desc nulls first limit 1`, [accountId])).rows[0];
  if (l) { const plan = planOf(l.plan); return { state: 'licensed', plan, term: termOf(l), edition: plan === 'basic' ? 'finance' : 'both', schools: l.schools, expires_at: l.expires_at }; }
  await q('insert into school_trials (account_id) values ($1) on conflict do nothing', [accountId]);
  const t = (await q('select started_at from school_trials where account_id = $1', [accountId])).rows[0];
  const ends = new Date(new Date(t.started_at).getTime() + TRIAL_DAYS * 864e5);
  const last = (await q(`select expires_at from school_licences where account_id = $1 order by started_at desc limit 1`, [accountId])).rows[0];
  if (ends > new Date()) return { state: 'trial', plan: 'pro', term: 'trial', edition: 'both', schools: 1, expires_at: ends.toISOString() };
  return { state: 'expired', plan: null, schools: 0, expires_at: last ? last.expires_at : ends.toISOString() };
}

/** A licence granted (by the developer console, or bought): a renewal runs on from the end of the licence still in force, so no paid day is lost. */
async function grantLicence(accountId, { plan: p, term: t, schools: n, amount, note, by }) {
  const plan = PLANS[p] ? p : 'pro';
  const term = TERMS[t] ? t : '1y';
  const days = TERMS[term].days;
  const schools = Math.max(1, Math.min(50, Number(n) || 1));
  const cur = (await q(`select expires_at from school_licences where account_id = $1 and status = 'active' and expires_at > now() order by expires_at desc limit 1`, [accountId])).rows[0];
  const from = cur ? new Date(cur.expires_at) : new Date();
  const until = days === null ? null : new Date(from.getTime() + days * 864e5);
  const r = await q(`insert into school_licences (account_id, plan, term, schools, expires_at, issued_by, note, edition, amount)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
  [accountId, plan, term, schools, until, by || null, String(note || '').slice(0, 300) || null, plan === 'basic' ? 'finance' : 'both', amount ?? null]);
  return { ...r.rows[0], amount: r.rows[0].amount === null ? null : Number(r.rows[0].amount) };
}
/* SALJOE TECH's own MTN and Airtel keys, from /etc/genius/api.env: without them, buying in the app is not open yet */
const sellKeys = () => ({
  mtn: process.env.MTN_MOMO_KEY ? { key: process.env.MTN_MOMO_KEY, user: process.env.MTN_MOMO_USER, secret: process.env.MTN_MOMO_SECRET, env: process.env.MTN_MOMO_ENV || 'live', target: process.env.MTN_MOMO_TARGET } : null,
  airtel: process.env.AIRTEL_CLIENT_ID ? { id: process.env.AIRTEL_CLIENT_ID, secret: process.env.AIRTEL_CLIENT_SECRET, env: process.env.AIRTEL_ENV || 'live' } : null,
});
const meta = (b) => ({ id: b.id, name: b.name, version: b.version, snapshot_version: b.snapshot_version, size: b.size, hash: b.hash, updated_at: b.updated_at, updated_from: b.updated_from });
/* a Tallix older than 0.14 knows only whole copies: while changes wait on top of the copy, it must update first, or it would miss them */
const UPGRADE = 'The school\'s book has changes saved by a newer Tallix. Update Tallix on this computer (About Tallix → Check for an update), then try again.';
const newClient = (req) => Number(req.query?.client || req.body?.client || 0) >= 2;

const ADMIN_PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tallix licences</title>
<style>body{font:14px/1.5 Roboto,'Segoe UI',system-ui,sans-serif;background:#f1f3f6;color:#111;margin:0;padding:24px}main{max-width:980px;margin:0 auto}h1{font-weight:500;font-size:22px}
.card{background:#fff;border-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.16);padding:16px 18px;margin-bottom:14px}input,select{font:inherit;padding:8px 10px;border:1px solid #d5d9e0;border-radius:4px;min-height:38px}
button{font:inherit;font-weight:500;padding:8px 14px;border-radius:4px;border:1px solid #0e6655;background:#0e6655;color:#fff;cursor:pointer;box-shadow:0 2px 5px rgba(0,0,0,.18)}button.g{background:#fff;color:#b42318;border-color:#efc9c5;box-shadow:none}
table{width:100%;border-collapse:collapse}th{font-size:11.5px;text-transform:uppercase;color:#6b7280;text-align:left;padding:8px;border-bottom:1px solid #e3e6ec}td{padding:8px;border-bottom:1px solid #eef0f4}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}#msg{color:#b42318}</style></head>
<body><main><h1>Tallix licences</h1><div id="msg"></div>
<div class="card" id="in"><div class="row"><input id="e" placeholder="Developer email"><input id="p" type="password" placeholder="Password"><button onclick="login()">Sign in</button></div></div>
<div id="app" style="display:none"><div class="card"><b>Grant a licence</b><div class="row" style="margin-top:8px"><input id="ge" placeholder="School's account email" style="flex:1">
<select id="gp"><option value="basic">Basic: finance</option><option value="pro" selected>Pro: everything</option></select>
<select id="gd"><option value="1y" selected>One year</option><option value="3y">Three years</option><option value="lifetime">Lifetime</option></select>
<input id="gs" type="number" value="1" min="1" style="width:80px" title="Schools"><input id="ga" type="number" placeholder="Amount paid (blank: the price)" style="width:200px"><input id="gn" placeholder="Note (receipt)"><button onclick="grant()">Grant</button></div></div>
<div class="card"><b>Prices</b><div id="pr" class="row" style="margin-top:8px"></div><div style="margin-top:8px"><button onclick="savePrices()">Save prices</button></div></div>
<div class="card"><table><thead><tr><th>Account</th><th>Plan</th><th>For</th><th>Schools</th><th>Status</th><th>Until</th><th>By</th><th></th></tr></thead><tbody id="list"></tbody></table></div></div>
<script>let t=sessionStorage.getItem('smadm')||'';const $=(i)=>document.getElementById(i);const say=(m)=>msg.textContent=m||'';
async function api(m,u,b){const r=await fetch(u,{method:m,headers:{'content-type':'application/json',authorization:'Bearer '+t},body:b?JSON.stringify(b):undefined});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.message||('Error '+r.status));return j}
async function login(){try{const r=await fetch('/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:e.value,password:p.value})});const j=await r.json();if(!r.ok)throw new Error(j.message||'Wrong email or password');t=j.access;sessionStorage.setItem('smadm',t);load()}catch(e){say(e.message)}}
async function load(){try{const l=await api('GET','/v1/admin/school/licences');in.style.display='none';app.style.display='';say('');
prices();list.innerHTML=l.map(x=>'<tr><td>'+x.email+'</td><td>'+x.plan+'</td><td>'+(x.term||'')+'</td><td>'+x.schools+'</td><td>'+x.status+'</td><td>'+(x.expires_at?String(x.expires_at).slice(0,10):'lifetime')+'</td><td>'+(x.issued_by||'')+'</td><td>'+(x.status==='active'?'<button class=g onclick=revoke('+x.id+')>Revoke</button>':'')+'</td></tr>').join('')}catch(e){say(e.message)}}
async function grant(){try{await api('POST','/v1/admin/school/licences',{email:ge.value,plan:gp.value,term:gd.value,schools:Number(gs.value),amount:ga.value===''?null:Number(ga.value),note:gn.value});ge.value='';load()}catch(e){say(e.message)}}
async function prices(){const p=await api('GET','/v1/admin/school/prices');pr.innerHTML=p.map(x=>'<label>'+x.plan+' · '+x.term+' <input data-p="'+x.plan+'" data-t="'+x.term+'" type="number" value="'+x.price+'" style="width:130px"> '+x.currency+'</label>').join('')}
async function savePrices(){try{await api('PUT','/v1/admin/school/prices',{prices:[...pr.querySelectorAll('input')].map(i=>({plan:i.dataset.p,term:i.dataset.t,price:Number(i.value)}))});say('Prices saved');prices()}catch(e){say(e.message)}}
async function revoke(id){if(!confirm('Revoke this licence?'))return;try{await api('POST','/v1/admin/school/licences/'+id+'/revoke');load()}catch(e){say(e.message)}}
if(t)load();</script></main></body></html>`;

export default async function schoolBookRoutes(app) {
  await ensureTables();
  /* Africa's Talking posts its delivery reports as a form */
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 64 * 1024 },
    (req, body, done) => { try { done(null, Object.fromEntries(new URLSearchParams(body))); } catch (e) { done(e); } });

  /*
   * Tallix 0.14: an SMS's delivery report. A school sets this address as the
   * delivery-report callback in its Africa's Talking account; Tallix then asks
   * for its own messages by their ids (which only the sender knows).
   */
  app.post('/v1/sms/dlr', { config: { rateLimit: { max: 6000, timeWindow: '1 hour' } } }, async (req) => {
    const b = req.body || {};
    const id = String(b.id || '').slice(0, 120);
    if (id) {
      await q(`insert into school_sms_dlr (id, status, reason, phone) values ($1, $2, $3, $4)
        on conflict (id) do update set status = $2, reason = $3, at = now()`, [id, String(b.status || '').slice(0, 40), String(b.failureReason || '').slice(0, 120) || null, String(b.phoneNumber || '').slice(0, 20) || null]);
    }
    return { ok: true };
  });
  app.get('/v1/school/sms-status', async (req, reply) => {
    const me = await whoami(req, reply); if (!me) return reply;
    const ids = String(req.query?.ids || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 200);
    if (!ids.length) return { reports: [] };
    const rows = (await q('select id, status, reason, at from school_sms_dlr where id = any($1)', [ids])).rows;
    return { reports: rows };
  });

  app.get('/v1/school/licence', async (req, reply) => {
    const me = await whoami(req, reply); if (!me) return reply;
    const lic = await licenceOf(me.id);
    /* the school names itself (Tallix 0.13): the developer console lists it before any licence or cloud book */
    const device = String(req.query?.device || '').slice(0, 80);
    if (device) {
      await q(`insert into school_seen (account_id, device, school, version) values ($1, $2, $3, $4)
        on conflict (account_id, device) do update set school = $3, version = $4, last_seen = now()`,
      [me.id, device, String(req.query?.school || '').slice(0, 160) || null, String(req.query?.version || '').slice(0, 20) || null]).catch(() => null);
    }
    let token = null;
    try { token = await signLicence(me, lic); } catch (e) { req.log.error({ err: e.message }, 'school licence not signed'); }
    return { ...lic, now: new Date().toISOString(), email: me.email, token, offline_days: OFFLINE_DAYS };
  });

  /*
   * Tallix 0.14: a school buys its licence in the app. A prompt for the price
   * goes to the phone given (MTN or Airtel); the school approves it with its
   * PIN; the app asks how it stands, and the moment it is paid the licence is
   * granted to the account (once) and the app checks its licence again.
   */
  app.post('/v1/school/buy', async (req, reply) => {
    const me = await whoami(req, reply); if (!me) return reply;
    const keys = sellKeys();
    if (!keys.mtn && !keys.airtel) return fail(reply, 503, 'closed', 'Paying in the app is not open yet. Buy or renew on WhatsApp with SALJOE TECH.');
    const plan = PLANS[req.body?.plan] ? req.body.plan : null, term = TERMS[req.body?.term] ? req.body.term : null;
    if (!plan || !term) return fail(reply, 400, 'malformed', 'Choose the plan and how long.');
    const price = (await q('select price from school_prices where plan = $1 and term = $2', [plan, term])).rows[0];
    if (!price || !(Number(price.price) > 0)) return fail(reply, 409, 'price', 'That plan has no price yet. Contact SALJOE TECH.');
    const phone = String(req.body?.phone || '');
    const net = momopay.networkOf(phone);
    if (!net) return fail(reply, 400, 'phone', 'Give an MTN or Airtel number to pay from.');
    if ((net === 'mtn' && !keys.mtn) || (net === 'airtel' && !keys.airtel)) return fail(reply, 409, 'network', `Paying with ${net === 'mtn' ? 'MTN' : 'Airtel'} is not open yet: use the other network, or WhatsApp.`);
    let r;
    try { r = await momopay.request(keys, { amount: Number(price.price), phone, note: `Tallix ${plan === 'basic' ? 'Basic' : 'Pro'} ${TERMS[term].label}` }); }
    catch (e) { return fail(reply, 502, 'provider', String(e.message || e)); }
    const row = (await q(`insert into school_purchases (account_id, plan, term, amount, phone, network, ref) values ($1, $2, $3, $4, $5, $6, $7) returning id, status, amount`,
      [me.id, plan, term, Number(price.price), momopay.msisdn(phone), r.network, r.ref])).rows[0];
    return { id: Number(row.id), status: row.status, amount: Number(row.amount), network: r.network };
  });
  app.get('/v1/school/buy/:id', async (req, reply) => {
    const me = await whoami(req, reply); if (!me) return reply;
    const p = (await q('select * from school_purchases where id = $1 and account_id = $2', [Number(req.params.id), me.id])).rows[0];
    if (!p) return fail(reply, 404, 'notFound', 'No such purchase.');
    if (p.status === 'pending') {
      let st;
      try { st = await momopay.status(sellKeys(), p.network, p.ref); } catch (e) { return { id: Number(p.id), status: 'pending', note: String(e.message || e) }; }
      if (st.state === 'paid') {
        /* once: only the request that moves it from pending grants the licence */
        const won = (await q(`update school_purchases set status = 'paid', done_at = now() where id = $1 and status = 'pending' returning id`, [p.id])).rows[0];
        if (won) {
          const lic = await grantLicence(p.account_id, { plan: p.plan, term: p.term, amount: Number(p.amount), note: `Bought in the app: ${p.network === 'mtn' ? 'MTN' : 'Airtel'} ${p.phone}, ${st.txn || p.ref}`, by: 'mobile money' });
          await q('update school_purchases set licence_id = $2 where id = $1', [p.id, lic.id]);
        }
        p.status = 'paid';
      } else if (st.state === 'failed') {
        await q(`update school_purchases set status = 'failed', reason = $2, done_at = now() where id = $1 and status = 'pending'`, [p.id, String(st.reason || 'Not approved').slice(0, 200)]);
        p.status = 'failed'; p.reason = st.reason || 'Not approved';
      }
    }
    return { id: Number(p.id), status: p.status, reason: p.reason || null, plan: p.plan, term: p.term, amount: Number(p.amount) };
  });

  /* what each plan costs, for the school's Plan & licence page (no sign-in needed) */
  app.get('/v1/school/prices', async () => ({ buy: !!(sellKeys().mtn || sellKeys().airtel), plans: PLANS, terms: Object.fromEntries(Object.entries(TERMS).map(([k, v]) => [k, v.label])),
    prices: (await q('select plan, term, price, currency from school_prices order by plan, term')).rows.map((r) => ({ ...r, price: Number(r.price) })),
    offline_days: OFFLINE_DAYS, trial_days: TRIAL_DAYS }));

  app.get('/v1/school/books', async (req, reply) => {
    const me = await whoami(req, reply); if (!me) return reply;
    const rows = (await q(`select id, name, version, size, hash, updated_at, updated_from from school_books where account_id = $1 and status = 'active' order by created_at`, [me.id])).rows;
    return { books: rows.map(meta) };
  });

  app.post('/v1/school/books', async (req, reply) => {
    const me = await whoami(req, reply); if (!me) return reply;
    const lic = await licenceOf(me.id);
    if (lic.state === 'expired') return fail(reply, 402, 'licence', 'The School Manager licence has run out. Renew it to keep the book in the cloud.');
    const have = Number((await q(`select count(*) n from school_books where account_id = $1 and status = 'active'`, [me.id])).rows[0].n);
    if (have >= Math.max(1, lic.schools)) return fail(reply, 409, 'limit', `This licence covers ${lic.schools} school${lic.schools === 1 ? '' : 's'}.`);
    const name = String(req.body?.name || '').trim().slice(0, 120);
    if (!name) return fail(reply, 400, 'name', 'Name the school.');
    const id = crypto.randomUUID();
    await q('insert into school_books (id, account_id, name) values ($1, $2, $3)', [id, me.id, name]);
    return meta((await q('select * from school_books where id = $1', [id])).rows[0]);
  });

  /* ?meta=1: only the version (a computer checking whether anything changed). */
  app.get('/v1/school/books/:id', {
    config: { rateLimit: { max: 240, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const me = await whoami(req, reply); if (!me) return reply;
    const b = (await q(`select * from school_books where id = $1 and account_id = $2 and status = 'active'`, [String(req.params.id), me.id]).catch(() => ({ rows: [] }))).rows[0];
    if (!b) return fail(reply, 404, 'notFound', 'No such school book on this account.');
    if (req.query?.meta) return meta(b);
    if (!newClient(req) && b.version > b.snapshot_version) return fail(reply, 409, 'upgrade', UPGRADE);
    return { ...meta(b), data: b.data ? Buffer.from(b.data).toString('base64') : null };
  });

  app.put('/v1/school/books/:id', {
    bodyLimit: MAX_BOOK * 1.4,
    config: { rateLimit: { max: 120, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const me = await whoami(req, reply); if (!me) return reply;
    const lic = await licenceOf(me.id);
    if (lic.state === 'expired') return fail(reply, 402, 'licence', 'The School Manager licence has run out. Renew it to keep the book in the cloud.');
    const b = (await q(`select id, version, snapshot_version from school_books where id = $1 and account_id = $2 and status = 'active'`, [String(req.params.id), me.id]).catch(() => ({ rows: [] }))).rows[0];
    if (!b) return fail(reply, 404, 'notFound', 'No such school book on this account.');
    if (!newClient(req) && b.version > b.snapshot_version) return fail(reply, 409, 'upgrade', UPGRADE);
    const base = Number(req.body?.base_version);
    if (!Number.isInteger(base) || base !== b.version) {
      return reply.code(409).send({ error: 'conflict', message: 'Another computer saved the book since this one last took it.', version: b.version });
    }
    let data;
    try { data = Buffer.from(String(req.body?.data || ''), 'base64'); } catch { data = null; }
    if (!data || data.length < 32 || data.length > MAX_BOOK) return fail(reply, 400, 'data', 'The book did not arrive whole.');
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    if (req.body?.hash && req.body.hash !== hash) return fail(reply, 400, 'data', 'The book did not arrive whole.');
    const from = String(req.body?.device || '').slice(0, 80) || null;
    // the version check again inside the update: two uploads at once, one wins
    const r = await q(`update school_books set data = $1, size = $2, hash = $3, version = version + 1, snapshot_version = version + 1, updated_at = now(), updated_from = $4
      where id = $5 and version = $6 returning id, name, version, snapshot_version, size, hash, updated_at, updated_from`, [data, data.length, hash, from, b.id, base]);
    if (!r.rows[0]) return reply.code(409).send({ error: 'conflict', message: 'Another computer saved the book at the same moment.' });
    /* the whole copy holds every change before it */
    await q('delete from school_book_ops where book_id = $1 and version <= $2', [b.id, r.rows[0].version]);
    return meta(r.rows[0]);
  });

  /* Tallix 0.14: only the changes since the version this computer has (base_version), gzipped */
  app.post('/v1/school/books/:id/ops', {
    bodyLimit: 20 * 1024 * 1024,
    config: { rateLimit: { max: 600, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const me = await whoami(req, reply); if (!me) return reply;
    const lic = await licenceOf(me.id);
    if (lic.state === 'expired') return fail(reply, 402, 'licence', 'The Tallix licence has run out. Renew it to keep the book in the cloud.');
    const b = (await q(`select id, version, snapshot_version, data from school_books where id = $1 and account_id = $2 and status = 'active'`, [String(req.params.id), me.id]).catch(() => ({ rows: [] }))).rows[0];
    if (!b) return fail(reply, 404, 'notFound', 'No such school book on this account.');
    if (!b.data) return fail(reply, 409, 'snapshot', 'The book has no whole copy here yet: send the whole book first.');
    const base = Number(req.body?.base_version);
    if (!Number.isInteger(base) || base !== b.version) return reply.code(409).send({ error: 'conflict', message: 'Another computer saved the book since this one last took it.', version: b.version });
    let data;
    try { data = Buffer.from(String(req.body?.data || ''), 'base64'); } catch { data = null; }
    if (!data || data.length < 10) return fail(reply, 400, 'data', 'The changes did not arrive whole.');
    const next = b.version + 1;
    const up = await q(`update school_books set version = $1, updated_at = now(), updated_from = $2 where id = $3 and version = $4 returning version`,
      [next, String(req.body?.device || '').slice(0, 80) || null, b.id, base]);
    if (!up.rows[0]) return reply.code(409).send({ error: 'conflict', message: 'Another computer saved the book at the same moment.' });
    await q('insert into school_book_ops (book_id, version, data, count, device) values ($1, $2, $3, $4, $5)',
      [b.id, next, data, Math.max(0, Number(req.body?.count) || 0), String(req.body?.device || '').slice(0, 80) || null]);
    const n = Number((await q('select count(*) n from school_book_ops where book_id = $1', [b.id])).rows[0].n);
    return { version: next, snapshot_version: b.snapshot_version, ops_since_snapshot: n };
  });
  /* the changes after a version: those a computer at that version needs (410 when the whole copy is newer than it) */
  app.get('/v1/school/books/:id/ops', {
    config: { rateLimit: { max: 600, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const me = await whoami(req, reply); if (!me) return reply;
    const b = (await q(`select id, version, snapshot_version, data is not null as has_data from school_books where id = $1 and account_id = $2 and status = 'active'`, [String(req.params.id), me.id]).catch(() => ({ rows: [] }))).rows[0];
    if (!b) return fail(reply, 404, 'notFound', 'No such school book on this account.');
    if (!b.has_data) return fail(reply, 410, 'snapshot', 'Nothing is kept here yet: send the whole book first.');
    const since = Number(req.query?.since);
    if (!Number.isInteger(since) || since < b.snapshot_version) return fail(reply, 410, 'snapshot', 'Take the whole book: this computer is behind the last whole copy.');
    const rows = (await q('select version, data from school_book_ops where book_id = $1 and version > $2 order by version', [b.id, since])).rows;
    return { version: b.version, ops: rows.map((r) => ({ version: r.version, data: Buffer.from(r.data).toString('base64') })) };
  });

  /* ── the developer console ── */
  app.get('/v1/admin/school/licences', async (req, reply) => {
    if (!(await developer(req, reply))) return reply;
    return (await q(`select l.*, a.email from school_licences l join accounts a on a.id = l.account_id order by l.started_at desc limit 500`)).rows
      .map((l) => ({ ...l, plan: planOf(l.plan), old_plan: l.plan, term: termOf(l), amount: l.amount === null ? null : Number(l.amount) }));
  });
  app.get('/v1/admin/school/prices', async (req, reply) => {
    if (!(await developer(req, reply))) return reply;
    return (await q('select plan, term, price, currency, updated_at, updated_by from school_prices order by plan, term')).rows.map((r) => ({ ...r, price: Number(r.price) }));
  });
  /* body: { prices: [{ plan, term, price, currency? }] } */
  app.put('/v1/admin/school/prices', async (req, reply) => {
    const dev = await developer(req, reply); if (!dev) return reply;
    for (const p of Array.isArray(req.body?.prices) ? req.body.prices : []) {
      if (!PLANS[p.plan] || !TERMS[p.term]) continue;
      const price = Math.max(0, Math.round(Number(p.price) || 0));
      const cur = /^[A-Z]{3}$/.test(String(p.currency || '')) ? p.currency : 'UGX';
      await q(`insert into school_prices (plan, term, price, currency, updated_at, updated_by) values ($1, $2, $3, $4, now(), $5)
        on conflict (plan, term) do update set price = $3, currency = $4, updated_at = now(), updated_by = $5`, [p.plan, p.term, price, cur, dev.email]);
    }
    return (await q('select plan, term, price, currency, updated_at, updated_by from school_prices order by plan, term')).rows.map((r) => ({ ...r, price: Number(r.price) }));
  });
  app.post('/v1/admin/school/licences', async (req, reply) => {
    const dev = await developer(req, reply); if (!dev) return reply;
    const email = String(req.body?.email || '').trim().toLowerCase();
    const acc = (await q('select id from accounts where lower(email) = $1', [email])).rows[0];
    if (!acc) return fail(reply, 404, 'notFound', 'No account with that email.');
    const listed = (await q('select price from school_prices where plan = $1 and term = $2', [PLANS[req.body?.plan] ? req.body.plan : 'pro', TERMS[req.body?.term] ? req.body.term : '1y'])).rows[0];
    const amount = req.body?.amount === undefined || req.body?.amount === null || req.body?.amount === '' ? (listed ? Number(listed.price) : null) : Math.max(0, Math.round(Number(req.body.amount) || 0));
    return grantLicence(acc.id, { plan: req.body?.plan, term: req.body?.term, schools: req.body?.schools, amount, note: req.body?.note, by: dev.email });
  });
  /* every account that uses Tallix — seen checking its licence, on a trial, licensed or keeping a book here —
     with its schools and computers and where its licence stands: so a school is there to grant to */
  app.get('/v1/admin/school/schools', async (req, reply) => {
    if (!(await developer(req, reply))) return reply;
    const ids = (await q(`select account_id from school_seen union select account_id from school_trials
      union select account_id from school_licences union select account_id from school_books`)).rows.map((r) => r.account_id);
    const out = [];
    for (const id of ids.slice(0, 1000)) {
      const acc = (await q('select id, email, name from accounts where id = $1', [id])).rows[0];
      if (!acc) continue;
      const seen = (await q('select device, school, version, first_seen, last_seen from school_seen where account_id = $1 order by last_seen desc', [id])).rows;
      const books = (await q(`select name from school_books where account_id = $1 and status = 'active'`, [id])).rows.map((b) => b.name);
      const lic = await licenceOf(id);
      out.push({ account_id: id, email: acc.email, name: acc.name, schools: [...new Set([...seen.map((x) => x.school).filter(Boolean), ...books])],
        computers: seen.length, version: seen[0] ? seen[0].version : null, last_seen: seen[0] ? seen[0].last_seen : null,
        state: lic.state, plan: lic.state === 'licensed' ? lic.plan : lic.state === 'trial' ? 'trial' : null, term: lic.term || null, expires_at: lic.expires_at || null });
    }
    return out.sort((a, b) => String(b.last_seen || '').localeCompare(String(a.last_seen || '')));
  });
  /* every school book kept here, with its account and size */
  app.get('/v1/admin/school/books', async (req, reply) => {
    if (!(await developer(req, reply))) return reply;
    return (await q(`select b.id, b.name, b.version, b.size, b.updated_at, b.updated_from, b.created_at, a.email
      from school_books b join accounts a on a.id = b.account_id where b.status = 'active' order by b.updated_at desc limit 500`)).rows;
  });
  app.post('/v1/admin/school/licences/:id/revoke', async (req, reply) => {
    if (!(await developer(req, reply))) return reply;
    await q(`update school_licences set status = 'revoked' where id = $1`, [Number(req.params.id)]);
    return { ok: true };
  });

  /* The developer's page for School Manager licences: sign in with a developer account, grant, revoke. */
  app.get('/v1/admin/school', async (req, reply) => reply.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-store').send(ADMIN_PAGE));

  /* ── updates: latest.yml and the installer, as electron-updater's generic provider asks ── */
  app.get('/v1/school-desktop/:file', {
    config: { rateLimit: { max: 240, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const name = String(req.params.file || '');
    if (!SCHOOL_FILE.test(name)) return reply.code(404).send({ error: 'notFound' });
    const full = path.join(SCHOOL_DIR, name);
    let st;
    try { st = fs.statSync(full); } catch { return reply.code(404).send({ error: 'notFound' }); }
    /* the parts asked for, so a school's computer downloads only the blocks that changed (sendranged.js) */
    return sendRanged(req, reply, full, st.size, {
      'content-type': name.endsWith('.yml') ? 'text/yaml; charset=utf-8' : 'application/octet-stream',
      'cache-control': name.endsWith('.yml') ? 'no-cache' : 'public, max-age=86400',
    });
  });
}
