/**
 * The developer console's server side.
 *
 * Everything here is for whoever runs the service, not for shop owners, and
 * every route checks that before doing anything. A developer is named by email
 * in DEVELOPER_EMAILS on the server — never by anything a phone can send — so
 * the only way to become one is to have a shell on this box.
 *
 * What it answers:
 *   · who the owners are, when they last signed in, what licence they hold and
 *     when it ends, what businesses sit under their email, how much space those
 *     take up;
 *   · the three lists that need acting on — lapsed, lapsing, still on trial;
 *   · how the machine itself is coping, live, to know when to upscale;
 *   · backups of every tenant at once, in case the box is lost.
 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { q } from './db.js';
import { readAccess } from './tokens.js';
import { effectiveStatus } from './sync.js';
import { sendInvite } from './mail.js';

const BACKUP_DIR = process.env.BACKUP_DIR || '/var/backups/genius';
const KEEP_BACKUPS = Number(process.env.KEEP_BACKUPS || 14);
const SOON_DAYS = 14;

const developers = () => String(process.env.DEVELOPER_EMAILS || '')
  .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

const fail = (reply, status, error, message) => reply.code(status).send({ error, message });

/** The caller, if and only if they are a developer. */
export async function developer(req, reply) {
  const h = String(req.headers.authorization || '');
  if (!h.startsWith('Bearer ')) { fail(reply, 401, 'badCredentials', 'Sign in again.'); return null; }
  let claims;
  try { claims = await readAccess(h.slice(7)); } catch {
    fail(reply, 401, 'badCredentials', 'That session has expired. Sign in again.');
    return null;
  }
  if (!developers().includes(String(claims.email || '').toLowerCase())) {
    // said as a 404 rather than a 403, so the console's existence is not advertised
    fail(reply, 404, 'server', 'Not found.');
    return null;
  }
  return { id: claims.sub, email: claims.email };
}

/* ================================================================
   Request metrics — a rolling minute-by-minute window, in memory.
   ================================================================ */

const WINDOW_MIN = 60;
const minutes = new Map(); // minute timestamp -> { n, errors, total, slowest, samples[] }
const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();

function bucket(t = Date.now()) {
  const m = Math.floor(t / 60000) * 60000;
  let b = minutes.get(m);
  if (!b) {
    b = { n: 0, errors: 0, total: 0, slowest: 0, samples: [] };
    minutes.set(m, b);
    for (const k of minutes.keys()) if (k < m - WINDOW_MIN * 60000) minutes.delete(k);
  }
  return b;
}

/** Called for every finished request. Cheap enough to run on all of them. */
export function recordRequest(ms, status) {
  const b = bucket();
  b.n += 1;
  b.total += ms;
  if (ms > b.slowest) b.slowest = ms;
  if (status >= 500) b.errors += 1;
  if (b.samples.length < 500) b.samples.push(ms);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

/* ================================================================
   Owners
   ================================================================ */

async function owners() {
  const { rows } = await q(`
    select a.id, a.email, a.name, a.status, a.blocked_reason, a.created_at,
           a.last_login_at, a.last_seen_at,
           l.plan, l.term, l.seats, l.status as lic_status, l.expires_at, l.started_at as licensed_at,
           (select count(*)::int from devices d where d.account_id = a.id and d.revoked_at is null) as devices,
           (select coalesce(json_agg(json_build_object('id', b.id, 'name', b.name, 'created', b.created_at)
                    order by b.created_at), '[]'::json)
              from businesses b where b.account_id = a.id) as businesses,
           (select count(*)::int from ops o join businesses b on b.id = o.business_id where b.account_id = a.id) as ops,
           (select coalesce(sum(pg_column_size(o.payload)), 0)::bigint
              from ops o join businesses b on b.id = o.business_id where b.account_id = a.id)
         + (select coalesce(sum(pg_column_size(r.doc)), 0)::bigint
              from records r join businesses b on b.id = r.business_id where b.account_id = a.id) as bytes
      from accounts a
      left join lateral (
        select * from licences where account_id = a.id order by started_at desc limit 1
      ) l on true
     order by a.created_at desc`);

  const now = Date.now();
  return rows.map((r) => {
    const licence = r.plan ? { plan: r.plan, status: r.lic_status, expires_at: r.expires_at } : null;
    const status = effectiveStatus(r, licence);
    const daysLeft = r.expires_at ? Math.ceil((new Date(r.expires_at).getTime() - now) / 86400000) : null;
    return {
      id: r.id,
      email: r.email,
      name: r.name,
      blocked: r.status === 'blocked',
      blockedReason: r.blocked_reason,
      createdAt: r.created_at,
      lastLoginAt: r.last_login_at,
      lastSeenAt: r.last_seen_at,
      licence: r.plan ? {
        plan: r.plan, term: r.term, seats: r.seats, status,
        expiresAt: r.expires_at, daysLeft, since: r.licensed_at,
      } : null,
      devices: r.devices,
      businesses: r.businesses,
      ops: r.ops,
      bytes: Number(r.bytes),
    };
  });
}

/* ================================================================
   Backups
   ================================================================ */

function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.dump'))
    .map((f) => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      return { name: f, bytes: st.size, at: st.mtime.toISOString() };
    })
    .sort((a, b) => (a.at < b.at ? 1 : -1));
}

