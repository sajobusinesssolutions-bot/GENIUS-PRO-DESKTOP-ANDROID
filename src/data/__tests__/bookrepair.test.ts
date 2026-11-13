/** Check the books: what old deletes left wrong is found, put right once, and then nothing more. */
import { busyBook, makeDb, line } from '../__fixtures__/reportbook';
import * as logic from '../logic';

const net = (d: any, acc: string) => Math.round(d.journal.reduce((t: number, e: any) => t + e.lines.reduce((x: number, l: any) => x + (l.acc === acc ? (l.dr || 0) - (l.cr || 0) : 0), 0), 0) * 100) / 100;
const gap = (d: any) => Math.round(d.journal.reduce((t: number, e: any) => t + e.lines.reduce((x: number, l: any) => x + (l.dr || 0) - (l.cr || 0), 0), 0) * 100) / 100;

describe('check the books', () => {
  it('a sound book has nothing to put right', () => {
    const d = busyBook();
    expect(logic.checkBooks(d).issues).toEqual([]);
  });

  it('a deleted part-paid sale from an older version is found and put right, once', () => {
    const d = makeDb();
    d.products[0].stock.w1 = 10;
    const s = logic.commitSale(d, { lines: [line('p_a', 3, 200)], partyId: 'c1', method: 'credit', discount: 0, received: 250, receivedVia: 'cash' });
    const cashBefore = net(d, 'acc_cash') - 250;
    logic.deleteSale(d, s.id);
    // what the older delete did: no line taking the 250 back out of the till
    const v = d.journal.find((e) => e.ref === s.no && /^Void/.test(e.memo))!;
    v.lines = v.lines.filter((l) => l.acc !== 'acc_cash');
    expect(gap(d)).not.toBe(0);

    const found = logic.checkBooks(d).issues;
    expect(found.map((i) => [i.kind, i.ref])).toEqual([['fixable', s.no]]);
    expect(found[0].detail).toMatch(/Cash −250/);

    const done = logic.repairBooks(d);
    expect(done.length).toBe(1);
    expect(gap(d)).toBe(0);
    expect(net(d, 'acc_cash')).toBe(cashBefore);
    expect(net(d, 'n_ar')).toBe(Math.round(logic.partyBalance(d, 'c1') * 100) / 100);
    expect(logic.checkBooks(d).issues).toEqual([]);
    expect(logic.repairBooks(d)).toEqual([]);
  });

  it('only someone who may change settings can repair', () => {
    const d = makeDb();
    d.session.role = 'cashier' as any;
    expect(() => logic.repairBooks(d)).toThrow(/Permission denied/);
  });
});

describe('what a delete will do, said before it goes', () => {
  it('a part-paid credit sale paid again later', () => {
    const d = makeDb();
    d.products[0].stock.w1 = 10;
    const s = logic.commitSale(d, { lines: [line('p_a', 3, 200)], partyId: 'c1', method: 'credit', discount: 0, received: 100, receivedVia: 'momo' });
    logic.recordPayment(d, { partyId: 'c1', amount: 200, direction: 'in', accountId: 'acc_cash', allocations: [{ saleId: s.id, amount: 200 }] });
    const t = logic.deleteEffects(d, 'sale', s.id).join(' ');
    expect(t).toMatch(/3 items go back on the shelf/);
    expect(t).toMatch(/100 taken at the counter comes out of Mobile money/);
    expect(t).toMatch(/payment of 200 made on it afterwards stays as credit for Cust One/);
    expect(t).toMatch(/Cust One no longer owes 300/);
  });
  it('a receipt that settled a bill', () => {
    const d = makeDb();
    d.products[0].stock.w1 = 10;
    const s = logic.commitSale(d, { lines: [line('p_a', 2, 200)], partyId: 'c1', method: 'credit', discount: 0 });
    const p = logic.recordPayment(d, { partyId: 'c1', amount: 500, direction: 'in', accountId: 'acc_cash' });
    const t = logic.deleteEffects(d, 'payment', p.id).join(' ');
    expect(t).toMatch(/500 comes out of Cash/);
    expect(t).toMatch(new RegExp(s.no + ' is owed 400 again'));
    expect(t).toMatch(/credit of 100 goes/);
  });
});

describe('edit history shows the money', () => {
  it('an edited sale records its total, paid and owed before and after', () => {
    const d = makeDb();
    d.products[0].stock.w1 = 10;
    const s = logic.commitSale(d, { lines: [line('p_a', 2, 200)], partyId: 'c1', method: 'credit', discount: 0 });
    logic.editSale(d, s.id, { lines: [line('p_a', 5, 200)], partyId: 'c1', discount: 0 });
    const revs = logic.revisionsFor(d, s.id);
    expect(revs[0].why).toMatch(/^Edited/);
    const ch = Object.fromEntries(revs[0].changed.map((c: any) => [c.f, [c.from, c.to]]));
    expect(ch.total).toEqual([400, 1000]);
    expect(ch.due).toEqual([400, 1000]);
    expect(revs.some((r) => /^Voided/.test(r.why))).toBe(false);
  });
});

describe('put back in place', () => {
  it('a deleted sale put back takes back the payment made on it', () => {
    const d = makeDb();
    d.products[0].stock.w1 = 10;
    const s = logic.commitSale(d, { lines: [line('p_a', 5, 200)], partyId: 'c1', method: 'credit', discount: 0 });
    const p = logic.recordPayment(d, { partyId: 'c1', amount: 600, direction: 'in', accountId: 'acc_cash', allocations: [{ saleId: s.id, amount: 600 }] });
    logic.deleteSale(d, s.id);
    expect(p.unapplied).toBe(600);
    logic.restoreSale(d, s.id);
    expect([s.due, s.paid, p.unapplied]).toEqual([400, 600, 0]);
    expect(p.allocations!.some((a) => a.docId === s.id && a.amount === 600)).toBe(true);
    expect(logic.partyBalance(d, 'c1')).toBe(400);
  });
  it('unless the money was used for another bill meanwhile', () => {
    const d = makeDb();
    d.products[0].stock.w1 = 10;
    const s = logic.commitSale(d, { lines: [line('p_a', 5, 200)], partyId: 'c1', method: 'credit', discount: 0 });
    const p = logic.recordPayment(d, { partyId: 'c1', amount: 600, direction: 'in', accountId: 'acc_cash', allocations: [{ saleId: s.id, amount: 600 }] });
    logic.deleteSale(d, s.id);
    const s2 = logic.commitSale(d, { lines: [line('p_a', 2, 200)], partyId: 'c1', method: 'credit', discount: 0 });
    p.unapplied = 200; s2.due = 0; s2.paid = 400;   // 400 of it set against the new bill
    logic.restoreSale(d, s.id);
    expect([s.due, p.unapplied]).toEqual([800, 0]);
  });
});
