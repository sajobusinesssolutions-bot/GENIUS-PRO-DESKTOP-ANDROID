/**
 * Tallix licences on the account server (src/schoolbooks.js), on an in-memory
 * database: the developer sets prices and grants Basic or Pro for one year,
 * three years or life; a renewal runs on from the licence in force; the school
 * gets its licence signed (Ed25519, aud "tallix", good for 90 days).
 *
 *   node --experimental-test-module-mocks --test test/schoolbooks.test.mjs
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newDb } from 'pg-mem';
import zlib from 'node:zlib';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const keyFile = path.join(os.tmpdir(), `tallix-test-key-${process.pid}.pem`);
fs.writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }));
process.env.LICENCE_PRIVATE_KEY_PATH = keyFile;

const mem = newDb();
mem.public.registerFunction({ name: 'gen_random_uuid', returns: 'uuid', implementation: () => crypto.randomUUID(), impure: true });
const { Pool } = mem.adapters.createPg();
const pool = new Pool();
const q = (text, params) => pool.query(text, params);
await q('create table accounts (id uuid primary key, email text not null, name text)');
const SCHOOL = '11111111-1111-4111-8111-111111111111', DEV = '22222222-2222-4222-8222-222222222222';
await q('insert into accounts (id, email, name) values ($1, $2, $3), ($4, $5, $6)', [SCHOOL, 'bursar@rubona.ac.ug', 'Rubona', DEV, 'dev@saljoe.tech', 'Dev']);

/* who is calling: the header says, as a signed-in session would */
const who = (req) => ({ id: req.headers['x-who'] === 'dev' ? DEV : SCHOOL, email: req.headers['x-who'] === 'dev' ? 'dev@saljoe.tech' : 'bursar@rubona.ac.ug' });
mock.module('../src/db.js', { namedExports: { pool, q } });
mock.module('../src/sync.js', { namedExports: { whoami: async (req) => who(req) } });
mock.module('../src/admin.js', { namedExports: { developer: async (req, reply) => (req.headers['x-who'] === 'dev' ? who(req) : (reply.code(404).send({ error: 'server' }), null)) } });

const Fastify = (await import('fastify')).default;
const schoolBooks = (await import('../src/schoolbooks.js')).default;
const app = Fastify();
await app.register(schoolBooks);
await app.ready();
const dev = { 'x-who': 'dev' };
const call = async (method, url, payload, headers = {}) => { const r = await app.inject({ method, url, payload, headers }); return { status: r.statusCode, body: r.json() }; };
const claims = (token) => {
  const [h, b, s] = token.split('.');
  assert.ok(crypto.verify(null, Buffer.from(h + '.' + b), publicKey, Buffer.from(s, 'base64url')), 'signed with the server key');
  return JSON.parse(Buffer.from(b, 'base64url').toString());
};

test('a new school is on a 30-day Pro trial, signed for 90 days, for Tallix only', async () => {
  const r = await call('GET', '/v1/school/licence');
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.state, r.body.plan, r.body.offline_days], ['trial', 'pro', 90]);
  const c = claims(r.body.token);
  assert.equal(c.aud, 'tallix');
  assert.equal(c.email, 'bursar@rubona.ac.ug');
  assert.ok(Math.abs(c.exp - c.iat - 90 * 86400) < 5);
});

test('prices: set by a developer, read by anyone; nobody else may set them', async () => {
  assert.equal((await call('PUT', '/v1/admin/school/prices', { prices: [{ plan: 'pro', term: '1y', price: 1 }] })).status, 404);
  const put = await call('PUT', '/v1/admin/school/prices', { prices: [{ plan: 'basic', term: '1y', price: 600000 }, { plan: 'pro', term: '1y', price: 1200000 }, { plan: 'pro', term: '3y', price: 3000000 }, { plan: 'pro', term: 'lifetime', price: 6000000 }, { plan: 'gold', term: '1y', price: 9 }] }, dev);
  assert.equal(put.status, 200);
  assert.equal(put.body.length, 6, 'two plans × three terms; an unknown plan is ignored');
  const pub = await call('GET', '/v1/school/prices');
  assert.equal(pub.body.prices.find((p) => p.plan === 'pro' && p.term === '3y').price, 3000000);
  assert.equal(pub.body.offline_days, 90);
});