/**
 * A full, consistent dump of every tenant at once.
 *
 * pg_dump in custom format takes one snapshot of the whole database, so every
 * business in it is from the same instant — restoring one never finds another
 * half a transaction ahead. Old dumps beyond KEEP_BACKUPS are removed so the
 * disk does not quietly fill.
 */
export function runBackup() {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(BACKUP_DIR, 'genius-' + stamp + '.dump');
    const started = Date.now();
    const p = spawn('pg_dump', ['--format=custom', '--no-owner', '--file=' + file, process.env.DATABASE_URL]);
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) { reject(new Error(err.trim() || 'pg_dump exited ' + code)); return; }
      listBackups().slice(KEEP_BACKUPS).forEach((b) => {
        try { fs.unlinkSync(path.join(BACKUP_DIR, b.name)); } catch { /* ignore */ }
      });
      resolve({ name: path.basename(file), bytes: fs.statSync(file).size, ms: Date.now() - started });
    });
  });
}

/* ================================================================
   Routes
   ================================================================ */

/** Reads plan, period and seats from a request, or refuses with the reason. */
function licenceTerms(body, reply) {
  const plan = ['trial', 'starter', 'pro'].includes(body?.plan) ? body.plan : null;
  if (!plan) { fail(reply, 400, 'malformed', 'Choose trial, starter or pro.'); return null; }
  const days = body?.days === null ? null : Number(body?.days);
  if (days !== null && (!Number.isFinite(days) || days < 1 || days > 3660)) {
    fail(reply, 400, 'malformed', 'Choose a period between one day and ten years, or lifetime.');
    return null;
  }
  const seats = Math.max(1, Math.min(100, Number(body?.seats) || 1));
  const term = days === null ? 'lifetime' : days >= 360 ? 'yearly' : days >= 28 ? 'monthly' : 'days';
  return { plan, days, seats, term };
}

/**
 * Grants a licence. A new row each time rather than an edit, so the history
 * of what an owner has held — and who granted it — survives.
 * Returns when it runs out, or null for lifetime.
 */
async function grant(accountId, t, by) {
  const status = t.plan === 'trial' ? 'trial' : 'active';
  const { rows } = await q(
    `insert into licences (account_id, plan, term, seats, status, expires_at, issued_by)
     values ($1, $2, $3, $4, $5,
             case when $6::int is null then null else now() + ($6::int * interval '1 day') end, $7)
     returning expires_at`,
    [accountId, t.plan, t.term, t.seats, status, t.days, by],
  );
  return rows[0]?.expires_at || null;
}

