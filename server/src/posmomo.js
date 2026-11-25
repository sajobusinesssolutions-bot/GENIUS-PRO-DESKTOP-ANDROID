/**
 * posmomo.js — a Genius POS customer paying by MTN Mobile Money.
 *
 * The till asks the customer's phone to pay (request to pay, MTN Collections);
 * the customer approves with their PIN; the till asks here how it stands until
 * MTN says paid or refused, and only then records the receipt. The money lands
 * in SALJOE TECH's MTN collections account (the same keys as licence sales,
 * MTN_MOMO_* in the server's settings), so every request is kept here with the
 * business it was for: what each business is owed by SALJOE is the sum of its
 * paid requests not yet settled (GET /v1/pos-momo/collections).
 *
 *   POST /v1/pos-momo/request        { business, amount, phone, note, docRef } → { id, network, state }
 *   GET  /v1/pos-momo/request/:id    → { id, state: pending|paid|failed, reason, txn, amount, phone }
 *   GET  /v1/pos-momo/collections?business=…  → { rows, paid, settled, owed }
 *
 * The business comes from the session's own businesses, never trusted from
 * the body alone (sync.js businessFor does the same).
 */
import { q } from './db.js';
import { whoami } from './sync.js';
import * as momopay from './momopay.js';
import { developer } from './admin.js';

const fail = (reply, status, error, message) => reply.code(status).send({ error, message });

/** SALJOE's own collection keys (the same as licence sales: saccolicences.js sellKeys). */
const keys = () => ({
  mtn: process.env.MTN_MOMO_KEY ? { key: process.env.MTN_MOMO_KEY, user: process.env.MTN_MOMO_USER, secret: process.env.MTN_MOMO_SECRET,
    env: process.env.MTN_MOMO_ENV || 'live', target: process.env.MTN_MOMO_TARGET } : null,
  airtel: process.env.AIRTEL_CLIENT_ID ? { id: process.env.AIRTEL_CLIENT_ID, secret: process.env.AIRTEL_CLIENT_SECRET, env: process.env.AIRTEL_ENV || 'live' } : null,
});

export async function ensurePosMomoTable(qq = q) {
  await qq(`create table if not exists pos_momo (
    id uuid primary key,
    business_id uuid not null,
    account_id uuid not null,
    network text not null,
    amount numeric(14,2) not null,
    phone text not null,
    note text,
    doc_ref text,
    state text not null default 'pending',
    reason text,
    txn text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    settled_at timestamptz
  )`);
  await qq('create index if not exists ix_pos_momo_business on pos_momo (business_id, created_at)');
}

/** The business this account may act for, or null. */
async function businessOf(accountId, wanted) {
  if (!wanted) return null;
  const { rows } = await q(
    `select b.id from businesses b left join business_members bm on bm.business_id = b.id and bm.account_id = $1
      where b.status = 'active' and b.id = $2::uuid and (b.account_id = $1 or bm.account_id is not null) limit 1`, [accountId, wanted]);
  return rows[0] ? rows[0].id : null;
}

const shape = (r) => ({ id: r.id, network: r.network, state: r.state, reason: r.reason || null, txn: r.txn || null,
  amount: Number(r.amount), phone: r.phone, note: r.note || null, docRef: r.doc_ref || null, at: r.created_at, settledAt: r.settled_at || null });

export default async function posMomoRoutes(app) {
  await ensurePosMomoTable();

  app.post('/v1/pos-momo/request', async (req, reply) => {
    const me = await whoami(req, reply); if (!me) return;
    const b = req.body || {};
    const business = await businessOf(me.id, b.business);
    if (!business) return fail(reply, 404, 'notFound', 'That business is not on this account.');
    const amount = Math.round(Number(b.amount) || 0);
    if (!(amount >= 500)) return fail(reply, 400, 'badAmount', 'Mobile Money needs at least UGX 500.');
    if (amount > 5000000) return fail(reply, 400, 'badAmount', 'That is more than one Mobile Money payment allows (UGX 5,000,000).');
    const net = momopay.networkOf(b.phone);
    if (!net) return fail(reply, 400, 'badPhone', 'That is not an MTN or Airtel number.');
    const k = keys();
    if (await momopay.testOnly(req, developer)) return fail(reply, 503, 'notConnected', 'Mobile Money is in test mode on the account server — take the money another way for now.');
    if (net === 'mtn' && !k.mtn) return fail(reply, 503, 'notConnected', 'MTN Mobile Money is not connected on the account server yet.');
    if (net === 'airtel' && !k.airtel) return fail(reply, 400, 'notConnected', 'Airtel Money is not taken yet — use an MTN number, or take the money another way.');
    try {
      const r = await momopay.request(k, { amount, phone: b.phone, note: String(b.note || 'Payment').slice(0, 120) });
      await q(`insert into pos_momo (id, business_id, account_id, network, amount, phone, note, doc_ref) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [r.ref, business, me.id, r.network, amount, momopay.msisdn(b.phone), b.note || null, b.docRef || null]);
      return reply.send({ id: r.ref, network: r.network, state: 'pending' });
    } catch (e) {
      req.log.warn({ err: e.message }, 'pos-momo request');
      return fail(reply, 502, 'provider', e.provider ? e.message : 'Mobile Money could not be reached. Try again.');
    }
  });

  app.get('/v1/pos-momo/request/:id', async (req, reply) => {
    const me = await whoami(req, reply); if (!me) return;
    const { rows } = await q('select * from pos_momo where id = $1::uuid', [req.params.id]).catch(() => ({ rows: [] }));
    const row = rows[0];
    if (!row || !(await businessOf(me.id, row.business_id))) return fail(reply, 404, 'notFound', 'No such payment request.');
    if (row.state === 'pending') {
      try {
        const s = await momopay.status(keys(), row.network, row.id);
        if (s.state !== 'pending') {
          const up = await q(`update pos_momo set state = $2, reason = $3, txn = $4, updated_at = now() where id = $1 and state = 'pending' returning *`,
            [row.id, s.state, s.reason ? String(s.reason).slice(0, 200) : null, s.txn]);
          if (up.rows[0]) return reply.send(shape(up.rows[0]));
        }
      } catch (e) { req.log.warn({ err: e.message }, 'pos-momo status'); }
    }
    return reply.send(shape(row));
  });

  app.get('/v1/pos-momo/collections', async (req, reply) => {
    const me = await whoami(req, reply); if (!me) return;
    const business = await businessOf(me.id, req.query.business);
    if (!business) return fail(reply, 404, 'notFound', 'That business is not on this account.');
    const { rows } = await q('select * from pos_momo where business_id = $1 order by created_at desc limit 500', [business]);
    const paid = rows.filter((r) => r.state === 'paid');
    const sum = (a) => a.reduce((n, r) => n + Number(r.amount), 0);
    return reply.send({ rows: rows.map(shape), paid: sum(paid), settled: sum(paid.filter((r) => r.settled_at)), owed: sum(paid.filter((r) => !r.settled_at)) });
  });
}