test('granting: Basic for a year at its price, then Pro for three years runs on from it; lifetime has no end', async () => {
  assert.equal((await call('POST', '/v1/admin/school/licences', { email: 'bursar@rubona.ac.ug', plan: 'pro', term: '1y' })).status, 404, 'a school cannot grant itself');
  const a = await call('POST', '/v1/admin/school/licences', { email: 'Bursar@Rubona.ac.ug', plan: 'basic', term: '1y', note: 'receipt 12' }, dev);
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.deepEqual([a.body.plan, a.body.term, a.body.amount, a.body.edition], ['basic', '1y', 600000, 'finance']);
  const end1 = Date.parse(a.body.expires_at);
  assert.ok(Math.abs(end1 - (Date.now() + 365 * 864e5)) < 864e5);
  let lic = await call('GET', '/v1/school/licence');
  assert.deepEqual([lic.body.state, lic.body.plan, lic.body.term], ['licensed', 'basic', '1y']);
  assert.equal(claims(lic.body.token).plan, 'basic');

  const b = await call('POST', '/v1/admin/school/licences', { email: 'bursar@rubona.ac.ug', plan: 'pro', term: '3y', amount: 2800000 }, dev);
  assert.ok(Math.abs(Date.parse(b.body.expires_at) - (end1 + 1095 * 864e5)) < 864e5, 'runs on from the end of the year already paid for');
  assert.equal(b.body.amount, 2800000, 'the amount actually paid');
  lic = await call('GET', '/v1/school/licence');
  assert.deepEqual([lic.body.plan, lic.body.term], ['pro', '3y'], 'the licence that runs longest is the one in force');

  const c = await call('POST', '/v1/admin/school/licences', { email: 'bursar@rubona.ac.ug', plan: 'pro', term: 'lifetime' }, dev);
  assert.equal(c.body.expires_at, null);
  lic = await call('GET', '/v1/school/licence');
  assert.equal(lic.body.term, 'lifetime');
  assert.equal(claims(lic.body.token).until, null);

  const list = await call('GET', '/v1/admin/school/licences', null, dev);
  assert.equal(list.body.length, 3);
  assert.ok(list.body.every((l) => l.email === 'bursar@rubona.ac.ug'));
  assert.equal((await call('POST', '/v1/admin/school/licences', { email: 'nobody@x.ug', plan: 'pro', term: '1y' }, dev)).status, 404);
});

test("a school that checks its licence is listed in the console, with its name, computer and version, before any licence", async () => {
  const r = await app.inject({ method: "GET", url: "/v1/school/licence?school=Rubona%20Hill%20School&device=BURSAR-PC&version=0.13.0" });
  assert.equal(r.statusCode, 200);
  const list = await call("GET", "/v1/admin/school/schools", null, dev);
  assert.equal(list.status, 200, JSON.stringify(list.body) + " / " + r.body);
  const me = list.body.find((x) => x.email === "bursar@rubona.ac.ug");
  assert.ok(me, "the school is there to grant to");
  assert.deepEqual(me.schools, ["Rubona Hill School"]);
  assert.equal(me.computers, 1);
  assert.equal(me.version, "0.13.0");
  assert.equal((await call("GET", "/v1/admin/school/schools")).status, 404, "not for a school");
});

