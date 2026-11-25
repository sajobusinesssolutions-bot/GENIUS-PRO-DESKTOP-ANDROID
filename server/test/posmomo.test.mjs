/**
 * Genius POS taking MTN Mobile Money (src/posmomo.js): a request to pay sent
 * for one of the account's businesses, its state read from MTN until paid or
 * refused, and what each business has collected. MTN is a stand-in here
 * (global fetch), answering as the Collections API does.
 *
 *   node --experimental-test-module-mocks --test test/posmomo.test.mjs
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';

process.env.MTN_MOMO_KEY = 'primary-key'; process.env.MTN_MOMO_USER = 'api-user'; process.env.MTN_MOMO_SECRET = 'api-key';
process.env.MTN_MOMO_ENV = 'live'; process.env.MTN_MOMO_TARGET = 'mtnuganda';
delete process.env.AIRTEL_CLIENT_ID;

const mem = newDb();
mem.public.registerFunction({ name: 'gen_random_uuid', returns: 'uuid', implementation: () => crypto.randomUUID(), impure: true });
const { Pool } = mem.adapters.createPg();
const pool = new Pool();
const q = (text, params) => pool.query(text, params);
const OWNER = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const SHOP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ELSE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
await q("create table businesses (id uuid primary key, account_id uuid, name text, status text default 'active', created_at timestamptz default now())");
await q('create table business_members (business_id uuid, account_id uuid, role text)');
await q("insert into businesses (id, account_id, name) values ($1, $2, 'Shop'), ($3, $4, 'Someone else')", [SHOP, OWNER, ELSE, OTHER]);
mock.module('../src/db.js', { namedExports: { pool, q } });
mock.module('../src/admin.js', { namedExports: { developer: async () => null } });
mock.module('../src/sync.js', { namedExports: { whoami: async (req) => ({ id: req.headers['x-who'] === 'other' ? OTHER : OWNER }) } });

/* MTN: token, request to pay (202), and the state of each request */
const asked = new Map();
let answer = 'SUCCESSFUL';
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const res = (status, body) => ({ ok: status < 300, status, text: async () => (body ? JSON.stringify(body) : '') });
  assert.equal(opts.headers['Ocp-Apim-Subscription-Key'], 'primary-key');
  if (u.endsWith('/collection/token/')) return res(200, { access_token: 'tok', expires_in: 3600 });
  if (u.endsWith('/collection/v1_0/requesttopay') && opts.method === 'POST') {
    assert.equal(opts.headers['X-Target-Environment'], 'mtnuganda');
    const b = JSON.parse(opts.body);
    assert.equal(b.currency, 'UGX');
    asked.set(opts.headers['X-Reference-Id'], b);
    return res(202);
  }
  const m = /requesttopay\/([\w-]+)$/.exec(u);
  if (m) return res(200, { status: answer, financialTransactionId: answer === 'SUCCESSFUL' ? '987654' : undefined, reason: answer === 'FAILED' ? { message: 'APPROVAL_REJECTED' } : undefined });
  throw new Error('unexpected ' + u);
};

const Fastify = (await import('fastify')).default;
const app = Fastify();
await app.register((await import('../src/posmomo.js')).default);
await app.ready();
const call = async (method, url, payload, headers = {}) => { const r = await app.inject({ method, url, payload, headers }); return { status: r.statusCode, body: r.json() }; };

test('a sale paid by MTN: asked, approved, recorded against the business', async () => {
  const r = await call('POST', '/v1/pos-momo/request', { business: SHOP, amount: 25000, phone: '0772 123 456', note: 'INV-0001', docRef: 'INV-0001' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.state, 'pending');
  const sent = asked.get(r.body.id);
  assert.deepEqual([sent.amount, sent.payer.partyId], ['25000', '256772123456']);
  answer = 'SUCCESSFUL';
  const s = await call('GET', `/v1/pos-momo/request/${r.body.id}`);
  assert.deepEqual([s.body.state, s.body.txn, s.body.amount], ['paid', '987654', 25000]);
  const c = await call('GET', `/v1/pos-momo/collections?business=${SHOP}`);
  assert.deepEqual([c.body.paid, c.body.owed, c.body.settled], [25000, 25000, 0]);
});

test('refused on the phone: failed, with MTN\'s reason, and not counted', async () => {
  const r = await call('POST', '/v1/pos-momo/request', { business: SHOP, amount: 1000, phone: '0781000000' });
  answer = 'FAILED';
  const s = await call('GET', `/v1/pos-momo/request/${r.body.id}`);
  assert.deepEqual([s.body.state, s.body.reason], ['failed', 'APPROVAL_REJECTED']);
  answer = 'SUCCESSFUL';
  const again = await call('GET', `/v1/pos-momo/request/${r.body.id}`);
  assert.equal(again.body.state, 'failed', 'a settled answer is not asked again');
  assert.equal((await call('GET', `/v1/pos-momo/collections?business=${SHOP}`)).body.paid, 25000);
});

test('what is refused before MTN is asked', async () => {
  assert.equal((await call('POST', '/v1/pos-momo/request', { business: ELSE, amount: 1000, phone: '0772123456' })).status, 404, 'another account\'s business');
  assert.equal((await call('POST', '/v1/pos-momo/request', { business: SHOP, amount: 100, phone: '0772123456' })).status, 400, 'below UGX 500');
  const airtel = await call('POST', '/v1/pos-momo/request', { business: SHOP, amount: 1000, phone: '0701234567' });
  assert.deepEqual([airtel.status, airtel.body.error], [400, 'notConnected']);
  assert.equal((await call('POST', '/v1/pos-momo/request', { business: SHOP, amount: 1000, phone: '12345' })).body.error, 'badPhone');
  const r = await call('POST', '/v1/pos-momo/request', { business: SHOP, amount: 1000, phone: '0772123456' });
  assert.equal((await call('GET', `/v1/pos-momo/request/${r.body.id}`, null, { 'x-who': 'other' })).status, 404, 'another account cannot read it');
});
