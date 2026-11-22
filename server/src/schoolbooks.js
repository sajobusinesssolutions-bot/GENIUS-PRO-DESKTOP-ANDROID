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
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { q } from './db.js';
import { whoami } from './sync.js';
import { developer } from './admin.js';

const RELEASES_DIR = process.env.RELEASES_DIR || '/opt/genius/releases';
const SCHOOL_DIR = path.join(RELEASES_DIR, 'school');
const SCHOOL_FILE = /^(latest\.yml|(School-Manager|Tallix)-Setup-[0-9.]+\.exe(\.blockmap)?)$/;
const TRIAL_DAYS = 30;
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
  await q(`create table if not exists school_trials (account_id uuid primary key, started_at timestamptz not null default now())`);
  await q(`create table if not exists school_books (
    id uuid primary key, account_id uuid not null, name text not null, version int not null default 0,
    data bytea, size int not null default 0, hash text, updated_at timestamptz not null default now(), updated_from text,
    created_at timestamptz not null default now(), status text not null default 'active')`);
  await q('create index if not exists school_books_account on school_books(account_id)');
}

/** Where this account stands: a licence in force, a trial, or neither. */
async function licenceOf(accountId) {
  const l = (await q(`select * from school_licences where account_id = $1 and status = 'active'
    and (expires_at is null or expires_at > now()) order by expires_at desc nulls first limit 1`, [accountId])).rows[0];
  if (l) return { state: 'licensed', plan: l.plan, edition: l.edition || 'both', schools: l.schools, expires_at: l.expires_at };
  await q('insert into school_trials (account_id) values ($1) on conflict do nothing', [accountId]);
  const t = (await q('select started_at from school_trials where account_id = $1', [accountId])).rows[0];
  const ends = new Date(new Date(t.started_at).getTime() + TRIAL_DAYS * 864e5);
  const last = (await q(`select expires_at from school_licences where account_id = $1 order by started_at desc limit 1`, [accountId])).rows[0];
  if (ends > new Date()) return { state: 'trial', plan: 'trial', edition: 'both', schools: 1, expires_at: ends.toISOString() };
  return { state: 'expired', plan: null, schools: 0, expires_at: last ? last.expires_at : ends.toISOString() };
}

const meta = (b) => ({ id: b.id, name: b.name, version: b.version, size: b.size, hash: b.hash, updated_at: b.updated_at, updated_from: b.updated_from });

