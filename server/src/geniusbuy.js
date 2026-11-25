/**
 * geniusbuy.js — Genius POS plans: their prices, set in the developer console,
 * and buying or renewing one by Mobile Money from the app (PC and phone).
 *
 *   GET  /v1/genius/prices                → { buy, prices: { starter: { month, quarter, year }, pro: … }, mine, renewing }
 *   PUT  /v1/admin/genius/prices          { prices: [{ plan, term, price }] }        (developer)
 *   POST /v1/genius/buy                   { plan, term, phone, edition }            → { id, status, amount }
 *   GET  /v1/genius/buy/:id               → { id, status: pending|paid|failed, … , expiresAt }
 *   GET  /v1/genius/buys                  → this account's purchases, newest first
 *   GET  /v1/admin/genius/purchases       → everyone's, for the console          (developer)
 *
 * The price: the standard one for the plan and term, unless the developer has
 * set this client's own fees (Developer → Subscription → client fees,
 * licensing.js client_fees): then a year costs their licence fee the first
 * time and their renewal fee after that. Paid, the licence is granted exactly
 * as the console grants one (admin.js grant: a recharge adds to the time left)
 * and the money is recorded against it (licence_payments), so the
 * subscription reads as settled.
 *
 * The money goes to SALJOE TECH's MTN collections account (MTN_MOMO_*), the
 * same keys as Tallix and SACCO Manager licences.
 */
import { q } from './db.js';
import { whoami } from './sync.js';
import { developer, grant } from './admin.js';
import * as momopay from './momopay.js';

const fail = (reply, status, error, message) => reply.code(status).send({ error, message });

export const PLANS = { starter: { label: 'Starter', seats: 2 }, pro: { label: 'Pro', seats: 5 } };
export const TERMS = { month: { label: 'Monthly', days: 30 }, quarter: { label: 'Quarterly', days: 91 }, year: { label: 'Yearly', days: 365 } };
/* what the apps showed before prices lived here (PlanCards.jsx BASE) */
const START = { starter: { month: 50000, quarter: 140000, year: 420000 }, pro: { month: 120000, quarter: 330000, year: 1200000 } };

const sellKeys = () => ({
  mtn: process.env.MTN_MOMO_KEY ? { key: process.env.MTN_MOMO_KEY, user: process.env.MTN_MOMO_USER, secret: process.env.MTN_MOMO_SECRET,
    env: process.env.MTN_MOMO_ENV || 'live', target: process.env.MTN_MOMO_TARGET } : null,
  airtel: process.env.AIRTEL_CLIENT_ID ? { id: process.env.AIRTEL_CLIENT_ID, secret: process.env.AIRTEL_CLIENT_SECRET, env: process.env.AIRTEL_ENV || 'live' } : null,
});

export async function ensureGeniusBuyTables(qq = q) {
  await qq(`create table if not exists genius_prices (plan text not null, term text not null, price bigint not null default 0,
    updated_by text, updated_at timestamptz not null default now(), primary key (plan, term))`);
  for (const p of Object.keys(PLANS)) for (const t of Object.keys(TERMS)) {
    await qq('insert into genius_prices (plan, term, price) values ($1, $2, $3) on conflict do nothing', [p, t, START[p][t]]);
  }
  await qq(`create table if not exists genius_purchases (
    id serial primary key, account_id uuid not null, plan text not null, term text not null, edition text,
    amount bigint not null, phone text, network text, ref text, status text not null default 'pending',
    reason text, txn text, expires_at timestamptz, created_at timestamptz not null default now(), done_at timestamptz)`);
}

