/**
 * THE OWNER'S DAY SUMMARY BY EMAIL.
 *
 * The app writes the summary (it holds the books); the server only mails it,
 * so it reaches the owner without anyone opening a mail app on the till.
 * Signed-in accounts only, a handful a day each, to one address at a time.
 */
import { whoami } from './sync.js';
import { sendSummary } from './mail.js';

const sent = new Map(); // account id -> { day, n }
const MAX_A_DAY = 12;

export default async function summaryRoutes(app) {
  app.post('/v1/summary/email', { bodyLimit: 64 * 1024 }, async (req, reply) => {
    const me = await whoami(req, reply);
    if (!me) return;
    const to = String(req.body?.to || '').trim();
    const subject = String(req.body?.subject || 'Day summary').slice(0, 160);
    const text = String(req.body?.text || '').slice(0, 20000);
    if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(to)) return reply.code(400).send({ error: 'malformed', message: 'That email address does not look right.' });
    if (!text.trim()) return reply.code(400).send({ error: 'malformed', message: 'The summary is empty.' });
    const day = new Date().toISOString().slice(0, 10);
    const c = sent.get(me.id);
    const n = c && c.day === day ? c.n : 0;
    if (n >= MAX_A_DAY) return reply.code(429).send({ error: 'too_many', message: 'Enough summaries have been sent today. Try again tomorrow.' });
    try {
      await sendSummary(to, subject, text);
    } catch (e) {
      if (e.message === 'mail_not_configured') return reply.code(503).send({ error: 'mail_not_configured', message: 'Email is not set up on the server yet.' });
      req.log.error(e, 'summary mail failed');
      return reply.code(502).send({ error: 'mail_failed', message: 'The email could not be sent. Try again shortly.' });
    }
    sent.set(me.id, { day, n: n + 1 });
    return { sent: true };
  });
}
