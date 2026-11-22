/**
 * The live chat on the website (saljoe.tech).
 *
 * A visitor writes in the chat bubble; the message is kept here and SALJOE
 * TECH gets it by email, with a link to a private reply page. A reply typed
 * there shows in the visitor's chat window (it asks every few seconds while
 * open) and, when they left an address, reaches them by email too. Both sides
 * see the whole conversation.
 *
 * The website is another origin, so the visitor's calls are "simple" requests
 * (GET, or POST with a text/plain body) that a browser sends without a
 * preflight, and each answer names saljoe.tech as allowed to read it. The rest
 * of the API stays closed to web pages.
 *
 * A conversation is reached only with its own secrets: the visitor's key (kept
 * in their browser) and the staff link's token (in the email). Nothing here is
 * listed or searchable from outside.
 */
import crypto from 'node:crypto';
import { q } from './db.js';
import { sendChatMail, mailConfigured } from './mail.js';

const SITES = new Set(['https://saljoe.tech', 'https://www.saljoe.tech', 'https://saljoetech.tech', 'https://www.saljoetech.tech']);
const TO = () => process.env.SITE_CHAT_TO || 'saljotech256@gmail.com';
const BASE = () => (process.env.SITE_CHAT_BASE || 'https://api.saljoe.tech').replace(/\/$/, '');
/* a run of visitor messages makes one email, not one each: at most one per conversation in this time */
const STAFF_MAIL_GAP_MS = 3 * 60 * 1000;

const cut = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const secret = () => crypto.randomBytes(24).toString('base64url');
const same = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && crypto.timingSafeEqual(x, y); };

export async function ensureChatTables() {
  await q(`create table if not exists site_chats (
    id          text primary key,
    visitor_key text not null,
    staff_token text not null unique,
    name        text,
    email       text,
    phone       text,
    page        text,
    ip          text,
    created_at  timestamptz not null default now(),
    last_at     timestamptz not null default now(),
    staff_mailed_at timestamptz
  )`);
  await q(`create table if not exists site_chat_messages (
    id      bigserial primary key,
    chat_id text not null references site_chats(id) on delete cascade,
    who     text not null,      -- visitor | staff
    body    text not null,
    at      timestamptz not null default now()
  )`);
  await q('create index if not exists site_chat_messages_chat on site_chat_messages (chat_id, id)');
}

/** The website may read the answer; nobody else's page. */
function allow(req, reply) {
  const o = String(req.headers.origin || '');
  if (SITES.has(o) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(o)) {
    reply.header('access-control-allow-origin', o);
    reply.header('vary', 'Origin');
  }
}
/* the body arrives as text (so no preflight is needed) and holds JSON */
function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(String(req.body || '{}')); } catch { return {}; }
}
const messagesOf = async (id, after = 0) =>
  (await q('select id, who, body, at from site_chat_messages where chat_id = $1 and id > $2 order by id limit 200', [id, Number(after) || 0])).rows;

