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
