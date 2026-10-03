/**
 * Crash and error reports from the apps.
 *
 * When something goes wrong on a phone, the app sends what it knows — the
 * error, where in the code, which screen, which phone and Android version,
 * which app version — so a problem can be found from its report instead of
 * guessed at from a description. Reports are read in the developer console.
 *
 * Sending is open to any copy of the app (a crash can happen before anyone has
 * signed in), so it is size-capped and rate-limited. A signed-in phone's
 * report carries its account, so a problem can be traced to a shop.
 */
import { q } from './db.js';
import { readAccess } from './tokens.js';
import { developer } from './admin.js';

const MAX_PER_POST = 20;
const cut = (v, n) => (v == null ? null : String(v).slice(0, n));

export async function ensureCrashTable() {
  await q(`create table if not exists crash_reports (
    id          bigserial primary key,
    received_at timestamptz not null default now(),
    happened_at timestamptz,
    account_id  uuid,
    fatal       boolean not null default false,
    kind        text,          -- crash | error | render
    message     text,
    stack       text,
    route       text,
    app_version text,
    platform    text,
    os_version  text,
    device      text,
    business_id text,
    extra       jsonb,
    ip          text
  )`);
  await q('create index if not exists crash_reports_received on crash_reports (received_at desc)');
}

export default async function crashRoutes(app) {
  await ensureCrashTable();

  app.post('/v1/crash', {
    bodyLimit: 256 * 1024,
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (req) => {
    let accountId = null;
    const h = String(req.headers.authorization || '');
    if (h.startsWith('Bearer ')) {
      try { accountId = (await readAccess(h.slice(7))).sub; } catch { /* sent anyway, without an account */ }
    }
    const list = (Array.isArray(req.body?.reports) ? req.body.reports : [req.body]).slice(0, MAX_PER_POST);
    let stored = 0;
    for (const r of list) {
      if (!r || typeof r !== 'object' || !r.message) continue;
      const when = r.at && !Number.isNaN(Date.parse(r.at)) ? r.at : null;
      await q(
        `insert into crash_reports (happened_at, account_id, fatal, kind, message, stack, route, app_version,
                                    platform, os_version, device, business_id, extra, ip)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [when, accountId, !!r.fatal, cut(r.kind, 20), cut(r.message, 2000), cut(r.stack, 16000), cut(r.route, 120),
          cut(r.appVersion, 40), cut(r.platform, 20), cut(r.osVersion, 40), cut(r.device, 120), cut(r.businessId, 80),
          r.extra && typeof r.extra === 'object' ? JSON.stringify(r.extra).slice(0, 8000) : null, cut(req.ip, 64)],
      );
      stored++;
    }
    return { stored };
  });

  /** The latest reports, newest first, with how often each message has happened. */
  app.get('/v1/admin/crashes', async (req, reply) => {
    if (!(await developer(req, reply))) return;
    const limit = Math.min(200, Math.max(1, Number(req.query?.limit) || 100));
    const { rows } = await q(
      `select c.id, c.received_at, c.happened_at, c.fatal, c.kind, c.message, c.stack, c.route, c.app_version,
              c.platform, c.os_version, c.device, c.business_id, a.email
         from crash_reports c left join accounts a on a.id = c.account_id
        order by c.received_at desc limit $1`,
      [limit],
    );
    const top = await q(
      `select message, count(*)::int as n, max(received_at) as last, bool_or(fatal) as fatal
         from crash_reports where received_at > now() - interval '30 days'
        group by message order by n desc limit 10`,
    );
    return { reports: rows, top: top.rows };
  });
}
