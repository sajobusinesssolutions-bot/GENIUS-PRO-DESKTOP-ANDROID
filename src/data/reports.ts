/**
 * The report engine — pure functions over a plain DB object, no React.
 *
 * Reference: the prototype's `REPORTS` catalogue (line 3359) and the `RPT`
 * map of builders (3457 onward), driven by `runReport(id, from, to)` (4121).
 * The prototype returned HTML; here every report returns a `ReportResult` so
 * one renderer (ReportDetailScreen) and one exporter set can serve all of them.
 */
import { DB, Sale, SaleLine, Product, Offer, CreditNoteLine } from './types';
import { money0, fmtDay, startOfDay, endOfDay, daysAgo } from './helpers';
import { shiftTotals, stockOfImpl, partyBalance } from './logic';

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

export type ReportCategory =
  | 'Sales' | 'Purchase' | 'Money' | 'Receivables' | 'Payables'
  | 'Stock' | 'Tax & books';

export interface ReportDef { id: string; cat: ReportCategory; name: string; sub: string }

/**
 * Reference REPORTS, line 3359 — the prototype's 67 entries less the EFRIS
 * log, which this build does not carry, so 66.
 */
export const REPORTS: ReportDef[] = [
  // Sales
  { id: 'day-close', cat: 'Sales', name: 'Z report · end of day', sub: 'Close the day — takings by mode and cashier' },
  { id: 'x-report', cat: 'Sales', name: 'X report', sub: 'Today so far, without closing' },
  { id: 'sale-summary', cat: 'Sales', name: 'Sale summary', sub: 'All bills with tax and dues' },
  { id: 'daily-sales', cat: 'Sales', name: 'Daily sales', sub: 'Totals per day in the range' },
  { id: 'hourly-sales', cat: 'Sales', name: 'Hourly sales', sub: 'Which hours sell the most' },
  { id: 'invoice-list', cat: 'Sales', name: 'Invoice list', sub: 'Every bill in the range' },
  { id: 'item-sales', cat: 'Sales', name: 'Item list (units sold)', sub: 'Quantity and revenue per item' },
  { id: 'sales-by-category', cat: 'Sales', name: 'Sales by category', sub: 'Product groups ranked by revenue' },
  { id: 'sales-by-customer', cat: 'Sales', name: 'Sales by customer', sub: 'Who buys the most' },
  { id: 'sales-by-user', cat: 'Sales', name: 'Sales by cashier', sub: 'Bills and totals per user' },
  { id: 'sale-summary-by-user', cat: 'Sales', name: 'Sale summary by user', sub: 'Items, sales, tax, discounts per rep' },
  { id: 'sale-summary-by-category-item', cat: 'Sales', name: 'Sale summary by category & item', sub: 'Every item under its category' },
  { id: 'user-profit', cat: 'Sales', name: 'User sales & profit', sub: 'Revenue, cost, profit and margin per rep' },
  { id: 'user-hourly', cat: 'Sales', name: 'User sales by hour', sub: 'When each rep sells through the day' },
  { id: 'user-time', cat: 'Sales', name: 'User time on shift', sub: 'Hours worked and average shift length' },
  { id: 'bill-profit', cat: 'Sales', name: 'Bill-wise profit', sub: 'Profit earned on each bill' },
  { id: 'sales-by-items', cat: 'Sales', name: 'Sales by items (per bill)', sub: 'Each sale grouped, with per-line profit' },
  { id: 'profit-margin', cat: 'Sales', name: 'Profit & margin', sub: 'Revenue vs cost per item' },
  { id: 'discounts-granted', cat: 'Sales', name: 'Discounts granted', sub: 'Every discounted bill, who and how much' },
  { id: 'refunds', cat: 'Sales', name: 'Refunds', sub: 'Credit notes issued in the range' },
  { id: 'voided-items', cat: 'Sales', name: 'Voided bills', sub: 'Everything voided, by whom and why' },
  { id: 'offer-usage', cat: 'Sales', name: 'Offer take-up', sub: 'Which promotions are actually used' },
  { id: 'quote-conversion', cat: 'Sales', name: 'Quote conversion', sub: 'How many quotations turn into bills' },
  // Purchase
  { id: 'purchase-summary', cat: 'Purchase', name: 'Purchase summary', sub: 'All supplier bills' },
  { id: 'bill-list', cat: 'Purchase', name: 'Purchase bill list', sub: 'Every supplier bill in the range' },
  { id: 'purchase-by-item', cat: 'Purchase', name: 'Purchases by product', sub: 'What you bought, ranked by spend' },
  { id: 'purchase-by-supplier', cat: 'Purchase', name: 'Purchases by supplier', sub: 'Spend and dues per supplier' },
  { id: 'unpaid-purchases', cat: 'Purchase', name: 'Unpaid purchases', sub: 'What you owe suppliers, with age' },
  { id: 'open-orders', cat: 'Purchase', name: 'Open purchase orders', sub: 'Ordered but not yet received' },
  // Money
  { id: 'cash-flow', cat: 'Money', name: 'Cash flow', sub: 'Money in and out of cash and bank' },
  { id: 'payment-types', cat: 'Money', name: 'Payment types', sub: 'Tender totals — cash, mobile, bank' },
  { id: 'payment-types-by-user', cat: 'Money', name: 'Payment types by user', sub: 'Tender split per cashier' },
  { id: 'payment-types-by-customer', cat: 'Money', name: 'Payment types by customer', sub: 'How each customer pays' },
  { id: 'drawer-entries', cat: 'Money', name: 'Drawer cash entries', sub: 'Till cash in and out with reasons' },
  { id: 'unpaid-sales', cat: 'Money', name: 'Unpaid sales', sub: 'Open customer balances with age' },
  { id: 'expenses-by-category', cat: 'Money', name: 'Expenses by category', sub: 'Where the money went' },
  // Receivables
  { id: 'ar-aging-summary', cat: 'Receivables', name: 'AR ageing summary', sub: 'What each customer owes, by how overdue' },
  { id: 'ar-aging-details', cat: 'Receivables', name: 'AR ageing details', sub: 'Every open bill with its age' },
  { id: 'invoice-details', cat: 'Receivables', name: 'Invoice details', sub: 'Every bill and how much is settled' },
  { id: 'quote-details', cat: 'Receivables', name: 'Quote details', sub: 'Quotations with their status' },
  { id: 'customer-balance-summary', cat: 'Receivables', name: 'Customer balance summary', sub: 'Invoiced, paid and still owing' },
  { id: 'receivable-summary', cat: 'Receivables', name: 'Receivable summary', sub: 'The debtors book in age buckets' },
  { id: 'receivable-details', cat: 'Receivables', name: 'Receivable details', sub: 'Everything owed to you, oldest first' },
  // Payables
  { id: 'ap-aging-summary', cat: 'Payables', name: 'AP ageing summary', sub: 'What you owe each supplier' },
  { id: 'ap-aging-details', cat: 'Payables', name: 'AP ageing details', sub: 'Every open supplier bill with its age' },
  { id: 'supplier-balance-summary', cat: 'Payables', name: 'Supplier balance summary', sub: 'Billed, paid and still owing' },
  { id: 'payable-summary', cat: 'Payables', name: 'Payable summary', sub: 'The creditors book in age buckets' },
  { id: 'payable-details', cat: 'Payables', name: 'Payable details', sub: 'Everything you owe, oldest first' },
  // Stock
  { id: 'stock-summary', cat: 'Stock', name: 'Stock summary', sub: 'Quantity and value of every item' },
  { id: 'stock-movement', cat: 'Stock', name: 'Stock movement', sub: 'Every in and out with reference' },
  { id: 'low-stock', cat: 'Stock', name: 'Low stock', sub: 'Items at or below reorder level' },
  { id: 'reorder-list', cat: 'Stock', name: 'Reorder list', sub: 'What to buy now, with suggested quantity' },
  { id: 'expiry', cat: 'Stock', name: 'Batch / expiry', sub: 'Tracked batches by days to expiry' },
  { id: 'batch-movement', cat: 'Stock', name: 'Batch movement', sub: 'Every in and out, by lot, with a running balance' },
  { id: 'batch-balances', cat: 'Stock', name: 'Batch balances', sub: 'What each lot holds and what it is worth' },
  { id: 'loss-damage', cat: 'Stock', name: 'Loss & damage', sub: 'Stock written off, with value' },
  { id: 'fast-moving', cat: 'Stock', name: 'Fast-moving products', sub: 'Best sellers with current stock' },
  { id: 'slow-moving', cat: 'Stock', name: 'Slow-moving products', sub: 'Holding stock with no sales in range' },
  { id: 'stock-adjustment', cat: 'Stock', name: 'Stock adjustment by item', sub: 'Recounts grouped by reference' },
  { id: 'stock-valuation', cat: 'Stock', name: 'Stock valuation', sub: 'Cost vs sale value, by category' },
  { id: 'production-report', cat: 'Stock', name: 'Production runs', sub: 'What was made and what it cost' },
  // Tax & books
  { id: 'tax-summary', cat: 'Tax & books', name: 'Tax summary', sub: 'VAT levied — sales vs purchases' },
  { id: 'party-statement', cat: 'Tax & books', name: 'Party statement', sub: 'Running ledger for any party' },
  { id: 'trial-balance', cat: 'Tax & books', name: 'Trial balance', sub: 'All accounts — Dr must equal Cr' },
  { id: 'general-ledger', cat: 'Tax & books', name: 'General ledger', sub: 'Every account: debit, credit, closing' },
  { id: 'pnl', cat: 'Tax & books', name: 'Profit & loss', sub: 'Sales, cost of goods, expenses' },
  { id: 'balance-sheet', cat: 'Tax & books', name: 'Balance sheet', sub: 'What you own against what you owe' },
  { id: 'zreport-summary', cat: 'Tax & books', name: 'Z report summary', sub: 'Every closed shift and its variance' },
];

export const REPORT_CATEGORIES: ReportCategory[] = [
  'Sales', 'Purchase', 'Money', 'Receivables', 'Payables', 'Stock', 'Tax & books',
];

/** The five the prototype pinned above the list — reference SCREENS.reports.body, 5359. */
export const FAVOURITE_REPORTS = ['day-close', 'sale-summary', 'ar-aging-summary', 'reorder-list', 'pnl'];

export function reportById(id: string): ReportDef | undefined {
  return REPORTS.find((r) => r.id === id);
}

/* ------------------------------------------------------------------ */
/* Result shape                                                        */
/* ------------------------------------------------------------------ */

export type CellTone = 'good' | 'warn' | 'danger' | 'muted' | 'accent';

/** A cell is plain text, or text plus the number behind it so sorting and totals work. */
export interface CellObj { text: string; n?: number; tone?: CellTone }
export type Cell = string | number | CellObj;

/** `r` right-aligns and marks the column numeric (reference tableCard's `c.r`, 2245). */
export interface ReportCol { h: string; r?: boolean; key?: string }

export interface ReportStat { k: string; v: string; tone?: 'g' | 'w' | 'd' | 'a' }

/** What a tapped row opens. */
export type RowRefKind = 'sale' | 'purchase' | 'payment' | 'entry' | 'creditNote';
export interface RowRef { kind: RowRefKind; id: string }

export interface ReportResult {
  title: string;
  /** Shown above the table, in the `statsRow` band — reference 2258. */
  stats?: ReportStat[];
  cols: ReportCol[];
  rows: Cell[][];
  /** The pinned totals row — reference tableCard's `foot`, rendered on var(--sunk) at 700. */
  foot?: Cell[];
  /** Parallel to `rows`; an entry makes that row tappable. */
  rowRefs?: (RowRef | null)[];
  /** A sentence printed under the table. */
  note?: string;
  /** Set when the builder is not written yet, so the UI can say so calmly. */
  notImplemented?: boolean;
  /** Set when the builder threw, so the UI can say so calmly. */
  error?: string;
}

export function cellText(c: Cell): string {
  if (c == null) return '';
  if (typeof c === 'object') return c.text;
  return String(c);
}

