/**
 * licensing.js — the developer console's subscription tools, kept apart from
 * admin.js so it can be installed on its own:
 *
 *   · money received on a subscription (one granted without an amount, or paid
 *     in parts), with who recorded it and when;
 *   · a client's own fees — licence and renewal — which their apps show in
 *     Plan & License in place of the standard prices;
 *   · resetting a licence, with its history, and reinstating it.
 *
 * A reset licence is "revoked", which the sync server already refuses; the
 * status it had before is kept so reinstating puts it back exactly.
 */
import { q } from './db.js';
import { readAccess } from './tokens.js';
import { developer } from './admin.js';

const fail = (reply, status, error, message) => reply.code(status).send({ error, message });
const money = (v) => (v === null || v === undefined || v === '' ? null : Math.max(0, Math.round(Number(v) || 0)));

let migrated = false;
async function migrate() {
  if (migrated) return;
  await q(`create table if not exists licence_payments (
    id serial primary key,
    account_id uuid not null,
    licence_id int,
    amount numeric not null,
    currency text not null default 'UGX',
    method text,
    note text,
    received_at timestamptz not null default now(),
    received_by text
  )`);
  await q(`create table if not exists client_fees (
    account_id uuid primary key,
    licence_fee numeric,
    renewal_fee numeric,
    currency text not null default 'UGX',
    note text,
    updated_by text,
    updated_at timestamptz not null default now()
  )`);
  await q('alter table licences add column if not exists reset_at timestamptz');
  await q('alter table licences add column if not exists reset_by text');
  await q('alter table licences add column if not exists reset_reason text');
  await q('alter table licences add column if not exists prev_status text');
  await q('alter table licences add column if not exists reinstated_at timestamptz');
  migrated = true;
}

async function account(id) {
  const { rows } = await q('select id, email, name from accounts where id = $1', [id]);
  return rows[0] || null;
}