test("only the changes: a parcel after the whole copy; a computer behind takes the parcels; an older Tallix is told to update", async () => {
  const made = await call("POST", "/v1/school/books", { name: "Rubona Hill School" });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const id = made.body.id;
  const gz = (o) => (zlib.gzipSync(Buffer.from(JSON.stringify(o)))).toString("base64");
  assert.equal((await call("GET", `/v1/school/books/${id}/ops?since=0&client=2`)).status, 410, "nothing kept yet: the whole book first");
  const whole = Buffer.alloc(64, 7).toString("base64");
  const put = await call("PUT", `/v1/school/books/${id}`, { base_version: 0, data: whole, client: 2 });
  assert.deepEqual([put.status, put.body.version, put.body.snapshot_version], [200, 1, 1]);
  const op = await call("POST", `/v1/school/books/${id}/ops`, { base_version: 1, data: gz([[["INSERT INTO x VALUES (?)", [1]]]]), count: 1, client: 2 });
  assert.deepEqual([op.status, op.body.version, op.body.ops_since_snapshot], [200, 2, 1]);
  assert.equal((await call("POST", `/v1/school/books/${id}/ops`, { base_version: 1, data: gz([]), client: 2 })).status, 409, "a computer behind cannot send on top");
  const got = await call("GET", `/v1/school/books/${id}/ops?since=1&client=2`);
  assert.deepEqual([got.body.version, got.body.ops.length, got.body.ops[0].version], [2, 1, 2]);
  /* a Tallix before 0.14 takes or sends only whole books: told to update, so it neither misses nor overwrites the parcel */
  assert.equal((await call("GET", `/v1/school/books/${id}`)).body.error, "upgrade");
  assert.equal((await call("PUT", `/v1/school/books/${id}`, { base_version: 2, data: whole })).body.error, "upgrade");
  /* the whole book again: the parcels before it go */
  const again = await call("PUT", `/v1/school/books/${id}`, { base_version: 2, data: whole, client: 2 });
  assert.deepEqual([again.body.version, again.body.snapshot_version], [3, 3]);
  assert.equal((await call("GET", `/v1/school/books/${id}/ops?since=1&client=2`)).status, 410, "behind the whole copy: take it whole");
  assert.equal((await call("GET", `/v1/school/books/${id}?client=2`)).body.data, whole);
});

test("a school buys its licence: a prompt for the price; paid → granted once; not open without SALJOE TECH's keys", async () => {
  assert.equal((await call("POST", "/v1/school/buy", { plan: "pro", term: "1y", phone: "0772123456" })).status, 503, "closed without the keys");
  process.env.MTN_MOMO_KEY = "k"; process.env.MTN_MOMO_USER = "u"; process.env.MTN_MOMO_SECRET = "s"; process.env.MTN_MOMO_ENV = "live"; process.env.MTN_MOMO_TARGET = "mtnuganda";
  const real = global.fetch; let state = "PENDING"; let asked = null;
  global.fetch = async (url, o = {}) => {
    const r = (status, j) => ({ ok: status < 300, status, text: async () => JSON.stringify(j), json: async () => j });
    if (url.endsWith("/collection/token/")) return r(200, { access_token: "T", expires_in: 3600 });
    if (url.endsWith("/collection/v1_0/requesttopay")) { asked = JSON.parse(o.body); return { ok: false, status: 202, text: async () => "", json: async () => ({}) }; }
    if (/requesttopay\/[\w-]+$/.test(url)) return r(200, { status: state, financialTransactionId: "MTN-9" });
    return r(404, {});
  };
  try {
    assert.equal((await call("POST", "/v1/school/buy", { plan: "pro", term: "1y", phone: "0752123456" })).status, 409, "Airtel not open");
    const b = await call("POST", "/v1/school/buy", { plan: "pro", term: "1y", phone: "0772123456" });
    assert.equal(b.status, 200, JSON.stringify(b.body));
    assert.equal(b.body.amount, 1200000, "the price set in the console");
    assert.equal(asked.payer.partyId, "256772123456");
    const before = (await call("GET", "/v1/admin/school/licences", null, dev)).body.length;
    assert.equal((await call("GET", `/v1/school/buy/${b.body.id}`)).body.status, "pending");
    state = "SUCCESSFUL";
    assert.equal((await call("GET", `/v1/school/buy/${b.body.id}`)).body.status, "paid");
    await call("GET", `/v1/school/buy/${b.body.id}`);
    const after = (await call("GET", "/v1/admin/school/licences", null, dev)).body;
    assert.equal(after.length, before + 1, "granted once, however often it is asked");
    assert.match(after[0].note, /Bought in the app: MTN 256772123456, MTN-9/);
    assert.equal((await call("GET", `/v1/school/buy/${b.body.id}`, null, dev)).status, 404, "another account cannot see it");
  } finally { global.fetch = real; delete process.env.MTN_MOMO_KEY; }
});

test.after(() => { try { fs.unlinkSync(keyFile); } catch { /* gone */ } });
