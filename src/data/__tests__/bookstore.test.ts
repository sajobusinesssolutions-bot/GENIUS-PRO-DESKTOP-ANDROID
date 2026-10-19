/**
 * The book in SQLite (store/bookstore.ts) — tested against real SQLite.
 *
 * Node's built-in `node:sqlite` stands in for expo-sqlite, so every statement
 * the store writes is actually executed and read back. A "cold reload" drops
 * everything the store knows in memory and reads the book from the database
 * alone — exactly what happens when the app starts again.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DatabaseSync } from 'node:sqlite';
import { setDriverOpener } from '../store/driver';
import { _resetForTests, stats, loadBook } from '../store/bookstore';
import { loadDB, saveDB, trackedChange, storageEngine, migrate, KEY, clearDB } from '../storage';
import { demoBook } from '../demos';
import { seed } from '../seed';
import * as logic from '../logic';
import type { DB, SaleLine } from '../types';

let mem: DatabaseSync;
function useSqlite() {
  if (mem) { try { mem.close(); } catch { /* already closed */ } }
  mem = new DatabaseSync(':memory:');
  setDriverOpener(async () => ({
    exec: async (s: string) => { mem.exec(s); },
    run: async (s: string, p: unknown[] = []) => { mem.prepare(s).run(...(p as never[])); },
    all: async (s: string, p: unknown[] = []) => mem.prepare(s).all(...(p as never[])) as never,
  }));
}
/** Forget everything in memory and read the book from the database alone. */
async function coldReload(): Promise<DB> {
  await _resetForTests();
  const b = await loadDB();
  if (!b) throw new Error('no book after reload');
  return b;
}
const json = (d: unknown) => JSON.parse(JSON.stringify(d));
function expectSameBook(a: DB, b: DB) {
  const A = json(a), B = json(b);
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
    expect([k, B[k]]).toEqual([k, A[k]]);
  }
}
const stocked = (d: DB) => d.products.filter((p) => logic.isStocked(p) && logic.stockOfImpl(p) > 5);
function lineOf(p: DB['products'][number], qty = 1): SaleLine {
  return { productId: p.id, name: p.name, sku: p.sku, unit: p.unit, qty, price: p.price, cost: p.cost, taxRate: 0 } as SaleLine;
}

beforeEach(async () => {
  await (AsyncStorage as unknown as { clear: () => Promise<void> }).clear();
  useSqlite();
  await _resetForTests();
});
afterAll(() => setDriverOpener(null));

describe('moving the old book across', () => {
  it('moves a pharmacy demo book into SQLite and reads back every part unchanged', async () => {
    const old = migrate(json(demoBook('pharmacy'))) as DB;
    await AsyncStorage.setItem(KEY, JSON.stringify(old));
    const d = await loadDB();
    expect(storageEngine()).toBe('sqlite');
    expectSameBook(old, d!);
    /* and again from the database alone, as on the next start */
    expectSameBook(old, await coldReload());
  });

  it('keeps the old key as a rollback copy and never writes to it again', async () => {
    const old = migrate(json(demoBook('retail'))) as DB;
    await AsyncStorage.setItem(KEY, JSON.stringify(old));
    const d = (await loadDB())!;
    trackedChange(d, (x) => { x.settings.lastBackupAt = 'changed after the move'; });
    await saveDB(d);
    const raw = JSON.parse((await AsyncStorage.getItem(KEY))!);
    expect(raw.settings.lastBackupAt).not.toBe('changed after the move');
    expect((await coldReload()).settings.lastBackupAt).toBe('changed after the move');
  });

  it('stays on the old storage when SQLite cannot open, and loses nothing', async () => {
    setDriverOpener(async () => { throw new Error('no native module'); });
    await _resetForTests();
    const old = migrate(json(demoBook('retail'))) as DB;
    await AsyncStorage.setItem(KEY, JSON.stringify(old));
    const d = (await loadDB())!;
    expect(storageEngine()).toBe('legacy');
    d.settings.lastBackupAt = 'still saved the old way';
    expect(await saveDB(d)).toBe(true);
    expect(JSON.parse((await AsyncStorage.getItem(KEY))!).settings.lastBackupAt).toBe('still saved the old way');
  });
});

