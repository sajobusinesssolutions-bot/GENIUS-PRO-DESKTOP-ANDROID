/**
 * transfers.harness.mjs — the account server's transfer routes, for testing a
 * computer and a "phone" against each other without Postgres.
 *
 *   node test/transfers.harness.mjs <port> <businesses JSON>
 *
 * Runs the real rules (src/transfers.core.js) on an in-memory Postgres, with
 * just enough sign-in for the Windows app: POST /v1/auth/refresh hands out an
 * access token "tok-<account>", and that token is the account. Businesses are
 * given on the command line: [{ id, name, account }].
 */
import Fastify from 'fastify';
import { newDb } from 'pg-mem';
import { ensureTransfersTable, registerTransfers } from '../src/transfers.core.js';

const port = Number(process.argv[2] || 4999);
const businesses = JSON.parse(process.argv[3] || '[]');
const mem = newDb(); const { Pool } = mem.adapters.createPg(); const pool = new Pool();
const q = (t, p) => pool.query(t, p);
await q(`create table businesses (id uuid primary key, name text, account_id uuid, status text default 'active', created_at timestamptz default now())`);
await q(`create table business_members (business_id uuid, account_id uuid, role text)`);
for (const b of businesses) await q('insert into businesses (id, name, account_id) values ($1,$2,$3)', [b.id, b.name, b.account]);
await ensureTransfersTable(q);

const app = Fastify();
app.post('/v1/auth/refresh', async (req) => ({ access: 'tok-' + String(req.body?.refresh || '').replace(/^ref-/, ''), refresh: req.body?.refresh }));
const who = async (req, reply) => {
  const t = String(req.headers.authorization || '').replace('Bearer tok-', '');
  if (!t) { reply.code(401).send({ ok: false, error: 'badCredentials', message: 'Sign in' }); return null; }
  return { id: t };
};
registerTransfers(app, { q, who });
app.setNotFoundHandler((req, reply) => reply.code(404).send({ ok: false, error: 'notFound', message: 'not here' }));
await app.listen({ port, host: '127.0.0.1' });
console.log('harness on ' + port);
