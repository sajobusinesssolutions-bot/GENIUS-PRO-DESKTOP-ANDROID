/**
 * SACCO Manager licences on the account server (src/saccolicences.js): a new
 * account on a 30-day Professional trial; tiers granted with their features
 * and member limits; a renewal running on; the licence signed for SACCO
 * Manager only (aud "sacco"); prices; the list of SACCOs.
 *
 *   node --experimental-test-module-mocks --test test/saccolicences.test.mjs
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newDb } from 'pg-mem';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const keyFile = path.join(os.tmpdir(), `sacco-test-key-${process.pid}.pem`);
fs.writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }));
process.env.LICENCE_PRIVATE_KEY_PATH = keyFile;

const mem = newDb();
const { Pool } = mem.adapters.createPg();
const pool = new Pool();
const q = (text, params) => pool.query(text, params);
await q('create table accounts (id uuid primary key, email text not null, name text)');
const SACCO = '33333333-3333-4333-8333-333333333333', DEV = '44444444-4444-4444-8444-444444444444';
await q('insert into accounts (id, email, name) values ($1, $2, $3), ($4, $5, $6)', [SACCO, 'manager@kasese-sacco.ug', 'Kasese SACCO', DEV, 'dev@saljoe.tech', 'Dev']);
const who = (req) => ({ id: req.headers['x-who'] === 'dev' ? DEV : SACCO, email: req.headers['x-who'] === 'dev' ? 'dev@saljoe.tech' : 'manager@kasese-sacco.ug' });
mock.module('../src/db.js', { namedExports: { pool, q } });
mock.module('../src/sync.js', { namedExports: { whoami: async (req) => who(req) } });
mock.module('../src/admin.js', { namedExports: { developer: async (req, reply) => (req.headers['x-who'] === 'dev' ? who(req) : (reply.code(404).send({ error: 'server' }), null)) } });

const Fastify = (await import('fastify')).default;
const routes = (await import('../src/saccolicences.js')).default;
const app = Fastify();
await app.register(routes);
await app.ready();
const dev = { 'x-who': 'dev' };
const call = async (method, url, payload, headers = {}) => { const r = await app.inject({ method, url, payload, headers }); return { status: r.statusCode, body: r.json() }; };
const claims = (token) => {
  const [h, b, s] = token.split('.');
  assert.ok(crypto.verify(null, Buffer.from(h + '.' + b), publicKey, Buffer.from(s, 'base64url')), 'signed with the server key');
  return JSON.parse(Buffer.from(b, 'base64url').toString());
};

test('a new SACCO: a 30-day Professional trial, signed for SACCO Manager only, and listed for the developer', async () => {
  const r = await call('GET', '/v1/sacco/licence?device=TELLER-1&institution=Kasese%20SACCO&version=1.10.0');
  assert.deepEqual([r.body.state, r.body.tier], ['trial', 'professional']);
  const c = claims(r.body.token);
  assert.equal(c.aud, 'sacco');
  assert.ok(c.features.includes('shares') && c.features.includes('payroll'));
  assert.equal(c.maxCustomers, 0);
  assert.ok(Math.abs(c.exp - c.iat - 90 * 86400) < 5);
  const list = await call('GET', '/v1/admin/sacco/saccos', null, dev);
  const me = list.body.find((x) => x.email === 'manager@kasese-sacco.ug');
  assert.deepEqual([me.institutions, me.computers, me.version, me.tier], [['Kasese SACCO'], 1, '1.10.0', 'trial']);
  assert.equal((await call('GET', '/v1/admin/sacco/saccos')).status, 404, 'not for a SACCO');
});

test('Basic with its member limit; Professional for three years runs on from it; prices', async () => {
  await call('PUT', '/v1/admin/sacco/prices', { prices: [{ tier: 'basic', term: '1y', price: 500000 }, { tier: 'professional', term: '3y', price: 4000000 }] }, dev);
  assert.equal((await call('GET', '/v1/sacco/prices')).body.prices.find((p) => p.tier === 'basic' && p.term === '1y').price, 500000);
  const a = await call('POST', '/v1/admin/sacco/licences', { email: 'manager@kasese-sacco.ug', tier: 'basic', term: '1y' }, dev);
  assert.deepEqual([a.status, a.body.tier, a.body.max_customers, a.body.amount], [200, 'basic', 100, 500000]);
  let c = claims((await call('GET', '/v1/sacco/licence')).body.token);
  assert.deepEqual([c.tier, c.maxCustomers, c.features], ['basic', 100, ['savings', 'loans', 'reports']]);
  const b = await call('POST', '/v1/admin/sacco/licences', { email: 'manager@kasese-sacco.ug', tier: 'professional', term: '3y' }, dev);
  assert.ok(Math.abs(Date.parse(b.body.expires_at) - (Date.parse(a.body.expires_at) + 1095 * 864e5)) < 864e5, 'runs on from the year paid for');
  c = claims((await call('GET', '/v1/sacco/licence')).body.token);
  assert.equal(c.tier, 'professional');
  assert.equal((await call('POST', '/v1/admin/sacco/licences', { email: 'manager@kasese-sacco.ug', tier: 'basic', term: '1y' })).status, 404, 'a SACCO cannot grant itself');
});

test('buying is closed without SALJOE TECH\'s keys', async () => {
  assert.equal((await call('POST', '/v1/sacco/buy', { tier: 'basic', term: '1y', phone: '0772123456' })).status, 503);
});

test.after(() => { try { fs.unlinkSync(keyFile); } catch { /* gone */ } });