/** The number behind a cell, for sorting and for the totals row. */
export function cellNum(c: Cell): number {
  if (c == null) return 0;
  if (typeof c === 'number') return c;
  if (typeof c === 'object') {
    if (typeof c.n === 'number') return c.n;
    return parseNum(c.text);
  }
  return parseNum(c);
}

function parseNum(s: string): number {
  const cleaned = String(s).replace(/[^0-9.\-]/g, '');
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : 0;
}

export function cellTone(c: Cell): CellTone | undefined {
  return c && typeof c === 'object' ? c.tone : undefined;
}

/** Sum a numeric column across rows — reference sumCol(), 3451. */
export function sumCol(rows: Cell[][], i: number): number {
  return rows.reduce((a, r) => a + cellNum(r[i]), 0);
}

function m(n: number): CellObj { return { text: money0(n), n }; }
function mTone(n: number, tone: CellTone): CellObj { return { text: money0(n), n, tone }; }
function dash(n: number, tone: CellTone = 'warn'): CellObj {
  return n ? { text: money0(n), n, tone } : { text: '—', n: 0, tone: 'muted' };
}
function pct(n: number): CellObj { return { text: Math.round(n) + '%', n }; }
function signed(n: number): CellObj {
  return { text: money0(n), n, tone: n > 0 ? 'good' : n < 0 ? 'danger' : undefined };
}
function pad2(n: number | string): string { const s = String(n); return s.length < 2 ? '0' + s : s; }

/* ------------------------------------------------------------------ */
/* DB helpers                                                          */
/* ------------------------------------------------------------------ */

/** Reference salesBetween(), line 1083 — void bills never count. */
export function salesBetween(db: DB, from: number, to: number): Sale[] {
  return db.sales.filter((s) => {
    if (s.status === 'void') return false;
    const t = new Date(s.ts).getTime();
    return (!from || t >= from) && (!to || t <= to);
  });
}

function within(ts: string, from: number, to: number): boolean {
  const t = new Date(ts).getTime();
  return (!from || t >= from) && (!to || t <= to);
}

interface SoldLine { s: Sale; l: SaleLine; value: number; cost: number }

/** Reference soldLines(), 3437. */
function soldLines(db: DB, from: number, to: number): SoldLine[] {
  const out: SoldLine[] = [];
  salesBetween(db, from, to).forEach((s) => {
    s.lines.forEach((l) => out.push({ s, l, value: l.qty * l.price, cost: l.qty * (l.cost || 0) }));
  });
  return out;
}

/** Reference groupRows(), 3446. */
function groupRows<T, G>(items: T[], keyFn: (x: T) => string, initFn: (x: T) => G, addFn: (g: G, x: T) => void): G[] {
  const map: Record<string, G> = {};
  const order: string[] = [];
  items.forEach((x) => {
    const k = keyFn(x);
    if (!map[k]) { map[k] = initFn(x); order.push(k); }
    addFn(map[k], x);
  });
  return order.map((k) => map[k]);
}

function partyName(db: DB, id: string | null | undefined): string {
  if (!id) return 'Walk-in';
  const p = db.parties.find((x) => x.id === id);
  return p ? p.name : 'Walk-in';
}
function userName(db: DB, id: string | undefined): string {
  const u = db.users.find((x) => x.id === id);
  return u ? u.name : '—';
}
function productOf(db: DB, id: string): Product | undefined {
  return db.products.find((p) => p.id === id);
}
function categoryOf(db: DB, productId: string): string {
  return productOf(db, productId)?.category || '—';
}
function openShift(db: DB) {
  return (db.shifts || []).find((s) => !s.closedAt);
}

/** Reference offerText(), 3027 — adapted to this port's Offer shape. */
function offerText(db: DB, o: Offer): string {
  const scope = o.scope === 'all' ? 'any sale'
    : o.scope === 'category' ? (o.target || '—') + ' items'
      : (o.target ? productOf(db, o.target)?.name || '—' : '—');
  const what = o.kind === 'percent' ? o.value + '% off' : money0(o.value) + ' off';
  return what + ' — ' + scope;
}

function empty(title: string, cols: ReportCol[], note?: string): ReportResult {
  return { title, cols, rows: [], note };
}

/** Reference ageOf(), 3445 — whole days since a timestamp. */
function ageOf(ts: string): number {
  return Math.floor((Date.now() - new Date(ts).getTime()) / 864e5);
}
/** Reference bucketOf(), 3446. */
const BUCKETS = ['0–30', '31–60', '61–90', '90+'] as const;
type Bucket = typeof BUCKETS[number];
function bucketOf(days: number): Bucket {
  return days <= 30 ? '0–30' : days <= 60 ? '31–60' : days <= 90 ? '61–90' : '90+';
}
/** The prototype printed `fmtDay(ts).slice(0,6)` to drop the year. */
function shortDay(ts: string | number): string {
  return fmtDay(ts).split(' ').slice(0, 2).join(' ');
}
/** Reference stockOf(), 867 — across every warehouse. */
function stockOf(p: Product): number {
  return stockOfImpl(p);
}
function supplierName(db: DB, id: string | null | undefined): string {
  if (!id) return '—';
  return db.parties.find((x) => x.id === id)?.name || '—';
}
function purchaseTotal(p: { lines: { qty: number; cost: number }[] }): number {
  return p.lines.reduce((a, l) => a + l.qty * l.cost, 0);
}
function creditNoteTax(c: { lines: CreditNoteLine[] }): number {
  return c.lines.reduce((a, l) => {
    const v = l.qty * l.price;
    return a + (v - v / (1 + (l.taxRate || 0) / 100));
  }, 0);
}
function purchasesBetween(db: DB, from: number, to: number) {
  return db.purchases.filter((x) => within(x.ts, from, to));
}

/* ---- ledger helpers — reference NOMINAL/accName/accountBalance, 872-890 ---- */
const NOMINAL: Record<string, string> = {
  n_sales: 'Sales', n_cogs: 'Cost of goods sold', n_inventory: 'Inventory',
  n_ar: 'Accounts receivable', n_ap: 'Accounts payable', n_tax: 'VAT payable',
  n_expense: 'Expenses', n_income: 'Other income', n_equity: 'Owner equity',
  n_discount: 'Discounts given', n_loyalty: 'Loyalty redemptions',
};
function accName(db: DB, id: string): string {
  return NOMINAL[id] || db.accounts.find((a) => a.id === id)?.name || id;
}
/** Reference allAccountIds(), 3192 — this port has no DB.coa, so: real accounts + the nominals actually posted to. */
function allAccountIds(db: DB): string[] {
  const ids = db.accounts.map((a) => a.id);
  Object.keys(NOMINAL).forEach((k) => { if (ids.indexOf(k) < 0) ids.push(k); });
  db.journal.forEach((e) => e.lines.forEach((l) => { if (ids.indexOf(l.acc) < 0) ids.push(l.acc); }));
  return ids;
}
/** Reference accType(), 1134 — no chart of accounts here, so classify by nominal id. */
type AccType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
const NOMINAL_TYPE: Record<string, AccType> = {
  n_sales: 'income', n_income: 'income',
  n_cogs: 'expense', n_expense: 'expense', n_discount: 'expense', n_loyalty: 'expense',
  n_inventory: 'asset', n_ar: 'asset',
  n_ap: 'liability', n_tax: 'liability',
  n_equity: 'equity',
};
function accType(db: DB, id: string): AccType {
  if (db.accounts.some((a) => a.id === id)) return 'asset';
  return NOMINAL_TYPE[id] || 'equity';
}
function accountBalance(db: DB, id: string, from = 0, to = 0): number {
  let b = 0;
  db.journal.forEach((e) => {
    if ((from || to) && !within(e.ts, from, to)) return;
    e.lines.forEach((l) => { if (l.acc === id) b += (l.dr || 0) - (l.cr || 0); });
  });
  return b;
}
/** Reference nominalTotal(), 891 — credit-positive. */
function nominalTotal(db: DB, id: string, from = 0, to = 0): number {
  return -accountBalance(db, id, from, to);
}

interface LedgerRow { ts: string; memo: string; debit: number; credit: number; balance: number; ref?: RowRef }
/** Reference partyLedgerRows(), 1070. */
function partyLedgerRows(db: DB, id: string): LedgerRow[] {
  const rows: LedgerRow[] = [];
  const p = db.parties.find((x) => x.id === id);
  if (p && p.openingBalance) {
    rows.push({ ts: new Date(daysAgo(60)).toISOString(), memo: 'Opening balance', debit: p.openingBalance, credit: 0, balance: 0 });
  }
  db.sales.forEach((s) => {
    if (s.partyId === id && s.status !== 'void') {
      rows.push({ ts: s.ts, memo: 'Sale ' + s.no, debit: s.total, credit: s.paidAtSale || 0, balance: 0, ref: { kind: 'sale', id: s.id } });
    }
  });
  db.purchases.forEach((x) => {
    if (x.partyId === id) {
      rows.push({ ts: x.ts, memo: 'Purchase ' + x.no, debit: x.paid || 0, credit: x.total, balance: 0, ref: { kind: 'purchase', id: x.id } });
    }
  });
  db.payments.forEach((x) => {
    if (x.partyId === id) {
      rows.push({
        ts: x.ts,
        memo: (x.direction === 'in' ? 'Receipt' : 'Payment') + (x.note ? ' — ' + x.note : ''),
        debit: x.direction === 'out' ? x.amount : 0,
        credit: x.direction === 'in' ? x.amount : 0,
        balance: 0,
        ref: { kind: 'payment', id: x.id },
      });
    }
  });
  rows.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  let run = 0;
  rows.forEach((r) => { run += r.debit - r.credit; r.balance = run; });
  return rows;
}

/* ------------------------------------------------------------------ */
/* Report builders — Sales                                             */
/* ------------------------------------------------------------------ */

type Builder = (db: DB, from: number, to: number, money: (n: number) => string) => ReportResult;

const RPT: Record<string, Builder> = {};

/* --- Z report / end of day — reference RPT['day-close'], 3684 --- */
RPT['day-close'] = (db, _f, _t, money) => {
  const title = 'Z report · end of day';
  const sh = openShift(db);
  if (!sh) {
    return empty(title, [{ h: 'Line' }, { h: 'Amount', r: true }],
      'No open shift. Open a shift from the till to run a day close.');
  }
  const z = shiftTotals(db, sh);
  const rows: Cell[][] = [
    ['Opening float', m(sh.openingFloat)],
    ['Cash sales', m(z.cash)],
    ['Mobile money', m(z.momo)],
    ['Bank', m(z.bank)],
    ['On credit', m(z.credit)],
    ['Receipts into drawer', m(z.recv)],
    ['Cash paid out', { text: '(' + money0(z.paidOut) + ')', n: -z.paidOut, tone: 'danger' }],
  ];
  return {
    title,
    stats: [
      { k: 'Opening float', v: money(sh.openingFloat) },
      { k: 'Cash sales', v: money(z.cash), tone: 'g' },
      { k: 'Expected in drawer', v: money(z.expected), tone: 'a' },
      { k: 'Bills', v: String(z.count) },
    ],
    cols: [{ h: 'Line' }, { h: 'Amount', r: true }],
    rows,
    foot: ['Expected cash', m(z.expected)],
  };
};

/* --- X report — reference RPT['x-report'], 3696 --- */
RPT['x-report'] = (db, _f, _t, money) => {
  const ss = salesBetween(db, startOfDay(), endOfDay());
  const byMethod: Record<string, number> = {};
  ss.forEach((s) => { byMethod[s.method] = (byMethod[s.method] || 0) + s.total; });
  const total = ss.reduce((a, s) => a + s.total, 0);
  return {
    title: 'X report',
    stats: [
      { k: 'Bills today', v: String(ss.length) },
      { k: 'Taken today', v: money(total), tone: 'g' },
    ],
    cols: [{ h: 'Tender' }, { h: 'Amount', r: true }],
    rows: Object.keys(byMethod).map((k) => [k, m(byMethod[k])]),
    foot: ['Total', m(total)],
    note: 'The X report reads the day so far. It does not close the shift.',
  };
};

