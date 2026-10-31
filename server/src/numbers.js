/**
 * numbers.js — one running number per voucher series, handed out by the server.
 *
 * Twelve tills saving at the same moment each ask here for the next number.
 * The series row is locked for the instant it takes to add one, so they get
 * 3187, 3188, 3189… in the order they arrived: never the same number twice and
 * none skipped. A number is asked for at the moment a voucher is saved; a till
 * that is offline saves with a temporary number and asks when it is back, in
 * the order its vouchers were made.
 *
 *   POST /v1/numbers/next    { business, series, ref, floor?, device? } → { n }
 *        `ref` is the voucher's own id: asking again for the same voucher (a
 *        retry after a dropped connection) returns the number it already has.
 *        `floor` is the highest number the device already holds in that series,
 *        so a series that began before this existed carries on from there.
 *   POST /v1/numbers/cancel  { business, ref } — a number taken for a voucher
 *        that was then not saved is kept, marked cancelled, so the run of
 *        numbers stays complete and every gap has a record.
 */
import { q, tx } from './db.js';
import { whoami } from './sync.js';

const fail = (reply, status, error, message) => reply.code(status).send({ error, message });
/* The kinds the older leased blocks were taken under, by series prefix. */
const LEASE_KIND = { INV: 'sale', PUR: 'purchase', EST: 'estimate', DC: 'challan', CN: 'creditNote', PO: 'po' };
const cleanSeries =(s) => String(s || '').toUpperCase().replace(/[^A-Z0-9/_-]/g, '').slice(0, 24);

async function memberBusiness(accountId, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return null;
  const { rows } = await q(
    `select b.id from businesses b
       left join business_members bm on bm.business_id = b.id and bm.account_id = $1
      where b.id = $2::uuid and b.status = 'active' and (b.account_id = $1 or bm.account_id is not null)`,
    [accountId, id]);
  return rows[0]?.id || null;
}

export default async function numberRoutes(app) {
  await q(`create table if not exists number_series (
             business_id uuid not null, series text not null, next bigint not null default 1,
             primary key (business_id, series))`);
  await q(`create table if not exists number_issued (
             business_id uuid not null, series text not null, n bigint not null,
             ref text not null, device text, issued_at timestamptz not null default now(),
             status text not null default 'issued',
             primary key (business_id, series, n), unique (business_id, ref))`);

  app.post('/v1/numbers/next', async (req, reply) => {
    const me = await whoami(req, reply);
    if (!me) return;
    const biz = await memberBusiness(me.id, req.body?.business);
    if (!biz) return fail(reply, 404, 'unknownBusiness', 'That business is not on this account.');
    const series = cleanSeries(req.body?.series);
    const ref = String(req.body?.ref || '').slice(0, 80);
    if (!series || !ref) return fail(reply, 400, 'malformed', 'Say which series and which voucher.');
    const floor = Math.max(0, Math.floor(Number(req.body?.floor) || 0));

    const n = await tx(async (c) => {
      const had = await c.query('select n from number_issued where business_id = $1 and ref = $2', [biz, ref]);
      if (had.rows[0]) return Number(had.rows[0].n);
      await c.query('insert into number_series (business_id, series, next) values ($1, $2, 1) on conflict do nothing', [biz, series]);
      const row = await c.query('select next from number_series where business_id = $1 and series = $2 for update', [biz, series]);
      // never below a number a device already holds: a series older than this carries on
      let next = Math.max(Number(row.rows[0].next), floor + 1);
      // never inside a block leased to a till before numbers came from here (sync.js numbers/lease)
      const kind = LEASE_KIND[series.split('/')[0]];
      if (kind) {
        for (let guard = 0; guard < 50; guard++) {
          const hit = await c.query('select hi from number_blocks where business_id = $1 and kind = $2 and lo <= $3 and hi >= $3 order by hi desc limit 1', [biz, kind, next]);
          if (!hit.rows[0]) break;
          next = Number(hit.rows[0].hi) + 1;
        }
      }
      await c.query('insert into number_issued (business_id, series, n, ref, device) values ($1, $2, $3, $4, $5)',
        [biz, series, next, ref, String(req.body?.device || '').slice(0, 80) || null]);
      await c.query('update number_series set next = $3 where business_id = $1 and series = $2', [biz, series, next + 1]);
      return next;
    });
    return { series, n };
  });

  app.post('/v1/numbers/cancel', async (req, reply) => {
    const me = await whoami(req, reply);
    if (!me) return;
    const biz = await memberBusiness(me.id, req.body?.business);
    if (!biz) return fail(reply, 404, 'unknownBusiness', 'That business is not on this account.');
    await q(`update number_issued set status = 'cancelled' where business_id = $1 and ref = $2`, [biz, String(req.body?.ref || '')]);
    return { ok: true };
  });
}