export default async function licensingRoutes(app) {
  try { await migrate(); } catch (e) { app.log.error({ err: e.message }, 'licensing migrate failed'); }

  /** One owner's subscription: every licence they have held, what they have paid, and their own fees. */
  app.get('/v1/admin/owners/:id/subscription', async (req, reply) => {
    if (!(await developer(req, reply))) return;
    const acc = await account(req.params.id);
    if (!acc) return fail(reply, 404, 'server', 'No such owner.');
    const licences = (await q(
      `select id, plan, term, seats, status, started_at, expires_at, issued_by, edition, max_businesses,
              renewal_fee, installation_fee, vat_rate, currency, reset_at, reset_by, reset_reason, prev_status, reinstated_at
         from licences where account_id = $1 order by started_at desc`, [acc.id])).rows;
    const payments = (await q(
      'select id, licence_id, amount, currency, method, note, received_at, received_by from licence_payments where account_id = $1 order by received_at desc',
      [acc.id])).rows;
    const fees = (await q('select licence_fee, renewal_fee, currency, note, updated_by, updated_at from client_fees where account_id = $1', [acc.id])).rows[0] || null;
    // what is owed: each licence's fees with VAT, less what has been received
    const due = licences.filter((l) => l.status !== 'revoked').reduce((s, l) => {
      const base = Number(l.renewal_fee || 0) + Number(l.installation_fee || 0);
      return s + base * (1 + Number(l.vat_rate ?? 18) / 100);
    }, 0);
    const paid = payments.reduce((s, p) => s + Number(p.amount), 0);
    return { owner: acc, licences, payments, fees, totals: { due: Math.round(due), paid: Math.round(paid), balance: Math.round(due - paid) } };
  });

  /** Money received on a subscription — for one granted without amounts, or paid in parts. */
  app.post('/v1/admin/owners/:id/payments', async (req, reply) => {
    const dev = await developer(req, reply);
    if (!dev) return;
    const acc = await account(req.params.id);
    if (!acc) return fail(reply, 404, 'server', 'No such owner.');
    const amount = money(req.body?.amount);
    if (!amount) return fail(reply, 400, 'malformed', 'Enter the amount received.');
    const licenceId = req.body?.licenceId ? Number(req.body.licenceId) : (await q(
      'select id from licences where account_id = $1 order by started_at desc limit 1', [acc.id])).rows[0]?.id || null;
    const when = req.body?.receivedAt && !Number.isNaN(Date.parse(req.body.receivedAt)) ? req.body.receivedAt : null;
    const { rows } = await q(
      `insert into licence_payments (account_id, licence_id, amount, currency, method, note, received_at, received_by)
       values ($1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now()), $8) returning id`,
      [acc.id, licenceId, amount, String(req.body?.currency || 'UGX').slice(0, 8).toUpperCase(),
       String(req.body?.method || '').slice(0, 40) || null, String(req.body?.note || '').slice(0, 300) || null, when, dev.email]);
    return { ok: true, id: rows[0].id };
  });

  /** Takes back a payment recorded by mistake. */
  app.delete('/v1/admin/payments/:pid', async (req, reply) => {
    if (!(await developer(req, reply))) return;
    await q('delete from licence_payments where id = $1', [Number(req.params.pid)]);
    return { ok: true };
  });

  /** A client's own fees. Empty both to go back to the standard prices. */
  app.put('/v1/admin/owners/:id/fees', async (req, reply) => {
    const dev = await developer(req, reply);
    if (!dev) return;
    const acc = await account(req.params.id);
    if (!acc) return fail(reply, 404, 'server', 'No such owner.');
    const lf = money(req.body?.licenceFee), rf = money(req.body?.renewalFee);
    if (lf === null && rf === null) {
      await q('delete from client_fees where account_id = $1', [acc.id]);
      return { ok: true, cleared: true };
    }
    await q(
      `insert into client_fees (account_id, licence_fee, renewal_fee, currency, note, updated_by, updated_at)
       values ($1, $2, $3, $4, $5, $6, now())
       on conflict (account_id) do update set licence_fee = excluded.licence_fee, renewal_fee = excluded.renewal_fee,
         currency = excluded.currency, note = excluded.note, updated_by = excluded.updated_by, updated_at = now()`,
      [acc.id, lf, rf, String(req.body?.currency || 'UGX').slice(0, 8).toUpperCase(), String(req.body?.note || '').slice(0, 300) || null, dev.email]);
    return { ok: true };
  });

  /** Resets a licence: it stops working at once, and its history keeps why. */
  app.post('/v1/admin/licences/:lid/reset', async (req, reply) => {
    const dev = await developer(req, reply);
    if (!dev) return;
    const { rows } = await q(
      `update licences set prev_status = status, status = 'revoked', reset_at = now(), reset_by = $2, reset_reason = $3, reinstated_at = null
        where id = $1 and status <> 'revoked' returning id`,
      [Number(req.params.lid), dev.email, String(req.body?.reason || '').slice(0, 300) || null]);
    if (!rows[0]) return fail(reply, 404, 'server', 'That licence is already reset, or does not exist.');
    return { ok: true };
  });

  /** Puts a reset licence back as it was. */
  app.post('/v1/admin/licences/:lid/reinstate', async (req, reply) => {
    if (!(await developer(req, reply))) return;
    const { rows } = await q(
      `update licences set status = coalesce(prev_status, 'active'), prev_status = null, reinstated_at = now()
        where id = $1 and status = 'revoked' returning id`, [Number(req.params.lid)]);
    if (!rows[0]) return fail(reply, 404, 'server', 'That licence is not reset.');
    return { ok: true };
  });

  /** For the signed-in owner's own Plan & License: the fees set for them, if any. */
  app.get('/v1/account/fees', async (req, reply) => {
    const h = String(req.headers.authorization || '');
    let claims;
    try { claims = await readAccess(h.slice(7)); } catch { return fail(reply, 401, 'badCredentials', 'Sign in again.'); }
    const id = claims.sub || claims.accountId || claims.aid;
    if (!id) return { fees: null };
    const fees = (await q('select licence_fee, renewal_fee, currency, note from client_fees where account_id = $1', [id])).rows[0];
    const paid = (await q('select coalesce(sum(amount), 0) as n from licence_payments where account_id = $1', [id])).rows[0];
    return { fees: fees ? { licenceFee: fees.licence_fee == null ? null : Number(fees.licence_fee), renewalFee: fees.renewal_fee == null ? null : Number(fees.renewal_fee), currency: fees.currency, note: fees.note } : null,
      paid: Number(paid?.n || 0) };
  });
}