/* --- Sale summary — reference RPT['sale-summary'], 3457 --- */
RPT['sale-summary'] = (db, from, to, money) => {
  const sales = salesBetween(db, from, to);
  const gross = sales.reduce((a, s) => a + s.total, 0);
  const tax = sales.reduce((a, s) => a + s.tax, 0);
  const cogs = sales.reduce((a, s) => a + s.cogs, 0);
  const disc = sales.reduce((a, s) => a + s.discount, 0);
  const due = sales.reduce((a, s) => a + s.due, 0);
  const profit = (gross - tax) - cogs;
  return {
    title: 'Sale summary',
    stats: [
      { k: 'Total sales', v: money(gross), tone: 'g' },
      { k: 'Bills', v: String(sales.length) },
      { k: 'Gross profit', v: money(profit), tone: 'a' },
      { k: 'Still owing', v: money(due), tone: due ? 'w' : undefined },
    ],
    cols: [{ h: 'Measure' }, { h: 'Amount', r: true }],
    rows: [
      ['Gross sales', m(gross)],
      ['Discounts given', m(disc)],
      ['VAT included', m(tax)],
      ['Net of VAT', m(gross - tax)],
      ['Cost of goods sold', m(cogs)],
      ['Average bill', m(sales.length ? gross / sales.length : 0)],
      ['Settled at the till', m(gross - due)],
    ],
    foot: ['Gross profit', m(profit)],
  };
};

/* --- Daily sales — reference RPT['daily-sales'], 3474 --- */
RPT['daily-sales'] = (db, from, to) => {
  const span = to - (from || to - 30 * 864e5);
  const days = Math.min(60, Math.max(1, Math.ceil(span / 864e5)));
  const rows: Cell[][] = [];
  for (let d = days - 1; d >= 0; d--) {
    const f = startOfDay(daysAgo(d));
    const g = endOfDay(daysAgo(d));
    if (from && g < from) continue;
    const ss = salesBetween(db, f, g);
    rows.push([
      fmtDay(daysAgo(d)),
      ss.length,
      m(ss.reduce((a, s) => a + s.total, 0)),
      m(ss.reduce((a, s) => a + (s.total - s.tax - s.cogs), 0)),
    ]);
  }
  return {
    title: 'Daily sales',
    cols: [{ h: 'Day' }, { h: 'Bills', r: true }, { h: 'Sales', r: true }, { h: 'Profit', r: true }],
    rows,
    foot: ['Total', sumCol(rows, 1), m(sumCol(rows, 2)), m(sumCol(rows, 3))],
  };
};

/* --- Hourly sales — reference RPT['hourly-sales'], 3487 --- */
RPT['hourly-sales'] = (db, from, to) => {
  const buckets = Array.from({ length: 24 }, () => ({ c: 0, v: 0 }));
  salesBetween(db, from, to).forEach((s) => {
    const h = new Date(s.ts).getHours();
    buckets[h].c++; buckets[h].v += s.total;
  });
  const rows: Cell[][] = [];
  buckets.forEach((b, i) => {
    if (!b.c) return;
    rows.push([pad2(i) + ':00 – ' + pad2(i) + ':59', b.c, m(b.v)]);
  });
  const best = buckets.reduce((n, b, i) => (b.v > buckets[n].v ? i : n), 0);
  return {
    title: 'Hourly sales',
    stats: rows.length ? [{ k: 'Busiest hour', v: pad2(best) + ':00', tone: 'a' }] : undefined,
    cols: [{ h: 'Hour' }, { h: 'Bills', r: true }, { h: 'Sales', r: true }],
    rows,
    foot: ['Total', sumCol(rows, 1), m(sumCol(rows, 2))],
  };
};

/* --- Invoice list — reference RPT['invoice-list'], 3502 --- */
RPT['invoice-list'] = (db, from, to) => {
  const sales = salesBetween(db, from, to).slice().reverse();
  const rows: Cell[][] = sales.map((s) => [
    s.no, partyName(db, s.partyId), s.method, m(s.total), dash(s.due),
  ]);
  return {
    title: 'Invoice list',
    cols: [{ h: 'Bill' }, { h: 'Customer' }, { h: 'Mode' }, { h: 'Total', r: true }, { h: 'Due', r: true }],
    rows,
    foot: ['Total', '', '', m(sumCol(rows, 3)), m(sumCol(rows, 4))],
    rowRefs: sales.map((s) => ({ kind: 'sale' as const, id: s.id })),
  };
};

/* --- Item list — reference RPT['item-sales'], 3508 --- */
RPT['item-sales'] = (db, from, to) => {
  const groups = groupRows(soldLines(db, from, to), (x) => x.l.productId,
    (x) => ({ n: x.l.name, u: x.l.unit, q: 0, v: 0, c: 0 }),
    (g, x) => { g.q += x.l.qty; g.v += x.value; g.c += x.cost; })
    .sort((a, b) => b.v - a.v);
  const rows: Cell[][] = groups.map((g) => [
    g.n, { text: g.q + ' ' + g.u, n: g.q }, m(g.v), m(g.v - g.c),
  ]);
  return {
    title: 'Item list (units sold)',
    cols: [{ h: 'Item' }, { h: 'Sold', r: true }, { h: 'Revenue', r: true }, { h: 'Profit', r: true }],
    rows,
    foot: ['Total', '', m(sumCol(rows, 2)), m(sumCol(rows, 3))],
  };
};

/* --- Sales by category — reference RPT['sales-by-category'], 3517 --- */
RPT['sales-by-category'] = (db, from, to) => {
  const groups = groupRows(soldLines(db, from, to), (x) => categoryOf(db, x.l.productId),
    (x) => ({ n: categoryOf(db, x.l.productId), q: 0, v: 0, c: 0 }),
    (g, x) => { g.q += x.l.qty; g.v += x.value; g.c += x.cost; })
    .sort((a, b) => b.v - a.v);
  const tot = groups.reduce((a, g) => a + g.v, 0);
  return {
    title: 'Sales by category',
    cols: [{ h: 'Category' }, { h: 'Units', r: true }, { h: 'Revenue', r: true }, { h: 'Share', r: true }],
    rows: groups.map((g) => [g.n, g.q, m(g.v), pct(tot ? g.v / tot * 100 : 0)]),
    foot: ['Total', groups.reduce((a, g) => a + g.q, 0), m(tot), tot ? '100%' : '0%'],
  };
};

/* --- Sales by customer — reference RPT['sales-by-customer'], 3527 --- */
RPT['sales-by-customer'] = (db, from, to) => {
  const groups = groupRows(salesBetween(db, from, to), (s) => s.partyId || 'walkin',
    (s) => ({ n: partyName(db, s.partyId), c: 0, v: 0, d: 0 }),
    (g, s) => { g.c++; g.v += s.total; g.d += s.due; })
    .sort((a, b) => b.v - a.v);
  return {
    title: 'Sales by customer',
    cols: [{ h: 'Customer' }, { h: 'Bills', r: true }, { h: 'Value', r: true }, { h: 'Unpaid', r: true }],
    rows: groups.map((g) => [g.n, g.c, m(g.v), dash(g.d)]),
    foot: ['Total', groups.reduce((a, g) => a + g.c, 0),
      m(groups.reduce((a, g) => a + g.v, 0)), m(groups.reduce((a, g) => a + g.d, 0))],
  };
};

/* --- Sales by cashier — reference RPT['sales-by-user'], 3537 --- */
RPT['sales-by-user'] = (db, from, to) => {
  const groups = groupRows(salesBetween(db, from, to), (s) => s.userId,
    (s) => ({ n: userName(db, s.userId), c: 0, v: 0 }),
    (g, s) => { g.c++; g.v += s.total; })
    .sort((a, b) => b.v - a.v);
  const bills = groups.reduce((a, g) => a + g.c, 0);
  const value = groups.reduce((a, g) => a + g.v, 0);
  return {
    title: 'Sales by cashier',
    cols: [{ h: 'Cashier' }, { h: 'Bills', r: true }, { h: 'Value', r: true }, { h: 'Average', r: true }],
    rows: groups.map((g) => [g.n, g.c, m(g.v), m(g.c ? g.v / g.c : 0)]),
    foot: ['Total', bills, m(value), m(bills ? value / bills : 0)],
  };
};

/* --- Sale summary by user — reference RPT['sale-summary-by-user'], 3544 --- */
RPT['sale-summary-by-user'] = (db, from, to) => {
  const groups = groupRows(salesBetween(db, from, to), (s) => s.userId,
    (s) => ({ n: userName(db, s.userId), items: 0, v: 0, t: 0, d: 0 }),
    (g, s) => {
      g.v += s.total; g.t += s.tax; g.d += s.discount;
      s.lines.forEach((l) => { g.items += l.qty; });
    })
    .sort((a, b) => b.v - a.v);
  const rows: Cell[][] = groups.map((g) => [g.n, g.items, m(g.v), m(g.t), m(g.d)]);
  return {
    title: 'Sale summary by user',
    cols: [{ h: 'Rep' }, { h: 'Items', r: true }, { h: 'Sales', r: true }, { h: 'VAT', r: true }, { h: 'Discount', r: true }],
    rows,
    foot: ['Total', sumCol(rows, 1), m(sumCol(rows, 2)), m(sumCol(rows, 3)), m(sumCol(rows, 4))],
  };
};

/* --- Sale summary by category & item — reference 3552, flattened to one table --- */
RPT['sale-summary-by-category-item'] = (db, from, to) => {
  const byCat: Record<string, Record<string, { n: string; q: number; v: number; t: number }>> = {};
  soldLines(db, from, to).forEach((x) => {
    const c = categoryOf(db, x.l.productId);
    const cat = byCat[c] || (byCat[c] = {});
    const e = cat[x.l.productId] || (cat[x.l.productId] = { n: x.l.name, q: 0, v: 0, t: 0 });
    e.q += x.l.qty;
    e.v += x.value;
    e.t += x.value - x.value / (1 + (x.l.taxRate || 0) / 100);
  });
  const rows: Cell[][] = [];
  Object.keys(byCat).sort().forEach((c) => {
    const items = Object.keys(byCat[c]).map((k) => byCat[c][k]).sort((a, b) => b.v - a.v);
    items.forEach((i) => rows.push([c, i.n, i.q, m(i.v), { text: money0(i.t), n: i.t, tone: 'muted' }]));
  });
  return {
    title: 'Sale summary by category & item',
    cols: [{ h: 'Category' }, { h: 'Item' }, { h: 'Qty', r: true }, { h: 'Value', r: true }, { h: 'VAT', r: true }],
    rows,
    foot: ['Total', '', sumCol(rows, 2), m(sumCol(rows, 3)), m(sumCol(rows, 4))],
  };
};

/* --- User sales & profit — reference RPT['user-profit'], 3575 --- */
RPT['user-profit'] = (db, from, to) => {
  const groups = groupRows(salesBetween(db, from, to), (s) => s.userId,
    (s) => ({ n: userName(db, s.userId), v: 0, c: 0 }),
    (g, s) => { g.v += s.total - s.tax; g.c += s.cogs; })
    .sort((a, b) => (b.v - b.c) - (a.v - a.c));
  const rows: Cell[][] = groups.map((g) => [
    g.n, m(g.v), m(g.c), m(g.v - g.c), pct(g.v ? (g.v - g.c) / g.v * 100 : 0),
  ]);
  const rev = sumCol(rows, 1);
  const cost = sumCol(rows, 2);
  return {
    title: 'User sales & profit',
    cols: [{ h: 'Rep' }, { h: 'Revenue', r: true }, { h: 'Cost', r: true }, { h: 'Profit', r: true }, { h: 'Margin', r: true }],
    rows,
    foot: ['Total', m(rev), m(cost), m(rev - cost), pct(rev ? (rev - cost) / rev * 100 : 0)],
  };
};

