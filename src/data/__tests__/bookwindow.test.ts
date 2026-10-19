/**
 * Phase 2: holding only recent trade in memory (store/bookstore.ts loadBook
 * with a window). Every figure the shop relies on must read the same whether
 * the whole book or only the last 90 days (plus open documents and a
 * brought-forward journal entry) is in memory — and saving with a window must
 * never lose a row that was left on disk.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DatabaseSync } from 'node:sqlite';
import { setDriverOpener } from '../store/driver';
import { _resetForTests, CARRY_PREFIX, history } from '../store/bookstore';
import { loadDB, saveDB, trackedChange, migrate, KEY, setMemoryWindowDays, wholeBook, isPartialBook, ensureLoaded, saveMemoryWindowDays, rowsOnDisk, countOnDisk, bookForRange, needsOlder } from '../storage';
import { sealBook } from '../deviceBackup';
import { demoBook } from '../demos';
import * as logic from '../logic';
import { runReport, implementedReports, earliestRead } from '../reports';
import type { DB, SaleLine } from '../types';

let mem: DatabaseSync | null = null;
function useSqlite() {
  if (mem) { try { mem.close(); } catch { /* closed */ } }
  const m = new DatabaseSync(':memory:');
  mem = m;
  setDriverOpener(async () => ({
    exec: async (s: string) => { m.exec(s); },
    run: async (s: string, p: unknown[] = []) => { m.prepare(s).run(...(p as never[])); },
    all: async (s: string, p: unknown[] = []) => m.prepare(s).all(...(p as never[])) as never,
  }));
}
const DAY = 86400000;
const json = (d: unknown) => JSON.parse(JSON.stringify(d));
const r2 = (n: number) => Math.round(n * 100) / 100;

/** 200 days of trade: cash and credit sales, purchases, payments against old invoices. */
async function buildBook(): Promise<DB> {
  const d = migrate(json(demoBook('pharmacy'))) as DB;
  d.session.role = 'owner';
  const wh = d.session.warehouse || d.warehouses[0].id;
  d.products.forEach((p) => { if (logic.isStocked(p)) p.stock = { ...p.stock, [wh]: 1e7 }; });
  const ps = d.products.filter((p) => logic.isStocked(p)).slice(0, 4);
  const cust = d.parties.filter((p) => p.type === 'customer');
  const sup = d.parties.find((p) => p.type === 'supplier') || cust[0];
  const acc = d.accounts[0].id;
  const line = (p: DB['products'][number], q: number) => ({ productId: p.id, name: p.name, sku: p.sku, unit: p.unit, qty: q, price: p.price, cost: p.cost, taxRate: 0 }) as SaleLine;
  const now = Date.now();
  const credit: string[] = [];
  for (let day = 200; day >= 1; day--) {
    const when = new Date(now - day * DAY + 10 * 3600000);
    for (let k = 0; k < 6; k++) {
      const onCredit = k === 0 && cust.length > 0;
      const s = logic.commitSale(d, { lines: [line(ps[k % 4], 1 + (k % 3)), line(ps[(k + 1) % 4], 1)], partyId: onCredit ? cust[day % cust.length].id : null,
        method: onCredit ? 'credit' : 'cash', discount: 0, ts: when.toISOString() }, when);
      if (onCredit) credit.push(s.id);
    }
    if (day % 7 === 0) logic.createPurchase(d, sup.id, [{ productId: ps[0].id, name: ps[0].name, qty: 50, cost: ps[0].cost } as never], day % 14 === 0 ? 'credit' : 'cash', when);
    /* pay off some old credit invoices, leaving others open across the window */
    if (day % 5 === 0 && credit.length > 3) {
      const sid = credit.shift()!;
      const s = d.sales.find((x) => x.id === sid)!;
      if (s.partyId && s.due > 0) logic.recordPayment(d, { partyId: s.partyId, amount: s.due, direction: 'in', accountId: acc, allocations: [{ saleId: sid, amount: s.due }] }, when);
    }
  }
  return d;
}

