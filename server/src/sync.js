/**
 * Devices, licences and the operation log.
 *
 * The rules that matter, and why they are where they are:
 *
 *  · **Seats are checked when a device registers, and nowhere else.** A till in
 *    the middle of a market day must never start failing because the owner
 *    added a phone at home.
 *  · **Pushing the same operation twice is free.** On the connections this is
 *    built for, a request can time out after the server committed it, and the
 *    device cannot know. Without idempotency its only options would be to lose
 *    the sale or to double it.
 *  · **Unknown operation kinds are stored, not rejected.** It is not this
 *    server's business to understand a sale in order to keep it safe, and an
 *    older server must never drop a newer app's work.
 */
import { q, tx } from './db.js';
import { readAccess, issueLicence } from './tokens.js';

const fail = (reply, status, error, message) => reply.code(status).send({ error, message });

/** Pulls the account off the bearer token. Everything below is scoped by it. */
async function whoami(req, reply) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) {
    fail(reply, 401, 'badCredentials', 'Sign in again.');
    return null;
  }
  try {
    const claims = await readAccess(header.slice(7));
    return { id: claims.sub, email: claims.email };
  } catch {
    fail(reply, 401, 'badCredentials', 'That session has expired. Sign in again.');
    return null;
  }
}

/**
 * The business a request may touch.
 *
 * Derived from the token, never from the body — a client that can name its own
 * tenant has no tenancy at all.
 */
async function businessFor(accountId, wanted) {
  const { rows } = await q(
    `select id, name from businesses
      where account_id = $1 and status = 'active'
        and ($2::uuid is null or id = $2::uuid)
      order by created_at limit 1`,
    [accountId, wanted || null],
  );
  return rows[0] || null;
}

