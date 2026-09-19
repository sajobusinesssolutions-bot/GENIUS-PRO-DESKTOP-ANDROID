/**
 * The Genius POS sync and licence server.
 *
 * Listens on localhost only. nginx terminates TLS and proxies to it, so the
 * process itself never needs to be reachable from the internet and cannot be
 * hit directly even if the firewall were misconfigured.
 */
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';

import { pool, q } from './db.js';
import { verifyMail, mailConfigured } from './mail.js';
import authRoutes from './auth.js';
import googleRoutes from './google.js';
import syncRoutes from './sync.js';
import adminRoutes, { recordRequest, runBackup } from './admin.js';

const app = Fastify({
  logger: {
    level: 'info',
    // Payloads carry customer names and phone numbers, so requests are logged
    // by shape and never by body.
    serializers: {
      req: (r) => ({ method: r.method, url: r.url, ip: r.ip }),
      res: (r) => ({ statusCode: r.statusCode }),
    },
  },
  trustProxy: true,
  bodyLimit: 32 * 1024 * 1024,
});

await app.register(helmet, { contentSecurityPolicy: false });

// The app is a phone, not a browser page, so there is no origin to allow and
// nothing here is reachable from a website by design.
await app.register(cors, { origin: false });

await app.register(rateLimit, {
  max: 120,
  timeWindow: '1 minute',
  keyGenerator: (req) => req.ip,
});

/* ---------------------------------------------------------------- */

app.get('/health', async () => {
  const started = Date.now();
  let db = 'down';
  try {
    await q('select 1');
    db = 'up';
  } catch { /* reported as down */ }
  return {
    ok: db === 'up',
    db,
    mail: mailConfigured() ? 'configured' : 'not configured',
    ms: Date.now() - started,
    version: '0.1.0',
  };
});

app.get('/', async () => ({
  service: 'genius-sync',
  message: 'This is an API for the Genius POS app. There is no website here.',
}));

// every request is timed for the developer console's live figures — registered
// before the routes so it applies to all of them
app.addHook('onResponse', async (req, reply) => {
  recordRequest(reply.elapsedTime, reply.statusCode);
});

// Tighter limits where guessing is the attack: sign-in and code entry.
await app.register(async (scope) => {
  await scope.register(rateLimit, { max: 10, timeWindow: '1 minute' });
  await scope.register(authRoutes);
});
await app.register(googleRoutes);
await app.register(syncRoutes);
await app.register(adminRoutes);


/*
 * A nightly dump of every tenant. The button in the console is for "now"; this
 * is for the night nobody remembers to press it. Checked hourly; runs once a day
 * after 02:00 UTC. A restart may add a second dump that day, which is harmless —
 * the retention limit trims the oldest.
 */
let lastNightly = '';
setInterval(async () => {
  const d = new Date();
  const day = d.toISOString().slice(0, 10);
  if (d.getUTCHours() < 2 || lastNightly === day) return;
  lastNightly = day;
  try {
    const b = await runBackup();
    app.log.info({ backup: b.name, bytes: b.bytes }, 'nightly backup');
  } catch (e) {
    app.log.error({ err: e.message }, 'nightly backup failed');
  }
}, 60 * 60 * 1000).unref();

/* ---------------------------------------------------------------- */

const port = Number(process.env.PORT || 8080);

try {
  // Checked once at boot so a wrong SMTP password is found now, not by a
  // shopkeeper waiting for a code that is never going to arrive.
  const mail = await verifyMail();
  app.log.info({ mail: mail.ok ? 'ok' : mail.why }, 'mail check');

  await app.listen({ port, host: '127.0.0.1' });
  app.log.info(`listening on 127.0.0.1:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

/** Finish what is in flight before going away, so a push is not lost on deploy. */
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    app.log.info(`${sig} — closing`);
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
