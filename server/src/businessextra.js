/**
 * businessextra.js — what Your businesses shows beyond the list itself, kept
 * apart from sync.js so it can be installed on its own:
 *
 *   GET  /v1/businesses/extra        each of the owner's businesses: vouchers
 *                                    recorded this week, and when it was last used
 *   POST /v1/businesses/:id/rename   a new name for one of the owner's businesses
 */
import { q } from './db.js';
import { readAccess } from './tokens.js';

const fail = (reply, status, error, message) => reply.code(status).send({ error, message });
/* what counts as a voucher: the documents a shop raises, not stock moves or ledger lines */
const VOUCHERS = ['sale.create', 'sale.edit', 'purchase.create', 'purchase.edit', 'payment.record', 'entry.record', 'creditnote.create'];

async function owner(req, reply) {
  const h = String(req.headers.authorization || '');
  try { const c = await readAccess(h.slice(7)); if (c && c.sub) return c.sub; } catch { /* below */ }
  fail(reply, 401, 'badCredentials', 'Sign in again.');
  return null;
}

export default async function businessExtraRoutes(app) {
  app.get('/v1/businesses/extra', async (req, reply) => {
    const me = await owner(req, reply);
    if (!me) return;
    const { rows } = await q(
      `select b.id,
              (select count(*)::int from ops o where o.business_id = b.id and o.kind = any($2) and o.client_ts > now() - interval '7 days') as vouchers_week,
              (select max(o.client_ts) from ops o where o.business_id = b.id) as last_activity
         from businesses b where b.account_id = $1`, [me, VOUCHERS]);
    return { businesses: rows.map((r) => ({ id: r.id, vouchersWeek: r.vouchers_week || 0, lastActivity: r.last_activity })) };
  });

  app.post('/v1/businesses/:id/rename', async (req, reply) => {
    const me = await owner(req, reply);
    if (!me) return;
    const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    if (!name) return fail(reply, 400, 'malformed', 'Give the business a name.');
    const { rows } = await q('update businesses set name = $3 where id = $1 and account_id = $2 returning id', [req.params.id, me, name]);
    if (!rows[0]) return fail(reply, 404, 'server', 'That business is not yours to rename.');
    return { ok: true, name };
  });
}
