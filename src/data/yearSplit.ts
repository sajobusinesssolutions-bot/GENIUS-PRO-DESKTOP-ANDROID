/**
 * yearSplit.ts — closing a financial year and splitting the book at its last
 * day: the phone's side of the PC's accounting/yearsplit.js.
 *
 * Everything dated on or before the day leaves this book; what was carried
 * comes back as openings on the next day, so every figure stands:
 *   · each ledger (cash, bank, stock, debtors, tax…): one opening journal
 *     entry holding exactly what the removed entries added up to, with the
 *     year's income and expenses closed into retained earnings;
 *   · each customer and supplier: their opening balance becomes what they
 *     owed on the day (the parties' opening entry follows it, and the opening
 *     journal leaves out what that entry now carries);
 *   · stock: the quantities on each product and batch are kept as they are
 *     (they are held on the product, not added up from movements); an
 *     opening movement per product, shelf and batch records what was there.
 *
 * The closed year itself is kept as a business of its own on the account (the
 * device closing it sends that book up first); this book only loses it.
 */
import type { DB, JournalEntry, JournalLine, Movement } from './types';
import { partyBalance, cents, audit } from './logic';
import { partyOpeningEntry } from './branch';
import { ensureCoa } from './coa';
import { uid, iso } from './uid';
import { Refusal } from './refusal';

export const RETAINED_ID = 'n_retained';

