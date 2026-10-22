/**
 * transfers.test.mjs — stock transfers between businesses on the account
 * server (src/transfers.core.js), over HTTP, against an in-memory Postgres.
 *
 *   npm test        (needs the dev dependency pg-mem)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { newDb } from 'pg-mem';
import { ensureTransfersTable, registerTransfers } from '../src/transfers.core.js';

const OWNER = '11111111-1111-1111-1111-111111111111';
const STRANGER = '22222222-2222-2222-2222-222222222222';
const PHARM = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SALJO = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const OTHER = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

async function setup() {
  const mem = newDb();
  const { Pool } = mem.adapters.createPg();
  const pool = new Pool();
  const q = (text, params) => pool.query(text, params);
  await q(`create table businesses (id uuid primary key, name text, account_id uuid, status text default 'active', created_at timestamptz default now())`);
  await q(`create table business_members (business_id uuid, account_id uuid, role text)`);
  await q(`insert into businesses (id, name, account_id) values ($1,'Pharmacy',$4), ($2,'Saljo Tech',$4), ($3,'Someone else',$5)`, [PHARM, SALJO, OTHER, OWNER, STRANGER]);
  await ensureTransfersTable(q);
  const app = Fastify();
  /* the signed-in account comes from a test header instead of a token */
  registerTransfers(app, { q, who: async (req) => ({ id: String(req.headers['x-account'] || OWNER) }) });
  const call = async (method, url, body, account = OWNER) => {
    const r = await app.inject({ method, url, payload: body, headers: { 'x-account': account } });
    return { status: r.statusCode, body: r.json() };
  };
  return { call };
}
const LINES = [{ name: 'Panadol', unit: 'PCS', quantity: 10, unit_cost: 300, sale_price: 500 }];

test('send, open, receive short, reconcile', async () => {
  const { call } = await setup();
  const dest = await call('GET', `/v1/transfers/destinations?business=${PHARM}`);
  assert.deepEqual(dest.body.businesses.map((b) => b.name), ['Saljo Tech']);

  const s = await call('POST', '/v1/transfers', { business: PHARM, to_business: SALJO, ref: 'dev1-1', lines: LINES, by: 'Amar', vehicle: 'UAX 1' });
  assert.equal(s.status, 200);
  assert.equal(s.body.transfer.transfer_no, 'TRF-00001');
  assert.equal(s.body.transfer.value, 3000);
  const again = await call('POST', '/v1/transfers', { business: PHARM, to_business: SALJO, ref: 'dev1-1', lines: LINES });
  assert.equal(again.body.transfer.id, s.body.transfer.id, 'the same ref is the same transfer');

  const inc = await call('GET', `/v1/transfers/incoming?business=${SALJO}`);
  assert.equal(inc.body.unseen, 1);
  const id = s.body.transfer.id;
  const seen = await call('GET', `/v1/transfers/${id}?business=${SALJO}&by=Sam`);
  assert.ok(seen.body.transfer.seen_at);
  assert.equal(seen.body.transfer.direction, 'in');

  const wrongSide = await call('POST', `/v1/transfers/${id}/claim`, { business: PHARM, as: 'receiving' });
  assert.equal(wrongSide.status, 403);
  const c = await call('POST', `/v1/transfers/${id}/claim`, { business: SALJO, as: 'receiving' });
  assert.equal(c.body.transfer.status, 'receiving');
  const race = await call('POST', `/v1/transfers/${id}/claim`, { business: PHARM, as: 'cancelling' });
  assert.equal(race.status, 409, 'cannot call back while it is being received');
  const f = await call('POST', `/v1/transfers/${id}/finish`, { business: SALJO, status: 'short', short_value: 600, received_lines: [{ name: 'Panadol', sent: 10, received: 8 }], by: 'Sam', note: 'two torn' });
  assert.equal(f.body.transfer.status, 'short');

  const noNote = await call('POST', `/v1/transfers/${id}/reconcile`, { business: PHARM });
  assert.equal(noNote.status, 400);
  const r = await call('POST', `/v1/transfers/${id}/reconcile`, { business: PHARM, note: 'driver pays', by: 'Amar' });
  assert.equal(r.body.transfer.status, 'reconciled');
  assert.deepEqual(r.body.transfer.events.map((e) => e.what), ['sent', 'seen', 'received_short', 'reconciled']);
});

test('call back, change, release, and strangers kept out', async () => {
  const { call } = await setup();
  const s = await call('POST', '/v1/transfers', { business: PHARM, to_business: SALJO, ref: 'dev1-2', lines: LINES });
  const id = s.body.transfer.id;

  const e = await call('POST', `/v1/transfers/${id}/claim`, { business: PHARM, as: 'editing' });
  assert.equal(e.body.transfer.status, 'editing');
  const ef = await call('POST', `/v1/transfers/${id}/finish`, { business: PHARM, lines: [{ ...LINES[0], quantity: 12 }], value: 3600 });
  assert.equal(ef.body.transfer.status, 'in_transit');
  assert.equal(ef.body.transfer.value, 3600);
  assert.equal(ef.body.transfer.seen_at, null, 'changed: the other side is told again');

  const rc = await call('POST', `/v1/transfers/${id}/claim`, { business: SALJO, as: 'receiving' });
  assert.equal(rc.status, 200);
  const rel = await call('POST', `/v1/transfers/${id}/release`, { business: SALJO });
  assert.equal(rel.body.transfer.status, 'in_transit', 'a failed receive hands it back');

  const cb = await call('POST', `/v1/transfers/${id}/claim`, { business: PHARM, as: 'cancelling' });
  assert.equal(cb.status, 200);
  const cf = await call('POST', `/v1/transfers/${id}/finish`, { business: PHARM });
  assert.equal(cf.body.transfer.status, 'cancelled');
  const late = await call('POST', `/v1/transfers/${id}/claim`, { business: SALJO, as: 'receiving' });
  assert.equal(late.status, 409);

  const peek = await call('GET', `/v1/transfers?business=${PHARM}`, undefined, STRANGER);
  assert.equal(peek.status, 403);
  const toStranger = await call('POST', '/v1/transfers', { business: PHARM, to_business: OTHER, ref: 'x', lines: LINES });
  assert.equal(toStranger.status, 400, 'only to a business the same person runs');
});
