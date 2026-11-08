/**
 * An item's transactions, as the computer shows them: one row per document.
 *
 * The movements underneath stay exactly as posted — a sale edited is still
 * "reversed and reposted" in the books, and an adjustment taken back still has
 * its reversal. But a person reading an item's history wants the documents:
 *
 *   - a sale (or bill) is one row with its net quantity, however many times it
 *     was edited — its void-and-repost movements net out inside it;
 *   - a sale or bill that was voided or deleted is not a transaction of the
 *     item any more: it is in Deleted transactions, not here;
 *   - an adjustment that was taken back, and the movement that took it back,
 *     are both gone from here (Deleted transactions holds the pair).
 *
 * Everything else (adjustments, transfers, stock takes, openings) is a row of
 * its own.
 */
import type { DB, Movement } from './types';

export interface HistoryRow {
  id: string;
  ts: string;
  qty: number;
  type: string;
  ref: string;
  /** The document the row opens, when it has one. */
  doc?: { kind: 'sale' | 'purchase'; id: string };
  /** The movement itself, for a row that is a single movement (an adjustment). */
  move?: Movement;
}

export function itemHistory(d: Pick<DB, 'sales' | 'purchases'>, productId: string, movements: Movement[]): HistoryRow[] {
  const mine = movements.filter((m) => m.productId === productId);
  /* adjustments taken back: the reversal names what it reverses */
  const reversed = new Set(mine.filter((m) => m.reverses).map((m) => m.reverses as string));
  const sales = new Map<string, DB['sales'][number]>();
  (d.sales || []).forEach((s) => { sales.set(s.no, s); sales.set(s.id, s); });
  const purchases = new Map<string, DB['purchases'][number]>();
  (d.purchases || []).forEach((p) => { purchases.set(p.no, p); purchases.set(p.id, p); });

  const groups = new Map<string, HistoryRow>();
  const rows: HistoryRow[] = [];
  for (const m of mine) {
    if (m.reverses || reversed.has(m.id)) continue;
    const sale = (m.type === 'sale' || m.type === 'void') && m.ref ? sales.get(m.ref) : undefined;
    const purchase = !sale && (m.type === 'purchase' || m.type === 'void') && m.ref ? purchases.get(m.ref) : undefined;
    if (sale || purchase) {
      const doc = (sale || purchase)!;
      if (doc.status === 'void' || (doc as { deletedAt?: string }).deletedAt) continue;
      const key = (sale ? 'sale:' : 'purchase:') + doc.id;
      const g = groups.get(key);
      if (g) {
        g.qty += m.qty;
        if (m.ts < g.ts) g.ts = m.ts;
      } else {
        groups.set(key, { id: m.id, ts: m.ts, qty: m.qty, type: sale ? 'sale' : 'purchase', ref: doc.no, doc: { kind: sale ? 'sale' : 'purchase', id: doc.id } });
      }
      continue;
    }
    rows.push({ id: m.id, ts: m.ts, qty: m.qty, type: m.type, ref: m.ref, move: m });
  }
  groups.forEach((g) => {
    g.qty = Math.round(g.qty * 1e6) / 1e6;
    if (Math.abs(g.qty) > 1e-9) rows.push(g);
  });
  return rows.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
}