/* --- User sales by hour — reference RPT['user-hourly'], 3582, flattened --- */
RPT['user-hourly'] = (db, from, to) => {
  const map: Record<string, Record<number, { c: number; v: number }>> = {};
  salesBetween(db, from, to).forEach((s) => {
    const n = userName(db, s.userId);
    const h = new Date(s.ts).getHours();
    const rep = map[n] || (map[n] = {});
    const slot = rep[h] || (rep[h] = { c: 0, v: 0 });
    slot.c++; slot.v += s.total;
  });
  const rows: Cell[][] = [];
  Object.keys(map).sort().forEach((n) => {
    const hrs = map[n];
    Object.keys(hrs).map(Number).sort((a, b) => a - b).forEach((h) => {
      rows.push([n, pad2(h) + ':00', hrs[h].c, m(hrs[h].v)]);
    });
  });
  return {
    title: 'User sales by hour',
    cols: [{ h: 'Rep' }, { h: 'Hour' }, { h: 'Bills', r: true }, { h: 'Sales', r: true }],
    rows,
    foot: ['Total', '', sumCol(rows, 2), m(sumCol(rows, 3))],
  };
};

/* --- User time on shift — reference RPT['user-time'], 3602 --- */
RPT['user-time'] = (db) => {
  const groups = groupRows(db.shifts || [], (s) => s.userId,
    (s) => ({ n: userName(db, s.userId), count: 0, ms: 0 }),
    (g, s) => {
      g.count++;
      g.ms += (s.closedAt ? new Date(s.closedAt).getTime() : Date.now()) - new Date(s.openedAt).getTime();
    });
  const rows: Cell[][] = groups.map((g) => {
    const h = g.ms / 36e5;
    return [g.n, g.count, { text: h.toFixed(1), n: h }, { text: (g.count ? h / g.count : 0).toFixed(1) + 'h', n: g.count ? h / g.count : 0 }];
  });
  const shifts = sumCol(rows, 1);
  const hours = sumCol(rows, 2);
  return {
    title: 'User time on shift',
    cols: [{ h: 'User' }, { h: 'Shifts', r: true }, { h: 'Hours', r: true }, { h: 'Average', r: true }],
    rows,
    foot: ['Total', shifts, { text: hours.toFixed(1), n: hours }, { text: (shifts ? hours / shifts : 0).toFixed(1) + 'h' }],
  };
};

/* --- Bill-wise profit — reference RPT['bill-profit'], 3609 --- */
RPT['bill-profit'] = (db, from, to) => {
  const sales = salesBetween(db, from, to).slice().reverse();
  const rows: Cell[][] = sales.map((s) => {
    const p = (s.total - s.tax) - s.cogs;
    const net = s.total - s.tax;
    return [s.no, partyName(db, s.partyId), m(s.total), signed(p), pct(net ? p / net * 100 : 0)];
  });
  const total = sumCol(rows, 2);
  const profit = sumCol(rows, 3);
  return {
    title: 'Bill-wise profit',
    cols: [{ h: 'Bill' }, { h: 'Customer' }, { h: 'Total', r: true }, { h: 'Profit', r: true }, { h: 'Margin', r: true }],
    rows,
    foot: ['Total', '', m(total), m(profit), pct(total ? profit / total * 100 : 0)],
    rowRefs: sales.map((s) => ({ kind: 'sale' as const, id: s.id })),
  };
};

/* --- Sales by items, per bill — reference RPT['sales-by-items'], 3617, flattened --- */
RPT['sales-by-items'] = (db, from, to) => {
  const sales = salesBetween(db, from, to).slice().reverse().slice(0, 30);
  const rows: Cell[][] = [];
  const refs: (RowRef | null)[] = [];
  sales.forEach((s) => {
    s.lines.forEach((l) => {
      const p = l.qty * l.price - l.qty * (l.cost || 0);
      rows.push([s.no, partyName(db, s.partyId), l.name, l.qty, m(l.price), m(l.qty * l.price), signed(p)]);
      refs.push({ kind: 'sale', id: s.id });
    });
  });
  return {
    title: 'Sales by items (per bill)',
    cols: [
      { h: 'Bill' }, { h: 'Customer' }, { h: 'Item' }, { h: 'Qty', r: true },
      { h: 'Price', r: true }, { h: 'Value', r: true }, { h: 'Profit', r: true },
    ],
    rows,
    foot: ['Total', '', '', sumCol(rows, 3), '', m(sumCol(rows, 5)), m(sumCol(rows, 6))],
    rowRefs: refs,
    note: sales.length === 30 ? 'The 30 most recent bills in the range.' : undefined,
  };
};

/* --- Profit & margin — reference RPT['profit-margin'], 3633 --- */
RPT['profit-margin'] = (db, from, to) => {
  const groups = groupRows(soldLines(db, from, to), (x) => x.l.productId,
    (x) => ({ n: x.l.name, v: 0, c: 0 }),
    (g, x) => { g.v += x.value; g.c += x.cost; })
    .sort((a, b) => (b.v - b.c) - (a.v - a.c));
  const rows: Cell[][] = groups.map((g) => [
    g.n, m(g.v), m(g.c), m(g.v - g.c), pct(g.v ? (g.v - g.c) / g.v * 100 : 0),
  ]);
  const rev = sumCol(rows, 1);
  const cost = sumCol(rows, 2);
  return {
    title: 'Profit & margin',
    cols: [{ h: 'Item' }, { h: 'Revenue', r: true }, { h: 'Cost', r: true }, { h: 'Profit', r: true }, { h: 'Margin', r: true }],
    rows,
    foot: ['Total', m(rev), m(cost), m(rev - cost), pct(rev ? (rev - cost) / rev * 100 : 0)],
  };
};

/* --- Discounts granted — reference RPT['discounts-granted'], 3641 --- */
RPT['discounts-granted'] = (db, from, to) => {
  const sales = salesBetween(db, from, to).filter((s) => s.discount > 0);
  const rows: Cell[][] = sales.map((s) => [
    s.no, userName(db, s.userId), partyName(db, s.partyId), m(s.total), mTone(s.discount, 'danger'),
  ]);
  return {
    title: 'Discounts granted',
    cols: [{ h: 'Bill' }, { h: 'By' }, { h: 'Customer' }, { h: 'Total', r: true }, { h: 'Discount', r: true }],
    rows,
    foot: ['Total', '', '', m(sumCol(rows, 3)), m(sumCol(rows, 4))],
    rowRefs: sales.map((s) => ({ kind: 'sale' as const, id: s.id })),
  };
};

/* --- Refunds — reference RPT['refunds'], 3649 --- */
RPT['refunds'] = (db, from, to) => {
  const notes = (db.creditNotes || []).filter((c) => within(c.ts, from, to)).slice().reverse();
  const rows: Cell[][] = notes.map((c) => {
    const against = c.saleId ? db.sales.find((s) => s.id === c.saleId)?.no || '—' : '—';
    return [c.no, against, partyName(db, c.partyId), c.reason || '—', mTone(c.total, 'danger')];
  });
  return {
    title: 'Refunds',
    cols: [{ h: 'Credit note' }, { h: 'Against' }, { h: 'Customer' }, { h: 'Reason' }, { h: 'Amount', r: true }],
    rows,
    foot: ['Total', '', '', '', m(sumCol(rows, 4))],
    rowRefs: notes.map((c) => ({ kind: 'creditNote' as const, id: c.id })),
  };
};

/* --- Voided bills — reference RPT['voided-items'], 3657 --- */
RPT['voided-items'] = (db, from, to) => {
  const sales = db.sales.filter((s) => s.status === 'void' && within(s.ts, from, to));
  const rows: Cell[][] = sales.map((s) => [
    s.no, fmtDay(s.voidedAt || s.ts), userName(db, s.userId), s.voidReason || '—', m(s.total),
  ]);
  return {
    title: 'Voided bills',
    cols: [{ h: 'Bill' }, { h: 'Voided' }, { h: 'By' }, { h: 'Reason' }, { h: 'Value', r: true }],
    rows,
    foot: ['Total', '', '', '', m(sumCol(rows, 4))],
    rowRefs: sales.map((s) => ({ kind: 'sale' as const, id: s.id })),
  };
};

/* --- Offer take-up — reference RPT['offer-usage'], 3665 --- */
RPT['offer-usage'] = (db) => {
  const offers = db.offers || [];
  return {
    title: 'Offer take-up',
    cols: [{ h: 'Offer' }, { h: 'Rule' }, { h: 'Status' }],
    rows: offers.map((o) => [
      o.name, offerText(db, o),
      o.active ? { text: 'Live', tone: 'good' as CellTone } : { text: 'Off', tone: 'muted' as CellTone },
    ]),
    foot: [`${offers.length} offer${offers.length === 1 ? '' : 's'}`, '',
      `${offers.filter((o) => o.active).length} live`],
    note: 'Offers apply automatically at the till — the rule that saves the customer most wins.',
  };
};

/* --- Quote conversion — reference RPT['quote-conversion'], 3672 --- */
RPT['quote-conversion'] = (db, from, to, money) => {
  const qs = (db.estimates || []).filter((e) => within(e.ts, from, to));
  const won = qs.filter((e) => e.status === 'converted');
  const lost = qs.filter((e) => e.status === 'void');
  const quoted = qs.reduce((a, e) => a + e.total, 0);
  const rows: Cell[][] = qs.slice().reverse().map((e) => [
    e.no, partyName(db, e.partyId), m(e.total),
    {
      text: e.status,
      tone: (e.status === 'converted' ? 'good' : e.status === 'void' ? 'danger' : 'muted') as CellTone,
    },
  ]);
  return {
    title: 'Quote conversion',
    stats: [
      { k: 'Quoted', v: money(quoted) },
      { k: 'Won', v: won.length + ' of ' + qs.length, tone: 'g' },
      { k: 'Win rate', v: (qs.length ? Math.round(won.length / qs.length * 100) : 0) + '%', tone: 'a' },
      { k: 'Cancelled', v: String(lost.length), tone: lost.length ? 'w' : undefined },
    ],
    cols: [{ h: 'Quote' }, { h: 'Customer' }, { h: 'Value', r: true }, { h: 'Status' }],
    rows,
    foot: ['Total', '', m(sumCol(rows, 2)), won.length + ' won'],
  };
};

/* ------------------------------------------------------------------ */
/* Report builders — Purchase                                          */
/* ------------------------------------------------------------------ */

/* --- Purchase summary — reference RPT['purchase-summary'], 3707 --- */
RPT['purchase-summary'] = (db, from, to, money) => {
  const ps = purchasesBetween(db, from, to);
  const tot = ps.reduce((a, x) => a + x.total, 0);
  const due = ps.reduce((a, x) => a + x.due, 0);
  const list = ps.slice().reverse();
  return {
    title: 'Purchase summary',
    stats: [
      { k: 'Bought', v: money(tot) },
      { k: 'Bills', v: String(ps.length) },
      { k: 'Still owing', v: money(due), tone: due ? 'w' : undefined },
    ],
    cols: [{ h: 'Bill' }, { h: 'Supplier' }, { h: 'Total', r: true }, { h: 'Due', r: true }],
    rows: list.map((x) => [x.no, supplierName(db, x.partyId), m(x.total), dash(x.due)]),
    foot: ['Total', '', m(tot), m(due)],
    rowRefs: list.map((x) => ({ kind: 'purchase' as const, id: x.id })),
  };
};

/* --- `RPT['bill-list'] = RPT['purchase-summary']`, 3718 --- */
RPT['bill-list'] = (db, from, to, money) => ({
  ...RPT['purchase-summary'](db, from, to, money),
  title: 'Purchase bill list',
});

