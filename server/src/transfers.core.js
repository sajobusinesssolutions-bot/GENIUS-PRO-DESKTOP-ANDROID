/**
 * Stock transfers between businesses — the rules, with no imports, so they can
 * be tested against an in-memory Postgres (test/transfers.test.mjs).
 *
 * A transfer is between two businesses the same person runs (owner or member
 * of both): a computer sends from one, a phone or another computer receives at
 * the other. The server holds the transfer and its story; the stock is each
 * device's own business, moved on that device:
 *
 *   send      the sender takes the goods off its own shelf, then registers
 *             the transfer here — once per `ref`, so a retry never makes two
 *   receive   the receiver CLAIMS it (in_transit → receiving), puts the goods
 *             on its shelf, then FINISHES it (received | short) — or RELEASES
 *             the claim if its own step failed
 *   call back the sender claims it (→ cancelling), puts the goods back, then
 *             finishes it (cancelled)
 *   change    the sender claims it (→ editing), redoes its stock, then
 *             finishes it with the new lines (back to in_transit, unseen)
 *   reconcile the sender closes a short delivery with a note
 *
 * A claim is the one place two devices could race, so it is a single
 * conditional UPDATE: whoever changes the row first wins, the other is told.
 * A claim that was never finished (the device died between its stock step and
 * the server) can be taken again by the same business after STALE_MS, so the
 * device can look at its own books and finish or release it.
 */
export const STALE_MS = 30 * 60 * 1000;
const CLAIMS = { receiving: 'to', cancelling: 'from', editing: 'from' };
const FINISH = {
  receiving: ['received', 'short'],
  cancelling: ['cancelled'],
  editing: ['in_transit'],
};

export async function ensureTransfersTable(q) {
  await q(`create table if not exists account_transfers (
    id             bigserial primary key,
    transfer_no    text not null,
    from_business  uuid not null,
    to_business    uuid not null,
    ref            text not null,
    status         text not null default 'in_transit',
    lines          jsonb not null default '[]',
    value          numeric not null default 0,
    note           text,
    vehicle        text,
    sent_by        text,
    sent_at        timestamptz not null default now(),
    seen_at        timestamptz,
    seen_by        text,
    received_at    timestamptz,
    received_by    text,
    received_lines jsonb,
    short_value    numeric not null default 0,
    reconciled_at  timestamptz,
    cancelled_at   timestamptz,
    claimed_at     timestamptz,
    events         jsonb not null default '[]',
    updated_at     timestamptz not null default now(),
    unique (from_business, ref)
  )`);
  await q('create index if not exists account_transfers_to on account_transfers (to_business, status)');
  await q('create index if not exists account_transfers_from on account_transfers (from_business, status)');
}

const fail = (code, status, message) => Object.assign(new Error(message), { code, status });
const num = (v) => (v == null ? 0 : Number(v));
const shape = (r, business) => r && ({
  id: Number(r.id), transfer_no: r.transfer_no, from_business: r.from_business, to_business: r.to_business,
  ref: r.ref, status: r.status, lines: r.lines || [], value: num(r.value), note: r.note, vehicle: r.vehicle,
  sent_by: r.sent_by, sent_at: r.sent_at, seen_at: r.seen_at, seen_by: r.seen_by,
  received_at: r.received_at, received_by: r.received_by, received_lines: r.received_lines, short_value: num(r.short_value),
  reconciled_at: r.reconciled_at, cancelled_at: r.cancelled_at, claimed_at: r.claimed_at, events: r.events || [],
  from_name: r.from_name, to_name: r.to_name,
  direction: business ? (r.from_business === business ? 'out' : 'in') : undefined,
});
const event = (what, by, branch, note) => [{ at: new Date().toISOString(), what, by: by || '', branch: branch || '', note: note || '' }];