/** The local day (YYYY-MM-DD) a stamp falls on — the day the shop saw. */
export function dayOf(ts: string | undefined | null): string {
  if (!ts) return '';
  const t = new Date(ts);
  if (isNaN(t.getTime())) return String(ts).slice(0, 10);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

export function nextDay(day: string): string {
  const t = new Date(day + 'T12:00:00');
  t.setDate(t.getDate() + 1);
  return dayOf(t.toISOString());
}

export interface YearSplitResult {
  to: string;
  opens: string;
  removed: Record<string, number>;
  openingLines: number;
  partiesCarried: number;
}

/** What closing to `to` would move out of the book, for the screen. */
export function previewYearSplit(d: DB, to: string) {
  const n = (list: Array<{ ts?: string }> | undefined) => (list || []).filter((x) => dayOf(x.ts) <= to).length;
  return {
    to, opens: nextDay(to),
    sales: n(d.sales), purchases: n(d.purchases), payments: n(d.payments), entries: n(d.entries),
    returns: n(d.creditNotes), journal: n(d.journal),
    closedTo: d.settings.yearClosedTo || null,
  };
}

/**
 * Close the year to `to` (YYYY-MM-DD) and split the book there. The waiting
 * changes must have gone first; the caller saves and sends the new book.
 */
export function splitYear(d: DB, to: string, now = new Date()): YearSplitResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Refusal('Choose the last day of the year');
  if (to >= dayOf(now.toISOString())) throw new Refusal('A year can only be closed once it has ended');
  if (d.settings.yearClosedTo && d.settings.yearClosedTo >= to) throw new Refusal('The books are already closed to ' + d.settings.yearClosedTo);
  if (d.settings.yearArchiveOf) throw new Refusal('This is a closed year kept for reference', 'It cannot be closed again.');
  ensureCoa(d);   // the ledger types say which are income and expenses
  const opens = nextDay(to);
  const openTs = new Date(opens + 'T00:00:00').toISOString();
  const old = (ts?: string | null) => !!ts && dayOf(ts) <= to;

  /* what each party owes now, and the parties' opening entry as it stands */
  const before = new Map(d.parties.map((p) => [p.id, partyBalance(d, p.id)]));
  const virtualBefore = partyOpeningEntry(d);

  /* stock on the day, per product, shelf and batch: what is there now less what moved after */
  const after = new Map<string, number>();
  (d.movements || []).forEach((m) => {
    if (old(m.ts)) return;
    const k = m.productId + '|' + m.wh + '|' + (m.batchNo || '');
    after.set(k, (after.get(k) || 0) + m.qty);
  });

  /* the removed journal entries, added up per ledger and branch */
  const carried = new Map<string, number>();   // branch|acc → dr − cr
  const removedJournal = (d.journal || []).filter((e) => old(e.ts));
  removedJournal.forEach((e) => e.lines.forEach((l: JournalLine) => {
    const k = (e.branch || '') + '|' + l.acc;
    carried.set(k, (carried.get(k) || 0) + (l.dr || 0) - (l.cr || 0));
  }));

  /* the documents of the closed year leave the book */
  const removed: Record<string, number> = {};
  const drop = <K extends keyof DB>(key: K, keep: (x: any) => boolean) => {
    const list = (d as any)[key] as any[] | undefined;
    if (!Array.isArray(list)) return;
    const next = list.filter(keep);
    removed[String(key)] = list.length - next.length;
    (d as any)[key] = next;
  };
  drop('sales', (s) => !old(s.ts));
  drop('purchases', (p) => !old(p.ts));
  drop('payments', (p) => !old(p.ts));
  drop('entries', (e) => !old(e.ts));
  drop('creditNotes', (c) => !old(c.ts));
  drop('journal', (e) => !old(e.ts));
  drop('movements', (m) => !old(m.ts));
  drop('shifts', (s) => !(s.closedAt && old(s.openedAt)));
  drop('estimates', (e) => e.status === 'open' || !old(e.ts));
  drop('challans', (c) => !old(c.ts));
  drop('stockTakes', (s) => s.status === 'open' || !old(s.ts));
  drop('productionRuns', (r) => !old(r.ts));
  drop('deletedPayments', (p) => !old(p.ts || p.payment?.ts));
  drop('revisions', (r) => !old(r.ts));

  /* each party: the opening balance that keeps what they owe exactly as it was */
  let partiesCarried = 0;
  d.parties.forEach((p) => {
    const now2 = partyBalance(d, p.id);
    const v = cents((p.openingBalance || 0) + (before.get(p.id) || 0) - now2);
    if (Math.abs(v - (p.openingBalance || 0)) > 0.004) p.openingBalance = v;
    if (Math.abs(v) > 0.004) partiesCarried++;
  });
  /* what the parties' opening entry now carries on top of what it did */
  const virtualAfter = partyOpeningEntry(d);
  const shift = new Map<string, number>();
  const addEntry = (e: JournalEntry | null, sign: number) => e && e.lines.forEach((l) => shift.set(l.acc, (shift.get(l.acc) || 0) + sign * ((l.dr || 0) - (l.cr || 0))));
  addEntry(virtualAfter, 1);
  addEntry(virtualBefore, -1);

  /* the year's income and expenses into retained earnings */
  const coa = d.coa || [];
  const typeOf = new Map(coa.map((l) => [l.id, l.type]));
  if (!coa.some((l) => l.id === RETAINED_ID)) {
    coa.push({ id: RETAINED_ID, code: '3100', name: 'Retained earnings', type: 'equity' } as any);
    d.coa = coa;
  }
  const byBranch = new Map<string, Map<string, number>>();
  const put = (branch: string, acc: string, v: number) => {
    const m = byBranch.get(branch) || new Map<string, number>();
    m.set(acc, (m.get(acc) || 0) + v);
    byBranch.set(branch, m);
  };
  carried.forEach((v, k) => {
    const [branch, acc] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)];
    const t = typeOf.get(acc);
    put(branch, t === 'income' || t === 'expense' ? RETAINED_ID : acc, v);
  });
  /* the parties' entry has no branch: the difference it now carries comes off the unbranched opening */
  shift.forEach((v, acc) => put('', acc, -v));

  let openingLines = 0;
  byBranch.forEach((m, branch) => {
    const lines: JournalLine[] = [];
    m.forEach((v, acc) => { const c = cents(v); if (Math.abs(c) >= 0.005) lines.push(c > 0 ? { acc, dr: c } : { acc, cr: -c }); });
    if (!lines.length) return;
    let dr = 0, cr = 0;
    lines.forEach((l) => { dr = cents(dr + (l.dr || 0)); cr = cents(cr + (l.cr || 0)); });
    const gap = cents(dr - cr);
    if (gap) lines.push(gap > 0 ? { acc: RETAINED_ID, cr: gap } : { acc: RETAINED_ID, dr: -gap });
    const e: JournalEntry = {
      id: uid('jnl'), ts: openTs, memo: 'Opening balances brought forward from the year closed to ' + to, ref: 'OPENING ' + opens,
      lines, balanced: true, ...(branch ? { branch } : {}),
    };
    d.journal.unshift(e);
    openingLines += lines.length;
  });

  /* what was on each shelf on the day, as an opening movement (the quantities themselves stay on the products) */
  const opening: Movement[] = [];
  d.products.forEach((p) => {
    const shelves = Object.keys(p.stock || {});
    shelves.forEach((wh) => {
      const batches = (p.batches || []).filter((b: any) => !b.wh || b.wh === wh);
      const parts: Array<[string, number]> = batches.length
        ? batches.map((b: any) => [b.no, (b.qty || 0) - (after.get(p.id + '|' + wh + '|' + b.no) || 0)])
        : [['', (p.stock[wh] || 0) - (after.get(p.id + '|' + wh + '|') || 0)]];
      parts.forEach(([batchNo, qty]) => {
        if (Math.abs(qty) < 0.00005) return;
        opening.push({ id: uid('mv'), ts: openTs, productId: p.id, wh, qty, type: 'opening', ref: 'OPENING ' + opens, ...(batchNo ? { batchNo } : {}) } as Movement);
      });
    });
  });
  d.movements = [...opening, ...(d.movements || [])];

  d.settings.yearClosedTo = to;
  d.financialYear = { start: openTs, openedAt: iso(now), previousStart: d.financialYear?.start };
  audit(d, 'Year closed and split', 'To ' + to + ' · ' + openingLines + ' opening line(s) · ' + partiesCarried + ' part' + (partiesCarried === 1 ? 'y' : 'ies') + ' carried');
  return { to, opens, removed, openingLines, partiesCarried };
}

