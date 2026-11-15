/**
 * How slow a big pharmacy book is: every report, the party balances, and a
 * sale, timed on a book like a busy pharmacy's (1,000 customers, 600 items
 * kept in batches, many thousands of sales, credit, payments and returns).
 * Off by default (it takes a while): PERF=1 npx jest pharmacy.perf
 * PERF_SALES sets how many sales (default 12,000).
 */
import { demoBook } from '../demos';
import { migrate } from '../storage';
import * as logic from '../logic';
import { REPORTS, runReport } from '../reports';
import type { DB, SaleLine } from '../types';

const on = !!process.env.PERF;
const t = on ? it : it.skip;
const json = (d: unknown) => JSON.parse(JSON.stringify(d));

export function bigPharmacy(nSales = Number(process.env.PERF_SALES || 12000)): DB {
  const d = migrate(json(demoBook('pharmacy'))) as DB;
  d.session.role = 'owner';
  const wh = d.session.warehouse || d.warehouses[0].id;
  // 600 items in batches, 3 lots each
  const base = d.products[0];
  for (let i = 0; i < 600; i++) {
    d.products.push({ ...json(base), id: 'pp' + i, name: 'Medicine ' + String(i).padStart(3, '0'), sku: 'M' + i, trackBatches: true, price: 1000 + i * 10, cost: 600 + i * 6,
      stock: { [wh]: 3000 }, batches: [0, 1, 2].map((b) => ({ no: `B${i}-${b}`, expiry: new Date(Date.now() + (b * 200 - 100) * 864e5).toISOString().slice(0, 10), qty: 1000 })) });
  }
  for (let i = 0; i < 1000; i++) d.parties.push({ ...json(d.parties.find((p) => p.type === 'customer') || {}), id: 'cu' + i, name: 'Customer ' + String(i).padStart(4, '0'), type: 'customer', openingBalance: i % 7 ? 0 : 50000, active: true, phone: '' } as any);
  const items = d.products.filter((p) => p.id.startsWith('pp'));
  const t0 = Date.now();
  for (let i = 0; i < nSales; i++) {
    const p = items[(i * 7) % items.length], q = items[(i * 13) % items.length];
    const lines = [p, q].map((x) => ({ productId: x.id, name: x.name, sku: x.sku, unit: x.unit, qty: 1, price: x.price, cost: x.cost, taxRate: 0 } as SaleLine));
    const credit = i % 3 === 0;
    logic.commitSale(d, { lines, partyId: credit || i % 5 === 0 ? 'cu' + (i % 1000) : null, method: credit ? 'credit' : 'cash', discount: 0, ts: new Date(Date.now() - (nSales - i) * 60000 * 12).toISOString() });
  }
  const acc = (d.accounts || [])[0];
  for (let i = 0; i < nSales / 6; i++) {
    try { logic.recordPayment(d, { partyId: 'cu' + (i % 1000), amount: 1500, direction: 'in', accountId: acc ? acc.id : 'cash' }); } catch { /* nothing owed */ }
  }
  // eslint-disable-next-line no-console
  console.log(`book: ${d.sales.length} sales, ${d.payments.length} payments, ${d.parties.length} parties, ${d.products.length} items, built in ${Date.now() - t0} ms`);
  return d;
}

describe('a big pharmacy book', () => {
  t('every report, the balances and a sale, timed', () => {
    const d = bigPharmacy();
    const now = Date.now(), from = now - 365 * 864e5;
    const times: [string, number][] = [];
    for (const r of REPORTS) {
      const a = Date.now();
      runReport(d, r.id, from, now);
      times.push([r.id, Date.now() - a]);
    }
    times.sort((a, b) => b[1] - a[1]);
    let a = Date.now(); logic.allPartyBalances({ ...d } as DB); const bal = Date.now() - a;
    const p = d.products.find((x) => x.id === 'pp1')!;
    a = Date.now(); logic.commitSale(d, { lines: [{ productId: p.id, name: p.name, sku: p.sku, unit: p.unit, qty: 1, price: p.price, cost: p.cost, taxRate: 0 } as SaleLine], partyId: 'cu1', method: 'credit', discount: 0 }); const sale = Date.now() - a;
    // eslint-disable-next-line no-console
    console.log(['slowest reports (ms):', ...times.slice(0, 25).map(([id, ms]) => `  ${id}: ${ms}`), `all reports: ${times.reduce((s, x) => s + x[1], 0)} ms`, `all party balances: ${bal} ms`, `one sale: ${sale} ms`].join('\n'));
    expect(times.length).toBeGreaterThan(50);
  });
});
