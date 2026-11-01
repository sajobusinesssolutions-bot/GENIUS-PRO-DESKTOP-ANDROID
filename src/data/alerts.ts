/**
 * What needs the owner's attention, worked out from the book: the bell's list
 * on the Notifications screen, and the notifications the phone puts in its
 * notification bar (notify.ts). One list, so the bar never says something the
 * screen does not.
 */
import type { DB, Product } from './types';
import { ageOfDays } from './helpers';
import { dueRecurring } from './logic';

export type AlertTone = 'warn' | 'danger' | 'accent';
export interface Alert {
  /** Stable per kind of alert: a notification is replaced, not repeated. */
  key: string;
  count: number;
  title: string;
  sub: string;
  route: string;
  tone: AlertTone;
}

const plural = (n: number, w: string) => n + ' ' + w + (n === 1 ? '' : 's');
const day = (d: Date) => d.toISOString().slice(0, 10);

export function alertsOf(db: DB, stockOf: (p: Product) => number, now = new Date()): Alert[] {
  const st = db.settings;
  const out: Alert[] = [];
  const low = st.lowStockAlerts === false || st.notifyLowStock === false
    ? [] : db.products.filter((p) => p.active && p.kind !== 'service' && stockOf(p) <= p.reorder);
  if (low.length) out.push({ key: 'restock', count: low.length, title: plural(low.length, 'item') + ' to restock', sub: 'At or below the reorder level', route: 'ItemsTab', tone: 'warn' });

  const overdue = st.notifyOverdue === false
    ? [] : db.sales.filter((s) => s.due > 0 && s.status !== 'void' && ageOfDays(s.ts) > 30);
  if (overdue.length) out.push({ key: 'overdue', count: overdue.length, title: plural(overdue.length, 'sale') + ' overdue', sub: 'Unpaid for more than 30 days', route: 'Sales', tone: 'danger' });

  const claims = (db.claims || []).filter((c) => c.status === 'open');
  if (claims.length) out.push({ key: 'claims', count: claims.length, title: plural(claims.length, 'warranty claim') + ' open', sub: 'Waiting on a decision', route: 'Warranties', tone: 'warn' });

  const due = dueRecurring(db, now);
  if (due.length) out.push({ key: 'recurring', count: due.length, title: plural(due.length, 'repeating sale') + ' due', sub: 'Ready to be raised', route: 'Recurring', tone: 'accent' });

  /* what comes round in the next seven days */
  const week = now.getTime() + 7 * 864e5;
  const soon = (db.recurringInvoices || []).filter((r) => r.active && new Date(r.nextDue).getTime() > now.getTime() && new Date(r.nextDue).getTime() <= week);
  if (soon.length) out.push({ key: 'recurring-soon', count: soon.length, title: plural(soon.length, 'repeating sale') + ' coming up', sub: 'In the next 7 days', route: 'Recurring', tone: 'accent' });

  /* quotations past their last day that never became a sale */
  const today = day(now);
  const expired = (db.estimates || []).filter((e) => e.status === 'open' && e.validUntil && String(e.validUntil).slice(0, 10) < today);
  if (expired.length) out.push({ key: 'quotes-expired', count: expired.length, title: plural(expired.length, 'quotation') + ' expired', sub: 'Past the valid-until date, not converted', route: 'Estimates', tone: 'warn' });

  return out;
}