/** The figures a shop actually reads, all of them. */
function figures(d: DB) {
  const out: Record<string, number> = {};
  d.parties.forEach((p) => { out['party:' + p.name] = r2(logic.partyBalance(d, p.id)); });
  d.accounts.forEach((a) => { out['cash:' + a.name] = r2(logic.cashOnHand(d, a.id)); });
  d.products.forEach((p) => { out['stock:' + p.name] = logic.stockOfImpl(p); });
  const byAcc: Record<string, number> = {};
  d.journal.forEach((e) => e.lines.forEach((l) => { byAcc[l.acc] = (byAcc[l.acc] || 0) + (l.dr || 0) - (l.cr || 0); }));
  Object.keys(byAcc).forEach((a) => { out['ledger:' + a] = r2(byAcc[a]); });
  return out;
}
const stripVolatile = (r: unknown) => JSON.parse(JSON.stringify(r, (k, v) => (k === 'generatedAt' ? undefined : v)));

beforeEach(async () => {
  await (AsyncStorage as unknown as { clear: () => Promise<void> }).clear();
  useSqlite();
  setMemoryWindowDays(0);
  await _resetForTests();
});
afterAll(() => { setMemoryWindowDays(0); setDriverOpener(null); });

describe('a 90-day window', () => {
  let full: DB, win: DB;
  beforeEach(async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify(await buildBook()));
    full = (await loadDB())!;                    // moved into SQLite, whole
    setMemoryWindowDays(90);
    await _resetForTests();
    win = (await loadDB())!;                     // same books, last 90 days
  });

  it('holds far less in memory', () => {
    expect(isPartialBook(win)).toBe(true);
    expect(win.sales.length).toBeLessThan(full.sales.length * 0.6);
    expect(win.journal.some((e) => e.id.startsWith(CARRY_PREFIX))).toBe(true);
  });

  it('every balance, stock level and ledger total reads exactly the same', () => {
    expect(figures(win)).toEqual(figures(full));
  });

  it('keeps every open credit invoice in memory, however old', () => {
    const open = (b: DB) => b.sales.filter((s) => s.due > 0.005).map((s) => s.id).sort();
    expect(open(win)).toEqual(open(full));
  });

  it('every report over the last 30 days reads exactly the same', () => {
    const to = Date.now(), from = to - 30 * DAY;
    const differ: string[] = [];
    for (const id of implementedReports()) {
      const a = stripVolatile(runReport(full, id, from, to));
      const b = stripVolatile(runReport(win, id, from, to));
      if (JSON.stringify(a) !== JSON.stringify(b)) differ.push(id);
    }
    // eslint-disable-next-line no-console
    console.log(`reports differing with a 90-day window (${differ.length} of ${implementedReports().length}): ${differ.join(', ') || 'none'}`);
    expect(differ).toEqual([]);
  });

  it('saving with a window keeps every row left on disk, and never writes the carried entry', async () => {
    const before = full.sales.length;
    const p = win.products.find((x) => logic.isStocked(x))!;
    trackedChange(win, (x) => { logic.commitSale(x, { lines: [{ productId: p.id, name: p.name, sku: p.sku, unit: p.unit, qty: 1, price: p.price, cost: p.cost, taxRate: 0 } as SaleLine], partyId: null, method: 'cash', discount: 0 }); });
    trackedChange(win, (x) => { x.queue = []; });          // a whole-list rewrite, the riskiest path
    await saveDB(win);
    setMemoryWindowDays(0);
    await _resetForTests();
    const back = (await loadDB())!;
    expect(back.sales.length).toBe(before + 1);
    expect(back.journal.some((e) => e.id.startsWith(CARRY_PREFIX))).toBe(false);
    expect(figures(back)['stock:' + p.name]).toBe(figures(full)['stock:' + p.name] - 1);
  });

  it('a backup refuses the partial book, and wholeBook() gives the complete one', async () => {
    expect(() => sealBook(win)).toThrow(/incomplete/);
    const whole = await wholeBook(win);
    expect(isPartialBook(whole)).toBe(false);
    expect(whole.sales.length).toBe(full.sales.length);
    expect(whole.journal.some((e) => e.id.startsWith(CARRY_PREFIX))).toBe(false);
    expect(() => sealBook(whole)).not.toThrow();
  });

  it('a report reaching before the window reads the older range from disk, exactly', async () => {
    const from = Date.now() - 150 * DAY, to = Date.now() - 120 * DAY;
    expect(needsOlder(win, from)).toBe(true);
    const differ: string[] = [];
    for (const id of implementedReports()) {
      const older = await bookForRange(win, earliestRead(id, from, to));
      if (JSON.stringify(stripVolatile(runReport(full, id, from, to))) !== JSON.stringify(stripVolatile(runReport(older, id, from, to)))) differ.push(id);
    }
    expect(differ).toEqual([]);
    /* and "all time" reads the whole book */
    const all = await bookForRange(win, 0);
    expect(all.sales.length).toBe(full.sales.length);
  });

  it('history() reaches records older than the window', async () => {
    const old = new Date(Date.now() - 150 * DAY).toISOString().slice(0, 10);
    const rows = await history<{ id: string }>('sales', { from: old, to: old });
    expect(rows.length).toBeGreaterThan(0);
    const inMem = new Set(win.sales.map((s) => s.id));
    expect(rows.some((r) => !inMem.has(r.id))).toBe(true);
  });
  it('an old record read in on demand can be changed, and nothing is doubled or lost', async () => {
    const inMem = new Set(win.sales.map((s) => s.id));
    const oldPaid = full.sales.find((s) => !inMem.has(s.id) && s.partyId)!;
    const oldCash = full.sales.find((s) => !inMem.has(s.id) && !s.partyId)!;
    expect(await ensureLoaded(win, 'sales', [oldPaid.id, oldCash.id])).toBe(2);
    expect(await ensureLoaded(win, 'sales', [oldPaid.id])).toBe(0);      // already there
    expect(figures(win)).toEqual(figures(full));                            // read in, not counted twice
    trackedChange(win, (x) => { const s = x.sales.find((y) => y.id === oldCash.id)!; (s as { note?: string }).note = 'checked'; });
    await saveDB(win);
    setMemoryWindowDays(0);
    await _resetForTests();
    const back = (await loadDB())!;
    expect(back.sales.length).toBe(full.sales.length);
    expect(new Set(back.sales.map((s) => s.id)).size).toBe(full.sales.length);
    expect((back.sales.find((s) => s.id === oldCash.id) as { note?: string }).note).toBe('checked');
    expect(figures(back)).toEqual(figures(full));
  });
  it('older movements of an item and older bills of a user, read from disk, fill exactly what the window left out', async () => {
    const pid = full.movements[0].productId;
    const older = await rowsOnDisk<{ id: string; productId: string }>(win, 'movements', { item: pid });
    const ids = (b: { id: string }[]) => b.map((m) => m.id).sort();
    const inMem = win.movements.filter((m) => m.productId === pid);
    expect(ids([...older, ...inMem])).toEqual(ids(full.movements.filter((m) => m.productId === pid)));
    const uid = full.sales.find((x) => x.userId)!.userId!;
    const bills = (b: DB) => b.sales.filter((x) => x.userId === uid && x.status !== 'void').length;
    expect(bills(win) + await countOnDisk(win, 'sales', { eq: { userId: uid }, notEq: { status: 'void' } })).toBe(bills(full));
  });
});

