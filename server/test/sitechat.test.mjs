/**
 * The website's live chat (src/sitechat.js), end to end on an in-memory
 * database: a visitor writes, SALJOE TECH is emailed a reply link, the reply
 * page answers, the visitor's window sees it and the visitor is emailed.
 *
 *   node --experimental-test-module-mocks --test test/sitechat.test.mjs
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';

const mem = newDb();
const { Pool } = mem.adapters.createPg();
const pool = new Pool();
const mails = [];
mock.module('../src/db.js', { namedExports: { pool, q: (text, params) => pool.query(text, params) } });
mock.module('../src/mail.js', { namedExports: { mailConfigured: () => true, sendChatMail: async (m) => { mails.push(m); } } });

const Fastify = (await import('fastify')).default;
const rateLimit = (await import('@fastify/rate-limit')).default;
const siteChat = (await import('../src/sitechat.js')).default;

const app = Fastify();
await app.register(rateLimit, { max: 1000, timeWindow: '1 minute' });
await app.register(siteChat);
await app.ready();
const site = { origin: 'https://saljoe.tech', 'content-type': 'text/plain' };

test('a visitor writes, SALJOE TECH replies, and both sides see the conversation', async () => {
  const start = await app.inject({ method: 'POST', url: '/v1/site-chat/start', headers: site,
    payload: JSON.stringify({ name: 'Grace', email: 'grace@example.com', message: 'Do you install CCTV in Kasese?', page: '/Solutions.html' }) });
  assert.equal(start.statusCode, 200, start.body);
  assert.equal(start.headers['access-control-allow-origin'], 'https://saljoe.tech', 'the website may read the answer');
  const { id, key } = start.json();
  assert.ok(id && key);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'saljotech256@gmail.com');
  assert.equal(mails[0].replyTo, 'grace@example.com');
  const link = /\/v1\/site-chat\/reply\/([\w-]+)/.exec(mails[0].text)[1];

  // another site's page cannot read anything
  const other = await app.inject({ method: 'GET', url: `/v1/site-chat/${id}?key=${key}`, headers: { origin: 'https://evil.example' } });
  assert.equal(other.headers['access-control-allow-origin'], undefined);
  // a wrong key gets nothing
  assert.equal((await app.inject({ method: 'GET', url: `/v1/site-chat/${id}?key=nope`, headers: site })).statusCode, 404);

  const page = await app.inject({ method: 'GET', url: `/v1/site-chat/reply/${link}` });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Do you install CCTV in Kasese\?/);
  const sent = await app.inject({ method: 'POST', url: `/v1/site-chat/reply/${link}`, headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: 'message=' + encodeURIComponent('Yes, we cover Kasese. When can we visit?') });
  assert.equal(sent.statusCode, 302);
  assert.equal(mails.length, 2, 'the visitor is emailed the reply');
  assert.equal(mails[1].to, 'grace@example.com');

  const poll = await app.inject({ method: 'GET', url: `/v1/site-chat/${id}?key=${key}&after=0`, headers: site });
  const msgs = poll.json().messages;
  assert.deepEqual(msgs.map((m) => m.who), ['visitor', 'staff']);
  assert.match(msgs[1].body, /We cover Kasese/i);

  // the visitor answers; a run of messages makes one email to staff, not one each
  const again = await app.inject({ method: 'POST', url: `/v1/site-chat/${id}/send`, headers: site,
    payload: JSON.stringify({ key, message: 'Tomorrow at 10 works.', after: msgs[1].id }) });
  assert.equal(again.statusCode, 200);
  assert.deepEqual(again.json().messages.map((m) => m.body), ['Tomorrow at 10 works.']);
  assert.equal(mails.length, 2, 'staff were emailed moments ago, so not again yet');
});

test('a message needs words and a way to reply', async () => {
  const empty = await app.inject({ method: 'POST', url: '/v1/site-chat/start', headers: site, payload: JSON.stringify({ name: 'X', email: 'x@example.com', message: '  ' }) });
  assert.equal(empty.statusCode, 400);
  const noContact = await app.inject({ method: 'POST', url: '/v1/site-chat/start', headers: site, payload: JSON.stringify({ message: 'Hello' }) });
  assert.equal(noContact.statusCode, 400);
  const badEmail = await app.inject({ method: 'POST', url: '/v1/site-chat/start', headers: site, payload: JSON.stringify({ message: 'Hello', email: 'not-an-email' }) });
  assert.equal(badEmail.statusCode, 400);
  const phoneOnly = await app.inject({ method: 'POST', url: '/v1/site-chat/start', headers: site, payload: JSON.stringify({ message: 'Call me', phone: '0772 000000' }) });
  assert.equal(phoneOnly.statusCode, 200);
});