export default async function syncRoutes(app) {
  /* ---------------------------------------------------------- devices */

  app.post('/v1/devices', async (req, reply) => {
    const me = await whoami(req, reply);
    if (!me) return;

    const lic = await q(
      `select seats, status from licences where account_id = $1
        order by started_at desc limit 1`,
      [me.id],
    );
    const seats = lic.rows[0]?.seats ?? 1;

    const used = await q(
      'select count(*)::int as n from devices where account_id = $1 and revoked_at is null',
      [me.id],
    );
    if (used.rows[0].n >= seats) {
      return fail(reply, 402, 'seatsFull',
        `Your licence covers ${seats} device${seats === 1 ? '' : 's'} and they are all in use. `
        + 'Remove one from your account, or add seats, then try again.');
    }

    const { rows } = await q(
      `insert into devices (account_id, name, kind, platform, refresh_hash, last_seen)
       values ($1, $2, $3, $4, '', now()) returning id`,
      [me.id, req.body?.name || 'a device', req.body?.kind || 'phone', req.body?.platform || null],
    );
    return { deviceId: rows[0].id, seats, used: used.rows[0].n + 1 };
  });

  app.get('/v1/devices', async (req, reply) => {
    const me = await whoami(req, reply);
    if (!me) return;
    const { rows } = await q(
      `select id, name, kind, platform, last_seen, created_at
         from devices where account_id = $1 and revoked_at is null
        order by created_at`,
      [me.id],
    );
    return { devices: rows };
  });

  app.delete('/v1/devices/:id', async (req, reply) => {
    const me = await whoami(req, reply);
    if (!me) return;
    await q(
      'update devices set revoked_at = now() where id = $1 and account_id = $2',
      [req.params.id, me.id],
    );
    return { revoked: true };
  });

  /* ---------------------------------------------------------- licence */

  app.post('/v1/licence/heartbeat', async (req, reply) => {
    const me = await whoami(req, reply);
    if (!me) return;

    const acct = await q('select id, email, name from accounts where id = $1', [me.id]);
    const lic = await q(
      `select plan, term, seats, status, expires_at from licences
        where account_id = $1 order by started_at desc limit 1`,
      [me.id],
    );
    if (!lic.rows[0]) return fail(reply, 404, 'server', 'No licence is on this account.');

    const biz = await q('select id from businesses where account_id = $1', [me.id]);
    const token = await issueLicence({
      account: acct.rows[0],
      licence: lic.rows[0],
      businesses: biz.rows.map((b) => b.id),
    });
    return { token, record: lic.rows[0] };
  });

  /* --------------------------------------------------------- business */

  app.get('/v1/businesses', async (req, reply) => {
    const me = await whoami(req, reply);
    if (!me) return;
    const { rows } = await q(
      'select id, name, tin, local_id, created_at from businesses where account_id = $1 order by created_at',
      [me.id],
    );
    return { businesses: rows };
  });

  app.post('/v1/businesses', async (req, reply) => {
    const me = await whoami(req, reply);
    if (!me) return;
    const { rows } = await q(
      `insert into businesses (account_id, name, tin, local_id)
       values ($1, $2, $3, $4) returning id, name, local_id`,
      [me.id, req.body?.name || 'My shop', req.body?.tin || null, req.body?.localId || null],
    );
    return rows[0];
  });

  /* ------------------------------------------------------------- sync */

  app.post('/v1/sync/push', async (req, reply) => {
    const me = await whoami(req, reply);
    if (!me) return;
    const ops = Array.isArray(req.body?.ops) ? req.body.ops : [];
    if (!ops.length) return { accepted: [], rejected: [], seq: 0 };

    const biz = await businessFor(me.id, ops[0].business);
    if (!biz) return fail(reply, 404, 'unknownBusiness', 'That business is not on this account.');

    const accepted = [];
    const rejected = [];

    await tx(async (c) => {
      for (const op of ops) {
        if (!op?.opId || !op?.kind || !op?.device) {
          rejected.push({ opId: op?.opId || null, reason: 'malformed' });
          continue;
        }
        try {
          // `on conflict do nothing` is what makes a retry free: the second
          // arrival of an operation is silently the same as the first.
          await c.query(
            `insert into ops (business_id, op_id, branch_local, device_id, user_local,
                              kind, client_ts, lamport, schema_v, payload)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             on conflict (business_id, op_id) do nothing`,
            [
              biz.id, op.opId, op.branch || null, op.device, op.user || null,
              op.kind, op.ts || new Date().toISOString(),
              op.lamport || 0, op.schema || 0, JSON.stringify(op.payload ?? {}),
            ],
          );
          accepted.push(op.opId);
        } catch (e) {
          req.log.warn({ err: e.message, kind: op.kind }, 'op rejected');
          rejected.push({ opId: op.opId, reason: e.code === '23503' ? 'unknownBranch' : 'malformed' });
        }
      }
    });

    const head = await q('select coalesce(max(seq),0)::bigint as seq from ops where business_id = $1', [biz.id]);
    return { accepted, rejected, seq: Number(head.rows[0].seq) };
  });

  app.get('/v1/sync/pull', async (req, reply) => {
    const me = await whoami(req, reply);
    if (!me) return;
    const biz = await businessFor(me.id, req.query?.business);
    if (!biz) return fail(reply, 404, 'unknownBusiness', 'That business is not on this account.');

    const since = Number(req.query?.since || 0);
    const limit = Math.min(Number(req.query?.limit || 500), 1000);

    const { rows } = await q(
      `select seq, op_id, branch_local, device_id, user_local, kind,
              client_ts, lamport, schema_v, payload, received_at
         from ops
        where business_id = $1 and seq > $2
        order by seq limit $3`,
      [biz.id, since, limit + 1],
    );

    const more = rows.length > limit;
    const page = more ? rows.slice(0, limit) : rows;

    return {
      ops: page.map((r) => ({
        seq: Number(r.seq),
        opId: r.op_id,
        business: biz.id,
        branch: r.branch_local,
        device: r.device_id,
        user: r.user_local,
        kind: r.kind,
        ts: r.client_ts,
        lamport: Number(r.lamport),
        schema: r.schema_v,
        payload: r.payload,
        receivedAt: r.received_at,
      })),
      seq: page.length ? Number(page[page.length - 1].seq) : since,
      more,
    };
  });

  app.get('/v1/sync/state', async (req, reply) => {
    const me = await whoami(req, reply);
    if (!me) return;
    const biz = await businessFor(me.id, req.query?.business);
    if (!biz) return fail(reply, 404, 'unknownBusiness', 'That business is not on this account.');
    const { rows } = await q(
      `select coalesce(max(seq),0)::bigint as seq, count(*)::int as ops,
              max(received_at) as last
         from ops where business_id = $1`,
      [biz.id],
    );
    return { seq: Number(rows[0].seq), ops: rows[0].ops, lastPush: rows[0].last, lastPull: null };
  });

  /**
   * A block of document numbers this device owns outright.
   *
   * Handed out under a transaction so two tills asking at the same moment
   * cannot be given the same range. Gaps are expected and are not an error — a
   * device that leases a hundred and sells eleven leaves a hole.
   */
  app.post('/v1/sync/numbers/lease', async (req, reply) => {
    const me = await whoami(req, reply);
    if (!me) return;
    const biz = await businessFor(me.id, req.body?.business);
    if (!biz) return fail(reply, 404, 'unknownBusiness', 'That business is not on this account.');

    const branch = String(req.body?.branch || '');
    const kind = String(req.body?.kind || 'sale');
    const size = Math.min(Math.max(Number(req.body?.size || 100), 1), 1000);

    const block = await tx(async (c) => {
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [biz.id + branch + kind]);
      const { rows } = await c.query(
        `select coalesce(max(hi), 0)::bigint as top from number_blocks
          where business_id = $1 and branch_local = $2 and kind = $3`,
        [biz.id, branch, kind],
      );
      const lo = Number(rows[0].top) + 1;
      const hi = lo + size - 1;
      await c.query(
        `insert into number_blocks (business_id, branch_local, kind, lo, hi, device_id)
         values ($1,$2,$3,$4,$5,$6)`,
        [biz.id, branch, kind, lo, hi, req.body?.device],
      );
      return { lo, hi };
    });

    return { branch, kind, ...block };
  });
}