/** The businesses an account may act for: its own, and those it is a member of. */
export async function businessesOf(q, accountId) {
  const { rows } = await q(
    `select b.id, b.name from businesses b
      where b.status = 'active'
        and (b.account_id = $1 or b.id in (select business_id from business_members where account_id = $1))
      order by b.name`, [accountId]);
  return rows;
}
async function mustAct(q, accountId, business) {
  if (!business) throw fail('badRequest', 400, 'Say which business this is for.');
  const ok = (await businessesOf(q, accountId)).find((b) => b.id === business);
  if (!ok) throw fail('forbidden', 403, 'You do not have access to that business.');
  return ok;
}
async function load(q, id) {
  const { rows } = await q(
    `select t.*, f.name as from_name, d.name as to_name from account_transfers t
       left join businesses f on f.id = t.from_business left join businesses d on d.id = t.to_business
      where t.id = $1`, [id]);
  if (!rows[0]) throw fail('notFound', 404, 'Transfer not found.');
  return rows[0];
}
const cleanLines = (lines) => (Array.isArray(lines) ? lines : []).slice(0, 500).map((l) => ({
  name: String(l.name || '').slice(0, 200), item_code: l.item_code ? String(l.item_code).slice(0, 60) : '',
  unit: String(l.unit || '').slice(0, 30), quantity: Number(l.quantity) || 0, unit_cost: Number(l.unit_cost) || 0,
  sale_price: Number(l.sale_price) || 0, batch_no: String(l.batch_no || '').slice(0, 60),
  expiry_date: l.expiry_date ? String(l.expiry_date).slice(0, 10) : null,
})).filter((l) => l.name && l.quantity > 0);

/** Where the business may send: every other business the same account runs. */
export async function destinations(q, accountId, business) {
  await mustAct(q, accountId, business);
  return (await businessesOf(q, accountId)).filter((b) => b.id !== business);
}

export async function list(q, accountId, business) {
  await mustAct(q, accountId, business);
  const { rows } = await q(
    `select t.*, f.name as from_name, d.name as to_name from account_transfers t
       left join businesses f on f.id = t.from_business left join businesses d on d.id = t.to_business
      where t.from_business = $1 or t.to_business = $1
      order by t.id desc limit 300`, [business]);
  return rows.map((r) => shape(r, business));
}

/** Registered by the sender after its own stock step. Idempotent on (from_business, ref). */
export async function send(q, accountId, b) {
  const from = await mustAct(q, accountId, b.business);
  if (!b.ref) throw fail('badRequest', 400, 'A transfer needs its reference from the device.');
  const to = (await businessesOf(q, accountId)).find((x) => x.id === b.to_business);
  if (!to || to.id === from.id) throw fail('badRequest', 400, 'Pick another business you run to send to.');
  const lines = cleanLines(b.lines);
  if (!lines.length) throw fail('badRequest', 400, 'Add at least one item and quantity.');
  const had = await q('select id from account_transfers where from_business = $1 and ref = $2', [from.id, String(b.ref)]);
  if (had.rows[0]) return shape(await load(q, had.rows[0].id), from.id);
  const n = (await q('select count(*)::int as n from account_transfers where from_business = $1', [from.id])).rows[0].n + 1;
  const no = b.transfer_no ? String(b.transfer_no).slice(0, 40) : 'TRF-' + String(n).padStart(5, '0');
  const value = Number(b.value) || lines.reduce((a, l) => a + l.quantity * l.unit_cost, 0);
  const ins = await q(
    `insert into account_transfers (transfer_no, from_business, to_business, ref, lines, value, note, vehicle, sent_by, events)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     on conflict (from_business, ref) do nothing returning id`,
    [no, from.id, to.id, String(b.ref), JSON.stringify(lines), Math.round(value * 100) / 100, b.note || null, b.vehicle || null, b.by || null,
      JSON.stringify(event('sent', b.by, from.name, [b.note, b.vehicle ? 'Vehicle ' + b.vehicle : ''].filter(Boolean).join(' · ') || `${lines.length} line(s) to ${to.name}`))]);
  const id = ins.rows[0] ? ins.rows[0].id : (await q('select id from account_transfers where from_business = $1 and ref = $2', [from.id, String(b.ref)])).rows[0].id;
  return shape(await load(q, id), from.id);
}

/** One transfer; opened by the receiving business it is marked seen. */
export async function open(q, accountId, id, business, by) {
  await mustAct(q, accountId, business);
  const t = await load(q, id);
  if (t.from_business !== business && t.to_business !== business) throw fail('notFound', 404, 'Transfer not found.');
  if (t.to_business === business && t.status === 'in_transit' && !t.seen_at) {
    await q(`update account_transfers set seen_at = now(), seen_by = $2, updated_at = now(),
              events = $3::jsonb where id = $1 and seen_at is null`,
      [id, by || null, JSON.stringify([...(t.events || []), ...event('seen', by, t.to_name, 'Opened at the receiving branch')])]);
    return shape(await load(q, id), business);
  }
  return shape(t, business);
}

