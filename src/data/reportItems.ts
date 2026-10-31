/**
 * "Item details" in an export: under each sale, bill, quotation or return in
 * a report, the lines that were on it — what, how many, at what price. Works
 * for any report whose rows point at a document (sales register, day book,
 * sales by customer, staff sales, profit, refunds, voided sales, purchases,
 * quotations, payables, statements…), so there is one switch, not one per report.
 */
import type { DB } from './types';
import type { ReportResult, RowRef } from './reports';

type Line = { name: string; qty: number; unit?: string; price: number };

/** The lines of the document a row points at, if it is one that has lines. */
export function linesOf(db: DB, ref: RowRef | null | undefined, range?: { from: number; to: number }): Line[] {
  if (!ref) return [];
  // a customer or a cashier: everything sold in the range, added up by item
  if ((ref.kind === 'party' || ref.kind === 'user') && range) {
    const by = new Map<string, Line>();
    db.sales.forEach((s) => {
      if (s.status === 'void' || (ref.kind === 'party' ? s.partyId : s.userId) !== ref.id) return;
      const t = new Date(s.ts).getTime();
      if (t < range.from || t > range.to) return;
      s.lines.forEach((l) => {
        const k = l.productId + '|' + l.price;
        const x = by.get(k) || { name: l.name, qty: 0, unit: l.unit, price: l.price };
        x.qty += l.qty; by.set(k, x);
      });
    });
    return [...by.values()].sort((a, b) => b.qty * b.price - a.qty * a.price);
  }
  const name = (id: string) => db.products.find((p) => p.id === id)?.name || 'Item';
  if (ref.kind === 'sale') return (db.sales.find((x) => x.id === ref.id)?.lines || []).map((l) => ({ name: l.name, qty: l.qty, unit: l.unit, price: l.price }));
  if (ref.kind === 'purchase') return (db.purchases.find((x) => x.id === ref.id)?.lines || []).map((l) => ({ name: name(l.productId), qty: l.qty, price: l.cost }));
  if (ref.kind === 'estimate') return ((db.estimates || []).find((x) => x.id === ref.id)?.lines || []).map((l: any) => ({ name: l.name || name(l.productId), qty: l.qty, unit: l.unit, price: l.price }));
  if (ref.kind === 'creditNote') return ((db.creditNotes || []).find((x) => x.id === ref.id)?.lines || []).map((l) => ({ name: l.name, qty: l.qty, price: l.price }));
  if (ref.kind === 'voucher') {
    // a day-book row is a journal entry: its number is the sale's or the bill's
    const j = db.journal.find((x) => x.id === ref.id);
    const s = j && db.sales.find((x) => x.no === j.ref);
    if (s) return linesOf(db, { kind: 'sale', id: s.id });
    const p = j && db.purchases.find((x) => x.no === j.ref || x.ref === j.ref);
    if (p) return linesOf(db, { kind: 'purchase', id: p.id });
  }
  return [];
}

/** The report with each document's lines written under its row. */
export function withItemDetails(db: DB, result: ReportResult, fmt: (n: number) => string, range?: { from: number; to: number }): ReportResult {
  const refs = result.rowRefs;
  if (!refs || !refs.length) return result;
  const width = result.cols.length;
  const rows: ReportResult['rows'] = [];
  const outRefs: (RowRef | null)[] = [];
  const kinds = result.rowKinds ? [] as NonNullable<ReportResult['rowKinds']> : undefined;
  result.rows.forEach((row, i) => {
    rows.push(row); outRefs.push(refs[i] ?? null);
    if (kinds) kinds.push(result.rowKinds![i]);
    for (const l of linesOf(db, refs[i], range)) {
      const q = Number.isInteger(l.qty) ? String(l.qty) : l.qty.toFixed(2);
      const text = '    • ' + l.name + ' — ' + q + (l.unit ? ' ' + l.unit : '') + ' × ' + fmt(l.price) + ' = ' + fmt(l.qty * l.price);
      rows.push([{ text, tone: 'muted' }, ...Array(Math.max(0, width - 1)).fill('')]);
      outRefs.push(null);
      if (kinds) kinds.push('line');
    }
  });
  return { ...result, rows, rowRefs: outRefs, ...(kinds ? { rowKinds: kinds } : {}) };
}

/** Whether a report has any rows that would gain item details. */
export function hasItemDetails(db: DB, result: ReportResult, range?: { from: number; to: number }): boolean {
  return !!result.rowRefs?.some((r) => linesOf(db, r, range).length);
}
