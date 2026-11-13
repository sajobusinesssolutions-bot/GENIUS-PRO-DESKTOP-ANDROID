/**
 * The rules a shop depends on, on the phone: selling below cost (a bill
 * discount counted), selling more than is in stock (several lines of one
 * item together), batches drawn soonest-expiry first when no batch is named,
 * and what a cashier may not do.
 */
import { makeDb, line } from '../__fixtures__/reportbook';
import * as logic from '../logic';
import type { DB } from '../types';

function stocked(): DB {
  const d = makeDb();
  d.products[0].stock.w1 = 10;
  return d;
}

describe('selling below cost', () => {
  it('a line priced below cost is stopped when the shop refuses it', () => {
    const d = stocked();
    d.settings.belowCost = 'block';
    expect(logic.saleBlockers(d, [line('p_a', 1, 90)]).join(' ')).toMatch(/below its cost/);
    expect(logic.saleBlockers(d, [line('p_a', 1, 150)])).toEqual([]);
  });
  it('a bill discount that takes a line below cost is below cost too', () => {
    const d = stocked();
    d.settings.belowCost = 'block';
    expect(logic.saleBlockers(d, [line('p_a', 2, 120)], 60).join(' ')).toMatch(/once the bill discount/);
  });
  it('allowed when the shop allows it', () => {
    const d = stocked();
    d.settings.belowCost = 'allow';
    expect(logic.saleBlockers(d, [line('p_a', 1, 10)])).toEqual([]);
  });
});

describe('selling more than is in stock', () => {
  it('two lines of one item together over stock are stopped', () => {
    const d = stocked();
    d.settings.blockNegativeStock = true;
    expect(logic.saleBlockers(d, [line('p_a', 6, 200), line('p_a', 5, 200)]).join(' ')).toMatch(/10 PC on hand, 11 needed/);
    expect(logic.saleBlockers(d, [line('p_a', 6, 200), line('p_a', 4, 200)])).toEqual([]);
  });
  it('goes below nil when the shop allows it', () => {
    const d = stocked();
    d.settings.blockNegativeStock = false;
    expect(logic.saleBlockers(d, [line('p_a', 50, 200)])).toEqual([]);
  });
});

describe('batches: soonest expiry first', () => {
  it('a line with no batch named is drawn from the batches that expire first, skipping expired ones', () => {
    const d = makeDb();
    const p = d.products[0];
    const y = new Date().getFullYear();
    p.trackBatches = true;
    p.batches = [
      { no: 'LATE', expiry: `${y + 2}-12-31`, qty: 10 },
      { no: 'GONE', expiry: `${y - 1}-01-31`, qty: 5 },
      { no: 'EARLY', expiry: `${y + 1}-06-30`, qty: 10 },
    ];
    p.stock.w1 = 25;
    const s = logic.commitSale(d, { lines: [line('p_a', 12, 200)], partyId: null, method: 'cash', discount: 0 });
    expect(s.lines.map((l) => [l.batchNo, l.qty])).toEqual([['EARLY', 10], ['LATE', 2]]);
    expect(Object.fromEntries(p.batches.map((b) => [b.no, b.qty]))).toEqual({ LATE: 8, GONE: 5, EARLY: 0 });
    // the batches still add up to the shelf
    expect(p.batches.reduce((a, b) => a + b.qty, 0)).toBe(p.stock.w1);
  });
});

describe('what a cashier may not do', () => {
  const asCashier = () => { const d = stocked(); const s = logic.commitSale(d, { lines: [line('p_a', 1, 200)], partyId: null, method: 'cash', discount: 0 }); d.session.role = 'cashier' as any; return { d, s }; };
  it('cannot delete a sale', () => { const { d, s } = asCashier(); expect(() => logic.deleteSale(d, s.id)).toThrow(/Permission denied/); });
  it('cannot edit a sale', () => { const { d, s } = asCashier(); expect(() => logic.editSale(d, s.id, { lines: [line('p_a', 1, 1)], partyId: null, discount: 0 })).toThrow(/Permission denied/); });
  it('cannot delete a payment', () => {
    const { d } = asCashier();
    d.session.role = 'owner' as any;
    const p = logic.recordPayment(d, { partyId: 'c1', amount: 100, direction: 'in', accountId: 'acc_cash' });
    d.session.role = 'cashier' as any;
    expect(() => logic.deletePayment(d, p.id)).toThrow(/Permission denied/);
  });
  it('cannot enter a purchase', () => { const { d } = asCashier(); expect(() => logic.createPurchase(d, 's1', [{ productId: 'p_a', qty: 1, cost: 100 } as any], 'credit')).toThrow(/Permission denied/); });
});