async function priceTable() {
  const out = {};
  for (const r of (await q('select plan, term, price from genius_prices')).rows) (out[r.plan] = out[r.plan] || {})[r.term] = Number(r.price);
  return out;
}
/** This client's own fees, if the developer set them. */
async function mineOf(accountId) {
  try {
    const r = (await q('select licence_fee, renewal_fee from client_fees where account_id = $1', [accountId])).rows[0];
    if (!r || (r.licence_fee == null && r.renewal_fee == null)) return null;
    return { licenceFee: r.licence_fee == null ? null : Number(r.licence_fee), renewalFee: r.renewal_fee == null ? null : Number(r.renewal_fee) };
  } catch { return null; }   // licensing.js not installed: no client fees
}
/** Whether this account has held a paid licence before (then a year is a renewal). */
async function renewingOf(accountId) {
  return !!(await q(`select 1 from licences where account_id = $1 and plan <> 'trial' limit 1`, [accountId])).rows[0];
}
/** The best discount an advert is running on this plan now (Developer → Adverts), in percent. */
async function dealOf(plan) {
  try {
    const r = (await q(`select coalesce(max(discount_pct), 0) as pct from adverts where active and starts_at <= now() and (ends_at is null or ends_at > now())
                         and discount_pct > 0 and (discount_plan = 'all' or discount_plan = $1)`, [plan])).rows[0];
    return Math.max(0, Math.min(90, Number(r && r.pct) || 0));
  } catch { return 0; }   // no adverts table
}
async function priceFor(accountId, plan, term) {
  if (term === 'year') {
    const mine = await mineOf(accountId);
    if (mine) {
      const own = (await renewingOf(accountId)) ? (mine.renewalFee ?? mine.licenceFee) : (mine.licenceFee ?? mine.renewalFee);
      if (own != null && own > 0) return own;
    }
  }
  const full = ((await priceTable())[plan] || {})[term] || 0;
  return Math.round(full * (1 - (await dealOf(plan)) / 100));
}

const shape = (p) => ({ id: Number(p.id), txnId: 'GP-' + String(p.id).padStart(6, '0'), ref: p.ref || null, plan: p.plan, term: p.term, edition: p.edition, amount: Number(p.amount), phone: p.phone, network: p.network,
  status: p.status, reason: p.reason || null, txn: p.txn || null, expiresAt: p.expires_at || null, at: p.created_at, doneAt: p.done_at || null });

