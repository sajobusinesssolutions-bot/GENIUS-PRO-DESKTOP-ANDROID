/**
 * Sale numbers come from the server so every device follows one run. A sale
 * saved where the server cannot be asked carries a temporary number, and gets
 * its real one on the next sync — with its ledger and stock lines following.
 */
import { seed } from '../seed';
import { commitSale, setSaleNumber, saleFloor, formatSaleNo, numberPart, editSale, PENDING } from '../logic';
import type { DB } from '../types';

function book(syncOn: boolean): DB {
  const d = seed();
  d.demo = false;
  d.session = { ...d.session, role: 'owner' as any, online: true };
  d.sync = { ...d.sync, on: syncOn };
  return d;
}
const line = (d: DB) => {
  const p = d.products.find((x) => Object.values(x.stock || {}).some((q) => q > 2))!;
  return { productId: p.id, name: p.name, sku: p.sku, unit: p.unit, qty: 1, price: p.price, cost: p.cost, taxRate: 0 };
};

describe('sale numbers', () => {
  it('without sync, the phone numbers as before', () => {
    const d = book(false);
    const s = commitSale(d, { lines: [line(d)], partyId: null, method: 'cash', discount: 0 });
    expect(s.no).toMatch(/^[A-Z]+-\d{5}$/);
    expect(s.numberPending).toBeFalsy();
  });

  it('with sync and no number from the server, the sale waits with a temporary one', () => {
    const d = book(true);
    const s = commitSale(d, { lines: [line(d)], partyId: null, method: 'cash', discount: 0 });
    expect(s.no.startsWith(PENDING)).toBe(true);
    expect(s.numberPending).toBe(true);
  });

  it('a number from the server is used as given', () => {
    const d = book(true);
    const s = commitSale(d, { lines: [line(d)], partyId: null, method: 'cash', discount: 0, no: 'INV-03187' });
    expect(s.no).toBe('INV-03187');
    expect(s.numberPending).toBeFalsy();
  });

  it('the real number replaces the temporary one on the sale, its journal and its stock moves', () => {
    const d = book(true);
    const s = commitSale(d, { lines: [line(d)], partyId: null, method: 'cash', discount: 0 });
    const temp = s.no;
    expect(setSaleNumber(d, s.id, 'INV-03188')).toBe(true);
    expect(s.no).toBe('INV-03188');
    expect(s.numberPending).toBeUndefined();
    expect(d.journal.some((j) => j.ref === temp)).toBe(false);
    expect(d.journal.some((j) => j.ref === 'INV-03188')).toBe(true);
    expect(d.movements.some((m) => m.ref === temp)).toBe(false);
    // and it is given once only
    expect(setSaleNumber(d, s.id, 'INV-09999')).toBe(false);
  });

  it('an edit keeps a temporary number waiting, and a real one as it was', () => {
    const d = book(true);
    const a = commitSale(d, { lines: [line(d)], partyId: null, method: 'cash', discount: 0 });
    const ea = editSale(d, a.id, { lines: [{ ...line(d), qty: 2 }], partyId: null, discount: 0 })!;
    expect(ea.no).toBe(a.no);
    expect(ea.numberPending).toBe(true);
    const b = commitSale(d, { lines: [line(d)], partyId: null, method: 'cash', discount: 0, no: 'INV-04000' });
    const eb = editSale(d, b.id, { lines: [{ ...line(d), qty: 2 }], partyId: null, discount: 0 })!;
    expect(eb.no).toBe('INV-04000');
    expect(eb.numberPending).toBeFalsy();
  });

  it('the floor is the highest number held in the series, ignoring temporary ones', () => {
    const d = book(true);
    d.sales = [];
    commitSale(d, { lines: [line(d)], partyId: null, method: 'cash', discount: 0, no: 'INV-00041' });
    commitSale(d, { lines: [line(d)], partyId: null, method: 'cash', discount: 0, no: 'INV-00007' });
    commitSale(d, { lines: [line(d)], partyId: null, method: 'cash', discount: 0 });
    expect(saleFloor(d, 'INV')).toBe(41);
    expect(formatSaleNo('INV', 42)).toBe('INV-00042');
    expect(numberPart('INV-000114-P')).toBe(114);
  });
});