const ADMIN_PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>School Manager licences</title>
<style>body{font:14px/1.5 Roboto,'Segoe UI',system-ui,sans-serif;background:#f1f3f6;color:#111;margin:0;padding:24px}main{max-width:980px;margin:0 auto}h1{font-weight:500;font-size:22px}
.card{background:#fff;border-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.16);padding:16px 18px;margin-bottom:14px}input,select{font:inherit;padding:8px 10px;border:1px solid #d5d9e0;border-radius:4px;min-height:38px}
button{font:inherit;font-weight:500;padding:8px 14px;border-radius:4px;border:1px solid #0e6655;background:#0e6655;color:#fff;cursor:pointer;box-shadow:0 2px 5px rgba(0,0,0,.18)}button.g{background:#fff;color:#b42318;border-color:#efc9c5;box-shadow:none}
table{width:100%;border-collapse:collapse}th{font-size:11.5px;text-transform:uppercase;color:#6b7280;text-align:left;padding:8px;border-bottom:1px solid #e3e6ec}td{padding:8px;border-bottom:1px solid #eef0f4}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}#msg{color:#b42318}</style></head>
<body><main><h1>School Manager licences</h1><div id="msg"></div>
<div class="card" id="in"><div class="row"><input id="e" placeholder="Developer email"><input id="p" type="password" placeholder="Password"><button onclick="login()">Sign in</button></div></div>
<div id="app" style="display:none"><div class="card"><b>Grant a licence</b><div class="row" style="margin-top:8px"><input id="ge" placeholder="School's account email" style="flex:1">
<select id="gp"><option value="basic">Basic: students and fees</option><option value="standard">Standard: + academics, SMS, school life</option><option value="premium" selected>Premium: everything</option></select>
<select id="ged"><option value="both" selected>Finance and academics</option><option value="finance">Finance only</option><option value="academics">Academics only</option></select>
<select id="gd"><option value="30">30 days</option><option value="120">One term (120 days)</option><option value="365" selected>One year</option><option value="lifetime">Lifetime</option></select>
<input id="gs" type="number" value="1" min="1" style="width:80px" title="Schools"><input id="gn" placeholder="Note (receipt, amount)"><button onclick="grant()">Grant</button></div></div>
<div class="card"><table><thead><tr><th>Account</th><th>Plan</th><th>Covers</th><th>Schools</th><th>Status</th><th>Until</th><th>By</th><th></th></tr></thead><tbody id="list"></tbody></table></div></div>
<script>let t=sessionStorage.getItem('smadm')||'';const $=(i)=>document.getElementById(i);const say=(m)=>msg.textContent=m||'';
async function api(m,u,b){const r=await fetch(u,{method:m,headers:{'content-type':'application/json',authorization:'Bearer '+t},body:b?JSON.stringify(b):undefined});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.message||('Error '+r.status));return j}
async function login(){try{const r=await fetch('/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:e.value,password:p.value})});const j=await r.json();if(!r.ok)throw new Error(j.message||'Wrong email or password');t=j.access;sessionStorage.setItem('smadm',t);load()}catch(e){say(e.message)}}
async function load(){try{const l=await api('GET','/v1/admin/school/licences');in.style.display='none';app.style.display='';say('');
list.innerHTML=l.map(x=>'<tr><td>'+x.email+'</td><td>'+x.plan+'</td><td>'+(x.edition||'both')+'</td><td>'+x.schools+'</td><td>'+x.status+'</td><td>'+(x.expires_at?String(x.expires_at).slice(0,10):'lifetime')+'</td><td>'+(x.issued_by||'')+'</td><td>'+(x.status==='active'?'<button class=g onclick=revoke('+x.id+')>Revoke</button>':'')+'</td></tr>').join('')}catch(e){say(e.message)}}
async function grant(){try{await api('POST','/v1/admin/school/licences',{email:ge.value,plan:gp.value,edition:ged.value,days:gd.value==='lifetime'?null:Number(gd.value),schools:Number(gs.value),note:gn.value});ge.value='';load()}catch(e){say(e.message)}}
async function revoke(id){if(!confirm('Revoke this licence?'))return;try{await api('POST','/v1/admin/school/licences/'+id+'/revoke');load()}catch(e){say(e.message)}}
if(t)load();</script></main></body></html>`;

export default async function schoolBookRoutes(app) {
  await ensureTables();

  app.get('/v1/school/licence', async (req, reply) => {
    const me = await whoami(req, reply); if (!me) return reply;
    return { ...(await licenceOf(me.id)), now: new Date().toISOString(), email: me.email };
  });

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
    return { ...meta(b), data: b.data ? Buffer.from(b.data).toString('base64') : null };
  });

  app.put('/v1/school/books/:id', {
    bodyLimit: MAX_BOOK * 1.4,
    config: { rateLimit: { max: 120, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const me = await whoami(req, reply); if (!me) return reply;
    const lic = await licenceOf(me.id);
    if (lic.state === 'expired') return fail(reply, 402, 'licence', 'The School Manager licence has run out. Renew it to keep the book in the cloud.');
    const b = (await q(`select id, version from school_books where id = $1 and account_id = $2 and status = 'active'`, [String(req.params.id), me.id]).catch(() => ({ rows: [] }))).rows[0];
    if (!b) return fail(reply, 404, 'notFound', 'No such school book on this account.');
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
    const r = await q(`update school_books set data = $1, size = $2, hash = $3, version = version + 1, updated_at = now(), updated_from = $4
      where id = $5 and version = $6 returning id, name, version, size, hash, updated_at, updated_from`, [data, data.length, hash, from, b.id, base]);
    if (!r.rows[0]) return reply.code(409).send({ error: 'conflict', message: 'Another computer saved the book at the same moment.' });
    return meta(r.rows[0]);
  });

  /* ── the developer console ── */
  app.get('/v1/admin/school/licences', async (req, reply) => {
    if (!(await developer(req, reply))) return reply;
    return (await q(`select l.*, a.email from school_licences l join accounts a on a.id = l.account_id order by l.started_at desc limit 500`)).rows;
  });
  app.post('/v1/admin/school/licences', async (req, reply) => {
    const dev = await developer(req, reply); if (!dev) return reply;
    const email = String(req.body?.email || '').trim().toLowerCase();
    const acc = (await q('select id from accounts where lower(email) = $1', [email])).rows[0];
    if (!acc) return fail(reply, 404, 'notFound', 'No account with that email.');
    const days = req.body?.days === null || req.body?.days === 'lifetime' ? null : Math.max(1, Math.min(3660, Number(req.body?.days) || 365));
    const schools = Math.max(1, Math.min(50, Number(req.body?.schools) || 1));
    const plan = ['basic', 'standard', 'premium'].includes(req.body?.plan) ? req.body.plan : 'premium';
    const edition = ['finance', 'academics', 'both'].includes(req.body?.edition) ? req.body.edition : 'both';
    const r = await q(`insert into school_licences (account_id, plan, schools, expires_at, issued_by, note, edition)
      values ($1, $2, $3, case when $4::int is null then null else now() + ($4::int || ' days')::interval end, $5, $6, $7) returning *`,
    [acc.id, plan, schools, days, dev.email, String(req.body?.note || '').slice(0, 300) || null, edition]);
    return r.rows[0];
  });
  /* every school book kept here, with its account and size: the developer console's list of schools */
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
    config: { rateLimit: { max: 60, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const name = String(req.params.file || '');
    if (!SCHOOL_FILE.test(name)) return reply.code(404).send({ error: 'notFound' });
    const full = path.join(SCHOOL_DIR, name);
    let st;
    try { st = fs.statSync(full); } catch { return reply.code(404).send({ error: 'notFound' }); }
    reply
      .header('content-type', name.endsWith('.yml') ? 'text/yaml; charset=utf-8' : 'application/octet-stream')
      .header('content-length', st.size)
      .header('cache-control', name.endsWith('.yml') ? 'no-cache' : 'public, max-age=86400');
    return reply.send(fs.createReadStream(full));
  });
}