/* --- Purchases by product — reference 3719 --- */
RPT['purchase-by-item'] = (db, from, to) => {
  const lines: { productId: string; qty: number; cost: number }[] = [];
  purchasesBetween(db, from, to).forEach((x) => x.lines.forEach((l) => lines.push(l)));
  const groups = groupRows(lines, (l) => l.productId,
    (l) => ({ n: productOf(db, l.productId)?.name || '—', q: 0, v: 0 }),
    (g, l) => { g.q += l.qty; g.v += l.qty * l.cost; })
    .sort((a, b) => b.v - a.v);
  const rows: Cell[][] = groups.map((g) => [g.n, g.q, m(g.v)]);
  return {
    title: 'Purchases by product',
    cols: [{ h: 'Product' }, { h: 'Qty', r: true }, { h: 'Spend', r: true }],
    rows,
    foot: ['Total', sumCol(rows, 1), m(sumCol(rows, 2))],
  };
};

/* --- Purchases by supplier — reference 3728 --- */
RPT['purchase-by-supplier'] = (db, from, to) => {
  const groups = groupRows(purchasesBetween(db, from, to), (x) => x.partyId,
    (x) => ({ n: supplierName(db, x.partyId), c: 0, v: 0, d: 0 }),
    (g, x) => { g.c++; g.v += x.total; g.d += x.due; })
    .sort((a, b) => b.v - a.v);
  const rows: Cell[][] = groups.map((g) => [g.n, g.c, m(g.v), dash(g.d)]);
  return {
    title: 'Purchases by supplier',
    cols: [{ h: 'Supplier' }, { h: 'Bills', r: true }, { h: 'Spend', r: true }, { h: 'Owing', r: true }],
    rows,
    // The prototype left this one without a foot; every table here carries one.
    foot: ['Total', sumCol(rows, 1), m(sumCol(rows, 2)), m(sumCol(rows, 3))],
  };
};

/* --- Unpaid purchases — reference 3738; ignores the range, like the prototype --- */
RPT['unpaid-purchases'] = (db) => {
  const ps = db.purchases.filter((x) => x.due > 0)
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const rows: Cell[][] = ps.map((x) => {
    const a = ageOf(x.ts);
    return [x.no, supplierName(db, x.partyId), { text: a + 'd', n: a }, mTone(x.due, a > 30 ? 'danger' : 'warn')];
  });
  return {
    title: 'Unpaid purchases',
    cols: [{ h: 'Bill' }, { h: 'Supplier' }, { h: 'Age', r: true }, { h: 'Owing', r: true }],
    rows,
    foot: ['Total', '', '', m(sumCol(rows, 3))],
    rowRefs: ps.map((x) => ({ kind: 'purchase' as const, id: x.id })),
    note: 'Every open supplier bill, oldest first — the range does not apply.',
  };
};

/* --- Open purchase orders — reference 3747. This port's PurchaseOrder has
       no `expected` date and no stored `total`, so the order date stands in
       and the value is summed from its lines. --- */
RPT['open-orders'] = (db) => {
  const pos = (db.purchaseOrders || []).filter((p) => p.status === 'open');
  const rows: Cell[][] = pos.map((p) => {
    const total = purchaseTotal(p);
    const late = ageOf(p.ts) > 30;
    return [
      p.no, supplierName(db, p.partyId), shortDay(p.ts),
      late ? { text: 'overdue', tone: 'warn' as CellTone } : { text: 'open', tone: 'accent' as CellTone },
      m(total),
    ];
  });
  return {
    title: 'Open purchase orders',
    cols: [{ h: 'Order' }, { h: 'Supplier' }, { h: 'Ordered' }, { h: 'Status' }, { h: 'Value', r: true }],
    rows,
    foot: ['Total', '', '', '', m(sumCol(rows, 4))],
    note: 'An order older than 30 days and still open is flagged overdue.',
  };
};

/* ------------------------------------------------------------------ */
/* Report builders — Money                                             */
/* ------------------------------------------------------------------ */

/* --- Cash flow — reference RPT['cash-flow'], 3759 --- */
RPT['cash-flow'] = (db, from, to) => {
  const rows: Cell[][] = db.accounts.map((a) => {
    let inn = 0; let out = 0;
    db.journal.forEach((e) => {
      if (!within(e.ts, from, to)) return;
      e.lines.forEach((l) => { if (l.acc === a.id) { inn += l.dr || 0; out += l.cr || 0; } });
    });
    return [a.name, m(inn), m(out), signed(inn - out), m(accountBalance(db, a.id))];
  });
  return {
    title: 'Cash flow',
    cols: [{ h: 'Account' }, { h: 'In', r: true }, { h: 'Out', r: true }, { h: 'Net', r: true }, { h: 'Balance', r: true }],
    rows,
    foot: ['Total', m(sumCol(rows, 1)), m(sumCol(rows, 2)), m(sumCol(rows, 3)), m(sumCol(rows, 4))],
  };
};

const METHOD_NAMES: Record<string, string> = {
  cash: 'Cash', momo: 'Mobile money', bank: 'Bank', credit: 'On credit',
};

/* --- Payment types — reference 3771 --- */
RPT['payment-types'] = (db, from, to) => {
  const ss = salesBetween(db, from, to);
  const map: Record<string, { c: number; v: number }> = {};
  ss.forEach((s) => {
    const e = map[s.method] || (map[s.method] = { c: 0, v: 0 });
    e.c++; e.v += s.total;
  });
  const tot = ss.reduce((a, s) => a + s.total, 0);
  return {
    title: 'Payment types',
    cols: [{ h: 'Tender' }, { h: 'Bills', r: true }, { h: 'Value', r: true }, { h: 'Share', r: true }],
    rows: Object.keys(map).map((k) => [
      METHOD_NAMES[k] || k, map[k].c, m(map[k].v), pct(tot ? map[k].v / tot * 100 : 0),
    ]),
    foot: ['Total', ss.length, m(tot), tot ? '100%' : '0%'],
  };
};

/** The shared body of the two tender-split reports — reference 3781 and 3792. */
function tenderSplit(db: DB, from: number, to: number, title: string, head: string, nameOf: (s: Sale) => string): ReportResult {
  const map: Record<string, Record<string, number>> = {};
  salesBetween(db, from, to).forEach((s) => {
    const n = nameOf(s);
    const row = map[n] || (map[n] = { cash: 0, momo: 0, bank: 0, credit: 0 });
    row[s.method] = (row[s.method] || 0) + s.total;
  });
  const rows: Cell[][] = Object.keys(map).sort().map((n) => [
    n, m(map[n].cash), m(map[n].momo), m(map[n].bank), m(map[n].credit),
  ]);
  return {
    title,
    cols: [{ h: head }, { h: 'Cash', r: true }, { h: 'Mobile', r: true }, { h: 'Bank', r: true }, { h: 'Credit', r: true }],
    rows,
    foot: ['Total', m(sumCol(rows, 1)), m(sumCol(rows, 2)), m(sumCol(rows, 3)), m(sumCol(rows, 4))],
  };
}

RPT['payment-types-by-user'] = (db, from, to) =>
  tenderSplit(db, from, to, 'Payment types by user', 'User', (s) => userName(db, s.userId));

RPT['payment-types-by-customer'] = (db, from, to) =>
  tenderSplit(db, from, to, 'Payment types by customer', 'Customer', (s) => partyName(db, s.partyId));

/* --- Drawer cash entries — reference 3803. This port has no `DB.drawer`;
       the equivalent record is `DB.entries`, money in or out of an account,
       so the entry's category stands in for the prototype's reason and the
       account name for its user. --- */
RPT['drawer-entries'] = (db, from, to) => {
  const es = db.entries.filter((e) => e.direction !== 'transfer' && within(e.ts, from, to)).slice().reverse();
  const rows: Cell[][] = es.map((e) => {
    const acc = db.accounts.find((a) => a.id === e.accountId);
    const signedAmt = e.direction === 'in' ? e.amount : -e.amount;
    return [
      shortDay(e.ts), e.category || '—', e.note || '—', acc ? acc.name : '—',
      { text: (e.direction === 'in' ? '+ ' : '− ') + money0(e.amount), n: signedAmt, tone: (e.direction === 'in' ? 'good' : 'danger') as CellTone },
    ];
  });
  return {
    title: 'Drawer cash entries',
    cols: [{ h: 'Date' }, { h: 'Reason' }, { h: 'Note' }, { h: 'Account' }, { h: 'Amount', r: true }],
    rows,
    foot: ['Net', '', '', '', signed(sumCol(rows, 4))],
    rowRefs: es.map((e) => ({ kind: 'entry' as const, id: e.id })),
  };
};

/* --- Unpaid sales — reference 3811; ignores the range, like the prototype --- */
RPT['unpaid-sales'] = (db) => {
  const ss = db.sales.filter((s) => s.due > 0 && s.status !== 'void')
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const rows: Cell[][] = ss.map((s) => {
    const a = ageOf(s.ts);
    return [s.no, partyName(db, s.partyId), { text: a + 'd', n: a }, mTone(s.due, a > 30 ? 'danger' : 'warn')];
  });
  return {
    title: 'Unpaid sales',
    cols: [{ h: 'Bill' }, { h: 'Customer' }, { h: 'Age', r: true }, { h: 'Due', r: true }],
    rows,
    foot: ['Total', '', '', m(sumCol(rows, 3))],
    rowRefs: ss.map((s) => ({ kind: 'sale' as const, id: s.id })),
    note: 'Every open customer bill, oldest first — the range does not apply.',
  };
};

/* --- Expenses by category — reference 3820 --- */
RPT['expenses-by-category'] = (db, from, to) => {
  const map: Record<string, number> = {};
  db.entries.filter((e) => e.direction === 'out' && within(e.ts, from, to))
    .forEach((e) => { map[e.category] = (map[e.category] || 0) + e.amount; });
  const rows: Cell[][] = Object.keys(map).sort((a, b) => map[b] - map[a]).map((k) => [k, m(map[k])]);
  return {
    title: 'Expenses by category',
    cols: [{ h: 'Category' }, { h: 'Amount', r: true }],
    rows,
    foot: ['Total', m(sumCol(rows, 1))],
  };
};

/* ------------------------------------------------------------------ */
/* Report builders — Receivables                                       */
/* ------------------------------------------------------------------ */

/** Reference arRows(), 3829 — every open bill, oldest first. */
function arRows(db: DB): Sale[] {
  return db.sales.filter((s) => s.due > 0 && s.status !== 'void')
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
}

function emptyBuckets(): Record<Bucket, number> {
  return { '0–30': 0, '31–60': 0, '61–90': 0, '90+': 0 };
}

/** The ageing-summary table, shared by AR and AP — reference 3833 and 3897. */
function agingSummary<T extends { ts: string; due: number }>(
  db: DB,
  items: T[],
  nameOf: (x: T) => string,
  title: string,
  head: string,
): ReportResult {
  const map: Record<string, Record<Bucket, number> & { t: number }> = {};
  items.forEach((x) => {
    const n = nameOf(x);
    const e = map[n] || (map[n] = { ...emptyBuckets(), t: 0 });
    e[bucketOf(ageOf(x.ts))] += x.due;
    e.t += x.due;
  });
  const rows: Cell[][] = Object.keys(map).sort((a, b) => map[b].t - map[a].t).map((n) => [
    n, m(map[n]['0–30']), m(map[n]['31–60']), m(map[n]['61–90']),
    mTone(map[n]['90+'], 'danger'), m(map[n].t),
  ]);
  return {
    title,
    cols: [
      { h: head }, { h: '0–30', r: true }, { h: '31–60', r: true },
      { h: '61–90', r: true }, { h: '90+', r: true }, { h: 'Total', r: true },
    ],
    rows,
    foot: ['Total', m(sumCol(rows, 1)), m(sumCol(rows, 2)), m(sumCol(rows, 3)), m(sumCol(rows, 4)), m(sumCol(rows, 5))],
  };
}

