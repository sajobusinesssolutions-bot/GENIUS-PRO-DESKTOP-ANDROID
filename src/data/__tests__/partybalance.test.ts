import { seed } from '../seed';
import * as logic from '../logic';
import { runReport } from '../reports';
import type { DB } from '../types';

/* The party statement's closing balance and the Parties list are the same figure. */
function closingOf(d: DB, id: string): number {
  const r = runReport(d, 'party-statement', 0, Date.now() + 864e5);
  const i = (r.rowRefs || []).findIndex((x) => x && x.kind === 'party' && x.id === id);
  const c: any = r.rows[i][4];
  return c.n;
}

describe('party balances agree everywhere', () => {
  it('counts returns, withholding and older advances alike', () => {
    const d: DB = seed();
    d.settings.requireShift = false;
    const cust = d.parties.find((p) => p.type === 'customer')!;
    const p = d.products.find((x) => x.active && x.price > 0)!;
    const s = logic.commitSale(d, { lines: [{ productId: p.id, name: p.name, qty: 2, price: 50000, disc: 0, taxRate: 0, cost: 0 } as any], partyId: cust.id, method: 'credit', discount: 0 });
    // a return credited to the account, part off the bill
    d.creditNotes.push({ id: 'cn1', no: 'CN-1', ts: new Date().toISOString(), saleId: s.id, partyId: cust.id, lines: [], total: 30000, reason: 'damaged', refund: 'account', appliedToSale: 30000 });
    s.due -= 30000;
    // a receipt with tax withheld
    logic.recordPayment(d, { partyId: cust.id, amount: 20000, taxDeducted: 1000, direction: 'in', accountId: d.accounts[0].id });
    for (const pt of d.parties) expect(Math.round(closingOf(d, pt.id))).toBe(Math.round(logic.partyBalance(d, pt.id)));
    // an older advance left on disk (a big book loaded with a window)
    (d as any).__window = { sinceDay: '2020-01-01', parties: { [cust.id]: { payIn: 50000, payUnIn: 50000 } } };
    const all = logic.allPartyBalances({ ...d });
    expect(Math.round(closingOf(d, cust.id))).toBe(Math.round(logic.partyBalance(d, cust.id)));
    expect(Math.round(all.get(cust.id)!)).toBe(Math.round(logic.partyBalance(d, cust.id)));
  });
});

describe('deleting a bill that was paid later', () => {
  it('leaves the money on the account, and the cash book where it was', () => {
    const d: DB = seed();
    d.settings.requireShift = false;
    const cust = d.parties.find((p) => p.type === 'customer')!;
    const p = d.products.find((x) => x.active && x.price > 0)!;
    const before = logic.partyBalance(d, cust.id);
    const s = logic.commitSale(d, { lines: [{ productId: p.id, name: p.name, qty: 1, price: 100000, disc: 0, taxRate: 0, cost: 0 } as any], partyId: cust.id, method: 'credit', discount: 0 });
    const acc = d.accounts[0].id;
    const cashOf = () => d.journal.reduce((t, e) => t + e.lines.filter((l) => l.acc === acc).reduce((x, l) => x + (l.dr || 0) - (l.cr || 0), 0), 0);
    logic.recordPayment(d, { partyId: cust.id, amount: 100000, direction: 'in', accountId: acc, allocations: [{ saleId: s.id, amount: 100000 }] });
    expect(Math.round(logic.partyBalance(d, cust.id) - before)).toBe(0);
    const cash = cashOf();
    logic.deleteSale(d, s.id);
    // the 100,000 received is now theirs on account
    expect(Math.round(logic.partyBalance(d, cust.id) - before)).toBe(-100000);
    expect(Math.round(closingOf(d, cust.id))).toBe(Math.round(logic.partyBalance(d, cust.id)));
    expect(Math.round(cashOf())).toBe(Math.round(cash));
  });
});

describe('a journal made on the PC on a customer\'s or supplier\'s own account', () => {
  it('moves what they owe on the list, the statement and the ageing alike', () => {
    const d: DB = seed();
    d.settings.requireShift = false;
    const cust = d.parties.find((p) => p.type === 'customer')!;
    const sup = d.parties.find((p) => p.type === 'supplier')!;
    const before = logic.partyBalance(d, cust.id), beforeS = logic.partyBalance(d, sup.id);
    // the customer's 15,000 set against an expense; the supplier's 7,000 off what we owe them
    d.journal.push({ id: 'jpc1', ts: new Date().toISOString(), memo: 'Offset against transport', ref: 'JV-0001', balanced: true,
      lines: [{ acc: 'exp', dr: 15000 }, { acc: 'ar', cr: 15000, partyId: cust.id }] } as any);
    d.journal.push({ id: 'jpc2', ts: new Date().toISOString(), memo: 'Discount from supplier', ref: 'JV-0002', balanced: true,
      lines: [{ acc: 'ap', dr: 7000, partyId: sup.id }, { acc: 'inc', cr: 7000 }] } as any);
    expect(Math.round(logic.partyBalance(d, cust.id) - before)).toBe(-15000);
    expect(Math.round(logic.partyBalance(d, sup.id) - beforeS)).toBe(7000);
    const all = logic.allPartyBalances(d);
    for (const pt of [cust, sup]) {
      expect(Math.round(all.get(pt.id)!)).toBe(Math.round(logic.partyBalance(d, pt.id)));
      expect(Math.round(closingOf(d, pt.id))).toBe(Math.round(logic.partyBalance(d, pt.id)));
    }
    // older journals left on disk in a big book count the same
    (d as any).__window = { sinceDay: '2020-01-01', parties: { [cust.id]: { jnlCr: 5000 } } };
    const b2 = logic.partyBalance(d, cust.id);
    expect(Math.round(b2 - logic.allPartyBalances({ ...d }).get(cust.id)!)).toBe(0);
    expect(Math.round(closingOf(d, cust.id))).toBe(Math.round(b2));
  });
});
