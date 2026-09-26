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

/**
 * What a licence really is right now, as opposed to what its row was last set to.
 *
 * A blocked account is blocked whatever its licence says; a licence past its
 * expiry is expired even if nobody has touched the row since. Exported so the
 * developer console reports exactly what the phones are being told.
 */
export function effectiveStatus(account, licence, now = new Date()) {
  if (!licence) return 'none';
  if (account && account.status === 'blocked') return 'blocked';
  if (licence.status === 'blocked' || licence.status === 'revoked') return licence.status;
  if (licence.expires_at && new Date(licence.expires_at) < now) return 'expired';
  return licence.status || 'active';
}

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
    `select b.id, b.name,
            case when b.account_id = $1 then 'owner'
                 else coalesce(bm.role, 'staff') end as role
       from businesses b
       left join business_members bm on bm.business_id = b.id and bm.account_id = $1
      where b.status = 'active'
        and (b.account_id = $1 or bm.account_id is not null)
        and ($2::uuid is null or b.id = $2::uuid)
      order by b.created_at limit 1`,
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

    const registration = await tx(async (db) => {
      // Lock the account's active seats while choosing the one to replace. A
      // new phone should never create a short-lived over-seat race.
      const active = await db.query(
        `select id, name from devices
           where account_id = $1 and revoked_at is null
          order by created_at asc, id asc for update`,
        [me.id],
      );
      let replacedDevice = null;
      if (active.rows.length >= seats) {
        replacedDevice = active.rows[0];
        await db.query(
          'update devices set revoked_at = now() where id = $1 and account_id = $2',
          [replacedDevice.id, me.id],
        );
      }

      const inserted = await db.query(
        `insert into devices (account_id, name, kind, platform, refresh_hash, last_seen)
         values ($1, $2, $3, $4, '', now()) returning id`,
        [me.id, req.body?.name || 'a device', req.body?.kind || 'phone', req.body?.platform || null],
      );
      return { deviceId: inserted.rows[0].id, used: active.rows.length || 0, replacedDevice };
    });
    return { ...registration, seats };
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

    const acct = await q('select id, email, name, status from accounts where id = $1', [me.id]);
    const lic = await q(
      `select plan, term, seats, status, expires_at from licences
        where account_id = $1 order by started_at desc limit 1`,
      [me.id],
    );
    if (!lic.rows[0]) return fail(reply, 404, 'server', 'No licence is on this account.');

    const biz = await q(`select b.id from businesses b
      where b.account_id = $1 or exists (select 1 from business_members bm where bm.business_id = b.id and bm.account_id = $1)`, [me.id]);
    const token = await issueLicence({
      account: acct.rows[0],
      licence: { ...lic.rows[0], status: effectiveStatus(acct.rows[0], lic.rows[0]) },
      businesses: biz.rows.map((b) => b.id),
    });
    return { token, record: { ...lic.rows[0], status: effectiveStatus(acct.rows[0], lic.rows[0]) } };
  });

  /* --------------------------------------------------------- business */

  app.get('/v1/businesses', async (req, reply) => {
    const me = await whoami(req, reply);
    if (!me) return;
    const { rows } = await q(
      `select b.id, b.name, b.tin, b.local_id, b.created_at, b.status,
              case when b.account_id = $1 then 'owner'
                   else coalesce(bm.role, 'staff') end as role,
              s.updated_at as snapshot_at, s.bytes as snapshot_bytes
         from businesses b
         left join business_members bm on bm.business_id = b.id and bm.account_id = $1
         left join business_snapshots s on s.business_id = b.id
        where (b.account_id = $1 or bm.account_id is not null)
          and ($2::boolean = true or b.status = 'active')
        order by b.created_at`,
      [me.id, String(req.query?.all || '') === 'true'],
    );
    return { businesses: rows.map((b) => ({ ...b, active: b.status === 'active', role: b.role || 'staff' })) };
  });

  /* ------------------------------------------------------- snapshots */
  /*
   * A whole copy of a business's books, so a phone that has never held them
   * can open them: the owner signs in, picks a shop from the list, and gets
   * that shop — not an empty book, and not whichever shop was on the phone.
   */
  app.put('/v1/businesses/:id/snapshot', { bodyLimit: 48 * 1024 * 1024 }, async (req, reply) => {
    const me = await whoami(req, reply);
    if (!me) return;
    const biz = await businessFor(me.id, req.params.id);
    if (!biz) return fail(reply, 404, 'unknownBusiness', 'That business is not on this account.');
    const data = req.body?.data;
    if (!data || typeof data !== 'object') return fail(reply, 400, 'malformed', 'No books were sent.');
    const version = Number(req.body?.version || 0);
    const current = await q(
      'select version from business_snapshots where business_id = $1',
      [biz.id],
    );
    if (current.rows[0] && version < current.rows[0].version) {
      return fail(reply, 409, 'staleSnapshot', 'This device has an older snapshot than the server. Refresh first.');
    }
    const text = JSON.stringify(data);
    const nextVersion = (current.rows[0]?.version || 0) + 1;
    await q(
      `insert into business_snapshots (business_id, data, bytes, device_id, version, updated_at)
       values ($1, $2::jsonb, $3, $4, $5, now())
       on conflict (business_id) do update
         set data = excluded.data, bytes = excluded.bytes,
             device_id = excluded.device_id, version = excluded.version,
             updated_at = now()`,
      [biz.id, text, Buffer.byteLength(text), req.body?.device || null, nextVersion],
    );
    // the name on the list follows the name on the books
    if (data.firm?.name && data.firm.name !== biz.name) {
      await q('update businesses set name = $2 where id = $1', [biz.id, String(data.firm.name).slice(0, 200)]);
    }
    return { ok: true, bytes: Buffer.byteLength(text), version: nextVersion };
  });

  app.get('/v1/businesses/:id/snapshot', async (req, reply) => {
    const me = await whoami(req, reply);
    if (!me) return;
    const biz = await businessFor(me.id, req.params.id);
    if (!biz) return fail(reply, 404, 'unknownBusiness', 'That business is not on this account.');
    const { rows } = await q(
      'select data, updated_at, version from business_snapshots where business_id = $1',
      [biz.id],
    );
    if (!rows[0]) {
      return fail(reply, 404, 'noSnapshot',
        'This business has no copy on the server yet. Open it on the phone that holds it and sync once.');
    }
    return { data: rows[0].data, updatedAt: rows[0].updated_at, version: rows[0].version };
  });

  app.post('/v1/businesses', async (req, reply) => {
    const me = await whoami(req, reply);
    if (!me) return;
    // The same books asking twice get the same business back: a business is
    // identified by the id the books carry, never by its name.
    if (req.body?.localId) {
      const had = await q(
        'select id, name, local_id from businesses where account_id = $1 and local_id = $2 limit 1',
        [me.id, String(req.body.localId)],
      );
      if (had.rows[0]) return had.rows[0];
    }
    const { rows } = await q(
      `insert into businesses (account_id, name, tin, local_id)
       values ($1, $2, $3, $4) returning id, name, local_id`,
      [me.id, req.body?.name || 'My shop', req.body?.tin || null, req.body?.localId || null],
    );
    return rows[0];
  });

  app.patch('/v1/businesses/:id', async (req, reply) => {
    const me = await whoami(req, reply);
    if (!me) return;
    const biz = await businessFor(me.id, req.params.id);
    if (!biz) return fail(reply, 404, 'unknownBusiness', 'That business is not on this account.');
    if (typeof req.body?.active !== 'boolean') return fail(reply, 400, 'malformed', 'Choose whether the business is active.');
    await q('update businesses set status = $2 where id = $1', [biz.id, req.body.active ? 'active' : 'inactive']);
    return { active: req.body.active };
  });

  app.get('/v1/businesses/:id/members', async (req, reply) => {
    const me = await whoami(req, reply);
    if (!me) return;
    const owner = await q('select id from businesses where id = $1 and account_id = $2', [req.params.id, me.id]);
    if (!owner.rows[0]) return fail(reply, 403, 'forbidden', 'Only the business owner can manage access.');
    const { rows } = await q(
      `select bm.account_id as id, a.email, a.name, bm.role, bm.created_at
         from business_members bm join accounts a on a.id = bm.account_id
        where bm.business_id = $1 order by bm.created_at`, [req.params.id],
    );
    return { members: rows };
  });

  app.post('/v1/businesses/:id/members', async (req, reply) => {
    const me = await whoami(req, reply);
    if (!me) return;
    const owner = await q('select id from businesses where id = $1 and account_id = $2', [req.params.id, me.id]);
    if (!owner.rows[0]) return fail(reply, 403, 'forbidden', 'Only the business owner can manage access.');
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email.includes('@')) return fail(reply, 400, 'malformed', 'Enter a valid account email.');
    const account = await q('select id, email, name from accounts where email = $1', [email]);
    if (!account.rows[0]) return fail(reply, 404, 'unknownAccount', 'That person must create an account before they can be assigned.');
    await q(
      `insert into business_members (business_id, account_id, role) values ($1,$2,$3)
       on conflict (business_id, account_id) do update set role = excluded.role`,
      [req.params.id, account.rows[0].id, String(req.body?.role || 'staff').slice(0, 40)],
    );
    return { member: { ...account.rows[0], role: String(req.body?.role || 'staff') } };
  });

  app.delete('/v1/businesses/:id/members/:accountId', async (req, reply) => {
    const me = await whoami(req, reply);
    if (!me) return;
    const owner = await q('select id from businesses where id = $1 and account_id = $2', [req.params.id, me.id]);
    if (!owner.rows[0]) return fail(reply, 403, 'forbidden', 'Only the business owner can manage access.');
    await q('delete from business_members where business_id = $1 and account_id = $2', [req.params.id, req.params.accountId]);
    return { removed: true };
  });

  /* ------------------------------------------------------------- sync */

  app.post('/v1/sync/push', async (req, reply) => {
    const me = await whoami(req, reply);
    if (!me) return;
    const ops = Array.isArray(req.body?.ops) ? req.body.ops : [];
    if (!ops.length) return { accepted: [], rejected: [], seq: 0 };

    const biz = await businessFor(me.id, ops[0].business);
    if (!biz) return fail(reply, 404, 'unknownBusiness', 'That business is not on this account.');

    // a blocked account keeps its books on the phone but adds nothing here
    const st = await q('select status from accounts where id = $1', [me.id]);
    if (st.rows[0]?.status === 'blocked') {
      return fail(reply, 403, 'server', 'This account has been blocked. Contact support.');
    }

    const accepted = [];
    const rejected = [];

    await tx(async (c) => {
      for (const op of ops) {
        if (!op?.opId || !op?.kind || !op?.device) {
          rejected.push({ opId: op?.opId || null, reason: 'malformed', note: 'Missing opId, kind, or device.' });
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
          const reason = e.code === '23503' ? 'unknownBranch' : 'malformed';
          rejected.push({ opId: op.opId, reason, note: e.message || 'The server rejected this operation.' });
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
