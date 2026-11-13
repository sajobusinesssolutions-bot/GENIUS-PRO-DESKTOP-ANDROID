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
