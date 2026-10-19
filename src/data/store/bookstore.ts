/**
 * The book in SQLite: one row per record, so a save writes what changed.
 *
 * Before this, the whole book was one JSON string under `genius.pos.v1` in
 * AsyncStorage, rewritten on every save. Android reads a value back only up to
 * about 2 MB, and AsyncStorage holds 6 MB in all by default. At ~2.3 KB per
 * sale a busy shop crossed both within days (docs/STORAGE_SQLITE_PLAN.md).
 *
 * Shape on disk:
 *   docs(coll, id, ord, day, party, item, doc)  one row per record of every list
 *                                               of records (sales, journal, products …)
 *   meta(key, doc)                              every other top-level value
 *                                               (settings, counters, session, units …)
 *   store(key, val)                             format version, which lists exist
 *
 * The book in memory is exactly the `DB` it always was. What is written per
 * save comes from three places:
 *   1. what the commit tracker saw change (store/track.ts),
 *   2. records this store has never written (new objects: appends, restores),
 *   3. a rotating re-check of older records against a fingerprint of what was
 *      last written, which catches an edit the tracker could not see.
 * Small lists (products, parties, settings-type values) are simply compared in
 * full on every save; they are cheap.
 */
import type { Driver } from './driver';
import { openDriver } from './driver';
import { Changes, emptyChanges, mergeChanges } from './track';

export const FORMAT = 1;

/** Lists that grow with trade: tracked, not compared in full on every save. */
export const TRACKED = new Set([
  'sales', 'purchases', 'payments', 'deletedPayments', 'entries', 'journal', 'movements', 'shifts',
  'warranties', 'claims', 'estimates', 'challans', 'creditNotes', 'stockTakes', 'purchaseOrders',
  'productionRuns', 'recurringInvoices', 'auditLog', 'queue', 'plans', 'instalmentPlans', 'revisions',
  'bankStatementLines', 'bankReconciliations', 'kitchenOrders', 'tickets', 'approvals',
]);
/** Lists of records small enough to compare in full every save. */
export const SMALL = new Set([
  'firms', 'roles', 'warehouses', 'products', 'parties', 'users', 'accounts', 'printers', 'templates',
  'coa', 'offers', 'priceLists', 'modifierGroups', 'menuGroups', 'menus', 'businessAccess',
]);
export const COLLS: ReadonlySet<string> = new Set([...TRACKED, ...SMALL]);

/** How many older records are re-checked per save (the safety net). */
const SWEEP_PER_SAVE = 150;

/* ── what this process knows is on disk ──────────────────────────────── */
let drv: Driver | null = null;
let opening: Promise<Driver> | null = null;
/* Which record objects are on disk as they stand (as far as tracking knows),
   and, for the small lists only, the exact JSON last written. Large lists keep
   no copy in memory: the re-check reads what SQLite holds instead. Hashing
   every record cost seconds at load on a busy book, so there is no hash. */
let known = new WeakSet<object>();
let smallJson = new WeakMap<object, string>();
let metaJson = new Map<string, string>();        // meta key -> JSON last written
let arrays = new Map<string, unknown[]>();       // coll -> the array last saved
let lengths = new Map<string, number>();
let ordNext = new Map<string, number>();
let docColls = new Set<string>();                // colls currently stored as rows
let sweepAt = new Map<string, number>();
let pending: Changes = emptyChanges();
/** Records a re-check had to rescue: the tracker missed them. For tests and diagnostics. */
export const stats = { rescued: 0, lastWrite: { rows: 0, deletes: 0, metas: 0, ms: 0 }, lastWhole: [] as string[] };

function resetMemory() {
  known = new WeakSet(); smallJson = new WeakMap(); metaJson = new Map(); domain = new Map(); arrays = new Map(); lengths = new Map();
  ordNext = new Map(); docColls = new Set(); sweepAt = new Map(); pending = emptyChanges();
}

/** Tests: drop the open handle so the next call opens a fresh engine. */
export async function _resetForTests(): Promise<void> {
  if (drv && drv.close) await drv.close().catch(() => undefined);
  drv = null; opening = null; resetMemory(); stats.rescued = 0;
}