/** Take the transfer for one step. Wins or is told why not. */
export async function claim(q, accountId, id, business, as) {
  const side = CLAIMS[as];
  if (!side) throw fail('badRequest', 400, 'Unknown step.');
  await mustAct(q, accountId, business);
  const col = side === 'to' ? 'to_business' : 'from_business';
  const r = await q(
    `update account_transfers set status = $3, claimed_at = now(), updated_at = now()
      where id = $1 and ${col} = $2
        and (status = 'in_transit' or (status = $3 and claimed_at < $4))
      returning id`, [id, business, as, new Date(Date.now() - STALE_MS).toISOString()]);
  if (!r.rows[0]) {
    const t = await load(q, id);
    if (t[col] !== business) throw fail('forbidden', 403, 'That step is for the other business.');
    const why = t.status === 'received' || t.status === 'short' || t.status === 'reconciled' ? 'has already been received'
      : t.status === 'cancelled' ? 'was called back by the sender'
      : t.status === 'receiving' ? 'is being received'
      : t.status === 'cancelling' ? 'is being called back'
      : t.status === 'editing' ? 'is being changed by the sender' : 'cannot be taken now';
    throw fail('conflict', 409, `${t.transfer_no} ${why}.`);
  }
  return shape(await load(q, id), business);
}

/** The device's step is done: record it. */
export async function finish(q, accountId, id, business, b) {
  await mustAct(q, accountId, business);
  const t = await load(q, id);
  const allowed = FINISH[t.status];
  if (!allowed) throw fail('conflict', 409, `${t.transfer_no} is not claimed.`);
  const side = CLAIMS[t.status] === 'to' ? 'to_business' : 'from_business';
  if (t[side] !== business) throw fail('forbidden', 403, 'That step is for the other business.');
  const to = String(b.status || allowed[0]);
  if (!allowed.includes(to)) throw fail('badRequest', 400, 'That ending does not fit the step.');
  const by = b.by || null, branch = t[side] === t.to_business ? t.to_name : t.from_name;
  if (t.status === 'receiving') {
    const rl = Array.isArray(b.received_lines) ? b.received_lines.slice(0, 500) : null;
    await q(`update account_transfers set status = $2, received_at = now(), received_by = $3, received_lines = $4,
              short_value = $5, claimed_at = null, updated_at = now(), events = $6::jsonb where id = $1`,
      [id, to, by, rl ? JSON.stringify(rl) : null, Number(b.short_value) || 0,
        JSON.stringify([...(t.events || []), ...event(to === 'short' ? 'received_short' : 'received', by, branch, b.note || (to === 'short' ? '' : 'Everything arrived'))])]);
  } else if (t.status === 'cancelling') {
    await q(`update account_transfers set status = 'cancelled', cancelled_at = now(), claimed_at = null, updated_at = now(),
              events = $2::jsonb where id = $1`,
      [id, JSON.stringify([...(t.events || []), ...event('cancelled', by, branch, b.note || 'Called back before it was received')])]);
  } else {
    const lines = cleanLines(b.lines);
    if (!lines.length) throw fail('badRequest', 400, 'Add at least one item and quantity.');
    const before = (t.lines || []).map((l) => `${l.name} × ${l.quantity}`).join(', ');
    await q(`update account_transfers set status = 'in_transit', lines = $2, value = $3, note = coalesce($4, note), vehicle = coalesce($5, vehicle),
              seen_at = null, seen_by = null, claimed_at = null, updated_at = now(), events = $6::jsonb where id = $1`,
      [id, JSON.stringify(lines), Math.round((Number(b.value) || 0) * 100) / 100, b.note ?? null, b.vehicle ?? null,
        JSON.stringify([...(t.events || []), ...event('edited', by, branch, `Was: ${before}. Now: ${lines.map((l) => `${l.name} × ${l.quantity}`).join(', ')}`)])]);
  }
  return shape(await load(q, id), business);
}

/** The device's step failed: hand the transfer back. */
export async function release(q, accountId, id, business) {
  await mustAct(q, accountId, business);
  const t = await load(q, id);
  const side = CLAIMS[t.status] === 'to' ? 'to_business' : CLAIMS[t.status] === 'from' ? 'from_business' : null;
  if (!side) return shape(t, business);
  if (t[side] !== business) throw fail('forbidden', 403, 'That step is for the other business.');
  await q(`update account_transfers set status = 'in_transit', claimed_at = null, updated_at = now() where id = $1 and status = $2`, [id, t.status]);
  return shape(await load(q, id), business);
}