async function mailStaff(chat, latest) {
  if (!mailConfigured()) return;
  const all = await messagesOf(chat.id);
  const who = chat.name || chat.email || chat.phone || 'A visitor';
  const link = `${BASE()}/v1/site-chat/reply/${chat.staff_token}`;
  const lines = all.slice(-12).map((m) => `${m.who === 'staff' ? 'SALJOE TECH' : who}: ${m.body}`).join('\n\n');
  await sendChatMail({
    to: TO(),
    replyTo: chat.email || undefined,
    subject: `Website chat: ${who} — "${latest.slice(0, 60)}${latest.length > 60 ? '…' : ''}"`,
    text: `${who} wrote in the chat on saljoe.tech${chat.page ? ' (' + chat.page + ')' : ''}.\n`
      + `${chat.email ? 'Email: ' + chat.email + '\n' : ''}${chat.phone ? 'Phone: ' + chat.phone + '\n' : ''}\n${lines}\n\n`
      + `Reply here and it appears in their chat window${chat.email ? ' and is emailed to them' : ''}:\n${link}\n`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:560px;color:#14202B">
      <p style="font-size:15px"><b>${esc(who)}</b> wrote in the chat on saljoe.tech${chat.page ? ' <span style="color:#687385">(' + esc(chat.page) + ')</span>' : ''}</p>
      <p style="font-size:13px;color:#687385">${chat.email ? 'Email: ' + esc(chat.email) + '<br>' : ''}${chat.phone ? 'Phone: ' + esc(chat.phone) : ''}</p>
      ${all.slice(-12).map((m) => `<div style="margin:8px 0;padding:10px 12px;border-radius:10px;background:${m.who === 'staff' ? '#FDF1E7' : '#F1F4F9'}"><div style="font-size:12px;color:#687385">${m.who === 'staff' ? 'SALJOE TECH' : esc(who)}</div><div style="font-size:15px;white-space:pre-wrap">${esc(m.body)}</div></div>`).join('')}
      <p style="margin-top:18px"><a href="${link}" style="background:#E8650F;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Reply in the chat</a></p>
      <p style="font-size:12px;color:#8b95a5">Your reply shows in their chat window${chat.email ? ' and is emailed to them' : ''}. Keep this link private: anyone with it can answer as SALJOE TECH.</p></div>`,
  });
  await q('update site_chats set staff_mailed_at = now() where id = $1', [chat.id]);
}

async function mailVisitor(chat, text) {
  if (!chat.email || !mailConfigured()) return;
  await sendChatMail({
    to: chat.email,
    replyTo: TO(),
    subject: 'SALJOE TECH replied to your message',
    text: `Hello${chat.name ? ' ' + chat.name : ''},\n\n${text}\n\nYou can carry on the conversation in the chat on https://saljoe.tech, or reply to this email.\n\nSALJOE TECH\n+256 753 201 462`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:520px;color:#14202B">
      <p>Hello${chat.name ? ' ' + esc(chat.name) : ''},</p>
      <div style="padding:12px 14px;border-radius:10px;background:#FDF1E7;font-size:15px;white-space:pre-wrap">${esc(text)}</div>
      <p style="font-size:14px">Carry on the conversation in the chat on <a href="https://saljoe.tech" style="color:#C2540A">saljoe.tech</a>, or reply to this email.</p>
      <p style="font-size:13px;color:#687385">SALJOE TECH · +256 753 201 462</p></div>`,
  });
}

/** The private page SALJOE TECH replies from: the conversation and a box to answer in. */
function replyPage(chat, msgs, note) {
  const who = chat.name || chat.email || chat.phone || 'Visitor';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Chat with ${esc(who)} — SALJOE TECH</title>
<style>body{margin:0;background:#F3F5F8;font:15px/1.55 system-ui,'Segoe UI',sans-serif;color:#14202B}
.w{max-width:640px;margin:0 auto;padding:20px 16px 40px}h1{font-size:20px;margin:6px 0 2px}.m{color:#687385;font-size:13px}
.b{margin:10px 0;max-width:85%;padding:10px 14px;border-radius:14px;white-space:pre-wrap}.v{background:#fff;border:1px solid #E4E8EE}
.s{background:#0D2747;color:#fff;margin-left:auto}.t{font-size:11px;opacity:.7;margin-top:4px}
form{margin-top:18px;background:#fff;border:1px solid #E4E8EE;border-radius:14px;padding:14px}
textarea{width:100%;box-sizing:border-box;min-height:110px;font:inherit;padding:10px;border:1px solid #D9DEE6;border-radius:10px}
button{margin-top:10px;background:#E8650F;color:#fff;border:0;border-radius:10px;padding:12px 20px;font:inherit;font-weight:600;cursor:pointer}
.n{background:#DCF7E8;color:#0B6B45;padding:10px 14px;border-radius:10px;margin-top:12px}</style></head><body><div class="w">
<div class="m">SALJOE TECH · website chat</div><h1>${esc(who)}</h1>
<div class="m">${[chat.email, chat.phone, chat.page].filter(Boolean).map(esc).join(' · ')}</div>
${note ? `<div class="n">${esc(note)}</div>` : ''}
${msgs.map((m) => `<div class="b ${m.who === 'staff' ? 's' : 'v'}">${esc(m.body)}<div class="t">${m.who === 'staff' ? 'SALJOE TECH' : esc(who)} · ${new Date(m.at).toLocaleString('en-GB', { timeZone: 'Africa/Kampala', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div></div>`).join('')}
<form method="post"><textarea name="message" required placeholder="Type your reply"></textarea><br><button>Send reply</button>
<div class="m" style="margin-top:8px">It shows in their chat window${chat.email ? ' and is emailed to ' + esc(chat.email) : ''}.</div></form>
</div></body></html>`;
}

export default async function siteChatRoutes(app) {
  await ensureChatTables();
  /* the reply page's form, posted as a form */
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 64 * 1024 },
    (req, raw, done) => done(null, Object.fromEntries(new URLSearchParams(raw))));

  /* a visitor starts a conversation */
  app.post('/v1/site-chat/start', { bodyLimit: 32 * 1024, config: { rateLimit: { max: 8, timeWindow: '10 minutes' } } }, async (req, reply) => {
    allow(req, reply);
    const b = body(req);
    const message = cut(b.message, 4000);
    const name = cut(b.name, 120), email = cut(b.email, 200), phone = cut(b.phone, 40);
    if (!message) return reply.code(400).send({ error: 'empty', message: 'Write a message first.' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply.code(400).send({ error: 'email', message: 'That email address does not look right.' });
    if (!email && !phone) return reply.code(400).send({ error: 'contact', message: 'Leave an email or a phone number so we can reply.' });
    const chat = { id: crypto.randomUUID(), visitor_key: secret(), staff_token: secret(), name, email, phone, page: cut(b.page, 200) };
    await q('insert into site_chats (id, visitor_key, staff_token, name, email, phone, page, ip) values ($1,$2,$3,$4,$5,$6,$7,$8)',
      [chat.id, chat.visitor_key, chat.staff_token, name || null, email || null, phone || null, chat.page || null, req.ip]);
    await q("insert into site_chat_messages (chat_id, who, body) values ($1, 'visitor', $2)", [chat.id, message]);
    try { await mailStaff(chat, message); } catch (e) { req.log.error({ err: e.message }, 'site chat: staff email failed'); }
    return { id: chat.id, key: chat.visitor_key, messages: await messagesOf(chat.id) };
  });

  /* the visitor writes again */
  app.post('/v1/site-chat/:id/send', { bodyLimit: 32 * 1024, config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (req, reply) => {
    allow(req, reply);
    const b = body(req);
    const chat = (await q('select * from site_chats where id = $1', [String(req.params.id)])).rows[0];
    if (!chat || !same(chat.visitor_key, b.key)) return reply.code(404).send({ error: 'unknown', message: 'That conversation was not found.' });
    const message = cut(b.message, 4000);
    if (!message) return reply.code(400).send({ error: 'empty', message: 'Write a message first.' });
    await q("insert into site_chat_messages (chat_id, who, body) values ($1, 'visitor', $2)", [chat.id, message]);
    await q('update site_chats set last_at = now() where id = $1', [chat.id]);
    if (!chat.staff_mailed_at || Date.now() - new Date(chat.staff_mailed_at).getTime() > STAFF_MAIL_GAP_MS) {
      try { await mailStaff(chat, message); } catch (e) { req.log.error({ err: e.message }, 'site chat: staff email failed'); }
    }
    return { messages: await messagesOf(chat.id, b.after) };
  });

  /* the visitor's window asks what is new */
  app.get('/v1/site-chat/:id', { config: { rateLimit: { max: 40, timeWindow: '1 minute' } } }, async (req, reply) => {
    allow(req, reply);
    const chat = (await q('select id, visitor_key from site_chats where id = $1', [String(req.params.id)])).rows[0];
    if (!chat || !same(chat.visitor_key, req.query?.key)) return reply.code(404).send({ error: 'unknown', message: 'That conversation was not found.' });
    return { messages: await messagesOf(chat.id, req.query?.after) };
  });

  /* SALJOE TECH's reply page, from the link in the email */
  app.get('/v1/site-chat/reply/:token', async (req, reply) => {
    const chat = (await q('select * from site_chats where staff_token = $1', [String(req.params.token)])).rows[0];
    if (!chat) return reply.code(404).type('text/plain').send('That conversation was not found.');
    return reply.type('text/html').header('cache-control', 'no-store').send(replyPage(chat, await messagesOf(chat.id), req.query?.sent ? 'Sent.' : ''));
  });
  app.post('/v1/site-chat/reply/:token', { bodyLimit: 64 * 1024, config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const chat = (await q('select * from site_chats where staff_token = $1', [String(req.params.token)])).rows[0];
    if (!chat) return reply.code(404).type('text/plain').send('That conversation was not found.');
    const message = cut((req.body || {}).message, 6000);
    if (message) {
      await q("insert into site_chat_messages (chat_id, who, body) values ($1, 'staff', $2)", [chat.id, message]);
      await q('update site_chats set last_at = now() where id = $1', [chat.id]);
      try { await mailVisitor(chat, message); } catch (e) { req.log.error({ err: e.message }, 'site chat: visitor email failed'); }
    }
    return reply.redirect(`/v1/site-chat/reply/${chat.staff_token}?sent=1`);
  });
}
