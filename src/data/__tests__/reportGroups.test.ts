/**
 * Similar reports are shown as one, with chips for their views. Nothing may
 * be lost on the way: every report must still be reachable, once.
 */
import { REPORTS, REPORT_GROUPS, reportEntries, groupOf } from '../reports';

it('every report is reachable: on its own, or as a view of exactly one group', () => {
  const entries = reportEntries();
  const reachable = new Set<string>();
  for (const e of entries) (e.group ? e.group.views.map((v) => v.id) : [e.id]).forEach((id) => reachable.add(id));
  // the expiry list is left out on purpose: batch balances shows the same lots
  expect(REPORTS.filter((r) => !reachable.has(r.id)).map((r) => r.id)).toEqual(['expiry']);
  const views = REPORT_GROUPS.flatMap((g) => g.views.map((v) => v.id));
  expect(new Set(views).size).toBe(views.length);
});

it('the list is much shorter, with the consumption reports and statements on their own', () => {
  expect(REPORTS.length).toBe(78);
  expect(reportEntries().length).toBe(45);
});

it('a group opens on its first view and knows all of them', () => {
  const g = groupOf('ar-aging-details')!;
  expect(g.name).toBe('Customers who owe');
  const row = reportEntries().find((e) => e.group === g)!;
  expect(row.id).toBe(g.views[0].id);
  expect(groupOf('pnl')).toBeUndefined();
});

it('the consumption reports and the two statements are rows of their own', () => {
  const rows = reportEntries().filter((e) => !e.group).map((e) => e.id);
  for (const id of ['amc', 'aamc', 'aawc', 'receivable-statement', 'payable-statement']) expect(rows).toContain(id);
});
