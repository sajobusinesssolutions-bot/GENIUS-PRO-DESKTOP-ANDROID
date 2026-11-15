/**
 * Similar reports are shown as one, with chips for their views. Nothing may
 * be lost on the way: every report still runs by its id (links, favourites,
 * the computer's matching reports), and the ones left out of the list say
 * the same as a view that is in it.
 */
import { REPORTS, REPORT_GROUPS, reportEntries, groupOf } from '../reports';

it('every report is reachable, or left out on purpose because a view shows the same', () => {
  const entries = reportEntries();
  const reachable = new Set<string>();
  for (const e of entries) (e.group ? e.group.views.map((v) => v.id) : [e.id]).forEach((id) => reachable.add(id));
  // the expiry list is the batches report in another order; the sales register opens on the bill list;
  // the debtors (creditors) book, oldest-first, unpaid and second ageing views are inside Customer (Supplier) statements → Ageing
  expect(REPORTS.filter((r) => !reachable.has(r.id)).map((r) => r.id).sort()).toEqual([
    'ap-aging-details', 'ar-aging-details', 'expiry', 'payable-details', 'payable-summary', 'receivable-details', 'receivable-summary', 'sale-summary', 'unpaid-purchases', 'unpaid-sales',
  ]);
  const views = REPORT_GROUPS.flatMap((g) => g.views.map((v) => v.id));
  expect(new Set(views).size).toBe(views.length);
});

it('the list is short, and in A–Z order', () => {
  expect(REPORTS.length).toBe(96);
  const names = reportEntries().map((e) => e.name);
  expect(names.length).toBe(57);
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
});

it('customer statements open on the balances, then ageing, then the statement', () => {
  const g = groupOf('customer-balance-summary')!;
  expect(g.name).toBe('Customer statements');
  expect(g.views.map((v) => v.label)).toEqual(['Balances', 'Ageing', 'Statement']);
  const row = reportEntries().find((e) => e.group === g)!;
  expect(row.id).toBe('customer-balance-summary');
  expect(groupOf('supplier-balance-summary')!.name).toBe('Supplier statements');
  expect(groupOf('pnl')).toBeUndefined();
});

it('the consumption reports are rows of their own', () => {
  const rows = reportEntries().filter((e) => !e.group).map((e) => e.id);
  for (const id of ['amc', 'aamc', 'aawc']) expect(rows).toContain(id);
});
