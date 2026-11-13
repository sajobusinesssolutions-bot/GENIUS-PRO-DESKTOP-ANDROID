/**
 * Every report that shows the same figure shows the same figure — and the
 * ledger agrees. Run on a book with opening balances both ways, a part-paid
 * credit sale, tax withheld, an advance, an edit, a deleted sale paid later
 * and a deleted purchase.
 */
import { busyBook } from '../__fixtures__/reportbook';
import { runReport, ReportResult } from '../reports';
import * as logic from '../logic';
import { ledgerBalances } from '../coa';
import type { DB } from '../types';

const r2 = (n: number) => Math.round(n * 100) / 100;
const txt = (c: any) => (c && typeof c === 'object' ? c.text : String(c ?? ''));
const num = (c: any): number => {
  if (c && typeof c === 'object' && typeof c.n === 'number') return c.n;
  const t = txt(c).replace(/[(),\s]/g, '').replace(/Dr|Cr/g, '');
  const v = Number(t.replace(/[^\d.-]/g, ''));
  return /^\(/.test(txt(c)) ? -v : isNaN(v) ? 0 : v;
};
function rpt(d: DB, id: string): ReportResult { return runReport(d, id, 0, Date.now() + 864e5, (n) => String(Math.round(n * 100) / 100)); }
function col(r: ReportResult, re: RegExp) { const i = r.cols.findIndex((c) => re.test(c.h)); if (i < 0) throw new Error('no column ' + re + ' in ' + r.title + ': ' + r.cols.map((c) => c.h).join('|')); return i; }
function row(r: ReportResult, name: string) { const x = r.rows.find((rw) => txt(rw[0]) === name || txt(rw[1]) === name); if (!x) throw new Error('no row ' + name + ' in ' + r.title); return x; }
const foot = (r: ReportResult, re: RegExp) => num((r.foot || [])[col(r, re)]);

describe('reports agree with each other and with the books', () => {
  const d = busyBook();
  const bal = (id: string) => r2(logic.partyBalance(d, id));
  const custOwe = bal('c1') + bal('c2');
  const suppOwe = -bal('s1');

  it('the balances themselves are what was traded', () => {
    expect(bal('c1')).toBe(870);            // 800 − 530 (500 + 30 withheld) + 600
    expect(bal('c2')).toBe(3950);           // 5,000 opening + 600 − 200 down − 1,000 advance − 450 paid on a sale since deleted
    expect(suppOwe).toBe(8000);             // 8,000 to pay; 6,500 bought, 6,500 paid; the deleted bill not counted
  });

  it('every customer: statement, summary, ageing and Parties say the same', () => {
    for (const [id, name] of [['c1', 'Cust One'], ['c2', 'Cust Two']]) {
      const ps = rpt(d, 'party-statement');
      expect([name, 'party statement', r2(num(row(ps, name)[col(ps, /Balance/)]))]).toEqual([name, 'party statement', bal(id)]);
      const cb = rpt(d, 'customer-balance-summary');
      const r = row(cb, name);
      expect([name, 'balance summary', num(r[col(cb, /Owing/)])]).toEqual([name, 'balance summary', bal(id)]);
      expect([name, 'row adds up', r2(num(r[1]) + num(r[2]) - num(r[3]))]).toEqual([name, 'row adds up', bal(id)]);
      const ag = rpt(d, 'ar-aging-summary');
      expect([name, 'ageing', num(row(ag, name)[col(ag, /Total/)])]).toEqual([name, 'ageing', bal(id)]);
    }
  });

  it('the totals owed agree everywhere, and with the debtors and creditors ledgers', () => {
    expect(r2(foot(rpt(d, 'ar-aging-summary'), /Total/))).toBe(custOwe);
    expect(r2(num((rpt(d, 'receivable-summary').foot || [])[1]))).toBe(custOwe);
    expect(r2(foot(rpt(d, 'ar-aging-details'), /Due/))).toBe(custOwe);
    expect(r2(foot(rpt(d, 'customer-balance-summary'), /Owing/))).toBe(custOwe);
    expect(r2(foot(rpt(d, 'receivable-statement'), /Balance/))).toBe(custOwe);
    expect(r2(foot(rpt(d, 'ap-aging-summary'), /Total/))).toBe(suppOwe);
    expect(r2(num((rpt(d, 'payable-summary').foot || [])[1]))).toBe(suppOwe);
    expect(r2(foot(rpt(d, 'ap-aging-details'), /Owing/))).toBe(suppOwe);
    expect(r2(foot(rpt(d, 'supplier-balance-summary'), /Owing/))).toBe(suppOwe);
    expect(r2(foot(rpt(d, 'payable-statement'), /Balance/))).toBe(suppOwe);
    const lb = ledgerBalances(d, 0, Number.MAX_SAFE_INTEGER, null);
    expect(r2(lb.get('n_ar') || 0)).toBe(custOwe);
    expect(r2(lb.get('n_ap') || 0)).toBe(suppOwe);
  });

  it('the trial balance balances and the balance sheet balances', () => {
    const tb = rpt(d, 'trial-balance');
    expect(r2(num(tb.foot![1]) - num(tb.foot![2]))).toBe(0);
    const bs = rpt(d, 'balance-sheet');
    const st = Object.fromEntries((bs.stats || []).map((s) => [s.k, Number(String(s.v).replace(/[^\d.-]/g, ''))]));
    expect(r2(st['Assets'])).toBe(r2(st['Liabilities + equity']));
    // debtors on the balance sheet are what customers owe
    expect(r2(num(row(bs, 'Accounts receivable')[2]))).toBe(custOwe);
  });

  it('sales: every sales report adds to the sales, and profit agrees with the profit and loss', () => {
    const sales = r2(d.sales.filter((s) => s.status !== 'void').reduce((a, s) => a + s.total, 0));
    expect(r2(foot(rpt(d, 'invoice-list'), /Total/))).toBe(sales);
    expect(r2(foot(rpt(d, 'sales-by-customer'), /Value/))).toBe(sales);
    expect(r2(foot(rpt(d, 'item-sales'), /Revenue/))).toBe(sales);
    expect(r2(foot(rpt(d, 'sales-by-category'), /Revenue/))).toBe(sales);
    expect(r2(foot(rpt(d, 'payment-types'), /Value/))).toBe(sales);
    const pnl = rpt(d, 'pnl');
    const gp = r2(Number(String((pnl.stats || []).find((s) => s.k === 'Gross profit')!.v)));
    expect(r2(foot(rpt(d, 'item-sales'), /Profit/))).toBeCloseTo(gp, 0);
    expect(r2(foot(rpt(d, 'profit-margin'), /Profit/))).toBeCloseTo(gp, 0);
    expect(r2(foot(rpt(d, 'bill-profit'), /Profit/))).toBeCloseTo(gp, 0);
  });

  it('money taken down on a credit sale is shown under how it was paid', () => {
    const pt = rpt(d, 'payment-types');
    expect(num(row(pt, 'Mobile money')[col(pt, /Value/)])).toBe(200);
  });

  it('purchases leave out the deleted bill', () => {
    expect(r2(foot(rpt(d, 'purchase-summary'), /Total/))).toBe(6500);
    expect(r2(foot(rpt(d, 'purchase-by-supplier'), /Spend/))).toBe(6500);
    expect(r2(foot(rpt(d, 'unpaid-purchases'), /Owing/))).toBe(0);
  });

  it('VAT is what the books hold', () => {
    const tx = rpt(d, 'tax-summary');
    const lb = ledgerBalances(d, 0, Number.MAX_SAFE_INTEGER, null);
    expect(r2(num(tx.foot![1]))).toBe(r2(lb.get('n_tax') || 0));
  });

  it('stock: on hand, movement and valuation agree with the inventory ledger', () => {
    const ss = rpt(d, 'stock-summary');
    const sm = rpt(d, 'stock-movement');
    for (const name of ['Widget A', 'Gadget B']) {
      expect([name, num(row(sm, name)[col(sm, /Closing/)])]).toEqual([name, num(row(ss, name)[col(ss, /On hand/)])]);
      const r = row(sm, name);
      expect([name, 'opening + in − out', num(r[1]) + num(r[2]) - num(r[3])]).toEqual([name, 'opening + in − out', num(r[4])]);
    }
    expect(num(row(sm, 'Widget A')[col(sm, /Stock In/)])).toBe(35);   // bought 35; the edit is not more stock in
    const lb = ledgerBalances(d, 0, Number.MAX_SAFE_INTEGER, null);
    expect(r2(foot(rpt(d, 'stock-valuation'), /Cost/))).toBe(r2(lb.get('n_inventory') || 0));
  });

  it('cash flow ends where each money account stands', () => {
    const cf = rpt(d, 'cash-flow');
    for (const a of d.accounts) expect([a.name, num(row(cf, a.name)[col(cf, /Balance/)])]).toEqual([a.name, r2(logic.cashOnHand(d, a.id))]);
  });

  it('a party changed from to pay to to receive shows so in every report', () => {
    const e = busyBook();
    e.parties[2].openingBalance = 8000;   // now Supp One owed us 8,000 when added
    const owe = -r2(logic.partyBalance(e, 's1'));
    expect(owe).toBe(-8000);
    expect(r2(foot(rpt(e, 'payable-statement'), /Balance/))).toBe(owe);
    expect(r2(foot(rpt(e, 'supplier-balance-summary'), /Owing/))).toBe(owe);
    expect(r2(foot(rpt(e, 'ap-aging-summary'), /Total/))).toBe(owe);
    const lb = ledgerBalances(e, 0, Number.MAX_SAFE_INTEGER, null);
    expect(r2(lb.get('n_ap') || 0)).toBe(owe);
    const tb = rpt(e, 'trial-balance');
    expect(r2(num(tb.foot![1]) - num(tb.foot![2]))).toBe(0);
  });
});
