/**
 * THE OWNER'S DAY IN A MESSAGE.
 *
 * Written when the day is closed, to send to the owner by WhatsApp, SMS or
 * email: what was taken and how, what was received and spent, how the drawers
 * counted, what sold best, and what needs attention tomorrow. Plain text, so
 * it reads the same in any messaging app.
 */
import type { DB } from './types';
import { editionOf } from './editions';

export function daySummary(d: DB, money: (n: number) => string, now = new Date()): string {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const inDay = (ts: string) => { const t = new Date(ts).getTime(); return t >= start.getTime() && t <= now.getTime(); };
  const sales = d.sales.filter((s) => s.status !== 'void' && inDay(s.ts));
  const total = sales.reduce((n, s) => n + s.total, 0);
  const by = (m: string) => sales.reduce((n, s) => n + (s.methods && s.methods.length > 1
    ? s.methods.filter((x) => x.method === m).reduce((a, x) => a + x.amount, 0)
    : s.method === m ? (m === 'credit' ? s.due : s.total) : 0), 0);
  const received = d.payments.filter((p) => p.direction === 'in' && inDay(p.ts)).reduce((n, p) => n + p.amount, 0);
  const spent = d.entries.filter((e) => e.direction === 'out' && inDay(e.ts)).reduce((n, e) => n + e.amount, 0)
    + d.payments.filter((p) => p.direction === 'out' && inDay(p.ts)).reduce((n, p) => n + p.amount, 0);
  const profit = sales.reduce((n, s) => n + (s.total - s.tax) - s.cogs, 0);

  // drawers closed today, and what they counted against what they should have held
  const shifts = d.shifts.filter((s) => s.closedAt && inDay(s.closedAt));
  const variance = shifts.reduce((n, s) => n + (s.variance ?? ((s.countedCash || 0) - (s.expected || 0))), 0);

  // best sellers
  const items = new Map<string, { qty: number; v: number }>();
  sales.forEach((s) => s.lines.forEach((l) => {
    const x = items.get(l.name) || { qty: 0, v: 0 };
    x.qty += l.qty; x.v += l.qty * l.price;
    items.set(l.name, x);
  }));
  const top = [...items.entries()].sort((a, b) => b[1].v - a[1].v).slice(0, 5);

  const lines: string[] = [];
  lines.push('*' + d.firm.name + ' — ' + now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) + '*');
  lines.push('');
  lines.push('Sales: ' + money(total) + ' (' + sales.length + ' bill' + (sales.length === 1 ? '' : 's') + ')');
  const methods = [['Cash', by('cash')], ['Mobile money', by('momo')], ['Bank / card', by('bank')], ['On credit', by('credit')]].filter(([, v]) => (v as number) > 0);
  methods.forEach(([k, v]) => lines.push('  • ' + k + ': ' + money(v as number)));
  if (received) lines.push('Money received on debts: ' + money(received));
  if (spent) lines.push('Paid out and expenses: ' + money(spent));
  lines.push('Gross profit: ' + money(profit));
  if (shifts.length) {
    lines.push('Drawers: ' + shifts.length + ' closed · ' + (Math.abs(variance) < 1 ? 'balanced' : variance < 0 ? 'SHORT ' + money(-variance) : 'over ' + money(variance)));
  }
  if (top.length) {
    lines.push('');
    lines.push('Best sellers:');
    top.forEach(([n, x], i) => lines.push('  ' + (i + 1) + '. ' + n + ' — ' + x.qty + ' · ' + money(x.v)));
  }

  // what needs attention tomorrow
  const watch: string[] = [];
  const ed = editionOf(d);
  if (ed === 'pharmacy') {
    const soon = now.getTime() + 30 * 864e5;
    const lots = d.products.flatMap((p) => (p.batches || []).filter((b) => b.qty > 0 && b.expiry && new Date(b.expiry).getTime() <= soon).map((b) => p.name + ' (' + b.no + ')'));
    if (lots.length) watch.push(lots.length + ' batch(es) expire within 30 days: ' + lots.slice(0, 4).join(', ') + (lots.length > 4 ? '…' : ''));
  }
  if (ed === 'restaurant') {
    const cancelled = (d.tickets || []).filter((t) => t.status === 'void' && inDay(t.updatedAt));
    if (cancelled.length) watch.push(cancelled.length + ' ticket(s) cancelled today');
  }
  const low = d.products.filter((p) => p.active !== false && p.kind !== 'service' && p.trackInventory !== false && p.reorder > 0
    && Object.values(p.stock || {}).reduce((n, v) => n + (v || 0), 0) <= p.reorder);
  if (low.length) watch.push(low.length + ' item(s) at or below reorder: ' + low.slice(0, 4).map((p) => p.name).join(', ') + (low.length > 4 ? '…' : ''));
  const owed = d.sales.filter((s) => s.status !== 'void' && s.due > 0).reduce((n, s) => n + s.due, 0);
  if (owed) watch.push('Customers owe ' + money(owed) + ' in all');
  if (watch.length) {
    lines.push('');
    lines.push('To watch:');
    watch.forEach((w) => lines.push('  • ' + w));
  }
  lines.push('');
  lines.push('— Genius Pro');
  return lines.join('\n');
}
