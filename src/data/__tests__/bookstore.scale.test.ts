/**
 * The book in SQLite at scale: a busy pharmacy's book, saved sale by sale.
 * Kept in its own file so its memory does not share a worker with the rest.
 * SCALE_N=182500 runs a full year at 500 sales a day (slow; for benchmarking).
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

describe('a busy pharmacy, at scale', () => {
  it('saving a sale stays fast as the book grows', async () => {
    const old = migrate(json(demoBook('pharmacy'))) as DB;
    old.session.role = 'owner';
    old.products.forEach((p) => { if (logic.isStocked(p)) p.stock = { ...p.stock, [old.session.warehouse || old.warehouses[0].id]: 1e9 }; });
    await AsyncStorage.setItem(KEY, JSON.stringify(old));
    const d = (await loadDB())!;
    const ps = stocked(d).slice(0, 3);
    const N = Number(process.env.SCALE_N || 3000);
    const tFill = Date.now();
    for (let i = 0; i < N; i++) logic.commitSale(d, { lines: ps.map((p) => lineOf(p, 1)), partyId: null, method: 'cash', discount: 0 });
    await saveDB(d);
    const fillMs = Date.now() - tFill;
    const times: number[] = [], commitT: number[] = [], plainT: number[] = [];
    for (let i = 0; i < 20; i++) {
      const copy = json(d) as DB;
      let t = Date.now();
      logic.commitSale(copy, { lines: ps.map((p) => lineOf(p, 1)), partyId: null, method: 'cash', discount: 0 });
      plainT.push(Date.now() - t);
      t = Date.now();
      trackedChange(d, (x) => { logic.commitSale(x, { lines: ps.map((p) => lineOf(p, 1)), partyId: null, method: 'cash', discount: 0 }); });
      commitT.push(Date.now() - t);
      t = Date.now(); await saveDB(d); times.push(Date.now() - t);

    }
    commitT.sort((a, b) => a - b); plainT.sort((a, b) => a - b);
    // eslint-disable-next-line no-console
    console.log(`commit with tracking p50 ${commitT[10]} ms (same sale untracked p50 ${plainT[10]} ms)`);
    times.sort((a, b) => a - b);
    const tl = Date.now(); const back = await coldReload(); const loadMs = Date.now() - tl;
    const bytes = (mem.prepare("SELECT SUM(LENGTH(doc)) b FROM docs").get() as { b: number }).b;
    // eslint-disable-next-line no-console
    console.log(`scale: ${back.sales.length} sales, ${(bytes / 1048576).toFixed(1)} MB of records · ${N} sales posted+saved in ${fillMs} ms · save p50 ${times[10]} ms, p95 ${times[18]} ms · cold load ${loadMs} ms`);
    expect(back.sales.length).toBe(d.sales.length);
    expect(times[18]).toBeLessThan(250);
  }, 300000);
});
