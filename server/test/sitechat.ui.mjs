/**
 * The chat bubble on the built website against the chat service, in a real
 * browser: write from the site, reply from the emailed link, see the reply
 * arrive in the bubble. Needs playwright (path in PW) and the built site (SITE).
 *
 *   PW=... SITE=... node --experimental-test-module-mocks --test test/sitechat.ui.mjs
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { newDb } from 'pg-mem';

const { Pool } = newDb().adapters.createPg();
const pool = new Pool();
const mails = [];
mock.module('../src/db.js', { namedExports: { pool, q: (t, p) => pool.query(t, p) } });
mock.module('../src/mail.js', { namedExports: { mailConfigured: () => true, sendChatMail: async (m) => { mails.push(m); } } });
const Fastify = (await import('fastify')).default;
const rateLimit = (await import('@fastify/rate-limit')).default;
const siteChat = (await import('../src/sitechat.js')).default;
const { chromium } = createRequire(process.env.PW + '/')('playwright');
const SITE = process.env.SITE, OUT = process.env.OUT || '.';

test('the bubble on the site talks to SALJOE TECH and shows the reply', async () => {
  const api = Fastify(); await api.register(rateLimit, { max: 1000, timeWindow: '1 minute' }); await api.register(siteChat);
  await api.listen({ port: 4410, host: '127.0.0.1' });
  const web = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.end(fs.readFileSync(f)); }).listen(4409);
  const b = await chromium.launch();
  try {
    for (const [w, h, tag] of [[1440, 900, 'd'], [390, 800, 'm']]) {
      mails.length = 0;
      const p = await b.newPage({ viewport: { width: w, height: h } });
      const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
      await p.addInitScript(() => { window.SJ_CHAT_API = 'http://127.0.0.1:4410'; try { localStorage.removeItem('saljoe-chat'); } catch {} });
      await p.goto('http://127.0.0.1:4409/Solutions.html', { waitUntil: 'domcontentloaded' });
      await p.waitForSelector('.sjc-btn');
      await p.screenshot({ path: `${OUT}/chat-0-${tag}.png` });
      await p.click('.sjc-btn');
      await p.fill('.sjc-form [name=name]', 'Grace');
      await p.fill('.sjc-form [name=email]', 'grace@example.com');
      await p.fill('.sjc-form [name=message]', 'Do you install CCTV in Kasese?');
      await p.screenshot({ path: `${OUT}/chat-1-${tag}.png` });
      await p.click('.sjc-go');
      await p.waitForSelector('.sjc-m.me');
      assert.equal(mails.length, 1, 'SALJOE TECH is emailed');
      const token = /\/v1\/site-chat\/reply\/([\w-]+)/.exec(mails[0].text)[1];
      const res = await fetch(`http://127.0.0.1:4410/v1/site-chat/reply/${token}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'message=' + encodeURIComponent('Yes, we cover Kasese. When can we visit?'), redirect: 'manual' });
      assert.equal(res.status, 302);
      await p.waitForSelector('.sjc-m.them', { timeout: 15000 });
      await p.fill('.sjc-send textarea', 'Tomorrow at 10 works.');
      await p.keyboard.press('Enter');
      await p.waitForFunction(() => document.querySelectorAll('.sjc-m.me').length === 2);
      await p.screenshot({ path: `${OUT}/chat-2-${tag}.png` });
      // the reply page SALJOE TECH opens from the email
      const rp = await b.newPage({ viewport: { width: 420, height: 800 } });
      await rp.goto(`http://127.0.0.1:4410/v1/site-chat/reply/${token}`);
      await rp.screenshot({ path: `${OUT}/chat-3-${tag}.png`, fullPage: true });
      assert.match(await rp.content(), /Tomorrow at 10 works/);
      await rp.close();
      assert.deepEqual(errs, []);
      await p.close();
    }
  } finally { await b.close(); web.close(); await api.close(); }
});