export default async function geniusBuyRoutes(app) {
  try { await ensureGeniusBuyTables(); } catch (e) { app.log.error({ err: e.message }, 'genius buy migrate failed'); }

  app.get('/v1/genius/prices', async (req, reply) => {
    const k = sellKeys();
    let mine = null, renewing = false;
    if (String(req.headers.authorization || '').startsWith('Bearer ')) {
      const me = await whoami(req, { code: () => ({ send: () => null }) }).catch(() => null);
      if (me) { mine = await mineOf(me.id); renewing = await renewingOf(me.id); }
    }
    return { buy: !!(k.mtn || k.airtel), networks: { mtn: !!k.mtn, airtel: !!k.airtel }, prices: await priceTable(),
      deals: Object.fromEntries(await Promise.all(Object.keys(PLANS).map(async (p) => [p, await dealOf(p)]))),
      plans: Object.fromEntries(Object.entries(PLANS).map(([id, p]) => [id, { label: p.label, devices: p.seats }])),
      terms: Object.fromEntries(Object.entries(TERMS).map(([id, t]) => [id, { label: t.label, days: t.days }])), mine, renewing };
  });

  app.put('/v1/admin/genius/prices', async (req, reply) => {
    const dev = await developer(req, reply); if (!dev) return;
    const list = Array.isArray(req.body?.prices) ? req.body.prices : [];
    for (const x of list) {
      if (!PLANS[x.plan] || !TERMS[x.term]) continue;
      const price = Math.max(0, Math.round(Number(x.price) || 0));
      await q(`insert into genius_prices (plan, term, price, updated_by, updated_at) values ($1, $2, $3, $4, now())
               on conflict (plan, term) do update set price = excluded.price, updated_by = excluded.updated_by, updated_at = now()`, [x.plan, x.term, price, dev.email]);
    }
    return { prices: await priceTable() };
  });

  app.post('/v1/genius/buy', async (req, reply) => {
    const me = await whoami(req, reply); if (!me) return;
    const k = sellKeys();
    if (!k.mtn && !k.airtel) return fail(reply, 503, 'closed', 'Paying in the app is not open yet. Buy or renew on WhatsApp with SALJOE TECH.');
    const plan = PLANS[req.body?.plan] ? req.body.plan : null, term = TERMS[req.body?.term] ? req.body.term : null;
    if (!plan || !term) return fail(reply, 400, 'malformed', 'Choose the plan and how long.');
    const amount = await priceFor(me.id, plan, term);
    if (!(amount > 0)) return fail(reply, 409, 'price', 'That plan has no price yet. Contact SALJOE TECH.');
    const phone = String(req.body?.phone || '');
    const net = momopay.networkOf(phone);
    if (!net) return fail(reply, 400, 'phone', 'Give an MTN or Airtel number to pay from.');
    if (!k[net]) return fail(reply, 409, 'network', `Paying with ${net === 'mtn' ? 'MTN' : 'Airtel'} is not open yet — use ${net === 'mtn' ? 'an Airtel' : 'an MTN'} number.`);
    const edition = (String(req.body?.edition || '').split(',').map((e) => e.trim()).filter((e) => ['retail', 'restaurant', 'pharmacy', 'hotel'].includes(e)).join(',')) || null;
    let r;
    try { r = await momopay.request(k, { amount, phone, note: `Genius POS ${PLANS[plan].label} ${TERMS[term].label}` }); }
    catch (e) { return fail(reply, 502, 'provider', String(e.message || e)); }
    const row = (await q(`insert into genius_purchases (account_id, plan, term, edition, amount, phone, network, ref) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [me.id, plan, term, edition, amount, momopay.msisdn(phone), r.network, r.ref])).rows[0];
    return shape(row);
  });

  app.get('/v1/genius/buy/:id', async (req, reply) => {
    const me = await whoami(req, reply); if (!me) return;
    const p = (await q('select * from genius_purchases where id = $1 and account_id = $2', [Number(req.params.id), me.id])).rows[0];
    if (!p) return fail(reply, 404, 'notFound', 'No such purchase.');
    if (p.status !== 'pending') return shape(p);
    let st;
    try { st = await momopay.status(sellKeys(), p.network, p.ref); }
    catch (e) { return { ...shape(p), note: String(e.message || e) }; }
    if (st.state === 'failed') {
      const row = (await q(`update genius_purchases set status = 'failed', reason = $2, done_at = now() where id = $1 and status = 'pending' returning *`,
        [p.id, st.reason ? String(st.reason).slice(0, 200) : null])).rows[0];
      return shape(row || p);
    }
    if (st.state !== 'paid') return shape(p);
    /* paid: taken once (the update wins only for the first reader), then the licence */
    const won = (await q(`update genius_purchases set status = 'paid', txn = $2, done_at = now() where id = $1 and status = 'pending' returning id`, [p.id, st.txn || null])).rows[0];
    if (won) {
      const cur = (await q('select edition, max_businesses from licences where account_id = $1 order by started_at desc limit 1', [p.account_id])).rows[0];
      const expires = await grant(p.account_id, {
        plan: p.plan, days: TERMS[p.term].days, seats: PLANS[p.plan].seats, term: p.term === 'year' ? 'yearly' : 'monthly',
        edition: p.edition || (cur && cur.edition) || 'retail', maxBusinesses: cur && cur.max_businesses != null ? cur.max_businesses : null, mode: 'extend',
        renewalFee: Number(p.amount), installationFee: null, vatRate: 0, currency: 'UGX',
      }, `Bought in the app (${p.network === 'mtn' ? 'MTN' : 'Airtel'} ${p.phone}${st.txn ? ', ' + st.txn : ''})`);
      const lic = (await q('select id from licences where account_id = $1 order by started_at desc limit 1', [p.account_id])).rows[0];
      try {
        await q(`insert into licence_payments (account_id, licence_id, amount, currency, method, note, received_by) values ($1,$2,$3,'UGX',$4,$5,'app')`,
          [p.account_id, lic ? lic.id : null, Number(p.amount), p.network === 'mtn' ? 'MTN MoMo' : 'Airtel Money', `${PLANS[p.plan].label} ${TERMS[p.term].label}${st.txn ? ' · ' + st.txn : ''}`]);
      } catch { /* licensing.js not installed: the licence stands */ }
      await q('update genius_purchases set expires_at = $2 where id = $1', [p.id, expires]);
    }
    return shape((await q('select * from genius_purchases where id = $1', [p.id])).rows[0]);
  });

  app.get('/v1/genius/buys', async (req, reply) => {
    const me = await whoami(req, reply); if (!me) return;
    return { purchases: (await q('select * from genius_purchases where account_id = $1 order by created_at desc limit 20', [me.id])).rows.map(shape) };
  });

  app.get('/v1/admin/genius/purchases', async (req, reply) => {
    if (!(await developer(req, reply))) return;
    const { rows } = await q(`select g.*, a.email from genius_purchases g left join accounts a on a.id = g.account_id order by g.created_at desc limit 200`);
    return { purchases: rows.map((r) => ({ ...shape(r), email: r.email })) };
  });
}
