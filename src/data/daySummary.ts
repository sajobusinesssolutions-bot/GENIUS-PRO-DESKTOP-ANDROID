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
import { ledgerBalances } from './coa';

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

  // the money position: this month so far, and what is held, owed and owing now
  lines.push('');
  lines.push('*Financial report*');
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const coa = d.coa || [];
  const month = ledgerBalances(d, monthStart, now.getTime());
  const sumType = (type: string, skip: string[] = []) => coa.filter((l) => l.type === type && !skip.includes(l.id)).reduce((n, l) => n + (month.get(l.id) || 0), 0);
  const income = sumType('income');
  const cogs = month.get('n_cogs') || 0;
  const expenses = sumType('expense', ['n_cogs']);
  lines.push(now.toLocaleDateString('en-GB', { month: 'long' }) + ' so far:');
  lines.push('  • Income: ' + money(income));
  lines.push('  • Cost of goods sold: ' + money(cogs));
  lines.push('  • Gross profit: ' + money(income - cogs));
  lines.push('  • Expenses: ' + money(expenses));
  lines.push('  • Net profit: ' + (income - cogs - expenses < 0 ? '−' : '') + money(Math.abs(income - cogs - expenses)));
  const all = ledgerBalances(d, 0, now.getTime());
  const moneyIds = new Set((d.accounts || []).map((x) => x.id));
  const held = coa.filter((l) => moneyIds.has(l.id));
  const heldLines = held.map((l) => [l.name, all.get(l.id) || 0] as const).filter(([, v]) => Math.abs(v) >= 1);
  if (heldLines.length) {
    lines.push('Money held now:');
    heldLines.forEach(([n, v]) => lines.push('  • ' + n + ': ' + (v < 0 ? '−' : '') + money(Math.abs(v))));
  }
  const ar = all.get('n_ar') || 0;
  const ap = all.get('n_ap') || 0;
  const stockValue = all.get('n_inventory') || 0;
  if (ar) lines.push('Customers owe you: ' + money(ar));
  if (ap) lines.push('You owe suppliers: ' + money(ap));
  if (stockValue) lines.push('Stock at cost: ' + money(stockValue));

  // what needs attention tomorrow
  const watch: string[] = [];
  const ed = editionOf(d);
  // anything with batches: expired and still on the shelf, or expiring within 30 days
  {
    const soon = now.getTime() + 30 * 864e5;
    const lots = d.products.filter((p) => p.active !== false).flatMap((p) => (p.batches || [])
      .filter((b) => b.qty > 0 && b.expiry && new Date(b.expiry).getTime() <= soon)
      .map((b) => ({ name: p.name + ' (' + b.no + ', ' + new Date(b.expiry!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ')', gone: new Date(b.expiry!).getTime() < now.getTime() })));
    const gone = lots.filter((x) => x.gone);
    const near = lots.filter((x) => !x.gone);
    if (gone.length) watch.push(gone.length + ' EXPIRED batch(es) still in stock: ' + gone.slice(0, 4).map((x) => x.name).join(', ') + (gone.length > 4 ? '…' : ''));
    if (near.length) watch.push(near.length + ' batch(es) expire within 30 days: ' + near.slice(0, 4).map((x) => x.name).join(', ') + (near.length > 4 ? '…' : ''));
  }
  if (ed === 'restaurant') {
    const cancelled = (d.tickets || []).filter((t) => t.status === 'void' && inDay(t.updatedAt));
    if (cancelled.length) watch.push(cancelled.length + ' ticket(s) cancelled today');
  }
  const low = d.products.filter((p) => p.active !== false && p.kind !== 'service' && p.trackInventory !== false && p.reorder > 0
    && Object.values(p.stock || {}).reduce((n, v) => n + (v || 0), 0) <= p.reorder);
  if (low.length) watch.push(low.length + ' item(s) at or below reorder: ' + low.slice(0, 4).map((p) => p.name).join(', ') + (low.length > 4 ? '…' : ''));
  if (watch.length) {
    lines.push('');
    lines.push('To watch:');
    watch.forEach((w) => lines.push('  • ' + w));
  }
  lines.push('');
  lines.push('— Genius Pro');
  return lines.join('\n');
}