/** The bucket-totals report, shared by AR and AP — reference 3874 and 3919. */
function bucketSummary(
  items: { ts: string; due: number }[],
  title: string,
  footLabel: string,
  money: (n: number) => string,
): ReportResult {
  const b = emptyBuckets();
  items.forEach((x) => { b[bucketOf(ageOf(x.ts))] += x.due; });
  const total = BUCKETS.reduce((a, k) => a + b[k], 0);
  return {
    title,
    stats: [
      { k: '0–30 days', v: money(b['0–30']) },
      { k: '31–60 days', v: money(b['31–60']), tone: 'w' },
      { k: '61–90 days', v: money(b['61–90']), tone: 'w' },
      { k: 'Over 90 days', v: money(b['90+']), tone: 'd' },
    ],
    cols: [{ h: 'Bucket' }, { h: 'Amount', r: true }],
    rows: BUCKETS.map((k) => [k, m(b[k])]),
    foot: [footLabel, m(total)],
  };
}

RPT['ar-aging-summary'] = (db) =>
  agingSummary(db, arRows(db), (x) => partyName(db, (x as Sale).partyId), 'AR ageing summary', 'Customer');

/* --- AR ageing details — reference 3846 --- */
RPT['ar-aging-details'] = (db) => {
  const ss = arRows(db);
  const rows: Cell[][] = ss.map((s) => {
    const a = ageOf(s.ts);
    return [s.no, partyName(db, s.partyId), shortDay(s.ts), { text: a + 'd', n: a }, bucketOf(a), mTone(s.due, a > 90 ? 'danger' : 'warn')];
  });
  return {
    title: 'AR ageing details',
    cols: [{ h: 'Bill' }, { h: 'Customer' }, { h: 'Date' }, { h: 'Age', r: true }, { h: 'Bucket' }, { h: 'Due', r: true }],
    rows,
    foot: ['Total', '', '', '', '', m(sumCol(rows, 5))],
    rowRefs: ss.map((s) => ({ kind: 'sale' as const, id: s.id })),
  };
};

/* --- Invoice details — reference 3853 --- */
RPT['invoice-details'] = (db, from, to) => {
  const ss = salesBetween(db, from, to).slice().reverse();
  const rows: Cell[][] = ss.map((s) => [
    s.no, partyName(db, s.partyId), m(s.total), m(s.paid), dash(s.due),
  ]);
  return {
    title: 'Invoice details',
    cols: [{ h: 'Bill' }, { h: 'Customer' }, { h: 'Total', r: true }, { h: 'Settled', r: true }, { h: 'Due', r: true }],
    rows,
    foot: ['Total', '', m(sumCol(rows, 2)), m(sumCol(rows, 3)), m(sumCol(rows, 4))],
    rowRefs: ss.map((s) => ({ kind: 'sale' as const, id: s.id })),
  };
};

/* --- Quote details — reference 3860. This port's Estimate carries no
       `validUntil`, so the quote date takes that column's place. --- */
RPT['quote-details'] = (db, from, to) => {
  const qs = (db.estimates || []).filter((e) => within(e.ts, from, to)).slice().reverse();
  const rows: Cell[][] = qs.map((e) => [
    e.no, partyName(db, e.partyId), shortDay(e.ts), m(e.total),
    {
      text: e.status,
      tone: (e.status === 'converted' ? 'good' : e.status === 'void' ? 'danger' : 'muted') as CellTone,
    },
  ]);
  return {
    title: 'Quote details',
    cols: [{ h: 'Quote' }, { h: 'Customer' }, { h: 'Raised' }, { h: 'Value', r: true }, { h: 'Status' }],
    rows,
    foot: ['Total', '', '', m(sumCol(rows, 3)), qs.filter((e) => e.status === 'open').length + ' open'],
  };
};

/* --- Customer balance summary — reference 3867 --- */
RPT['customer-balance-summary'] = (db) => {
  const rows: Cell[][] = db.parties.filter((p) => p.type === 'customer' && p.active)
    .map((p) => {
      let inv = 0; let paid = 0;
      db.sales.forEach((s) => {
        if (s.partyId === p.id && s.status !== 'void') { inv += s.total; paid += s.paid; }
      });
      return { p, inv, paid };
    })
    .filter((x) => x.inv > 0)
    .map((x) => [x.p.name, m(x.inv), m(x.paid), dash(partyBalance(db, x.p.id))]);
  return {
    title: 'Customer balance summary',
    cols: [{ h: 'Customer' }, { h: 'Invoiced', r: true }, { h: 'Paid', r: true }, { h: 'Owing', r: true }],
    rows,
    foot: ['Total', m(sumCol(rows, 1)), m(sumCol(rows, 2)), m(sumCol(rows, 3))],
  };
};

RPT['receivable-summary'] = (db, _f, _t, money) =>
  bucketSummary(arRows(db), 'Receivable summary', 'Total owed to you', money);

/* --- `RPT['receivable-details'] = RPT['ar-aging-details']`, 3888 --- */
RPT['receivable-details'] = (db, from, to, money) => ({
  ...RPT['ar-aging-details'](db, from, to, money),
  title: 'Receivable details',
});

/* ------------------------------------------------------------------ */
/* Report builders — Payables                                          */
/* ------------------------------------------------------------------ */

/** Reference apRows(), 3891. */
function apRows(db: DB) {
  return db.purchases.filter((x) => x.due > 0)
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
}

RPT['ap-aging-summary'] = (db) => {
  return agingSummary(
    db,
    apRows(db).map((x) => ({ ts: x.ts, due: x.due, name: supplierName(db, x.partyId) })),
    (x) => x.name,
    'AP ageing summary', 'Supplier',
  );
};

/* --- AP ageing details — reference 3906 --- */
RPT['ap-aging-details'] = (db) => {
  const ps = apRows(db);
  const rows: Cell[][] = ps.map((x) => {
    const a = ageOf(x.ts);
    return [x.no, supplierName(db, x.partyId), shortDay(x.ts), { text: a + 'd', n: a }, mTone(x.due, a > 90 ? 'danger' : 'warn')];
  });
  return {
    title: 'AP ageing details',
    cols: [{ h: 'Bill' }, { h: 'Supplier' }, { h: 'Date' }, { h: 'Age', r: true }, { h: 'Owing', r: true }],
    rows,
    foot: ['Total', '', '', '', m(sumCol(rows, 4))],
    rowRefs: ps.map((x) => ({ kind: 'purchase' as const, id: x.id })),
  };
};

/* --- Supplier balance summary — reference 3912 --- */
RPT['supplier-balance-summary'] = (db) => {
  const rows: Cell[][] = db.parties.filter((p) => p.type === 'supplier' && p.active).map((p) => {
    let billed = 0; let paid = 0;
    db.purchases.forEach((x) => {
      if (x.partyId === p.id) { billed += x.total; paid += x.paid || 0; }
    });
    return [p.name, m(billed), m(paid), dash(Math.max(0, -partyBalance(db, p.id)))];
  });
  return {
    title: 'Supplier balance summary',
    cols: [{ h: 'Supplier' }, { h: 'Billed', r: true }, { h: 'Paid', r: true }, { h: 'Owing', r: true }],
    rows,
    foot: ['Total', m(sumCol(rows, 1)), m(sumCol(rows, 2)), m(sumCol(rows, 3))],
  };
};

RPT['payable-summary'] = (db, _f, _t, money) =>
  bucketSummary(apRows(db), 'Payable summary', 'Total you owe', money);

/* --- `RPT['payable-details'] = RPT['ap-aging-details']`, 3933 --- */
RPT['payable-details'] = (db, from, to, money) => ({
  ...RPT['ap-aging-details'](db, from, to, money),
  title: 'Payable details',
});

/* ------------------------------------------------------------------ */
/* Report builders — Stock                                             */
/* ------------------------------------------------------------------ */

/* --- Stock summary — reference RPT['stock-summary'], 3937 --- */
RPT['stock-summary'] = (db) => {
  const rows: Cell[][] = db.products.filter((p) => p.active).map((p) => {
    const q = stockOf(p);
    return [p.name, { text: q + ' ' + p.unit, n: q }, m(q * p.cost), m(q * p.price)];
  });
  return {
    title: 'Stock summary',
    cols: [{ h: 'Item' }, { h: 'On hand', r: true }, { h: 'At cost', r: true }, { h: 'At sale', r: true }],
    rows,
    foot: ['Total', '', m(sumCol(rows, 2)), m(sumCol(rows, 3))],
  };
};

/* --- Stock movement — reference 3943 --- */
RPT['stock-movement'] = (db, from, to) => {
  const ms = db.movements.filter((x) => within(x.ts, from, to)).slice().reverse().slice(0, 150);
  const rows: Cell[][] = ms.map((x) => [
    shortDay(x.ts), productOf(db, x.productId)?.name || '—', x.type, x.ref || '—',
    { text: (x.qty > 0 ? '+' : '') + x.qty, n: x.qty, tone: (x.qty > 0 ? 'good' : 'danger') as CellTone },
  ]);
  return {
    title: 'Stock movement',
    cols: [{ h: 'Date' }, { h: 'Item' }, { h: 'Type' }, { h: 'Ref' }, { h: 'Qty', r: true }],
    rows,
    foot: ['Net', '', '', '', { text: String(sumCol(rows, 4)), n: sumCol(rows, 4) }],
    note: ms.length === 150 ? 'The 150 most recent movements in the range.' : undefined,
  };
};

/* --- Batch movement: every posting against a lot, with its running balance --- */
RPT['batch-movement'] = (db, from, to) => {
  const tracked = new Set(db.products.filter((p) => p.trackBatches).map((p) => p.id));

  // the balance has to run from the beginning of the lot, not the start of the
  // window, or the figure shown against the first row in range would be wrong
  const running = new Map<string, number>();
  const all = db.movements
    .filter((m) => m.batchNo && tracked.has(m.productId))
    .slice()
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  const withBalance = all.map((m) => {
    const key = m.productId + '·' + m.batchNo;
    const next = (running.get(key) || 0) + m.qty;
    running.set(key, next);
    return { m, balance: next };
  });

  const rows: Cell[][] = withBalance
    .filter((x) => within(x.m.ts, from, to))
    .reverse()
    .slice(0, 200)
    .map((x) => [
      shortDay(x.m.ts),
      productOf(db, x.m.productId)?.name || '—',
      x.m.batchNo || '—',
      x.m.type,
      x.m.ref || '—',
      { text: (x.m.qty > 0 ? '+' : '') + x.m.qty, n: x.m.qty, tone: (x.m.qty > 0 ? 'good' : 'danger') as CellTone },
      { text: String(x.balance), n: x.balance },
    ]);

  return {
    title: 'Batch movement',
    cols: [
      { h: 'Date' }, { h: 'Item' }, { h: 'Batch' }, { h: 'Type' }, { h: 'Ref' },
      { h: 'Qty', r: true }, { h: 'Balance', r: true },
    ],
    rows,
    note: !tracked.size
      ? 'No item has batch tracking switched on yet.'
      : rows.length === 200
        ? 'The 200 most recent batch movements in the range.'
        : 'The balance runs from the day the lot was opened, not from the start of the range.',
  };
};

/* --- Batch balances: what each lot still holds --- */
RPT['batch-balances'] = (db) => {
  const rows: Cell[][] = [];
  db.products.forEach((p) => {
    if (!p.trackBatches) return;
    (p.batches || []).forEach((b) => {
      if (b.qty <= 0) return;
      const days = b.expiry
        ? Math.floor((new Date(b.expiry).getTime() - Date.now()) / 86400000)
        : null;
      const tone: CellTone = days === null ? 'muted'
        : days < 0 ? 'danger'
          : days <= 7 ? 'danger'
            : days <= 90 ? 'warn' : 'good';
      rows.push([
        p.name,
        b.no,
        { text: b.expiry ? shortDay(b.expiry) : 'none', tone },
        { text: days === null ? '—' : String(days), n: days ?? 0, tone },
        { text: String(b.qty), n: b.qty },
        m(b.qty * p.cost),
      ]);
    });
  });

  rows.sort((a, b) => {
    const x = typeof a[3] === 'object' ? (a[3] as any).n : 0;
    const y = typeof b[3] === 'object' ? (b[3] as any).n : 0;
    return x - y;
  });

  return {
    title: 'Batch balances',
    cols: [
      { h: 'Item' }, { h: 'Batch' }, { h: 'Expires' }, { h: 'Days', r: true },
      { h: 'Qty', r: true }, { h: 'Value', r: true },
    ],
    rows,
    foot: ['Total', '', '', '', { text: String(sumCol(rows, 4)), n: sumCol(rows, 4) }, m(sumCol(rows, 5))],
    note: rows.length ? 'Soonest to expire first.' : 'No tracked lot is holding stock.',
  };
};