export default async function adminRoutes(app) {
  /** Whether the signed-in account may use the console. Safe for anyone to ask. */
  app.get('/v1/admin/me', async (req) => {
    const h = String(req.headers.authorization || '');
    try {
      const c = await readAccess(h.slice(7));
      return { developer: developers().includes(String(c.email || '').toLowerCase()) };
    } catch {
      return { developer: false };
    }
  });

  app.get('/v1/admin/owners', async (req, reply) => {
    if (!(await developer(req, reply))) return;
    return { owners: await owners() };
  });

  /** The three lists that need acting on. */
  app.get('/v1/admin/reports', async (req, reply) => {
    if (!(await developer(req, reply))) return;
    const all = await owners();
    const expired = all.filter((o) => o.licence && o.licence.status === 'expired');
    const soon = all.filter((o) => o.licence
      && (o.licence.status === 'active' || o.licence.status === 'trial')
      && o.licence.daysLeft !== null && o.licence.daysLeft <= SOON_DAYS);
    const trial = all.filter((o) => o.licence && o.licence.status === 'trial');
    const blocked = all.filter((o) => o.blocked);
    const paying = all.filter((o) => o.licence && o.licence.status === 'active');
    return {
      totals: {
        owners: all.length,
        businesses: all.reduce((s, o) => s + o.businesses.length, 0),
        paying: paying.length,
        trial: trial.length,
        expired: expired.length,
        expiringSoon: soon.length,
        blocked: blocked.length,
        bytes: all.reduce((s, o) => s + o.bytes, 0),
      },
      expired, expiringSoon: soon, trial, blocked,
      soonDays: SOON_DAYS,
    };
  });

  /** Grants an existing owner a licence (see grant). */
  app.post('/v1/admin/owners/:id/licence', async (req, reply) => {
    const dev = await developer(req, reply);
    if (!dev) return;
    const terms = licenceTerms(req.body, reply);
    if (!terms) return;
    const { rows } = await q('select id from accounts where id = $1', [req.params.id]);
    if (!rows[0]) return fail(reply, 404, 'server', 'No such owner.');
    await grant(req.params.id, terms, dev.email);
    return { ok: true };
  });

  /**
   * Adds an owner by email and gives them a subscription in one step — for a
   * shop that has paid before ever opening the app. The account has no
   * password: they get in with Google, or set one with "Forgot password".
   * An address that already has an account just gets the subscription.
   */
  app.post('/v1/admin/owners', async (req, reply) => {
    const dev = await developer(req, reply);
    if (!dev) return;
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail(reply, 400, 'malformed', 'That email address does not look right.');
    }
    const terms = licenceTerms(req.body, reply);
    if (!terms) return;
    const name = String(req.body?.name || '').trim().slice(0, 120) || email.split('@')[0];

    let created = false;
    let { rows } = await q('select id from accounts where email = $1', [email]);
    if (!rows[0]) {
      ({ rows } = await q(
        'insert into accounts (email, name, email_verified) values ($1, $2, false) returning id',
        [email, name],
      ));
      created = true;
    }
    const id = rows[0].id;
    const until = await grant(id, terms, dev.email);

    let invited = false;
    let inviteError = null;
    if (req.body?.invite !== false) {
      try { await sendInvite(email, { plan: terms.plan, until }); invited = true; } catch (e) {
        inviteError = e.message === 'mail_not_configured' ? 'Email is not set up on the server.' : 'The invitation email could not be sent.';
        req.log.error({ err: e.message }, 'invite failed');
      }
    }
    return { ok: true, id, created, invited, inviteError };
  });

  /** Blocks or unblocks an owner. Blocking ends their sessions straight away. */
  app.post('/v1/admin/owners/:id/block', async (req, reply) => {
    if (!(await developer(req, reply))) return;
    const blocked = req.body?.blocked === true;
    const reason = String(req.body?.reason || '').slice(0, 300) || null;
    const { rowCount } = await q(
      'update accounts set status = $2, blocked_reason = $3 where id = $1',
      [req.params.id, blocked ? 'blocked' : 'active', blocked ? reason : null],
    );
    if (!rowCount) return fail(reply, 404, 'server', 'No such owner.');
    if (blocked) {
      await q('update sessions set revoked_at = now() where account_id = $1 and revoked_at is null', [req.params.id]);
    }
    return { ok: true, blocked };
  });

  /** How the machine is coping, right now. Polled every few seconds. */
  app.get('/v1/admin/server', async (req, reply) => {
    if (!(await developer(req, reply))) return;

    const now = Date.now();
    const last = [...minutes.entries()].filter(([m]) => m >= now - 60 * 60000).sort((a, b) => a[0] - b[0]);
    const recent = last.filter(([m]) => m >= now - 5 * 60000).map(([, b]) => b);
    const n = recent.reduce((s, b) => s + b.n, 0);
    const samples = recent.flatMap((b) => b.samples);

    let disk = null;
    try {
      const st = fs.statfsSync('/');
      disk = { total: st.blocks * st.bsize, free: st.bavail * st.bsize };
    } catch { /* older node */ }

    const dbStats = await q(`
      select pg_database_size(current_database())::bigint as size,
             (select count(*)::int from pg_stat_activity where datname = current_database()) as connections,
             (select count(*)::int from pg_stat_activity where datname = current_database() and state = 'active') as active,
             (select setting::int from pg_settings where name = 'max_connections') as max_connections,
             (select round(100.0 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0), 1)
                from pg_stat_database where datname = current_database()) as cache_hit`);
    const tables = await q(`
      select relname as name, pg_total_relation_size(relid)::bigint as bytes, n_live_tup::bigint as rows
        from pg_stat_user_tables order by pg_total_relation_size(relid) desc limit 8`);

    const mem = process.memoryUsage();
    return {
      at: new Date().toISOString(),
      machine: {
        cpus: os.cpus().length,
        load: os.loadavg(),
        memTotal: os.totalmem(),
        memFree: os.freemem(),
        uptime: os.uptime(),
        disk,
      },
      process: {
        uptime: process.uptime(),
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        loopLagMs: Math.round(loopDelay.mean / 1e6),
        loopLagP99Ms: Math.round(loopDelay.percentile(99) / 1e6),
      },
      requests: {
        perMinute: Math.round(n / Math.max(1, recent.length)),
        avgMs: n ? Math.round(recent.reduce((s, b) => s + b.total, 0) / n) : 0,
        p95Ms: Math.round(percentile(samples, 95)),
        errors5m: recent.reduce((s, b) => s + b.errors, 0),
        history: last.map(([m, b]) => ({ t: m, n: b.n, avgMs: b.n ? Math.round(b.total / b.n) : 0, errors: b.errors })),
      },
      database: { ...dbStats.rows[0], size: Number(dbStats.rows[0].size), tables: tables.rows.map((t) => ({ ...t, bytes: Number(t.bytes), rows: Number(t.rows) })) },
    };
  });

  app.get('/v1/admin/backups', async (req, reply) => {
    if (!(await developer(req, reply))) return;
    return { backups: listBackups(), dir: BACKUP_DIR, keep: KEEP_BACKUPS };
  });

  app.post('/v1/admin/backups', async (req, reply) => {
    if (!(await developer(req, reply))) return;
    try {
      return { ok: true, backup: await runBackup() };
    } catch (e) {
      req.log.error({ err: e.message }, 'backup failed');
      return fail(reply, 500, 'server', 'The backup failed: ' + e.message);
    }
  });

  /** Downloads one dump, so a copy can live somewhere other than this box. */
  app.get('/v1/admin/backups/:name', async (req, reply) => {
    if (!(await developer(req, reply))) return;
    const name = path.basename(String(req.params.name || ''));
    if (!/^genius-[\w-]+\.dump$/.test(name)) return fail(reply, 400, 'malformed', 'Bad name.');
    const file = path.join(BACKUP_DIR, name);
    if (!fs.existsSync(file)) return fail(reply, 404, 'server', 'No such backup.');
    reply.header('content-type', 'application/octet-stream');
    reply.header('content-disposition', 'attachment; filename="' + name + '"');
    return reply.send(fs.createReadStream(file));
  });
}
