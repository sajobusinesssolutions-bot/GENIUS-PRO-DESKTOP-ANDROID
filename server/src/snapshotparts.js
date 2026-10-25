/**
 * A big book sent to the account server in parts, so no one request is large:
 * a 45 MB book (a Tally import) in one PUT timed out and froze the Windows
 * till. Each part is a slice of the gzipped copy, in base64; the commit puts
 * them together, unzips, and keeps the copy exactly as PUT /snapshot does.
 *
 *   POST /v1/businesses/:id/snapshot/parts   { upload, index, total, b64 }
 *   POST /v1/businesses/:id/snapshot/commit  { upload, total, version, device, cursor }
 *
 * Deploying: this file and one line in index.js
 * (`await app.register(snapshotPartRoutes)`). The table makes itself.
 * Only the business's owner sends a whole book.
 */
import zlib from 'node:zlib';
import { q } from './db.js';
import { whoami } from './sync.js';

const fail = (reply, status, error, message) => reply.code(status).send({ error, message });

async function ownBusiness(accountId, id) {
  const { rows } = await q(
    `select id, name from businesses where id = $2::uuid and account_id = $1 and status = 'active' limit 1`,
    [accountId, id],
  );
  return rows[0] || null;
}

export default async function snapshotPartRoutes(app) {
  await q(`create table if not exists snapshot_parts (
    business_id uuid not null, upload_id text not null, idx int not null,
    chunk bytea not null, created_at timestamptz not null default now(),
    primary key (business_id, upload_id, idx))`);

  app.post('/v1/businesses/:id/snapshot/parts', { bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    const me = await whoami(req, reply);
    if (!me) return;
    const biz = await ownBusiness(me.id, req.params.id);
    if (!biz) return fail(reply, 404, 'unknownBusiness', 'That business is not on this account.');
    const upload = String(req.body?.upload || '').slice(0, 80), idx = Number(req.body?.index);
    if (!upload || !Number.isInteger(idx) || idx < 0 || typeof req.body?.b64 !== 'string') return fail(reply, 400, 'malformed', 'A part was missing.');
    if (idx === 0) await q("delete from snapshot_parts where created_at < now() - interval '1 day'");
    await q(`insert into snapshot_parts (business_id, upload_id, idx, chunk) values ($1, $2, $3, $4)
             on conflict (business_id, upload_id, idx) do update set chunk = excluded.chunk`,
      [biz.id, upload, idx, Buffer.from(req.body.b64, 'base64')]);
    return { ok: true, index: idx };
  });

  app.post('/v1/businesses/:id/snapshot/commit', async (req, reply) => {
    const me = await whoami(req, reply);
    if (!me) return;
    const biz = await ownBusiness(me.id, req.params.id);
    if (!biz) return fail(reply, 404, 'unknownBusiness', 'That business is not on this account.');
    const upload = String(req.body?.upload || '').slice(0, 80), total = Number(req.body?.total);
    const parts = await q('select idx, chunk from snapshot_parts where business_id = $1 and upload_id = $2 order by idx', [biz.id, upload]);
    if (!parts.rows.length || parts.rows.length !== total || parts.rows.some((r, i) => r.idx !== i)) {
      return fail(reply, 400, 'partsMissing', `Only ${parts.rows.length} of ${total} parts arrived — send the copy again.`);
    }
    let text;
    try { text = zlib.gunzipSync(Buffer.concat(parts.rows.map((r) => r.chunk))).toString('utf8'); JSON.parse(text); }
    catch { return fail(reply, 400, 'malformed', 'The parts did not make a whole copy — send it again.'); }
    await q('delete from snapshot_parts where business_id = $1 and upload_id = $2', [biz.id, upload]);

    /* from here, as PUT /snapshot: refuse a copy older than the server's unless this device has every change */
    const version = Number(req.body?.version || 0);
    const current = await q('select version from business_snapshots where business_id = $1', [biz.id]);
    if (current.rows[0] && version < current.rows[0].version) {
      const head = await q('select coalesce(max(seq),0)::bigint as seq from ops where business_id = $1', [biz.id]);
      const cursor = Number(req.body?.cursor);
      if (!Number.isFinite(cursor) || cursor < Number(head.rows[0].seq)) {
        return reply.code(409).send({ error: 'staleSnapshot', message: 'This device has an older snapshot than the server. Refresh first.', version: current.rows[0].version });
      }
    }
    const nextVersion = (current.rows[0]?.version || 0) + 1;
    const bytes = Buffer.byteLength(text);
    await q(
      `insert into business_snapshots (business_id, data, bytes, device_id, version, updated_at)
       values ($1, $2::jsonb, $3, $4, $5, now())
       on conflict (business_id) do update
         set data = excluded.data, bytes = excluded.bytes, device_id = excluded.device_id, version = excluded.version, updated_at = now()`,
      [biz.id, text, bytes, req.body?.device || null, nextVersion],
    );
    const name = (() => { try { return JSON.parse(text).firm?.name; } catch { return null; } })();
    if (name && name !== biz.name) await q('update businesses set name = $2 where id = $1', [biz.id, String(name).slice(0, 200)]);
    return { ok: true, bytes, version: nextVersion };
  });
}