/* --- Low stock — reference 3951 --- */
RPT['low-stock'] = (db) => {
  const ps = db.products.filter((p) => p.active && stockOf(p) <= p.reorder);
  const rows: Cell[][] = ps.map((p) => {
    const q = stockOf(p);
    return [
      p.name,
      { text: q + ' ' + p.unit, n: q, tone: (q <= 0 ? 'danger' : 'warn') as CellTone },
      p.reorder,
      m(Math.max(0, p.reorder - q) * p.cost),
    ];
  });
  return {
    title: 'Low stock',
    cols: [{ h: 'Item' }, { h: 'On hand', r: true }, { h: 'Reorder at', r: true }, { h: 'To restock', r: true }],
    rows,
    foot: ['Total', '', '', m(sumCol(rows, 3))],
  };
};

/* --- Reorder list — reference 3958 --- */
RPT['reorder-list'] = (db) => {
  const t0 = startOfDay(daysAgo(29));
  const sold = soldLines(db, t0, endOfDay());
  const rows: Cell[][] = db.products.filter((p) => p.active).map((p) => {
    const q = sold.filter((x) => x.l.productId === p.id).reduce((a, x) => a + x.l.qty, 0);
    const perDay = q / 30;
    const cover = perDay ? Math.round(stockOf(p) / perDay) : 999;
    const suggest = Math.max(0, Math.ceil(perDay * 30 + p.reorder - stockOf(p)));
    return { p, cover, suggest };
  })
    .filter((r) => r.suggest > 0)
    .sort((a, b) => a.cover - b.cover)
    .map((r) => [
      r.p.name,
      { text: stockOf(r.p) + ' ' + r.p.unit, n: stockOf(r.p) },
      r.cover > 200
        ? { text: '—', n: 999, tone: 'muted' as CellTone }
        : { text: r.cover + 'd', n: r.cover, tone: (r.cover < 7 ? 'danger' : r.cover < 21 ? 'warn' : undefined) as CellTone | undefined },
      { text: r.suggest + ' ' + r.p.unit, n: r.suggest },
      m(r.suggest * r.p.cost),
    ]);
  return {
    title: 'Reorder list',
    cols: [{ h: 'Item' }, { h: 'On hand', r: true }, { h: 'Cover', r: true }, { h: 'Order', r: true }, { h: 'Cost', r: true }],
    rows,
    foot: ['Total', '', '', '', m(sumCol(rows, 4))],
    note: 'Suggested quantity covers 30 days at the last month’s selling rate, plus the reorder level.',
  };
};

/* --- Batch / expiry — reference 3975. This port's ProductBatch names the
       code `no`, not `code`. --- */
RPT['expiry'] = (db, _f, _t, money) => {
  const items: { n: string; c: string; q: number; u: string; d: number; v: number }[] = [];
  db.products.forEach((p) => {
    (p.batches || []).forEach((b) => {
      const d = Math.ceil((new Date(b.expiry).getTime() - Date.now()) / 864e5);
      items.push({ n: p.name, c: b.no, q: b.qty, u: p.unit, d, v: b.qty * p.cost });
    });
  });
  items.sort((a, b) => a.d - b.d);
  const cols: ReportCol[] = [
    { h: 'Item' }, { h: 'Batch' }, { h: 'Qty', r: true }, { h: 'Expires', r: true }, { h: 'Value', r: true },
  ];
  if (!items.length) {
    return empty('Batch / expiry', cols,
      'No tracked batches. Give a product batch codes and expiry dates and they show up here.');
  }
  const gone = items.filter((r) => r.d < 0);
  const rows: Cell[][] = items.map((r) => [
    r.n, r.c, { text: r.q + ' ' + r.u, n: r.q },
    {
      text: r.d < 0 ? Math.abs(r.d) + 'd ago' : 'in ' + r.d + 'd',
      n: r.d,
      tone: (r.d < 0 ? 'danger' : r.d < 30 ? 'warn' : undefined) as CellTone | undefined,
    },
    m(r.v),
  ]);
  return {
    title: 'Batch / expiry',
    stats: gone.length ? [{
      k: 'Past date',
      v: gone.length + ' · ' + money(gone.reduce((a, r) => a + r.v, 0)),
      tone: 'd',
    }] : undefined,
    cols,
    rows,
    foot: ['Total', '', '', '', m(sumCol(rows, 4))],
  };
};

/* --- Loss & damage — reference 3993 --- */
RPT['loss-damage'] = (db, from, to) => {
  const ms = db.movements.filter((x) =>
    within(x.ts, from, to) && x.qty < 0 && (x.type === 'adjust' || x.type === 'stocktake'));
  const rows: Cell[][] = ms.map((x) => {
    const p = productOf(db, x.productId);
    return [
      shortDay(x.ts), p?.name || '—', x.ref || '—',
      { text: Math.abs(x.qty) + ' ' + (p?.unit || ''), n: Math.abs(x.qty) },
      mTone(Math.abs(x.qty) * (p?.cost || 0), 'danger'),
    ];
  });
  return {
    title: 'Loss & damage',
    cols: [{ h: 'Date' }, { h: 'Item' }, { h: 'Reason' }, { h: 'Qty', r: true }, { h: 'Value', r: true }],
    rows,
    foot: ['Total', '', '', sumCol(rows, 3), m(sumCol(rows, 4))],
  };
};

/* --- Fast-moving — reference 4002 --- */
RPT['fast-moving'] = (db, from, to) => {
  const rows: Cell[][] = groupRows(soldLines(db, from, to), (x) => x.l.productId,
    (x) => ({ id: x.l.productId, n: x.l.name, q: 0, v: 0 }),
    (g, x) => { g.q += x.l.qty; g.v += x.value; })
    .sort((a, b) => b.q - a.q).slice(0, 20)
    .map((g) => {
      const p = productOf(db, g.id);
      const on = p ? stockOf(p) : 0;
      return [
        g.n, { text: g.q + ' ' + (p?.unit || ''), n: g.q }, m(g.v),
        { text: on + ' ' + (p?.unit || ''), n: on },
      ];
    });
  return {
    title: 'Fast-moving products',
    cols: [{ h: 'Item' }, { h: 'Sold', r: true }, { h: 'Revenue', r: true }, { h: 'On hand', r: true }],
    rows,
    foot: ['Total', sumCol(rows, 1), m(sumCol(rows, 2)), sumCol(rows, 3)],
    note: 'The twenty best sellers in the range, by units.',
  };
};

/* --- Slow-moving — reference 4011 --- */
RPT['slow-moving'] = (db, from, to) => {
  const soldIds: Record<string, number> = {};
  soldLines(db, from, to).forEach((x) => {
    soldIds[x.l.productId] = (soldIds[x.l.productId] || 0) + x.l.qty;
  });
  const rows: Cell[][] = db.products
    .filter((p) => p.active && stockOf(p) > 0 && !soldIds[p.id])
    .map((p) => [p.name, p.category, { text: stockOf(p) + ' ' + p.unit, n: stockOf(p) }, m(stockOf(p) * p.cost)]);
  return {
    title: 'Slow-moving products',
    cols: [{ h: 'Item' }, { h: 'Category' }, { h: 'On hand', r: true }, { h: 'Tied up', r: true }],
    rows,
    foot: ['Total', '', '', m(sumCol(rows, 3))],
    note: 'Stock sitting on the shelf with no sales in this period — money you cannot spend.',
  };
};

/* --- Stock adjustment by item — reference 4020 --- */
RPT['stock-adjustment'] = (db, from, to) => {
  const ms = db.movements
    .filter((x) => within(x.ts, from, to) && (x.type === 'adjust' || x.type === 'stocktake'))
    .slice().reverse();
  const rows: Cell[][] = ms.map((x) => {
    const p = productOf(db, x.productId);
    return [
      shortDay(x.ts), p?.name || '—', x.ref || '—',
      { text: (x.qty > 0 ? '+' : '') + x.qty, n: x.qty, tone: (x.qty > 0 ? 'good' : 'danger') as CellTone },
      m(Math.abs(x.qty) * (p?.cost || 0)),
    ];
  });
  return {
    title: 'Stock adjustment by item',
    cols: [{ h: 'Date' }, { h: 'Item' }, { h: 'Reference' }, { h: 'Change', r: true }, { h: 'Value', r: true }],
    rows,
    foot: ['Net', '', '', { text: String(sumCol(rows, 3)), n: sumCol(rows, 3) }, m(sumCol(rows, 4))],
  };
};

/* --- Stock valuation — reference 4029 --- */
RPT['stock-valuation'] = (db) => {
  const map: Record<string, { c: number; s: number; n: number }> = {};
  db.products.filter((p) => p.active).forEach((p) => {
    const e = map[p.category] || (map[p.category] = { c: 0, s: 0, n: 0 });
    e.c += stockOf(p) * p.cost;
    e.s += stockOf(p) * p.price;
    e.n++;
  });
  const rows: Cell[][] = Object.keys(map).sort().map((k) => [
    k, map[k].n, m(map[k].c), m(map[k].s), m(map[k].s - map[k].c),
  ]);
  return {
    title: 'Stock valuation',
    cols: [{ h: 'Category' }, { h: 'Items', r: true }, { h: 'Cost', r: true }, { h: 'Sale', r: true }, { h: 'Margin', r: true }],
    rows,
    foot: ['Total', sumCol(rows, 1), m(sumCol(rows, 2)), m(sumCol(rows, 3)), m(sumCol(rows, 4))],
  };
};

/* --- Production runs — reference 4040. This port's ProductionRun has no
       `no` and stores `componentCost` / `finishedValue` rather than
       `cost` / `unitCost`, so the date leads and unit cost is derived. --- */
RPT['production-report'] = (db, from, to) => {
  const runs = (db.productionRuns || []).filter((r) => within(r.ts, from, to)).slice().reverse();
  const rows: Cell[][] = runs.map((r) => {
    const p = productOf(db, r.productId);
    return [
      shortDay(r.ts), p?.name || '—', { text: r.qty + ' ' + (p?.unit || ''), n: r.qty },
      m(r.componentCost), m(r.qty ? r.componentCost / r.qty : 0), m(r.finishedValue),
    ];
  });
  return {
    title: 'Production runs',
    cols: [
      { h: 'Date' }, { h: 'Product' }, { h: 'Made', r: true },
      { h: 'Cost', r: true }, { h: 'Each', r: true }, { h: 'Value', r: true },
    ],
    rows,
    foot: ['Total', '', sumCol(rows, 2), m(sumCol(rows, 3)), '', m(sumCol(rows, 5))],
  };
};

/* ------------------------------------------------------------------ */
/* Report builders — Tax & books                                       */
/* ------------------------------------------------------------------ */

/* --- Tax summary — reference RPT['tax-summary'], 4052. This port's
       CreditNote carries no `tax` field, so VAT is recomputed from its
       lines' tax rates. --- */