describe('saving only what changed', () => {
  async function freshBook(): Promise<DB> {
    const old = migrate(json(seed())) as DB;
    old.session.role = 'owner';
    await AsyncStorage.setItem(KEY, JSON.stringify(old));
    return (await loadDB())!;
  }

  it('a sale writes a handful of rows, not the book', async () => {
    const d = await freshBook();
    const p = stocked(d)[0];
    trackedChange(d, (x) => { logic.commitSale(x, { lines: [lineOf(p, 2)], partyId: null, method: 'cash', discount: 0 }); });
    await saveDB(d);
    const total = (mem.prepare('SELECT COUNT(*) n FROM docs').get() as { n: number }).n;
    expect(stats.lastWrite.rows).toBeLessThan(15);
    expect(total).toBeGreaterThan(500);
    expectSameBook(d, await coldReload());
  });

  it('every kind of change survives a cold reload, and the tracker caught every edit', async () => {
    let d = await freshBook();
    const cust = d.parties.find((x) => x.type === 'customer')!;
    const sup = d.parties.find((x) => x.type === 'supplier') || cust;
    const [p1, p2, p3] = stocked(d);
    const acc = d.accounts[0].id;
    stats.rescued = 0;

    /* a credit sale, saved */
    let sale: { id: string } | null = null;
    trackedChange(d, (x) => { sale = logic.commitSale(x, { lines: [lineOf(p1, 3), lineOf(p2, 1)], partyId: cust.id, method: 'credit', discount: 0 }); });
    await saveDB(d);
    /* a payment allocated to that older invoice: edits the old sale in place */
    trackedChange(d, (x) => { logic.recordPayment(x, { partyId: cust.id, amount: 100, direction: 'in', accountId: acc, allocations: [{ saleId: sale!.id, amount: 100 }] }); });
    await saveDB(d);
    /* an edit of the sale's lines, then a void of another sale */
    trackedChange(d, (x) => { logic.editSale(x, sale!.id, { lines: [lineOf(p1, 1), lineOf(p3, 2)], partyId: cust.id, discount: 0 }); });
    const other = d.sales.find((s) => s.status !== 'void' && s.id !== sale!.id)!;
    trackedChange(d, (x) => { logic.voidSale(x, other.id, 'test'); });
    await saveDB(d);
    /* a purchase and a stock adjustment */
    trackedChange(d, (x) => { logic.createPurchase(x, sup.id, [{ productId: p2.id, name: p2.name, qty: 10, cost: p2.cost } as never], 'cash'); });
    trackedChange(d, (x) => { logic.adjustStock(x, p3.id, x.session.warehouse || x.warehouses[0].id, 7); });
    await saveDB(d);
    /* things removed: the sync queue emptied, an audit row spliced out */
    trackedChange(d, (x) => { x.queue = []; });
    trackedChange(d, (x) => { if (x.auditLog.length > 1) x.auditLog.splice(0, 1); });
    await saveDB(d);

    expect(stats.rescued).toBe(0);
    d = d; // eslint-disable-line no-self-assign
    expectSameBook(d, await coldReload());
  });

  it('saves what a change did even when it throws part-way', async () => {
    const d = await freshBook();
    const s0 = d.sales[0];
    expect(() => trackedChange(d, (x) => { x.sales[0].note = 'written before the refusal'; throw new Error('refused'); })).toThrow('refused');
    await saveDB(d);
    expect((await coldReload()).sales.find((s) => s.id === s0.id)!.note).toBe('written before the refusal');
  });

  it('the safety net picks up an edit made behind the tracker\'s back', async () => {
    const d = await freshBook();
    const s0 = d.sales[0];
    /* edited directly, not through trackedChange: only the re-check can see it */
    (s0 as { note?: string }).note = 'edited without tracking';
    await saveDB(d);
    expect(stats.rescued).toBeGreaterThan(0);
    expect((await coldReload()).sales.find((s) => s.id === s0.id)!.note).toBe('edited without tracking');
  });

  it('a restored book replaces the old one completely', async () => {
    const d = await freshBook();
    const restored = migrate(json(demoBook('pharmacy'))) as DB;
    await saveDB(restored);
    const back = await coldReload();
    expectSameBook(restored, back);
    expect(back.sales.length).toBe(restored.sales.length);
    expect(d.sales.length).not.toBe(0);
  });

  it('clearing the phone removes both the SQLite book and the old copy', async () => {
    await freshBook();
    await clearDB();
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
    await _resetForTests();
    expect(await loadBook()).toBeNull();
  });
});

