/**
 * How a business's saved copy of its books is kept and served.
 *
 * The copy is one JSON document; a busy pharmacy's runs to 18 MB. Two things
 * made that expensive:
 *
 *   · Small facts were read out of the big document. Every push and every
 *     pull (each device, every five seconds) asked for the book's minimum
 *     app version as data->'firm'->>'minAppVersion', and the business list
 *     asked for sync on/off and the business type the same way. PostgreSQL
 *     has to unpack the whole stored document to answer, so one version
 *     number cost reading 18 MB — dozens of times a minute per business.
 *     They are now columns of their own, written when the copy is saved.
 *
 *   · Downloading it sent 18 MB of JSON, rebuilt from jsonb on each request.
 *     The copy is now also kept gzipped, ready to send as it is (about a
 *     tenth of the size): a phone or computer that accepts gzip — all of
 *     them do — gets those bytes straight from the table, with no JSON work
 *     on the server at all.
 *
 * The jsonb column stays as it was, so backups and anything that reads it
 * are unchanged.
 */
import zlib from 'node:zlib';
import { q } from './db.js';

let ready = null;
/** The columns, and the small facts filled in once for copies saved before them. */
export function migrateSnapshots() {
  if (ready) return ready;
  ready = (async () => {
    await q('alter table business_snapshots add column if not exists min_app text');
    await q('alter table business_snapshots add column if not exists sync_on boolean');
    await q('alter table business_snapshots add column if not exists business_type text');
    await q('alter table business_snapshots add column if not exists gz bytea');
    await q('alter table business_snapshots add column if not exists meta_v int not null default 0');
    // once: copies saved before the columns existed
    await q(`update business_snapshots
                set min_app = data->'firm'->>'minAppVersion',
                    sync_on = (data->'sync'->>'on') = 'true',
                    business_type = data->'firm'->>'businessType',
                    meta_v = 1
              where meta_v = 0`);
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

const meta = (data) => ({
  minApp: data?.firm?.minAppVersion ? String(data.firm.minAppVersion) : null,
  syncOn: data?.sync ? data.sync.on === true : null,
  type: data?.firm?.businessType ? String(data.firm.businessType) : null,
});

/** The answer GET /snapshot gives, gzipped, built from the text as it came (no second stringify). */
function envelope(text, updatedAt, version) {
  return zlib.gzipSync(Buffer.from('{"data":' + text + ',"updatedAt":' + JSON.stringify(updatedAt) + ',"version":' + Number(version) + '}', 'utf8'), { level: 6 });
}

/**
 * Saves a copy: the JSON as text, its small facts, and the gzipped answer.
 * `data` is the parsed object when the caller has it (for the facts), else it is parsed here.
 */
export async function writeSnapshot(businessId, text, data, deviceId, version) {
  await migrateSnapshots();
  const m = meta(data || JSON.parse(text));
  const updatedAt = new Date().toISOString();
  const gz = envelope(text, updatedAt, version);
  await q(
    `insert into business_snapshots (business_id, data, bytes, device_id, version, updated_at, min_app, sync_on, business_type, gz, meta_v)
     values ($1, $2::jsonb, $3, $4, $5, $6, $7, $8, $9, $10, 1)
     on conflict (business_id) do update
       set data = excluded.data, bytes = excluded.bytes, device_id = excluded.device_id, version = excluded.version,
           updated_at = excluded.updated_at, min_app = excluded.min_app, sync_on = excluded.sync_on,
           business_type = excluded.business_type, gz = excluded.gz, meta_v = 1`,
    [businessId, text, Buffer.byteLength(text), deviceId || null, version, updatedAt, m.minApp, m.syncOn, m.type, gz],
  );
  return { bytes: Buffer.byteLength(text), gzBytes: gz.length };
}

/** The lowest app version these books may be opened with, read from its own column. */
export async function minAppOf(businessId) {
  await migrateSnapshots();
  const { rows } = await q('select min_app from business_snapshots where business_id = $1', [businessId]);
  return rows[0]?.min_app || null;
}

/**
 * Sends the copy. Gzipped bytes as they are kept when the caller accepts gzip;
 * a copy saved before this was kept is gzipped once now and kept that way.
 * Returns false when there is no copy.
 */
export async function sendSnapshot(req, reply, businessId) {
  await migrateSnapshots();
  let { rows } = await q('select gz, updated_at, version from business_snapshots where business_id = $1', [businessId]);
  if (!rows[0]) return false;
  let gz = rows[0].gz;
  if (!gz) {
    const old = await q('select data::text as text, updated_at, version from business_snapshots where business_id = $1', [businessId]);
    const r = old.rows[0];
    gz = envelope(r.text, new Date(r.updated_at).toISOString(), r.version);
    await q('update business_snapshots set gz = $2 where business_id = $1 and version = $3', [businessId, gz, r.version]);
  }
  reply.header('content-type', 'application/json; charset=utf-8');
  reply.header('cache-control', 'no-store');
  if (/\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''))) {
    reply.header('content-encoding', 'gzip');
    reply.header('vary', 'accept-encoding');
    reply.send(gz);
  } else {
    reply.send(zlib.gunzipSync(gz));
  }
  return true;
}