export async function reconcile(q, accountId, id, business, b) {
  await mustAct(q, accountId, business);
  const t = await load(q, id);
  if (t.from_business !== business) throw fail('forbidden', 403, 'Only the sender reconciles.');
  if (t.status === 'reconciled') return shape(t, business);
  if (t.status !== 'short') throw fail('conflict', 409, `${t.transfer_no} has nothing to reconcile.`);
  const note = String(b.note || '').trim();
  if (!note) throw fail('badRequest', 400, 'Say how the shortage was settled.');
  await q(`update account_transfers set status = 'reconciled', reconciled_at = now(), updated_at = now(), events = $2::jsonb where id = $1`,
    [id, JSON.stringify([...(t.events || []), ...event('reconciled', b.by, t.from_name, note.slice(0, 500))])]);
  return shape(await load(q, id), business);
}

export async function addNote(q, accountId, id, business, b) {
  await mustAct(q, accountId, business);
  const t = await load(q, id);
  if (t.from_business !== business && t.to_business !== business) throw fail('notFound', 404, 'Transfer not found.');
  const note = String(b.note || '').trim();
  if (!note) throw fail('badRequest', 400, 'Write the note.');
  await q(`update account_transfers set updated_at = now(), events = $2::jsonb where id = $1`,
    [id, JSON.stringify([...(t.events || []), ...event('note', b.by, t.from_business === business ? t.from_name : t.to_name, note.slice(0, 500))])]);
  return shape(await load(q, id), business);
}

/** Waiting to be received at this business — the count a device shows as a notice. */
export async function incoming(q, accountId, business) {
  await mustAct(q, accountId, business);
  const { rows } = await q(
    `select t.id, t.transfer_no, t.value, t.sent_at, t.sent_by, t.seen_at, f.name as from_name
       from account_transfers t left join businesses f on f.id = t.from_business
      where t.to_business = $1 and t.status = 'in_transit' order by t.id desc limit 50`, [business]);
  return { count: rows.length, unseen: rows.filter((r) => !r.seen_at).length, rows: rows.map((r) => ({ ...r, id: Number(r.id), value: num(r.value) })) };
}

/**
 * The HTTP routes. `who(req, reply)` answers the signed-in account or sends
 * the refusal itself (sync.js whoami); `q` is the database.
 */
export function registerTransfers(app, { q, who }) {
  const handle = (fn) => async (req, reply) => {
    const me = await who(req, reply);
    if (!me) return reply;
    try { return { ok: true, ...(await fn(me, req)) }; }
    catch (e) {
      if (!e.status) throw e;
      return reply.code(e.status).send({ ok: false, error: e.code, message: e.message });
    }
  };
  const biz = (req) => String(req.query.business || req.body?.business || '');
  app.get('/v1/transfers', handle(async (me, req) => ({ transfers: await list(q, me.id, biz(req)) })));
  app.get('/v1/transfers/destinations', handle(async (me, req) => ({ businesses: await destinations(q, me.id, biz(req)) })));
  app.get('/v1/transfers/incoming', handle(async (me, req) => incoming(q, me.id, biz(req))));
  app.post('/v1/transfers', handle(async (me, req) => ({ transfer: await send(q, me.id, req.body || {}) })));
  app.get('/v1/transfers/:id', handle(async (me, req) => ({ transfer: await open(q, me.id, Number(req.params.id), biz(req), req.query.by) })));
  app.post('/v1/transfers/:id/claim', handle(async (me, req) => ({ transfer: await claim(q, me.id, Number(req.params.id), biz(req), req.body?.as) })));
  app.post('/v1/transfers/:id/finish', handle(async (me, req) => ({ transfer: await finish(q, me.id, Number(req.params.id), biz(req), req.body || {}) })));
  app.post('/v1/transfers/:id/release', handle(async (me, req) => ({ transfer: await release(q, me.id, Number(req.params.id), biz(req)) })));
  app.post('/v1/transfers/:id/reconcile', handle(async (me, req) => ({ transfer: await reconcile(q, me.id, Number(req.params.id), biz(req), req.body || {}) })));
  app.post('/v1/transfers/:id/note', handle(async (me, req) => ({ transfer: await addNote(q, me.id, Number(req.params.id), biz(req), req.body || {}) })));
}
