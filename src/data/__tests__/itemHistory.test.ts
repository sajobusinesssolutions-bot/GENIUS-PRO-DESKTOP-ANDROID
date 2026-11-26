/**
 * An item's transactions read like the computer's: one row per document, an
 * edited sale as one row, a voided or deleted one gone, an adjustment taken
 * back gone with its reversal — and taking one back or changing it leaves the
 * shelf and the books exactly right.
 */
import { seed } from '../seed';
import * as logic from '../logic';
import { itemHistory } from '../itemHistory';
import type { DB, SaleLine } from '../types';

function book(): { d: DB; pid: string; line: (qty: number) => SaleLine } {
  const d: DB = seed();
  d.settings.requireShift = false;
  d.settings.editWindowDays = 0;
  const p = d.products[0];
  p.stock = { w1: 50 };
  p.trackBatches = false;
  p.batches = [];
  const line = (qty: number): SaleLine => ({ productId: p.id, name: p.name, sku: p.sku, unit: p.unit, qty, price: 1000, cost: p.cost, taxRate: 0 });
  return { d, pid: p.id, line };
}
const net = (d: DB, acc: string) => d.journal.reduce((n, e) => n + e.lines.filter((l) => l.acc === acc).reduce((x, l) => x + (l.dr || 0) - (l.cr || 0), 0), 0);

describe('editing a sale: its own stock counts, its new date sticks, one row', () => {
  it('20 of 30 sold, edited to 15 on another day: allowed, one row of 15 on the new day, 15 left', () => {
    const { d, pid, line } = book();
    const p = d.products.find((x) => x.id === pid)!;
    p.stock = { w1: 30 };
    d.settings.blockNegativeStock = true as any;
    const s = logic.commitSale(d, { lines: [line(20)], partyId: null, method: 'cash', discount: 0 });
    expect(p.stock.w1).toBe(10);
    const day = new Date(Date.now() - 3 * 864e5).toISOString();
    const out = logic.editSale(d, s.id, { lines: [line(15)], partyId: null, discount: 0, pay: { method: 'cash' }, ts: day });
    expect(out).not.toBeNull();
    expect(out!.ts).toBe(day);
    expect(d.sales.find((x) => x.id === s.id)!.ts).toBe(day);
    expect(p.stock.w1).toBe(15);
    const rows = itemHistory(d, pid, d.movements).filter((r) => r.ref === s.no);
    expect(rows).toHaveLength(1);
    expect(rows[0].qty).toBe(-15);
    expect(rows[0].ts).toBe(day);
    // and all 30 may be taken by the edit
    logic.editSale(d, s.id, { lines: [line(30)], partyId: null, discount: 0, pay: { method: 'cash' } });
    expect(p.stock.w1).toBe(0);
  });

  it('a PC edit arriving as a reversal under the sale number nets into the sale', () => {
    const { d, pid, line } = book();
    const s = logic.commitSale(d, { lines: [line(20)], partyId: null, method: 'cash', discount: 0 });
    d.movements.push({ id: 'pc-edit', ts: new Date().toISOString(), productId: pid, warehouse: 'w1', qty: 20, type: 'void', ref: s.no } as any);
    d.movements.push({ id: 'pc-new', ts: new Date().toISOString(), productId: pid, warehouse: 'w1', qty: -15, type: 'sale', ref: s.no } as any);
    const rows = itemHistory(d, pid, d.movements);
    expect(rows.filter((r) => r.ref === s.no)).toHaveLength(1);
    expect(rows.find((r) => r.ref === s.no)!.qty).toBe(-15);
    expect(rows.some((r) => r.type === 'void' || r.type === 'edit')).toBe(false);
  });
});

describe('item history, one row per document', () => {
  it('shows an edited sale once, with its final quantity', () => {
    const { d, pid, line } = book();
    const s = logic.commitSale(d, { lines: [line(5)], partyId: null, method: 'cash', discount: 0 });
    logic.editSale(d, s.id, { lines: [line(7)], partyId: null, discount: 0, pay: { method: 'cash' } });
    const rows = itemHistory(d, pid, d.movements).filter((r) => r.ref === s.no);
    expect(rows).toHaveLength(1);
    expect(rows[0].qty).toBe(-7);
    expect(rows[0].ref).toBe(s.no);
    expect(d.products.find((x) => x.id === pid)!.stock.w1).toBe(43);
  });

  it('leaves out a voided or deleted sale', () => {
    const { d, pid, line } = book();
    const a = logic.commitSale(d, { lines: [line(2)], partyId: null, method: 'cash', discount: 0 });
    const b = logic.commitSale(d, { lines: [line(3)], partyId: null, method: 'cash', discount: 0 });
    logic.voidSale(d, a.id, 'wrong');
    logic.deleteSale(d, b.id, 'gone');
    expect(itemHistory(d, pid, d.movements).filter((r) => r.ref === a.no || r.ref === b.no)).toHaveLength(0);
  });
});

describe('a stock adjustment taken back or changed', () => {
  it('taking one back returns the stock, reverses its money, and leaves the history', () => {
    const { d, pid } = book();
    const before = { inv: net(d, 'n_inventory'), exp: net(d, 'n_expense') };
    logic.adjustStock(d, pid, 'w1', 40, 'Breakage');
    const adj = d.movements.find((m) => m.type === 'adjust')!;
    expect(adj.journalId).toBeTruthy();
    expect(d.journal.find((j) => j.id === adj.journalId)!.moveId).toBe(adj.id);
    logic.reverseAdjustment(d, adj.id, 'Counted wrong');
    expect(d.products.find((x) => x.id === pid)!.stock.w1).toBe(50);
    expect(net(d, 'n_inventory')).toBeCloseTo(before.inv, 2);
    expect(net(d, 'n_expense')).toBeCloseTo(before.exp, 2);
    expect(itemHistory(d, pid, d.movements).filter((r) => r.type === 'adjust')).toHaveLength(0);
    expect(() => logic.reverseAdjustment(d, adj.id)).toThrow(/already taken back/);
  });

  it('changing one replaces it with the new quantity', () => {
    const { d, pid } = book();
    logic.adjustStock(d, pid, 'w1', 45, 'Recount');
    const adj = d.movements.find((m) => m.type === 'adjust')!;
    logic.changeAdjustment(d, adj.id, -2);
    expect(d.products.find((x) => x.id === pid)!.stock.w1).toBe(48);
    const rows = itemHistory(d, pid, d.movements).filter((r) => r.type === 'adjust');
    expect(rows).toHaveLength(1);
    expect(rows[0].qty).toBe(-2);
  });

  it('a count of zero is an adjustment like any other', () => {
    const { d, pid } = book();
    logic.adjustStock(d, pid, 'w1', 0, 'Nothing left');
    expect(d.products.find((x) => x.id === pid)!.stock.w1).toBe(0);
  });

  it('will not take back stock that has since been sold', () => {
    const { d, pid, line } = book();
    logic.adjustStock(d, pid, 'w1', 60, 'Found');
    const adj = d.movements.find((m) => m.type === 'adjust')!;
    logic.commitSale(d, { lines: [line(55)], partyId: null, method: 'cash', discount: 0 });
    expect(() => logic.reverseAdjustment(d, adj.id)).toThrow(/below zero/);
  });
});
