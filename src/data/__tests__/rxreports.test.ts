/**
 * Prescriptions reports (pharmacy): the details typed on a sale — doctor,
 * facility, where, diagnosis — counted the way the Windows till counts them.
 */
import { demoBook } from '../demos';
import { runReport, cellText } from '../reports';
import type { DB } from '../types';

function book(): DB {
  const db = demoBook('pharmacy');
  const rx = [['Malaria', 'Dr Okello'], ['malaria ', 'Dr Okello'], ['MALARIA', 'Dr Nansubuga'], ['Typhoid', 'Dr Okello'], ['Typhoid', 'Dr Nansubuga']];
  /* five sales of one medicine, each with its prescription */
  db.sales = rx.map(([diagnosis, prescriber], i) => ({
    id: 's' + i, no: 'INV-' + i, ts: new Date(2026, 9, 1 + i * 5).toISOString(), partyId: null, userId: 'u', till: 'T', warehouse: 'w',
    lines: [{ productId: 'p', name: 'Coartem', sku: 'C', unit: 'PC', qty: 1, price: 1000, cost: 600, taxRate: 0 }],
    discount: 0, redeemed: 0, gross: 1000, tax: 0, total: 1000, cogs: 600, method: 'cash', paid: 1000, paidAtSale: 1000, due: 0,
    status: 'complete', synced: true, fiscal: '', fdn: null,
    rx: { prescriber, diagnosis, facility: 'Mulago Hospital', location: 'Kampala', seenBy: 'Owner', seenAt: '' },
  })) as unknown as DB['sales'];
  return db;
}

it('a diagnosis typed three ways is one row', () => {
  const r = runReport(book(), 'rx-diagnosis', 0, 0, (n) => String(n));
  const mal = r.rows.find((x) => /^malaria$/i.test(cellText(x[0])));
  expect(mal).toBeDefined();
  expect(mal![1]).toBe(3);
  expect(r.stats![0].v).toBe('5');
});

it('doctors, facilities and the list follow the same prescriptions', () => {
  const db = book();
  const docs = runReport(db, 'rx-doctor', 0, 0, (n) => String(n));
  expect(docs.rows.find((x) => cellText(x[0]) === 'Dr Okello')![1]).toBe(3);
  const fac = runReport(db, 'rx-facility', 0, 0, (n) => String(n));
  expect(cellText(fac.rows[0][1])).toBe('Kampala');
  expect(fac.rows[0][2]).toBe(2);
  const list = runReport(db, 'rx-list', 0, 0, (n) => String(n));
  expect(list.rows.length).toBe(5);
  expect(list.rowRefs!.every((x) => x && x.kind === 'sale')).toBe(true);
  const meds = runReport(db, 'rx-medicines', 0, 0, (n) => String(n));
  expect(meds.rows.some((x) => /malaria/i.test(cellText(x[0])))).toBe(true);
});
