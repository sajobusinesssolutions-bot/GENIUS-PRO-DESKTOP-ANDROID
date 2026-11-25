/**
 * Genius POS plans bought by Mobile Money (src/geniusbuy.js): prices set in
 * the console, a client's own yearly fees, a purchase asked of MTN (a stand-in
 * here), and the licence granted once — with the money recorded — when MTN
 * says paid; a refused one grants nothing.
 *
 *   node --experimental-test-module-mocks --test test/geniusbuy.test.mjs
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';

process.env.MTN_MOMO_KEY = 'k'; process.env.MTN_MOMO_USER = 'u'; process.env.MTN_MOMO_SECRET = 's'; process.env.MTN_MOMO_ENV = 'live';
delete process.env.AIRTEL_CLIENT_ID;
const mem = newDb();
const { Pool } = mem.adapters.createPg();
const pool = new Pool();
const q = (text, params) => pool.query(text, params);
const OWNER = '11111111-1111-4111-8111-111111111111', DEV = '99999999-9999-4999-8999-999999999999';
await q('create table accounts (id uuid primary key, email text)');
await q("insert into accounts values ($1, 'shop@x.ug'), ($2, 'dev@saljoe.tech')", [OWNER, DEV]);
await q(`create table licences (id serial primary key, account_id uuid, plan text, term text, seats int, status text, started_at timestamptz default now(),
  expires_at timestamptz, issued_by text, edition text, max_businesses int, renewal_fee numeric, installation_fee numeric, vat_rate numeric, currency text)`);
await q(`create table client_fees (account_id uuid primary key, licence_fee numeric, renewal_fee numeric, currency text default 'UGX', note text, updated_by text, updated_at timestamptz default now())`);
await q(`create table licence_payments (id serial primary key, account_id uuid, licence_id int, amount numeric, currency text, method text, note text, received_at timestamptz default now(), received_by text)`);
mock.module('../src/db.js', { namedExports: { pool, q } });
mock.module('../src/sync.js', { namedExports: { whoami: async (req) => ({ id: req.headers['x-who'] === 'dev' ? DEV : OWNER }) } });
const granted = [];
mock.module('../src/admin.js', { namedExports: {
  developer: async (req, reply) => (req.headers['x-who'] === 'dev' ? { email: 'dev@saljoe.tech' } : (reply.code(404).send({ error: 'server' }), null)),
  grant: async (accountId, t, by) => {
    granted.push({ accountId, ...t, by });
    const exp = new Date(Date.now() + t.days * 864e5).toISOString();
    await q('insert into licences (account_id, plan, term, seats, status, expires_at, issued_by, edition, renewal_fee, vat_rate) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [accountId, t.plan, t.term, t.seats, 'active', exp, by, t.edition, t.renewalFee, t.vatRate]);
    return exp;
  },
} });

let answer = 'SUCCESSFUL';
const asked = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), res = (status, body) => ({ ok: status < 300, status, text: async () => (body ? JSON.stringify(body) : '') });
  if (u.endsWith('/collection/token/')) return res(200, { access_token: 't', expires_in: 3600 });
  if (u.endsWith('/requesttopay')) { asked.push(JSON.parse(opts.body)); return res(202); }
  return res(200, { status: answer, financialTransactionId: '555' });
};

const Fastify = (await import('fastify')).default;
const app = Fastify();
await app.register((await import('../src/geniusbuy.js')).default);
await app.ready();
const call = async (method, url, payload, headers = {}) => { const r = await app.inject({ method, url, payload, headers }); return { status: r.statusCode, body: r.json() }; };

test('with test (sandbox) keys only the developer may pay: a licence is not given away for test money', async () => {
  process.env.MTN_MOMO_ENV = 'sandbox';
  try {
    assert.equal((await call('GET', '/v1/genius/prices', null, { authorization: 'Bearer x' })).body.buy, false);
    const r = await call('POST', '/v1/genius/buy', { plan: 'pro', term: 'month', phone: '0772123456' });
    assert.deepEqual([r.status, r.body.error], [503, 'closed']);
    assert.equal((await call('GET', '/v1/genius/prices', null, { 'x-who': 'dev' })).body.buy, true, 'the developer can try it');
  } finally { process.env.MTN_MOMO_ENV = 'live'; }
});

test('prices: the standard ones, changed in the console only by the developer', async () => {
  const p = await call('GET', '/v1/genius/prices');
  assert.equal(p.body.buy, true);
  assert.equal(p.body.prices.pro.year, 1200000);
  assert.equal((await call('PUT', '/v1/admin/genius/prices', { prices: [{ plan: 'starter', term: 'month', price: 1000 }] })).status, 404);
  const put = await call('PUT', '/v1/admin/genius/prices', { prices: [{ plan: 'starter', term: 'month', price: 1000 }, { plan: 'bogus', term: 'month', price: 5 }] }, { 'x-who': 'dev' });
  assert.equal(put.body.prices.starter.month, 1000);
});

test('bought, paid, licensed once, and the money recorded', async () => {
  const b = await call('POST', '/v1/genius/buy', { plan: 'starter', term: 'month', phone: '0772123456', edition: 'retail' }, { authorization: 'Bearer x' });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.deepEqual([b.body.status, b.body.amount, asked.at(-1).amount], ['pending', 1000, '1000']);
  answer = 'SUCCESSFUL';
  const s = await call('GET', `/v1/genius/buy/${b.body.id}`);
  assert.equal(s.body.status, 'paid');
  assert.ok(s.body.expiresAt, 'it says until when');
  assert.equal(granted.length, 1);
  assert.deepEqual([granted[0].plan, granted[0].days, granted[0].seats, granted[0].mode, granted[0].edition], ['starter', 30, 2, 'extend', 'retail']);
  await call('GET', `/v1/genius/buy/${b.body.id}`);
  assert.equal(granted.length, 1, 'asking again grants nothing more');
  const pays = (await q('select amount from licence_payments where account_id = $1', [OWNER])).rows;
  assert.deepEqual(pays.map((r) => Number(r.amount)), [1000]);
  assert.equal((await call('GET', '/v1/genius/buys')).body.purchases[0].status, 'paid');
});

test("a client's own fees price their year: the renewal fee once they have held a licence", async () => {
  await q('insert into client_fees (account_id, licence_fee, renewal_fee) values ($1, 900000, 700000)', [OWNER]);
  const p = await call('GET', '/v1/genius/prices', null, { authorization: 'Bearer x' });
  assert.deepEqual([p.body.mine.renewalFee, p.body.renewing], [700000, true]);
  const b = await call('POST', '/v1/genius/buy', { plan: 'pro', term: 'year', phone: '0772123456' });
  assert.equal(b.body.amount, 700000);
});

test('refused on the phone: failed, nothing granted', async () => {
  const n = granted.length;
  const b = await call('POST', '/v1/genius/buy', { plan: 'pro', term: 'month', phone: '0772123456' });
  answer = 'FAILED';
  const s = await call('GET', `/v1/genius/buy/${b.body.id}`);
  assert.equal(s.body.status, 'failed');
  assert.equal(granted.length, n);
  assert.equal((await call('POST', '/v1/genius/buy', { plan: 'pro', term: 'month', phone: '0701234567' })).body.error, 'network', 'Airtel not connected');
  assert.equal((await call('POST', '/v1/genius/buy', { plan: 'gold', term: 'month', phone: '0772123456' })).status, 400);
});