describe('deleted bills under a window', () => {
  it('an old deleted bill stays in memory for the Deleted screen, and figures still match', async () => {
    const d = await buildBook();
    const old = d.sales.find((s) => !s.partyId && Date.now() - Date.parse(s.ts) > 150 * DAY)!;
    expect(logic.deleteSale(d, old.id, 'test', new Date(Date.parse(old.ts) + 3600000))).toBe(true);
    await AsyncStorage.setItem(KEY, JSON.stringify(d));
    const full = (await loadDB())!;
    setMemoryWindowDays(90);
    await _resetForTests();
    const win = (await loadDB())!;
    expect(win.sales.some((s) => s.id === old.id && s.deletedAt)).toBe(true);
    expect(figures(win)).toEqual(figures(full));
  });
});

describe('the window setting of the shop', () => {
  it('is kept with the books and applies on the next load, and Everything turns it off', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify(await buildBook()));
    const full = (await loadDB())!;
    await saveMemoryWindowDays(90);
    setMemoryWindowDays(0);                      // a fresh start knows nothing
    await _resetForTests();
    const win = (await loadDB())!;
    expect(isPartialBook(win)).toBe(true);
    expect(figures(win)).toEqual(figures(full));
    await saveMemoryWindowDays(0);
    await _resetForTests();
    expect(isPartialBook((await loadDB())!)).toBe(false);
  });
});