const DAY = /^\d{4}-\d{2}-\d{2}/;
function dayOf(r: Record<string, unknown>): string | null {
  for (const k of ['ts', 'date', 'at', 'when', 'createdAt', 'openedAt', 'start']) {
    const v = r[k];
    if (typeof v === 'string' && DAY.test(v)) return v.slice(0, 10);
  }
  return null;
}
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

async function db(): Promise<Driver> {
  if (drv) return drv;
  if (!opening) {
    opening = (async () => {
      const d = await openDriver();
      await d.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        CREATE TABLE IF NOT EXISTS docs (
          coll TEXT NOT NULL, id TEXT NOT NULL, ord INTEGER NOT NULL,
          day TEXT, party TEXT, item TEXT, doc TEXT NOT NULL,
          PRIMARY KEY (coll, id));
        CREATE INDEX IF NOT EXISTS docs_ord   ON docs(coll, ord);
        CREATE INDEX IF NOT EXISTS docs_day   ON docs(coll, day);
        CREATE INDEX IF NOT EXISTS docs_party ON docs(coll, party, day);
        CREATE INDEX IF NOT EXISTS docs_item  ON docs(coll, item, day);
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, doc TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS store (key TEXT PRIMARY KEY, val TEXT NOT NULL);`);
      drv = d;
      return d;
    })();
  }
  try { return await opening; } catch (e) { opening = null; throw e; }
}

/** Whether SQLite can be opened on this device at all (false: carry on with the old storage). */
export async function sqliteAvailable(): Promise<boolean> {
  try { await db(); return true; } catch { return false; }
}

/** Changes seen by the commit tracker since the last save. */
export function noteChanges(ch: Changes): void { mergeChanges(pending, ch); }

/** Whether this phone already keeps its book in SQLite. */
export async function hasBook(): Promise<boolean> {
  const d = await db();
  const r = await d.all<{ val: string }>("SELECT val FROM store WHERE key = 'format'");
  return r.length > 0;
}

/** Reads the whole book. `null` when SQLite holds no book yet. */
/* ── Phase 2: holding only recent trade in memory ──────────────────────
   With a window, only these lists are cut to recent rows. Everything else,
   and every open document of any age, is always loaded. A book loaded with a
   window carries `__window` so that nothing can mistake it for the whole
   book: backups and cloud snapshots refuse it (see storage.ts). */
export const WINDOWED: ReadonlySet<string> = new Set(['sales', 'purchases', 'payments', 'entries', 'journal', 'movements']);
/** Rows of a windowed list that are loaded whatever their age: still open. */
/* open, and deleted-but-not-purged (the Deleted screen restores them), stay in memory however old */
const OPEN_SQL: Record<string, string> = {
  sales: "((COALESCE(json_extract(doc,'$.due'),0) > 0.005 OR COALESCE(json_extract(doc,'$.status'),'') IN ('held','draft','open','pending','parked')) OR (json_extract(doc,'$.deletedAt') IS NOT NULL AND json_extract(doc,'$.purgedAt') IS NULL))",
  purchases: "((COALESCE(json_extract(doc,'$.due'),0) > 0.005 OR COALESCE(json_extract(doc,'$.status'),'') IN ('draft','open','pending')) OR (json_extract(doc,'$.deletedAt') IS NOT NULL AND json_extract(doc,'$.purgedAt') IS NULL))",
};
/** The id prefix of the journal entries that stand in for everything before the window. */
export const CARRY_PREFIX = '__carry_';
/** ids of rows this session loaded or wrote, per list. A save never deletes a row outside it. */
let domain = new Map<string, Set<string>>();
const inDomain = (coll: string, id: string) => { const s = domain.get(coll); return !!s && s.has(id); };
const addDomain = (coll: string, id: string) => { let s = domain.get(coll); if (!s) { s = new Set(); domain.set(coll, s); } s.add(id); };

export interface LoadOptions {
  /** yyyy-mm-dd: rows of the windowed lists older than this stay on disk (open ones still load). */
  sinceDay?: string;
  /** Build a separate book for a report, leaving the live book's caches alone. */
  detached?: boolean;
}

/** Reads the book. `null` when SQLite holds no book yet. */
export async function loadBook(opts: LoadOptions = {}): Promise<Record<string, unknown> | null> {
  const d = await db();
  if (!(await hasBook())) return null;
  const live = !opts.detached;
  if (live) resetMemory();
  const listed0 = new Set<string>();
  const book: Record<string, unknown> = {};
  for (const m of await d.all<{ key: string; doc: string }>('SELECT key, doc FROM meta')) {
    book[m.key] = JSON.parse(m.doc);
    if (live) metaJson.set(m.key, m.doc);
  }
  const listed = await d.all<{ val: string }>("SELECT val FROM store WHERE key = 'colls'");
  const present: string[] = listed.length ? JSON.parse(listed[0].val) : [];
  for (const c of present) { book[c] = []; listed0.add(c); }
  const since = opts.sinceDay && /^\d{4}-\d{2}-\d{2}$/.test(opts.sinceDay) ? opts.sinceDay : null;
  const winList = [...WINDOWED].map((c) => "'" + c + "'").join(',');
  const rows = since
    ? await d.all<{ coll: string; id: string; doc: string; ord: number }>(
      `SELECT coll, id, doc, ord FROM docs
        WHERE coll NOT IN (${winList}) OR day IS NULL OR day >= ?
           ${Object.entries(OPEN_SQL).map(([c, w]) => "OR (coll = '" + c + "' AND " + w + ")").join(' ')}
        ORDER BY coll, ord`, [since])
    : await d.all<{ coll: string; id: string; doc: string; ord: number }>('SELECT coll, id, doc, ord FROM docs ORDER BY coll, ord');
  for (const r of rows) {
    const rec = JSON.parse(r.doc);
    let arr = book[r.coll] as unknown[] | undefined;
    if (!Array.isArray(arr)) { arr = []; book[r.coll] = arr; listed0.add(r.coll); }
    arr.push(rec);
    if (live) { known.add(rec); addDomain(r.coll, r.id); if (SMALL.has(r.coll)) smallJson.set(rec, r.doc); }
  }
  if (live) for (const r of await d.all<{ coll: string; m: number }>('SELECT coll, MAX(ord) m FROM docs GROUP BY coll')) ordNext.set(r.coll, r.m + 1);
  if (since && Array.isArray(book.journal)) {
    /* Everything posted before the window, folded into one entry per branch
       and account, so balances, the trial balance and the balance sheet read
       exactly as with the whole journal loaded. Never written, never synced. */
    const carry = await d.all<{ br: string | null; acc: string; dr: number; cr: number }>(
      `SELECT json_extract(e.doc,'$.branch') br, json_extract(l.value,'$.acc') acc,
              SUM(COALESCE(json_extract(l.value,'$.dr'),0)) dr, SUM(COALESCE(json_extract(l.value,'$.cr'),0)) cr
         FROM docs e, json_each(e.doc,'$.lines') l
        WHERE e.coll = 'journal' AND e.day IS NOT NULL AND e.day < ?
        GROUP BY br, acc`, [since]);
    const byBranch = new Map<string, Array<{ acc: string; dr: number; cr: number }>>();
    /* Gross debit and credit per account, not just the net: the chart of
       accounts and the general ledger show both totals, and they must read
       exactly as with the whole journal loaded. */
    for (const c of carry) {
      const dr = Math.round((c.dr || 0) * 100) / 100, cr = Math.round((c.cr || 0) * 100) / 100;
      if (dr < 0.005 && cr < 0.005) continue;
      const k = c.br || '';
      const list = byBranch.get(k) || [];
      list.push({ acc: c.acc, dr, cr });
      byBranch.set(k, list);
    }
    const ts = new Date(Date.parse(since + 'T00:00:00') - 1).toISOString();
    const carries = [...byBranch.entries()].map(([br, lines]) => ({
      id: CARRY_PREFIX + (br || 'all'), ts, memo: 'Brought forward from before ' + since, ref: 'carry',
      lines, balanced: true, ...(br ? { branch: br } : {}), carried: true,
    }));
    (book.journal as unknown[]).unshift(...carries);
  }
  if (since) {
    /* Per party, the totals of the older sales, purchases and payments left on
       disk — the same sums reports.ts takes over the lists (party ledger,
       customer and supplier balance summaries). Open documents are in memory
       already and are left out here. */
    const notOpen = (c: string) => (OPEN_SQL[c] ? 'NOT ' + OPEN_SQL[c] : '1');
    const parties: Record<string, Record<string, number>> = {};
    const add = (pid: string | null, k: string, v: number) => {
      if (!pid || !v) return;
      const p = parties[pid] || (parties[pid] = {});
      p[k] = Math.round(((p[k] || 0) + v) * 100) / 100;
    };
    for (const r of await d.all<{ party: string; t: number; p: number; pt: number }>(
      `SELECT party, SUM(json_extract(doc,'$.total')) t, SUM(COALESCE(json_extract(doc,'$.paid'),0)) p,
              SUM(COALESCE(json_extract(doc,'$.paidAtSale'), CASE WHEN json_extract(doc,'$.method') = 'credit' THEN 0 ELSE json_extract(doc,'$.total') END)) pt
         FROM docs WHERE coll = 'sales' AND day < ? AND ${notOpen('sales')} AND COALESCE(json_extract(doc,'$.status'),'') <> 'void' AND party IS NOT NULL
        GROUP BY party`, [since])) { add(r.party, 'salesTotal', r.t); add(r.party, 'salesPaid', r.p); add(r.party, 'salesPaidThen', r.pt); }
    for (const r of await d.all<{ party: string; t: number; p: number; lt: number; lpt: number }>(
      `SELECT party, SUM(json_extract(doc,'$.total')) t, SUM(COALESCE(json_extract(doc,'$.paid'),0)) p,
              SUM(CASE WHEN COALESCE(json_extract(doc,'$.status'),'') <> 'void' THEN json_extract(doc,'$.total') ELSE 0 END) lt,
              SUM(CASE WHEN COALESCE(json_extract(doc,'$.status'),'') <> 'void' AND json_extract(doc,'$.method') <> 'credit' THEN json_extract(doc,'$.total') ELSE 0 END) lpt
         FROM docs WHERE coll = 'purchases' AND day < ? AND ${notOpen('purchases')} AND party IS NOT NULL
        GROUP BY party`, [since])) { add(r.party, 'purTotalAll', r.t); add(r.party, 'purPaidAll', r.p); add(r.party, 'purTotal', r.lt); add(r.party, 'purPaidThen', r.lpt); }
    for (const r of await d.all<{ party: string; i: number; o: number }>(
      `SELECT party, SUM(CASE WHEN json_extract(doc,'$.direction') = 'in' THEN json_extract(doc,'$.amount') ELSE 0 END) i,
              SUM(CASE WHEN json_extract(doc,'$.direction') = 'out' THEN json_extract(doc,'$.amount') ELSE 0 END) o
         FROM docs WHERE coll = 'payments' AND day < ? AND party IS NOT NULL GROUP BY party`, [since])) { add(r.party, 'payIn', r.i); add(r.party, 'payOut', r.o); }
    /* Items that moved before the window: their stock at the window start is
       history, not a first delivery (reports.ts stock-out days). */
    const movedBefore = (await d.all<{ item: string }>("SELECT DISTINCT item FROM docs WHERE coll = 'movements' AND day < ? AND item IS NOT NULL", [since])).map((r) => r.item);
    book.__window = { sinceDay: since, parties, movedBefore };
  }
  if (live) {
    docColls = listed0;
    docColls.forEach((c) => {
      const arr = book[c] as unknown[];
      arrays.set(c, arr); lengths.set(c, arr.length);
    });
  }
  return book;
}

/**
 * The whole book straight from disk, for backups and cloud snapshots. Touches
 * nothing the live store keeps in memory. Save first (flushSave) so it is current.
 */
export async function readFullBook(): Promise<Record<string, unknown> | null> {
  const d = await db();
  if (!(await hasBook())) return null;
  const book: Record<string, unknown> = {};
  for (const m of await d.all<{ key: string; doc: string }>('SELECT key, doc FROM meta')) book[m.key] = JSON.parse(m.doc);
  const listed = await d.all<{ val: string }>("SELECT val FROM store WHERE key = 'colls'");
  for (const c of (listed.length ? JSON.parse(listed[0].val) : []) as string[]) book[c] = [];
  for (const r of await d.all<{ coll: string; doc: string }>('SELECT coll, doc FROM docs ORDER BY coll, ord')) {
    let arr = book[r.coll] as unknown[] | undefined;
    if (!Array.isArray(arr)) { arr = []; book[r.coll] = arr; }
    arr.push(JSON.parse(r.doc));
  }
  return book;
}

/**
 * Pulls records left on disk (older than the window) into the live book, so a
 * screen can open one and a change can be made to it. They are slotted in as
 * records already on disk — never as new ones — so the next save rewrites
 * only what is then changed, and nothing is renumbered.
 * Returns how many were brought in.
 */
export async function faultIn(book: Record<string, unknown>, coll: string, ids: string[]): Promise<number> {
  const arr = book[coll];
  if (!Array.isArray(arr) || !ids.length) return 0;
  const have = new Set((arr as Array<{ id?: string }>).map((r) => r.id));
  const want = [...new Set(ids)].filter((id) => id && !have.has(id) && !id.startsWith(CARRY_PREFIX));
  if (!want.length) return 0;
  const d = await db();
  const rows: Array<{ id: string; doc: string }> = [];
  for (let i = 0; i < want.length; i += 400) {
    const part = want.slice(i, i + 400);
    rows.push(...await d.all<{ id: string; doc: string }>(
      'SELECT id, doc FROM docs WHERE coll = ? AND id IN (' + part.map(() => '?').join(',') + ')', [coll, ...part]));
  }
  if (!rows.length) return 0;
  const recs = rows.map((r) => JSON.parse(r.doc) as Record<string, unknown>);
  /* Before anything appended and not yet saved, and counted as saved, so the
     writer neither re-adds them nor mistakes them for new. */
  const at = Math.min(lengths.get(coll) ?? arr.length, arr.length);
  (arr as unknown[]).splice(at, 0, ...recs);
  recs.forEach((rec, i) => { known.add(rec); addDomain(coll, rows[i].id); if (SMALL.has(coll)) smallJson.set(rec, rows[i].doc); });
  if (arrays.get(coll) === arr) lengths.set(coll, (lengths.get(coll) ?? 0) + recs.length);
  return recs.length;
}

export interface HistoryQuery {
  from?: string; to?: string;            // yyyy-mm-dd, inclusive
  party?: string; item?: string;
  limit?: number; offset?: number;
  newestFirst?: boolean;
}
/** Records of one list from disk — for screens that reach past the window. */
export async function history<T = Record<string, unknown>>(coll: string, q: HistoryQuery = {}): Promise<T[]> {
  const d = await db();
  const where = ['coll = ?'];
  const args: unknown[] = [coll];
  if (q.from) { where.push('day >= ?'); args.push(q.from); }
  if (q.to) { where.push('day <= ?'); args.push(q.to); }
  if (q.party) { where.push('party = ?'); args.push(q.party); }
  if (q.item) { where.push('item = ?'); args.push(q.item); }
  const lim = Math.max(1, Math.min(q.limit || 500, 5000));
  const rows = await d.all<{ doc: string }>(
    `SELECT doc FROM docs WHERE ${where.join(' AND ')} ORDER BY day ${q.newestFirst ? 'DESC' : 'ASC'}, ord ${q.newestFirst ? 'DESC' : 'ASC'} LIMIT ? OFFSET ?`,
    [...args, lim, Math.max(0, q.offset || 0)]);
  return rows.map((r) => JSON.parse(r.doc) as T);
}

/**
 * Records left on disk by a window: before `sinceDay` and not kept in memory
 * as open. `item` narrows to one product; `eq` to fields of the record.
 */
export async function olderRows<T = Record<string, unknown>>(coll: string, sinceDay: string, q: { item?: string; eq?: Record<string, string> } = {}): Promise<T[]> {
  const d = await db();
  const { where, args } = olderWhere(coll, sinceDay, q);
  const rows = await d.all<{ doc: string }>(`SELECT doc FROM docs WHERE ${where} ORDER BY day, ord`, args);
  return rows.map((r) => JSON.parse(r.doc) as T);
}
/** How many such records, without reading them; `notEq` leaves out a field value (e.g. void bills). */
export async function countOlder(coll: string, sinceDay: string, q: { eq?: Record<string, string>; notEq?: Record<string, string> } = {}): Promise<number> {
  const d = await db();
  const { where, args } = olderWhere(coll, sinceDay, q);
  const r = await d.all<{ n: number }>(`SELECT COUNT(*) AS n FROM docs WHERE ${where}`, args);
  return Number(r[0]?.n || 0);
}
function olderWhere(coll: string, sinceDay: string, q: { item?: string; eq?: Record<string, string>; notEq?: Record<string, string> }) {
  const w = ['coll = ?', 'day < ?'];
  const args: unknown[] = [coll, sinceDay];
  if (OPEN_SQL[coll]) w.push('NOT ' + OPEN_SQL[coll]);
  if (q.item) { w.push('item = ?'); args.push(q.item); }
  const key = (k: string) => { if (!/^[A-Za-z_]\w*$/.test(k)) throw new Error('bad field ' + k); return "json_extract(doc,'$." + k + "')"; };
  Object.entries(q.eq || {}).forEach(([k, v]) => { w.push(key(k) + ' = ?'); args.push(v); });
  Object.entries(q.notEq || {}).forEach(([k, v]) => { w.push('COALESCE(' + key(k) + ", '') <> ?"); args.push(v); });
  return { where: w.join(' AND '), args };
}

const isRecordList = (v: unknown): v is Record<string, unknown>[] =>
  Array.isArray(v) && v.every((r) => r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string');

/**
 * Writes what changed since the last save, in one transaction.
 * `full` re-checks every record (first write, migration, restore).
 */
export async function writeBook(book: Record<string, unknown>, opts: { full?: boolean } = {}): Promise<void> {
  const d = await db();
  const t0 = Date.now();
  const ch = pending;
  pending = emptyChanges();
  const after: Array<() => void> = [];
  let rows = 0, deletes = 0, metas = 0;
  const upsert = async (coll: string, rec: Record<string, unknown>, json: string, ord: number) => {
    if (typeof rec.id === 'string' && rec.id.startsWith(CARRY_PREFIX)) return;
    after.push(() => addDomain(coll, rec.id as string));
    await d.run(
      `INSERT INTO docs (coll, id, ord, day, party, item, doc) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(coll, id) DO UPDATE SET doc = excluded.doc, day = excluded.day, party = excluded.party, item = excluded.item`,
      [coll, rec.id, ord, dayOf(rec), str(rec.partyId), str(rec.productId), json]);
    rows++;
    after.push(() => { known.add(rec); if (SMALL.has(coll)) smallJson.set(rec, json); });
  };
  try {
    await d.exec('BEGIN IMMEDIATE');
    /* ── every list of records ── */
    const nowDocColls = new Set<string>();
    const wholeColls: string[] = [];
    for (const k of Object.keys(book)) {
      const v = book[k];
      if (!COLLS.has(k) || !isRecordList(v)) continue;
      nowDocColls.add(k);
      const arr = v;
      const was = arrays.get(k);
      const whole = opts.full || ch.whole.has(k) || was !== arr || arr.length < (lengths.get(k) || 0) || !docColls.has(k);
      if (whole) {
        wholeColls.push(k + (opts.full ? ':full' : ch.whole.has(k) ? ':marked' : was !== arr ? ':newArray' : ':shrunk'));
        /* Reconcile: the set and order of ids must match the array. */
        const stored = await d.all<{ id: string; ord: number }>('SELECT id, ord FROM docs WHERE coll = ? ORDER BY ord', [k]);
        const here = new Set(arr.map((r) => r.id as string));
        /* Only rows this session loaded or wrote may be deleted: with a window,
           older history is on disk and not in the list, and must stay. */
        const windowed = !!book.__window;
        for (const s of stored) if (!here.has(s.id) && (!windowed || inDomain(k, s.id))) { await d.run('DELETE FROM docs WHERE coll = ? AND id = ?', [k, s.id]); deletes++; }
        const kept = stored.filter((s) => here.has(s.id));
        const ordOf = new Map(kept.map((s) => [s.id, s.ord]));
        /* Where the new records sit decides whether positions must change.
           New ones before the first kept record (an unshift, as the audit log
           does) count down from the lowest position; new ones after the last
           count up; removals need nothing. Only new records in between, or kept
           ones in a different order, renumber the whole list. */
        const keptIdx: number[] = [];
        for (let i = 0; i < arr.length; i++) if (ordOf.has(arr[i].id as string)) keptIdx.push(i);
        let inOrder = true;
        for (let j = 1; j < keptIdx.length; j++) {
          if ((ordOf.get(arr[keptIdx[j]].id as string) as number) <= (ordOf.get(arr[keptIdx[j - 1]].id as string) as number)) { inOrder = false; break; }
        }
        const first = keptIdx.length ? keptIdx[0] : arr.length, last = keptIdx.length ? keptIdx[keptIdx.length - 1] : -1;
        let middle = false;
        for (let i = first + 1; i < last && !middle; i++) if (!ordOf.has(arr[i].id as string)) middle = true;
        /* With a window, history rows sit on disk between these: renumbering
           would collide with them, so positions are left as they are. */
        const renumber = !windowed && (!inOrder || middle);
        const minOrd = kept.length ? kept[0].ord : 0;
        let next = Math.max(ordNext.get(k) || 0, kept.length ? kept[kept.length - 1].ord + 1 : 0);
        const ids = ch.ids.get(k);
        for (let i = 0; i < arr.length; i++) {
          const rec = arr[i];
          const onDisk = ordOf.has(rec.id as string);
          if (!onDisk) {
            const ord = renumber ? i : i < first ? minOrd - (first - i) : next++;
            await upsert(k, rec, JSON.stringify(rec), ord);
          } else if (opts.full || !known.has(rec) || (ids && ids.has(rec.id as string))) {
            /* a record this store never wrote (restore), or one the tracker named */
            const json = JSON.stringify(rec);
            if (!SMALL.has(k) || smallJson.get(rec) !== json) await upsert(k, rec, json, i);
          } else if (SMALL.has(k)) {
            const json = JSON.stringify(rec);
            if (smallJson.get(rec) !== json) await upsert(k, rec, json, i);
          }
          if (renumber && onDisk) await d.run('UPDATE docs SET ord = ? WHERE coll = ? AND id = ?', [i, k, rec.id]);
        }
        const endOrd = renumber ? arr.length : next;
        after.push(() => ordNext.set(k, endOrd));
      } else {
        const from = lengths.get(k) || 0;
        let next = ordNext.get(k) || from;
        /* appended */
        for (let i = from; i < arr.length; i++) { await upsert(k, arr[i], JSON.stringify(arr[i]), next++); }
        const nextOrd = next;
        after.push(() => ordNext.set(k, nextOrd));
        /* edited in place, as seen by the tracker */
        const ids = ch.ids.get(k);
        if (ids && ids.size) {
          /* Records added this time were written above; look only for the rest.
             (Looking for them among the older records walked the whole list on
             every save, which is what made saving slow down as the book grew.) */
          const appended = new Set<string>();
          for (let i = from; i < arr.length; i++) appended.add(arr[i].id as string);
          const want = new Set<string>();
          ids.forEach((id) => { if (!appended.has(id)) want.add(id); });
          const seen = new Set<string>();
          /* Newest first, stopping once every named record is found: edits are
             nearly always to recent records, so this rarely walks the list. */
          for (let i = Math.min(from, arr.length) - 1; i >= 0 && seen.size < want.size; i--) {
            const rec = arr[i];
            if (!want.has(rec.id as string)) continue;
            seen.add(rec.id as string);
            const json = JSON.stringify(rec);
            if (!SMALL.has(k) || smallJson.get(rec) !== json) await upsert(k, rec, json, i);
          }
          /* named, not added, and no longer in the list: removed */
          for (const id of want) {
            if (seen.has(id)) continue;
            await d.run('DELETE FROM docs WHERE coll = ? AND id = ?', [k, id]); deletes++;
          }
        }
        /* Small lists are compared in full against the JSON last written.
           Large ones: a rotating slice is compared against what SQLite holds,
           which catches an edit the tracker could not see. */
        if (SMALL.has(k)) {
          for (let i = 0; i < from; i++) {
            const rec = arr[i];
            if (ids && ids.has(rec.id as string)) continue;
            const json = JSON.stringify(rec);
            if (smallJson.get(rec) !== json) await upsert(k, rec, json, i);
          }
        }
        const lo = SMALL.has(k) ? 0 : (sweepAt.get(k) || 0) % Math.max(1, from);
        const n = SMALL.has(k) ? 0 : Math.min(from, SWEEP_PER_SAVE);
        if (n > 0) {
          const slice: Array<{ rec: Record<string, unknown>; i: number }> = [];
          for (let j = 0; j < n; j++) {
            const i = (lo + j) % from;
            const rec = arr[i];
            if (!(ids && ids.has(rec.id as string))) slice.push({ rec, i });
          }
          const onDisk = new Map<string, string>();
          for (let a = 0; a < slice.length; a += 400) {
            const part = slice.slice(a, a + 400);
            const rowsBack = await d.all<{ id: string; doc: string }>(
              'SELECT id, doc FROM docs WHERE coll = ? AND id IN (' + part.map(() => '?').join(',') + ')',
              [k, ...part.map((x) => x.rec.id)]);
            rowsBack.forEach((r) => onDisk.set(r.id, r.doc));
          }
          for (const { rec, i } of slice) {
            const json = JSON.stringify(rec);
            if (onDisk.get(rec.id as string) !== json) {
              if (onDisk.has(rec.id as string)) stats.rescued++;
              await upsert(k, rec, json, i);
            }
          }
        }
        if (!SMALL.has(k)) after.push(() => sweepAt.set(k, lo + n));
      }
      after.push(() => { arrays.set(k, arr); lengths.set(k, arr.length); });
    }
    /* lists that went away, or turned into plain values */
    for (const c of docColls) {
      if (!nowDocColls.has(c)) { await d.run('DELETE FROM docs WHERE coll = ?', [c]); deletes++; }
    }
    /* ── everything else ── */
    for (const k of Object.keys(book)) {
      if (nowDocColls.has(k) || k === "__window") continue;
      const v = book[k];
      if (v === undefined || typeof v === 'function') continue;
      const json = JSON.stringify(v);
      if (metaJson.get(k) === json) continue;
      await d.run('INSERT INTO meta (key, doc) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET doc = excluded.doc', [k, json]);
      metas++;
      after.push(() => metaJson.set(k, json));
    }
    for (const k of [...metaJson.keys()]) {
      if (k === "__window" || (k in book && book[k] !== undefined && !nowDocColls.has(k))) continue;
      await d.run('DELETE FROM meta WHERE key = ?', [k]);
      after.push(() => metaJson.delete(k));
    }
    const collsJson = JSON.stringify([...nowDocColls].sort());
    if (collsJson !== JSON.stringify([...docColls].sort()) || opts.full) {
      await d.run("INSERT INTO store (key, val) VALUES ('colls', ?) ON CONFLICT(key) DO UPDATE SET val = excluded.val", [collsJson]);
    }
    await d.run("INSERT INTO store (key, val) VALUES ('format', ?) ON CONFLICT(key) DO NOTHING", [String(FORMAT)]);
    await d.exec('COMMIT');
    after.forEach((f) => f());
    docColls = nowDocColls;
    stats.lastWrite = { rows, deletes, metas, ms: Date.now() - t0 };
    stats.lastWhole = wholeColls;
  } catch (e) {
    try { await d.exec('ROLLBACK'); } catch { /* not in a transaction */ }
    mergeChanges(pending, ch);           // try these again on the next save
    throw e;
  }
}

/** Empties the book (sign-out of a business, start again). */
export async function clearBook(): Promise<void> {
  const d = await db();
  await d.exec("BEGIN IMMEDIATE; DELETE FROM docs; DELETE FROM meta; DELETE FROM store; COMMIT;");
  resetMemory();
}

/** Small facts about the store kept beside the book (migration time etc.). */
export async function storeGet(key: string): Promise<string | null> {
  const d = await db();
  const r = await d.all<{ val: string }>('SELECT val FROM store WHERE key = ?', [key]);
  return r.length ? r[0].val : null;
}
export async function storeSet(key: string, val: string): Promise<void> {
  const d = await db();
  await d.run('INSERT INTO store (key, val) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET val = excluded.val', [key, val]);
}
