import { daySummary } from '../daySummary';

const money = (n: number) => 'UGX ' + Math.round(n).toLocaleString('en-US');

it("writes the owner's day: takings by method, best sellers and what to watch", () => {
  const now = new Date();
  const d: any = {
    firm: { name: 'Corner Shop', businessType: 'retail' },
    sales: [
      { status: 'complete', ts: now.toISOString(), total: 30000, tax: 0, cogs: 18000, method: 'cash', due: 0, lines: [{ name: 'Sugar', qty: 3, price: 10000 }] },
      { status: 'complete', ts: now.toISOString(), total: 20000, tax: 0, cogs: 12000, method: 'credit', due: 20000, lines: [{ name: 'Rice', qty: 1, price: 20000 }] },
      { status: 'void', ts: now.toISOString(), total: 99999, tax: 0, cogs: 0, method: 'cash', due: 0, lines: [] },
    ],
    payments: [{ direction: 'in', ts: now.toISOString(), amount: 5000 }],
    entries: [{ direction: 'out', ts: now.toISOString(), amount: 2000 }],
    shifts: [{ closedAt: now.toISOString(), variance: -1500 }],
    products: [{ name: 'Salt', active: true, trackInventory: true, reorder: 5, stock: { w1: 2 } }],
    tickets: [],
  };
  const text = daySummary(d, money, now);
  expect(text).toContain('Sales: UGX 50,000 (2 bills)');
  expect(text).toContain('Cash: UGX 30,000');
  expect(text).toContain('On credit: UGX 20,000');
  expect(text).toContain('Money received on debts: UGX 5,000');
  expect(text).toContain('SHORT UGX 1,500');
  expect(text).toContain('1. Sugar');
  expect(text).toContain('Salt');
  expect(text).not.toContain('99,999');
});

it('adds the financial report from the books, and flags expired and expiring batches', () => {
  const now = new Date();
  const day = (n: number) => new Date(now.getTime() + n * 864e5).toISOString().slice(0, 10);
  const d: any = {
    firm: { name: 'Corner Shop', businessType: 'retail' },
    sales: [], payments: [], entries: [], shifts: [], tickets: [],
    accounts: [{ id: 'acc_cash', name: 'Cash' }],
    coa: [
      { id: 'acc_cash', name: 'Cash', type: 'asset' }, { id: 'n_ar', name: 'Accounts receivable', type: 'asset' },
      { id: 'n_ap', name: 'Accounts payable', type: 'liability' }, { id: 'n_sales', name: 'Sales', type: 'income' },
      { id: 'n_cogs', name: 'Cost of goods sold', type: 'expense' }, { id: 'n_expense', name: 'Expenses', type: 'expense' },
    ],
    journal: [
      { id: 'j1', ts: now.toISOString(), memo: '', ref: '', balanced: true, lines: [{ acc: 'acc_cash', dr: 80000 }, { acc: 'n_ar', dr: 20000 }, { acc: 'n_sales', cr: 100000 }] },
      { id: 'j2', ts: now.toISOString(), memo: '', ref: '', balanced: true, lines: [{ acc: 'n_cogs', dr: 60000 }, { acc: 'n_ap', cr: 60000 }] },
      { id: 'j3', ts: now.toISOString(), memo: '', ref: '', balanced: true, lines: [{ acc: 'n_expense', dr: 15000 }, { acc: 'acc_cash', cr: 15000 }] },
    ],
    products: [{ name: 'Milk', active: true, trackInventory: true, reorder: 0, stock: { w1: 9 }, batches: [
      { no: 'B1', qty: 4, expiry: day(-2) }, { no: 'B2', qty: 5, expiry: day(10) }, { no: 'B3', qty: 3, expiry: day(90) },
    ] }],
  };
  const text = daySummary(d, money, now);
  expect(text).toContain('Financial report');
  expect(text).toContain('Income: UGX 100,000');
  expect(text).toContain('Gross profit: UGX 40,000');
  expect(text).toContain('Expenses: UGX 15,000');
  expect(text).toContain('Net profit: UGX 25,000');
  expect(text).toContain('Cash: UGX 65,000');
  expect(text).toContain('Customers owe you: UGX 20,000');
  expect(text).toContain('You owe suppliers: UGX 60,000');
  expect(text).toMatch(/1 EXPIRED batch\(es\) still in stock: Milk \(B1/);
  expect(text).toMatch(/1 batch\(es\) expire within 30 days: Milk \(B2/);
  expect(text).not.toContain('B3');
});