RPT['tax-summary'] = (db, from, to, money) => {
  const ss = salesBetween(db, from, to);
  const output = ss.reduce((a, s) => a + s.tax, 0);
  const credits = (db.creditNotes || []).filter((c) => within(c.ts, from, to))
    .reduce((a, c) => a + creditNoteTax(c), 0);
  const rate = db.settings.taxRate || 0;
  const ps = purchasesBetween(db, from, to);
  const input = ps.reduce((a, x) => a + (x.total - x.total / (1 + rate / 100)), 0);
  const net = output - credits - input;
  const purchaseGross = ps.reduce((a, x) => a + x.total, 0);
  return {
    title: 'Tax summary',
    stats: [
      { k: 'Output VAT on sales', v: money(output), tone: 'w' },
      { k: 'Less credit notes', v: money(credits) },
      { k: 'Input VAT on purchases', v: money(input) },
      { k: 'Payable', v: money(net), tone: net > 0 ? 'd' : 'g' },
    ],
    cols: [{ h: 'Line' }, { h: 'Amount', r: true }],
    rows: [
      ['Taxable sales (net)', m(ss.reduce((a, s) => a + (s.total - s.tax), 0))],
      ['Output VAT', m(output)],
      ['Credit notes VAT', { text: '(' + money0(credits) + ')', n: -credits, tone: 'muted' }],
      ['Purchases (net)', m(purchaseGross - input)],
      ['Input VAT', { text: '(' + money0(input) + ')', n: -input, tone: 'muted' }],
    ],
    foot: ['Net VAT payable', m(net)],
  };
};

/* --- Party statement — reference 4072. The prototype read the chosen party
       from `UI.params`; with no picker here it runs on the first active
       party, which the note says. --- */
RPT['party-statement'] = (db) => {
  const p = db.parties.filter((x) => x.active)[0];
  const cols: ReportCol[] = [
    { h: 'Date' }, { h: 'Detail' }, { h: 'Debit', r: true }, { h: 'Credit', r: true }, { h: 'Balance', r: true },
  ];
  if (!p) return empty('Party statement', cols, 'No parties yet — add a customer or supplier first.');
  const rows = partyLedgerRows(db, p.id);
  const view = rows.slice().reverse();
  const closing = rows.length ? rows[rows.length - 1].balance : 0;
  return {
    title: 'Party statement',
    stats: [{ k: p.name, v: money0(closing), tone: closing > 0 ? 'w' : 'g' }],
    cols,
    rows: view.map((r) => [
      shortDay(r.ts), r.memo, dash(r.debit, 'accent'), dash(r.credit, 'good'), m(r.balance),
    ]),
    foot: ['Closing balance', '', '', '', m(closing)],
    rowRefs: view.map((r) => r.ref || null),
    note: 'Running ledger for ' + p.name + '.',
  };
};

/* --- Trial balance — reference 4085 --- */
RPT['trial-balance'] = (db, _f, _t, money) => {
  const accs: Record<string, { d: number; c: number }> = {};
  db.journal.forEach((e) => e.lines.forEach((l) => {
    const a = accs[l.acc] || (accs[l.acc] = { d: 0, c: 0 });
    a.d += l.dr || 0; a.c += l.cr || 0;
  }));
  const keys = Object.keys(accs);
  const rows: Cell[][] = keys.map((k) => {
    const net = accs[k].d - accs[k].c;
    return [accName(db, k), net > 0 ? m(net) : '', net < 0 ? m(-net) : ''];
  });
  const td = keys.reduce((a, k) => { const n = accs[k].d - accs[k].c; return a + (n > 0 ? n : 0); }, 0);
  const tc = keys.reduce((a, k) => { const n = accs[k].d - accs[k].c; return a + (n < 0 ? -n : 0); }, 0);
  const ok = Math.abs(td - tc) < 2;
  return {
    title: 'Trial balance',
    stats: [{ k: ok ? 'Books balance' : 'Out by', v: ok ? '✓' : money(Math.abs(td - tc)), tone: ok ? 'g' : 'd' }],
    cols: [{ h: 'Account' }, { h: 'Debit', r: true }, { h: 'Credit', r: true }],
    rows,
    foot: ['Total', m(td), m(tc)],
  };
};

/* --- General ledger — reference accountingView('ledger'), 3221 --- */
RPT['general-ledger'] = (db) => {
  const rows: Cell[][] = allAccountIds(db).map((id) => {
    let dr = 0; let cr = 0;
    db.journal.forEach((e) => e.lines.forEach((l) => {
      if (l.acc === id) { dr += l.dr || 0; cr += l.cr || 0; }
    }));
    return [accName(db, id), m(dr), m(cr), { text: money0(Math.abs(dr - cr)) + (dr - cr >= 0 ? ' Dr' : ' Cr'), n: dr - cr }];
  });
  return {
    title: 'General ledger',
    cols: [{ h: 'Account' }, { h: 'Debit', r: true }, { h: 'Credit', r: true }, { h: 'Closing', r: true }],
    rows,
    foot: ['Total', m(sumCol(rows, 1)), m(sumCol(rows, 2)), m(sumCol(rows, 3))],
  };
};

/* --- Profit & loss — reference RPT['pnl'], 4092 --- */
RPT['pnl'] = (db, from, to, money) => {
  const sales = salesBetween(db, from, to);
  const sale = sales.reduce((a, s) => a + (s.total - s.tax), 0);
  const cogs = sales.reduce((a, s) => a + s.cogs, 0);
  const exp = db.entries.filter((e) => e.direction === 'out' && within(e.ts, from, to))
    .reduce((a, e) => a + e.amount, 0);
  const inc = db.entries.filter((e) => e.direction === 'in' && within(e.ts, from, to))
    .reduce((a, e) => a + e.amount, 0);
  const ret = (db.creditNotes || []).filter((c) => within(c.ts, from, to))
    .reduce((a, c) => a + (c.total - creditNoteTax(c)), 0);
  const gp = sale - ret - cogs;
  const np = gp + inc - exp;
  return {
    title: 'Profit & loss',
    stats: [
      { k: 'Gross profit', v: money(gp), tone: 'a' },
      { k: 'Net profit', v: money(np), tone: np >= 0 ? 'g' : 'd' },
    ],
    cols: [{ h: 'Line' }, { h: 'Amount', r: true }],
    rows: [
      ['Sales (net of VAT)', m(sale)],
      ['Less returns', { text: '(' + money0(ret) + ')', n: -ret, tone: 'muted' }],
      ['Less cost of goods sold', { text: '(' + money0(cogs) + ')', n: -cogs, tone: 'muted' }],
      ['Gross profit', mTone(gp, 'accent')],
      ['Other income', m(inc)],
      ['Less expenses', { text: '(' + money0(exp) + ')', n: -exp, tone: 'muted' }],
    ],
    foot: ['Net profit', m(np)],
  };
};

/* --- Balance sheet — reference accountingView('bs'), 3244, flattened to one
       table with a section column. --- */
RPT['balance-sheet'] = (db, _f, _t, money) => {
  const ids = allAccountIds(db);
  const assets = ids.filter((id) => accType(db, id) === 'asset')
    .map((id) => ({ n: accName(db, id), v: accountBalance(db, id) }));
  const liab = ids.filter((id) => accType(db, id) === 'liability')
    .map((id) => ({ n: accName(db, id), v: -accountBalance(db, id) }));
  const ta = assets.reduce((a, r) => a + r.v, 0);
  const tl = liab.reduce((a, r) => a + r.v, 0);
  const retained = ['n_sales', 'n_income', 'n_cogs', 'n_expense', 'n_discount', 'n_loyalty']
    .reduce((a, k) => a + nominalTotal(db, k), 0);
  const eq = -accountBalance(db, 'n_equity');
  const rows: Cell[][] = [
    ...assets.map((r) => ['Assets', r.n, m(r.v)] as Cell[]),
    ['Assets', 'Total assets', mTone(ta, 'accent')],
    ...liab.map((r) => ['Liabilities', r.n, m(r.v)] as Cell[]),
    ['Liabilities', 'Total liabilities', mTone(tl, 'accent')],
    ['Equity', 'Owner equity', m(eq)],
    ['Equity', 'Retained profit', m(retained)],
    ['Equity', 'Total equity', mTone(eq + retained, 'accent')],
  ];
  const balanced = Math.abs(ta - (tl + eq + retained)) < 2;
  return {
    title: 'Balance sheet',
    stats: [
      { k: 'Assets', v: money(ta), tone: 'a' },
      { k: 'Liabilities + equity', v: money(tl + eq + retained), tone: balanced ? 'g' : 'w' },
    ],
    cols: [{ h: 'Section' }, { h: 'Line' }, { h: 'Amount', r: true }],
    rows,
    foot: ['Balance', balanced ? 'Balanced' : 'Out of balance', m(ta - (tl + eq + retained))],
  };
};

/* --- Z report summary — reference 4104 --- */
RPT['zreport-summary'] = (db) => {
  const cols: ReportCol[] = [
    { h: 'Day' }, { h: 'User' }, { h: 'Till' },
    { h: 'Expected', r: true }, { h: 'Counted', r: true }, { h: 'Variance', r: true },
  ];
  const ss = (db.shifts || []).filter((s) => s.closedAt).slice().reverse();
  if (!ss.length) {
    return empty('Z report summary', cols, 'No closed shifts. Close a shift and its Z report lands here.');
  }
  const rows: Cell[][] = ss.map((s) => {
    const v = (s.countedCash || 0) - (s.expected || 0);
    return [
      shortDay(s.openedAt), userName(db, s.userId), s.till,
      m(s.expected || 0), m(s.countedCash || 0),
      {
        text: Math.abs(v) < 1 ? 'balanced' : (v > 0 ? '+' : '−') + money0(Math.abs(v)),
        n: v,
        tone: (Math.abs(v) < 1 ? 'good' : v < 0 ? 'danger' : 'warn') as CellTone,
      },
    ];
  });
  return {
    title: 'Z report summary',
    cols,
    rows,
    foot: ['Total', '', '', m(sumCol(rows, 3)), m(sumCol(rows, 4)), signed(sumCol(rows, 5))],
  };
};

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/** The ids that have a live builder. Everything else returns a "not built yet" result. */
export function implementedReports(): string[] {
  return Object.keys(RPT);
}

export function isImplemented(id: string): boolean {
  return !!RPT[id];
}

function defaultMoney(n: number): string { return money0(n); }

/**
 * Build one report. Never throws: an unknown id, an unbuilt id or a builder
 * that fails all come back as a `ReportResult` the UI can still render.
 * Reference runReport(), line 4121.
 */
export function runReport(
  db: DB,
  id: string,
  from: number,
  to: number,
  money: (n: number) => string = defaultMoney,
): ReportResult {
  const def = reportById(id);
  const title = def ? def.name : 'Report';
  const build = RPT[id];
  if (!build) {
    return {
      title,
      cols: [{ h: 'Report' }],
      rows: [],
      notImplemented: true,
      note: def
        ? def.name + ' is not built yet. It arrives in the next release.'
        : 'That report is not in this build.',
    };
  }
  try {
    return build(db, from, to, money);
  } catch (e) {
    return {
      title,
      cols: [{ h: 'Report' }],
      rows: [],
      error: e instanceof Error ? e.message : String(e),
      note: 'Could not build this report.',
    };
  }
}

/* ------------------------------------------------------------------ */
/* Sorting — driven by `cols`, used by the shared renderer              */
/* ------------------------------------------------------------------ */

export type SortDir = 'asc' | 'desc';

/**
 * Sort `rows` by column `i`. Numeric columns (`col.r`) sort on the number
 * behind the cell; everything else sorts on text. `rowRefs` travels with the
 * row so a sorted row still opens the right transaction.
 */
export function sortRows(
  result: ReportResult,
  i: number,
  dir: SortDir,
): { rows: Cell[][]; rowRefs?: (RowRef | null)[] } {
  const numeric = !!result.cols[i]?.r;
  const refs = result.rowRefs;
  const idx = result.rows.map((_, n) => n);
  idx.sort((a, b) => {
    const ra = result.rows[a][i];
    const rb = result.rows[b][i];
    const cmp = numeric
      ? cellNum(ra) - cellNum(rb)
      : cellText(ra).localeCompare(cellText(rb), undefined, { numeric: true, sensitivity: 'base' });
    return dir === 'asc' ? cmp : -cmp;
  });
  return {
    rows: idx.map((n) => result.rows[n]),
    rowRefs: refs ? idx.map((n) => refs[n] || null) : undefined,
  };
}