/**
 * The closed year's own copy: the book as it stood, with everything after the
 * day taken out. Sent up as the closed year's business; never changed again.
 */
export function closedYearCopy(d: DB, to: string): DB {
  const c: DB = JSON.parse(JSON.stringify(d));
  const late = (ts?: string | null) => !!ts && dayOf(ts) > to;
  /* stock as it stood on the day: the movements after it taken back off */
  (c.movements || []).forEach((m) => {
    if (!late(m.ts)) return;
    const p = c.products.find((x) => x.id === m.productId);
    if (!p) return;
    p.stock[m.wh] = (p.stock[m.wh] || 0) - m.qty;
    if (m.batchNo && p.batches) { const b = p.batches.find((x: any) => x.no === m.batchNo); if (b) b.qty -= m.qty; }
  });
  /* money paid after the day against the year's bills: back on the bills, as they stood */
  const latePay = new Set((c.payments || []).filter((p) => late(p.ts)).map((p) => p.id));
  for (const bill of [...(c.sales || []), ...(c.purchases || [])] as any[]) {
    if (late(bill.ts) || !Array.isArray(bill.receipts)) continue;
    const back = bill.receipts.filter((r: any) => latePay.has(r.paymentId)).reduce((a: number, r: any) => a + (Number(r.amount) || 0), 0);
    if (!back) continue;
    bill.receipts = bill.receipts.filter((r: any) => !latePay.has(r.paymentId));
    bill.paid = cents((bill.paid || 0) - back);
    bill.due = cents((bill.due || 0) + back);
  }
  const keep = (key: string, f: (x: any) => boolean) => { const l = (c as any)[key]; if (Array.isArray(l)) (c as any)[key] = l.filter(f); };
  for (const k of ['sales', 'purchases', 'payments', 'entries', 'creditNotes', 'journal', 'movements', 'estimates', 'challans', 'stockTakes', 'productionRuns', 'revisions']) keep(k, (x) => !late(x.ts));
  keep('shifts', (s) => !late(s.openedAt));
  c.queue = [];
  c.settings = { ...c.settings, yearArchiveOf: 'self', yearArchiveTo: to, closedThrough: '9999-12-31' } as any;
  return c;
}
