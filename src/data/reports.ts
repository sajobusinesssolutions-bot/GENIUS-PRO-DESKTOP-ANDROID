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
 * The analysis a paid plan (or the free trial) opens. Once a trial has ended
 * or a plan has run out these are locked; the everyday reports a shop needs to
 * close the day, count stock and chase money stay open, so the books are never
 * unreadable.
 */
export const PREMIUM_REPORTS = new Set<string>([
  'hourly-sales', 'sales-by-category', 'sales-by-customer', 'sales-by-user', 'sale-summary-by-user',
  'sale-summary-by-category-item', 'user-profit', 'user-hourly', 'user-time', 'bill-profit', 'sales-by-items',
  'profit-margin', 'discounts-granted', 'offer-usage', 'quote-conversion', 'purchase-by-item', 'purchase-by-supplier',
  'cash-flow', 'payment-types-by-user', 'payment-types-by-customer', 'ar-aging-summary', 'ar-aging-details',
  'ap-aging-summary', 'ap-aging-details', 'receivable-details', 'payable-details', 'stock-movement',
  'days-out-of-stock', 'amc', 'aamc', 'aawc', 'reorder-list', 'batch-movement', 'batch-balances', 'fast-moving',
  'slow-moving', 'stock-valuation', 'production-report', 'ledger-summary', 'voucher-summary', 'trial-balance',
  'general-ledger', 'pnl', 'balance-sheet', 'zreport-summary', 'daybook',
]);
export const isPremiumReport = (id: string) => PREMIUM_REPORTS.has(id);

/**
 * Reference REPORTS, line 3359 — the prototype's 67 entries less the EFRIS
 * log, which this build does not carry, so 66.
 */
export const REPORTS: ReportDef[] = [
  // Sales
  { id: 'day-close', cat: 'Sales', name: 'Z report · end of day', sub: 'Close the day — takings by mode and cashier' },
  { id: 'x-report', cat: 'Sales', name: 'X report', sub: 'Today so far, without closing' },
  { id: 'sale-summary', cat: 'Sales', name: 'Sale summary', sub: 'All sales with tax and dues' },
  { id: 'daily-sales', cat: 'Sales', name: 'Daily sales', sub: 'Each sale with cash and credit detail' },
  { id: 'daybook', cat: 'Sales', name: 'Day book', sub: 'All transactions in the range, with debit and credit columns' },
  { id: 'hourly-sales', cat: 'Sales', name: 'Hourly sales', sub: 'Which hours sell the most' },
  { id: 'invoice-list', cat: 'Sales', name: 'Invoice list', sub: 'Every sale in the range' },
  { id: 'item-sales', cat: 'Sales', name: 'Item list (units sold)', sub: 'Quantity and revenue per item' },
  { id: 'sales-by-category', cat: 'Sales', name: 'Sales by category', sub: 'Product groups ranked by revenue' },
  { id: 'sales-by-customer', cat: 'Sales', name: 'Sales by customer', sub: 'Who buys the most' },
  { id: 'sales-by-user', cat: 'Sales', name: 'Sales by cashier', sub: 'Bills and totals per user' },
  { id: 'sale-summary-by-user', cat: 'Sales', name: 'Sale summary by user', sub: 'Items, sales, tax, discounts per rep' },
  { id: 'sale-summary-by-category-item', cat: 'Sales', name: 'Sale summary by category & item', sub: 'Every item under its category' },
  { id: 'user-profit', cat: 'Sales', name: 'User sales & profit', sub: 'Revenue, cost, profit and margin per rep' },
  { id: 'user-hourly', cat: 'Sales', name: 'User sales by hour', sub: 'When each rep sells through the day' },
  { id: 'user-time', cat: 'Sales', name: 'User time on shift', sub: 'Hours worked and average shift length' },
  { id: 'bill-profit', cat: 'Sales', name: 'Sale-wise profit', sub: 'Profit earned on each sale' },
  { id: 'sales-by-items', cat: 'Sales', name: 'Sales by items (per sale)', sub: 'Each sale grouped, with per-line profit' },
  { id: 'profit-margin', cat: 'Sales', name: 'Profit & margin', sub: 'Revenue vs cost per item' },
  { id: 'discounts-granted', cat: 'Sales', name: 'Discounts granted', sub: 'Every discounted sale, who and how much' },
  { id: 'refunds', cat: 'Sales', name: 'Refunds', sub: 'Credit notes issued in the range' },
  { id: 'voided-items', cat: 'Sales', name: 'Voided sales', sub: 'Everything voided, by whom and why' },
  { id: 'offer-usage', cat: 'Sales', name: 'Offer take-up', sub: 'Which promotions are actually used' },
  { id: 'quote-conversion', cat: 'Sales', name: 'Quote conversion', sub: 'How many quotations turn into sales' },
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
  { id: 'ar-aging-details', cat: 'Receivables', name: 'AR ageing details', sub: 'Every open sale with its age' },
  { id: 'invoice-details', cat: 'Receivables', name: 'Invoice details', sub: 'Every sale and how much is settled' },
  { id: 'quote-details', cat: 'Receivables', name: 'Quote details', sub: 'Quotations with their status' },
  { id: 'customer-balance-summary', cat: 'Receivables', name: 'Customer balance summary', sub: 'Invoiced, paid and still owing' },
  { id: 'receivable-summary', cat: 'Receivables', name: 'Receivable summary', sub: 'The debtors book in age buckets' },
  { id: 'receivable-statement', cat: 'Receivables', name: 'Receivable statement', sub: 'Every customer: opening, sales, payments and closing balance' },
  { id: 'receivable-details', cat: 'Receivables', name: 'Receivable details', sub: 'Everything owed to you, oldest first' },
  // Payables
  { id: 'ap-aging-summary', cat: 'Payables', name: 'AP ageing summary', sub: 'What you owe each supplier' },
  { id: 'ap-aging-details', cat: 'Payables', name: 'AP ageing details', sub: 'Every open supplier bill with its age' },
  { id: 'supplier-balance-summary', cat: 'Payables', name: 'Supplier balance summary', sub: 'Billed, paid and still owing' },
  { id: 'payable-summary', cat: 'Payables', name: 'Payable summary', sub: 'The creditors book in age buckets' },
  { id: 'payable-statement', cat: 'Payables', name: 'Payable statement', sub: 'Every supplier: opening, bills, payments and closing balance' },
  { id: 'payable-details', cat: 'Payables', name: 'Payable details', sub: 'Everything you owe, oldest first' },
  // Stock
  { id: 'stock-summary', cat: 'Stock', name: 'Stock summary', sub: 'Quantity and value of every item' },
  { id: 'stock-movement', cat: 'Stock', name: 'Stock movement', sub: 'Every in and out with reference' },
  { id: 'days-out-of-stock', cat: 'Stock', name: 'Days out of stock', sub: 'Items and the days they were unavailable' },
  { id: 'amc', cat: 'Stock', name: 'Average monthly consumption', sub: 'Average units consumed per calendar month' },
  { id: 'aamc', cat: 'Stock', name: 'Adjusted average monthly consumption', sub: 'Consumption normalized for stockout months' },
  { id: 'aawc', cat: 'Stock', name: 'Adjusted average weekly consumption', sub: 'Consumption normalized for stockout weeks' },
  { id: 'low-stock', cat: 'Stock', name: 'Low stock', sub: 'Items at or below reorder level' },
  { id: 'reorder-list', cat: 'Stock', name: 'Reorder list', sub: 'What to buy now, with suggested quantity' },
  { id: 'expiry', cat: 'Stock', name: 'Batch / expiry', sub: 'Tracked batches by days to expiry' },
  { id: 'batch-movement', cat: 'Stock', name: 'Batch movement', sub: 'Every in and out, by lot, with a running balance' },
  { id: 'batch-balances', cat: 'Stock', name: 'Batches & expiry', sub: 'What each lot holds, when it expires and what it is worth' },
  { id: 'loss-damage', cat: 'Stock', name: 'Loss & damage', sub: 'Stock written off, with value' },
  { id: 'fast-moving', cat: 'Stock', name: 'Fast-moving products', sub: 'Best sellers with current stock' },
  { id: 'slow-moving', cat: 'Stock', name: 'Slow-moving products', sub: 'Holding stock with no sales in range' },
  { id: 'stock-adjustment', cat: 'Stock', name: 'Stock adjustment by item', sub: 'Recounts grouped by reference' },
  { id: 'stock-valuation', cat: 'Stock', name: 'Stock valuation', sub: 'Cost vs sale value, by category' },
  { id: 'production-report', cat: 'Stock', name: 'Production runs', sub: 'What was made and what it cost' },
  // Tax & books
  { id: 'tax-summary', cat: 'Tax & books', name: 'Tax summary', sub: 'VAT levied — sales vs purchases' },
  { id: 'party-statement', cat: 'Tax & books', name: 'Party statement', sub: 'Running ledger for any party' },
  { id: 'ledger-summary', cat: 'Tax & books', name: 'Ledger summary', sub: 'Debit, credit and closing by ledger' },
  { id: 'voucher-summary', cat: 'Tax & books', name: 'Voucher summary', sub: 'Journal vouchers with date, type and reference' },
  { id: 'chart-of-accounts', cat: 'Tax & books', name: 'Chart of accounts', sub: 'Every ledger with type, totals and balance' },
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

/*
 * REPORTS THAT ARE ONE REPORT.
 *
 * Many of the 76 reports are the same figures cut another way — a summary and
 * its detail, the same totals by cashier or by customer. Listed separately
 * they buried the one a shop owner was looking for. A group is one entry in
 * the list; the report opens on its first view and chips switch between the
 * others. Every view keeps its own id and calculation, so favourites, links
 * and the Windows till's matching reports are untouched.
 */
export interface ReportGroup { key: string; name: string; sub: string; views: { id: string; label: string }[] }

export const REPORT_GROUPS: ReportGroup[] = [
  { key: 'end-of-day', name: 'End of day', sub: 'Today so far, closing the day, and past closes', views: [
    { id: 'day-close', label: 'Close the day (Z)' }, { id: 'x-report', label: 'So far today (X)' }, { id: 'zreport-summary', label: 'Past closes' }] },
  { key: 'sales-register', name: 'Sales register', sub: 'Every bill: summary, by day, list and settlement', views: [
    { id: 'sale-summary', label: 'Summary' }, { id: 'daily-sales', label: 'By day' }, { id: 'invoice-list', label: 'Bill list' }, { id: 'invoice-details', label: 'Settlement' }] },
  { key: 'sales-items', name: 'Sales by item & category', sub: 'What sold, by item, category or sale', views: [
    { id: 'item-sales', label: 'Items' }, { id: 'sales-by-category', label: 'Categories' }, { id: 'sale-summary-by-category-item', label: 'Category & item' }, { id: 'sales-by-items', label: 'Per sale' }] },
  { key: 'staff', name: 'Staff sales', sub: 'Each cashier: totals, profit, hours and shifts', views: [
    { id: 'sales-by-user', label: 'Totals' }, { id: 'sale-summary-by-user', label: 'Summary' }, { id: 'user-profit', label: 'Profit' }, { id: 'user-hourly', label: 'By hour' }, { id: 'user-time', label: 'Time on shift' }] },
  { key: 'profit', name: 'Profit', sub: 'What each item and each sale earned', views: [
    { id: 'profit-margin', label: 'Per item' }, { id: 'bill-profit', label: 'Per sale' }] },
  { key: 'quotes', name: 'Quotations', sub: 'Quotes, their status and how many become sales', views: [
    { id: 'quote-details', label: 'Details' }, { id: 'quote-conversion', label: 'Conversion' }] },
  { key: 'purchases', name: 'Purchases', sub: 'Supplier bills: summary, list, by product and supplier', views: [
    { id: 'purchase-summary', label: 'Summary' }, { id: 'bill-list', label: 'Bill list' }, { id: 'purchase-by-item', label: 'By product' }, { id: 'purchase-by-supplier', label: 'By supplier' }] },
  { key: 'payment-types', name: 'Payment types', sub: 'Cash, mobile money and bank — in total, by cashier, by customer', views: [
    { id: 'payment-types', label: 'Totals' }, { id: 'payment-types-by-user', label: 'By cashier' }, { id: 'payment-types-by-customer', label: 'By customer' }] },
  { key: 'receivables', name: 'Customers who owe', sub: 'Balances, ageing and every unpaid sale', views: [
    { id: 'ar-aging-summary', label: 'Ageing' }, { id: 'ar-aging-details', label: 'Ageing details' }, { id: 'customer-balance-summary', label: 'Balances' },
    { id: 'receivable-summary', label: 'Debtors book' }, { id: 'receivable-details', label: 'Oldest first' }, { id: 'unpaid-sales', label: 'Unpaid sales' }] },
  { key: 'payables', name: 'Suppliers you owe', sub: 'Balances, ageing and every unpaid supplier bill', views: [
    { id: 'ap-aging-summary', label: 'Ageing' }, { id: 'ap-aging-details', label: 'Ageing details' }, { id: 'supplier-balance-summary', label: 'Balances' },
    { id: 'payable-summary', label: 'Creditors book' }, { id: 'payable-details', label: 'Oldest first' }, { id: 'unpaid-purchases', label: 'Unpaid bills' }] },
  { key: 'stock-value', name: 'Stock on hand', sub: 'Quantity and value of every item, and by category', views: [
    { id: 'stock-summary', label: 'Items' }, { id: 'stock-valuation', label: 'Value by category' }] },
  { key: 'reorder', name: 'Low stock & reorder', sub: 'What is running out, and how much to buy', views: [
    { id: 'reorder-list', label: 'Reorder list' }, { id: 'low-stock', label: 'Low stock' }] },
  { key: 'movers', name: 'Fast & slow movers', sub: 'Best sellers, and stock that is not moving', views: [
    { id: 'fast-moving', label: 'Fast' }, { id: 'slow-moving', label: 'Slow' }] },
];

/**
 * Reports left out of the list because another shows the same thing: the
 * expiry list is the batch balances in another order.
 */
const HIDDEN = new Set(['expiry']);

const GROUP_OF = new Map<string, ReportGroup>();
REPORT_GROUPS.forEach((g) => g.views.forEach((v) => GROUP_OF.set(v.id, g)));
export const groupOf = (id: string): ReportGroup | undefined => GROUP_OF.get(id);

/** A row in the report list: a group standing in for its views, or a report on its own. */
export interface ReportEntry extends ReportDef { group?: ReportGroup }

/** The list as shown: each group once, where its first member sits; everything else as it is. */
export function reportEntries(): ReportEntry[] {
  const seen = new Set<string>();
  const out: ReportEntry[] = [];
  for (const r of REPORTS) {
    if (HIDDEN.has(r.id)) continue;
    const g = GROUP_OF.get(r.id);
    if (!g) { out.push(r); continue; }
    if (seen.has(g.key)) continue;
    seen.add(g.key);
    const first = REPORTS.find((x) => x.id === g.views[0].id) || r;
    out.push({ id: first.id, cat: first.cat, name: g.name, sub: g.sub, group: g });
  }
  return out;
}

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
export type RowRefKind = 'sale' | 'purchase' | 'payment' | 'entry' | 'creditNote' | 'product' | 'month' | 'ledger' | 'party' | 'voucher' | 'vouchertype';

/** How a row of a statement is drawn: a section heading, an ordinary line, a subtotal, or the bottom line. */
export type RowKind = 'head' | 'line' | 'sub' | 'total';
export interface RowRef { kind: RowRefKind; id: string }

export const INVENTORY_METRIC_REPORTS = ['days-out-of-stock', 'amc', 'aamc', 'aawc'] as const;
export type InventoryMetricReport = typeof INVENTORY_METRIC_REPORTS[number];

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
  /**
   * Drawn as a financial statement (sections, lines, subtotals and a bottom
   * line) rather than as a grid. Parallel to `rows` when given.
   */
  rowKinds?: RowKind[];
  /** Offer a search box over the rows — for lists that run long. */
  searchable?: boolean;
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

function monthKeyFor(ts: string | number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}`;
}

function monthLabelForKey(key: string): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m, 1);
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function monthStartForKey(key: string): number {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 1).getTime();
}

function monthEndForKey(key: string): number {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m + 1, 0, 23, 59, 59, 999).getTime();
}

function monthKeysBetween(from: number, to: number): string[] {
  const start = new Date(from || Date.now());
  const end = new Date(to || Date.now());
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  const keys: string[] = [];
  while (cursor <= last) {
    keys.push(monthKeyFromDate(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return keys;
}

function monthKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}`;
}

function isConsumptionMovement(type: string): boolean {
  return type === 'sale' || type === 'production-consume';
}

interface StockoutInterval { from: number; to: number }
interface InventoryMetricSnapshot {
  inward: number;
  outward: number;
  consumption: number;
  closing: number;
  daysOut: number;
  availableDays: number;
}

function inventoryMetricSnapshot(
  db: DB,
  product: Product,
  from: number,
  to: number,
): InventoryMetricSnapshot {
  const all = db.movements
    .filter((m) => m.productId === product.id)
    .slice()
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const periodTo = to || Date.now();
  const periodFrom = from || (all[0] ? startOfDay(new Date(all[0].ts)) : periodTo);
  const historicalOpening = stockOf(product) - all.reduce((sum, m) => sum + m.qty, 0);
  let running = historicalOpening;
  const firstMovement = all[0];
  const startsUnavailable = running < 0 || (!firstMovement && running === 0) || (running === 0 && firstMovement && firstMovement.qty < 0);
  let stockoutFrom: number | null = startsUnavailable ? periodFrom : null;
  const intervals: StockoutInterval[] = [];
  all.forEach((m) => {
    const ts = new Date(m.ts).getTime();
    if (ts > periodTo) return;
    const before = running;
    running += m.qty;
    if (before > 0 && running <= 0) stockoutFrom = ts;
    if (before <= 0 && running > 0 && stockoutFrom !== null) {
      // A receipt makes stock available for that calendar day. Count only
      // complete unavailable days before the receipt day.
      intervals.push({ from: stockoutFrom, to: startOfDay(new Date(ts)) });
      stockoutFrom = null;
    }
  });
  if (stockoutFrom !== null) intervals.push({ from: stockoutFrom, to: periodTo });

  const daysOut = intervals.reduce((sum, x) => {
    const a = Math.max(x.from, periodFrom);
    const b = Math.min(x.to, periodTo);
    return sum + (b > a ? Math.ceil((b - a) / 86400000) : 0);
  }, 0);
  const totalDays = Math.max(1, Math.floor((startOfDay(periodTo) - startOfDay(periodFrom)) / 86400000) + 1);
  const periodMoves = all.filter((m) => within(m.ts, periodFrom, periodTo));
  const inward = periodMoves.reduce((sum, m) => sum + Math.max(0, m.qty), 0);
  const outward = periodMoves.reduce((sum, m) => sum + Math.max(0, -m.qty), 0);
  const consumption = periodMoves
    .filter((m) => isConsumptionMovement(m.type))
    .reduce((sum, m) => sum + Math.max(0, -m.qty), 0);
  return { inward, outward, consumption, closing: running, daysOut: Math.min(daysOut, totalDays), availableDays: Math.max(0, totalDays - Math.min(daysOut, totalDays)) };
}

function metricValue(metric: InventoryMetricReport, snapshot: InventoryMetricSnapshot, from: number, to: number): number {
  if (metric === 'days-out-of-stock') return snapshot.daysOut;
  const months = Math.max(1, monthKeysBetween(from, to).length);
  if (metric === 'amc') return snapshot.consumption / months;
  if (metric === 'aamc') {
    const availableDaysInSample = Math.max(0, 90 - snapshot.daysOut);
    return availableDaysInSample > 0 ? (snapshot.consumption * 30.5) / availableDaysInSample : 0;
  }
  if (metric === 'aawc') {
    const availableDaysInSample = Math.max(0, 56 - snapshot.daysOut);
    return availableDaysInSample > 0 ? (snapshot.consumption * 7) / availableDaysInSample : 0;
  }
  return 0;
}

function metricLabel(metric: InventoryMetricReport): string {
  if (metric === 'days-out-of-stock') return 'Days out';
  if (metric === 'amc') return 'AMC';
  if (metric === 'aamc') return 'AAMC';
  return 'AAWC';
}

function aamcSample(from: number, to: number): { from: number; to: number } {
  const sampleTo = to || Date.now();
  const sampleFrom = startOfDay(sampleTo - (90 - 1) * 86400000);
  return { from: sampleFrom, to: sampleTo };
}

function aawcSample(from: number, to: number): { from: number; to: number } {
  const sampleTo = to || Date.now();
  const sampleFrom = startOfDay(sampleTo - (56 - 1) * 86400000);
  return { from: sampleFrom, to: sampleTo };
}

export function inventoryMetricDrill(
  db: DB,
  metric: InventoryMetricReport,
  productId: string,
  from: number,
  to: number,
  monthKey?: string,
  dayKey?: string,
): ReportResult {
  const product = productOf(db, productId);
  if (!product) return empty(metricLabel(metric), [{ h: 'Item' }], 'This item is no longer in stock records.');
  const firstMovement = db.movements
    .filter((m) => m.productId === productId)
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())[0];
  const baseFrom = from || (firstMovement ? startOfDay(new Date(firstMovement.ts)) : (to || Date.now()));
  const baseTo = to || Date.now();
  const sample = metric === 'aamc' ? aamcSample(baseFrom, baseTo)
    : metric === 'aawc' ? aawcSample(baseFrom, baseTo)
      : { from: baseFrom, to: baseTo };
  const periodFrom = sample.from;
  const periodTo = sample.to;
  if (!monthKey) {
    const months = monthKeysBetween(periodFrom, periodTo);
    const rows = months.map((key) => {
      const a = Math.max(periodFrom, monthStartForKey(key));
      const b = Math.min(periodTo, monthEndForKey(key));
      const s = inventoryMetricSnapshot(db, product, a, b);
      const metricCell = { text: String(metric === 'days-out-of-stock' ? s.daysOut : metricValue(metric, s, a, b)), n: metric === 'days-out-of-stock' ? s.daysOut : metricValue(metric, s, a, b) };
      return metric === 'days-out-of-stock'
        ? [monthLabelForKey(key), { text: String(s.inward), n: s.inward }, { text: String(s.outward), n: s.outward }, { text: String(s.closing), n: s.closing }, metricCell]
        : [monthLabelForKey(key), { text: String(s.inward), n: s.inward }, { text: String(s.outward), n: s.outward }, { text: String(s.closing), n: s.closing }, { text: String(s.daysOut), n: s.daysOut }, metricCell];
    });
    const cols = metric === 'days-out-of-stock'
      ? [{ h: 'Month' }, { h: 'Inward', r: true }, { h: 'Outward', r: true }, { h: 'Closing', r: true }, { h: 'Days out', r: true }]
      : [{ h: 'Month' }, { h: 'Inward', r: true }, { h: 'Outward', r: true }, { h: 'Closing', r: true }, { h: 'Days out', r: true }, { h: metricLabel(metric), r: true }];
    return {
      title: `${product.name} · ${metricLabel(metric)}`,
      cols,
      rows,
      rowRefs: months.map((key) => ({ kind: 'month' as const, id: key })),
      foot: metric === 'days-out-of-stock'
        ? ['Total', { text: String(sumCol(rows, 1)), n: sumCol(rows, 1) }, { text: String(sumCol(rows, 2)), n: sumCol(rows, 2) }, '', { text: String(sumCol(rows, 4)), n: sumCol(rows, 4) }]
        : ['Total', { text: String(sumCol(rows, 1)), n: sumCol(rows, 1) }, { text: String(sumCol(rows, 2)), n: sumCol(rows, 2) }, '', { text: String(sumCol(rows, 4)), n: sumCol(rows, 4) }, ''],
      note: 'Tap a month to see daily inward, outward, closing stock, and stockout days. Adjusted consumption uses only days when stock was available.',
    };
  }

  const days: string[] = [];
  const first = new Date(Math.max(periodFrom, monthStartForKey(monthKey)));
  const last = new Date(Math.min(periodTo, monthEndForKey(monthKey)));
  for (const cursor = new Date(first.getFullYear(), first.getMonth(), first.getDate()); cursor <= last; cursor.setDate(cursor.getDate() + 1)) days.push(`${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`);
  const rows = days.map((key) => {
    const [y, m, d] = key.split('-').map(Number);
    const dayFrom = new Date(y, m, d).getTime();
    const dayTo = new Date(y, m, d, 23, 59, 59, 999).getTime();
    const s = inventoryMetricSnapshot(db, product, dayFrom, dayTo);
    const metricCell = { text: String(metric === 'days-out-of-stock' ? s.daysOut : metricValue(metric, s, dayFrom, dayTo)), n: metric === 'days-out-of-stock' ? s.daysOut : metricValue(metric, s, dayFrom, dayTo) };
    return metric === 'days-out-of-stock'
      ? [shortDay(dayFrom), { text: String(s.inward), n: s.inward }, { text: String(s.outward), n: s.outward }, { text: String(s.closing), n: s.closing }, metricCell]
      : [shortDay(dayFrom), { text: String(s.inward), n: s.inward }, { text: String(s.outward), n: s.outward }, { text: String(s.closing), n: s.closing }, { text: String(s.daysOut), n: s.daysOut }, metricCell];
  });
  const cols = metric === 'days-out-of-stock'
    ? [{ h: 'Date' }, { h: 'Inward', r: true }, { h: 'Outward', r: true }, { h: 'Closing', r: true }, { h: 'Days out', r: true }]
    : [{ h: 'Date' }, { h: 'Inward', r: true }, { h: 'Outward', r: true }, { h: 'Closing', r: true }, { h: 'Days out', r: true }, { h: metricLabel(metric), r: true }];
  return {
    title: `${product.name} · ${monthLabelForKey(monthKey)}`,
    cols,
    rows,
    foot: metric === 'days-out-of-stock'
      ? ['Total', { text: String(sumCol(rows, 1)), n: sumCol(rows, 1) }, { text: String(sumCol(rows, 2)), n: sumCol(rows, 2) }, '', { text: String(sumCol(rows, 4)), n: sumCol(rows, 4) }]
      : ['Total', { text: String(sumCol(rows, 1)), n: sumCol(rows, 1) }, { text: String(sumCol(rows, 2)), n: sumCol(rows, 2) }, '', { text: String(sumCol(rows, 4)), n: sumCol(rows, 4) }, ''],
    note: `Daily ${metricLabel(metric)} detail for ${product.name}.`,
  };
}

export function stockMovementDrill(
  db: DB,
  productId: string,
  from: number,
  to: number,
  monthKey?: string,
): ReportResult {
  const product = productOf(db, productId);
  if (!product) {
    return {
      title: 'Stock movement',
      cols: [{ h: 'Item' }, { h: 'Stock In', r: true }, { h: 'Stock Out', r: true }, { h: 'Closing', r: true }],
      rows: [],
      note: 'This item is no longer in stock records.',
    };
  }

  const items = db.movements
    .filter((m) => m.productId === productId && within(m.ts, from, to))
    .slice()
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  if (!monthKey) {
    const monthMap: Record<string, typeof items> = {};
    items.forEach((m) => {
      const key = monthKeyFor(m.ts);
      if (!monthMap[key]) monthMap[key] = [];
      monthMap[key].push(m);
    });

    const keys = Object.keys(monthMap).sort();
    const rows: Cell[][] = [];
    const rowRefs: RowRef[] = [];
    let running = 0;

    keys.forEach((key) => {
      const bucket = monthMap[key];
      const inQty = bucket.reduce((a, x) => a + Math.max(0, x.qty), 0);
      const outQty = bucket.reduce((a, x) => a + Math.max(0, -x.qty), 0);
      running += bucket.reduce((a, x) => a + x.qty, 0);
      rows.push([
        monthLabelForKey(key),
        { text: String(inQty), n: inQty, tone: inQty ? 'good' as CellTone : undefined },
        { text: String(outQty), n: outQty, tone: outQty ? 'danger' as CellTone : undefined },
        { text: String(running), n: running, tone: 'accent' as CellTone },
      ]);
      rowRefs.push({ kind: 'month', id: key });
    });

    return {
      title: `${product.name} · stock movement`,
      cols: [{ h: 'Month' }, { h: 'Stock In', r: true }, { h: 'Stock Out', r: true }, { h: 'Closing', r: true }],
      rows,
      rowRefs,
      foot: ['Total', { text: String(sumCol(rows, 1)), n: sumCol(rows, 1) }, { text: String(sumCol(rows, 2)), n: sumCol(rows, 2) }, { text: String(sumCol(rows, 3)), n: sumCol(rows, 3) }],
      note: 'Tap a month to see the detailed movement for that month.',
    };
  }

  const monthItems = db.movements
    .filter((m) => m.productId === productId && monthKeyFor(m.ts) === monthKey)
    .slice()
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  const earlierQty = db.movements
    .filter((m) => m.productId === productId && new Date(m.ts).getTime() < new Date(monthKey + '-01T00:00:00').getTime())
    .reduce((a, m) => a + m.qty, 0);

  const rows: Cell[][] = [[
    shortDay(from || Date.now()),
    'Opening Balance',
    'opening',
    '—',
    '',
    '',
    { text: String(earlierQty), n: earlierQty, tone: 'muted' as CellTone },
  ]];
  let running = earlierQty;
  monthItems.forEach((m) => {
    const inQty = Math.max(0, m.qty);
    const outQty = Math.max(0, -m.qty);
    running += m.qty;
    rows.push([
      shortDay(m.ts),
      product.name,
      m.type || 'stock',
      m.ref || '—',
      inQty ? { text: String(inQty), n: inQty, tone: 'good' as CellTone } : '',
      outQty ? { text: String(outQty), n: outQty, tone: 'danger' as CellTone } : '',
      { text: String(running), n: running, tone: 'accent' as CellTone },
    ]);
  });

  return {
    title: `${product.name} · ${monthLabelForKey(monthKey)}`,
    cols: [{ h: 'Date' }, { h: 'Particulars' }, { h: 'Voucher Type' }, { h: 'Voucher No' }, { h: 'Stock In', r: true }, { h: 'Stock Out', r: true }, { h: 'Closing', r: true }],
    rows,
    foot: ['Closing', '', '', '', '', '', { text: String(running), n: running }],
    note: `Showing the stock movements for ${product.name} in ${monthLabelForKey(monthKey)}.`,
  };
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
  return db.coa?.find((l) => l.id === id)?.name || NOMINAL[id] || db.accounts.find((a) => a.id === id)?.name || id;
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
  const chartType = db.coa?.find((ledger) => ledger.id === id)?.type;
  if (chartType) return chartType;
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

function accountTypeOrder(type?: string): number {
  switch (type) {
    case 'asset': return 0;
    case 'equity': return 1;
    case 'liability': return 2;
    case 'income': return 3;
    case 'expense': return 4;
    default: return 99;
  }
}

function orderedLedgerIds(db: DB): string[] {
  const ids = allAccountIds(db);
  const map = new Map<string, { code?: string; name: string; type?: string }>();
  ids.forEach((id) => map.set(id, { code: db.coa?.find((l) => l.id === id)?.code, name: accName(db, id), type: (db.coa?.find((l) => l.id === id)?.type || accType(db, id)) }));
  return ids.sort((a, b) => {
    const aa = map.get(a)!; const bb = map.get(b)!;
    const ord = accountTypeOrder(aa.type) - accountTypeOrder(bb.type);
    if (ord !== 0) return ord;
    return (aa.code || aa.name || a).localeCompare(bb.code || bb.name || b);
  });
}

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
      { k: 'Sales', v: String(z.count) },
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
      { k: 'Sales', v: String(sales.length) },
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
      ['Average sale', m(sales.length ? gross / sales.length : 0)],
      ['Settled at the till', m(gross - due)],
    ],
    foot: ['Gross profit', m(profit)],
  };
};

/* --- Daily sales — each transaction with the required voucher fields and cash/credit split --- */
function txRow(date: string, type: string, no: string, particulars: string, extra: Cell[] = []): Cell[] {
  return [shortDay(date), type, no, particulars, ...extra];
}

RPT['daily-sales'] = (db, from, to) => {
  const sales = salesBetween(db, from, to).slice().reverse();
  const rows: Cell[][] = sales.map((s) => {
    const methodTotal = s.methods
      ? s.methods.reduce((sum, m) => sum + (m.method === 'cash' || m.method === 'momo' || m.method === 'bank' ? m.amount : 0), 0)
      : (s.method === 'cash' || s.method === 'momo' || s.method === 'bank') ? s.total : 0;
    const creditTotal = s.methods
      ? s.methods.reduce((sum, m) => sum + (m.method === 'credit' ? m.amount : 0), 0)
      : (s.method === 'credit' ? s.total : Math.max(0, s.due));
    return txRow(s.ts, 'Sale', s.no, partyName(db, s.partyId) || 'Walk-in', [m(methodTotal), m(creditTotal), m(s.total)]);
  });
  return {
    title: 'Daily sales',
    cols: [
      { h: 'Date' }, { h: 'Vch Type' }, { h: 'Vch No' }, { h: 'Particulars' },
      { h: 'Cash', r: true }, { h: 'Credit', r: true }, { h: 'Total', r: true },
    ],
    rows,
    foot: ['Total', '', '', '', m(sumCol(rows, 4)), m(sumCol(rows, 5)), m(sumCol(rows, 6))],
    rowRefs: sales.map((s) => ({ kind: 'sale' as const, id: s.id })),
  };
};

RPT['daybook'] = (db, from, to) => {
  const txns: Array<{ ts: string; type: string; no: string; particulars: string; debit: number; credit: number; ref?: RowRef }> = [];

  (db.sales || []).filter((s) => within(s.ts, from, to) && s.status !== 'void').forEach((s) => {
    txns.push({
      ts: s.ts,
      type: 'Sale',
      no: s.no,
      particulars: partyName(db, s.partyId) || 'Walk-in',
      debit: 0,
      credit: s.total,
      ref: { kind: 'sale', id: s.id },
    });
  });
  (db.purchases || []).filter((p) => within(p.ts, from, to) && p.status !== 'void').forEach((p) => {
    txns.push({
      ts: p.ts,
      type: 'Purchase',
      no: p.no,
      particulars: supplierName(db, p.partyId),
      debit: p.total,
      credit: 0,
      ref: { kind: 'purchase', id: p.id },
    });
  });
  (db.entries || []).filter((e) => within(e.ts, from, to)).forEach((e) => {
    txns.push({
      ts: e.ts,
      type: 'Entry',
      no: e.id.slice(0, 8).toUpperCase(),
      particulars: e.note || e.category || 'Entry',
      debit: e.direction === 'in' ? e.amount : 0,
      credit: e.direction === 'out' ? e.amount : 0,
      ref: { kind: 'entry', id: e.id },
    });
  });

  txns.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const rows: Cell[][] = txns.map((t) => txRow(t.ts, t.type, t.no, t.particulars, [m(t.debit), m(t.credit)]));

  return {
    title: 'Day book',
    cols: [
      { h: 'Date' }, { h: 'Vch Type' }, { h: 'Vch No' }, { h: 'Particulars' },
      { h: 'Debit', r: true }, { h: 'Credit', r: true },
    ],
    rows,
    rowRefs: txns.map((t) => t.ref || null),
    foot: ['Total', '', '', '', m(sumCol(rows, 4)), m(sumCol(rows, 5))],
    note: 'Every transaction in the range, booked by date with debit and credit split.',
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
    cols: [{ h: 'Hour' }, { h: 'Count', r: true }, { h: 'Sales', r: true }],
    rows,
    foot: ['Total', sumCol(rows, 1), m(sumCol(rows, 2))],
  };
};

/* --- Invoice list — reference RPT['invoice-list'], 3502 --- */
RPT['invoice-list'] = (db, from, to) => {
  const sales = salesBetween(db, from, to).slice().reverse();
  const rows: Cell[][] = sales.map((s) => txRow(s.ts, 'Sale', s.no, partyName(db, s.partyId) || 'Walk-in', [s.method, m(s.total), dash(s.due)]));
  return {
    title: 'Invoice list',
    cols: [{ h: 'Date' }, { h: 'Vch Type' }, { h: 'Vch No' }, { h: 'Customer' }, { h: 'Mode' }, { h: 'Total', r: true }, { h: 'Due', r: true }],
    rows,
    foot: ['Total', '', '', '', '', m(sumCol(rows, 5)), m(sumCol(rows, 6))],
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
    cols: [{ h: 'Customer' }, { h: 'Sales', r: true }, { h: 'Value', r: true }, { h: 'Unpaid', r: true }],
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
    cols: [{ h: 'Cashier' }, { h: 'Sales', r: true }, { h: 'Value', r: true }, { h: 'Average', r: true }],
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
    cols: [{ h: 'Rep' }, { h: 'Hour' }, { h: 'Count', r: true }, { h: 'Sales', r: true }],
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
    title: 'Sale-wise profit',
    cols: [{ h: 'Sale' }, { h: 'Customer' }, { h: 'Total', r: true }, { h: 'Profit', r: true }, { h: 'Margin', r: true }],
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
    title: 'Sales by items (per sale)',
    cols: [
      { h: 'Sale' }, { h: 'Customer' }, { h: 'Item' }, { h: 'Qty', r: true },
      { h: 'Price', r: true }, { h: 'Value', r: true }, { h: 'Profit', r: true },
    ],
    rows,
    foot: ['Total', '', '', sumCol(rows, 3), '', m(sumCol(rows, 5)), m(sumCol(rows, 6))],
    rowRefs: refs,
    note: sales.length === 30 ? 'The 30 most recent sales in the range.' : undefined,
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
    cols: [{ h: 'Sale' }, { h: 'By' }, { h: 'Customer' }, { h: 'Total', r: true }, { h: 'Discount', r: true }],
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
    title: 'Voided sales',
    cols: [{ h: 'Sale' }, { h: 'Voided' }, { h: 'By' }, { h: 'Reason' }, { h: 'Value', r: true }],
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
      { k: 'Sales', v: String(ps.length) },
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
    cols: [{ h: 'Tender' }, { h: 'Sales', r: true }, { h: 'Value', r: true }, { h: 'Share', r: true }],
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
    cols: [{ h: 'Sale' }, { h: 'Customer' }, { h: 'Age', r: true }, { h: 'Due', r: true }],
    rows,
    foot: ['Total', '', '', m(sumCol(rows, 3))],
    rowRefs: ss.map((s) => ({ kind: 'sale' as const, id: s.id })),
    note: 'Every open customer sale, oldest first — the range does not apply.',
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
    cols: [{ h: 'Sale' }, { h: 'Customer' }, { h: 'Date' }, { h: 'Age', r: true }, { h: 'Bucket' }, { h: 'Due', r: true }],
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
    cols: [{ h: 'Sale' }, { h: 'Customer' }, { h: 'Total', r: true }, { h: 'Settled', r: true }, { h: 'Due', r: true }],
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

/* --- Stock movement — all products first, with item drill-down into monthly movement --- */
RPT['stock-movement'] = (db, from, to) => {
  const rows: Cell[][] = [];
  const rowRefs: RowRef[] = [];

  db.products.filter((p) => p.active).forEach((p) => {
    const ms = db.movements.filter((x) => x.productId === p.id && within(x.ts, from, to));
    const inQty = ms.reduce((a, x) => a + Math.max(0, x.qty), 0);
    const outQty = ms.reduce((a, x) => a + Math.max(0, -x.qty), 0);
    const closing = stockOf(p);
    rows.push([
      p.name,
      { text: String(inQty), n: inQty, tone: inQty ? 'good' as CellTone : undefined },
      { text: String(outQty), n: outQty, tone: outQty ? 'danger' as CellTone : undefined },
      { text: String(closing), n: closing, tone: 'accent' as CellTone },
    ]);
    rowRefs.push({ kind: 'product', id: p.id });
  });
  return {
    title: 'Stock movement',
    cols: [{ h: 'Item' }, { h: 'Stock In', r: true }, { h: 'Stock Out', r: true }, { h: 'Closing', r: true }],
    rows,
    rowRefs,
    foot: ['Total', { text: String(sumCol(rows, 1)), n: sumCol(rows, 1) }, { text: String(sumCol(rows, 2)), n: sumCol(rows, 2) }, { text: String(sumCol(rows, 3)), n: sumCol(rows, 3) }],
    note: 'Tap an item to open its monthly stock movement, then tap a month to see the item’s movements for that month.',
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
      'Batch',
      x.m.ref || '—',
      productOf(db, x.m.productId)?.name || '—',
      x.m.batchNo || '—',
      { text: (x.m.qty > 0 ? '+' : '') + x.m.qty, n: x.m.qty, tone: (x.m.qty > 0 ? 'good' : 'danger') as CellTone },
      { text: String(x.balance), n: x.balance },
    ]);

  return {
    title: 'Batch movement',
    cols: [
      { h: 'Date' }, { h: 'Vch Type' }, { h: 'Vch No' }, { h: 'Item' }, { h: 'Batch' },
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
  // each item once, its lots listed beneath it — soonest expiry first in both
  const daysTo = (iso: string) => (iso ? Math.floor((new Date(iso).getTime() - Date.now()) / 86400000) : null);
  const items = db.products
    .filter((p) => p.trackBatches && (p.batches || []).some((b) => b.qty > 0))
    .map((p) => {
      const lots = (p.batches || []).filter((b) => b.qty > 0)
        .map((b) => ({ b, days: daysTo(b.expiry) }))
        .sort((x, y) => (x.days ?? 1e9) - (y.days ?? 1e9));
      return { p, lots, soonest: lots[0]?.days ?? 1e9 };
    })
    .sort((x, y) => x.soonest - y.soonest);

  const rows: Cell[][] = [];
  let qty = 0;
  let value = 0;
  items.forEach(({ p, lots }) => {
    const q = lots.reduce((t, l) => t + l.b.qty, 0);
    qty += q;
    value += q * p.cost;
    rows.push([
      { text: p.name, tone: 'accent' as CellTone },
      { text: lots.length + (lots.length === 1 ? ' lot' : ' lots'), tone: 'muted' as CellTone },
      '',
      { text: String(q), n: q },
      m(q * p.cost),
    ]);
    lots.forEach(({ b, days }) => {
      const tone: CellTone = days === null ? 'muted' : days <= 7 ? 'danger' : days <= 90 ? 'warn' : 'good';
      rows.push([
        { text: '   ' + b.no, tone: 'muted' as CellTone },
        { text: b.expiry ? shortDay(b.expiry) : 'No expiry', tone },
        { text: days === null ? '—' : days < 0 ? 'Expired' : days + 'd', n: days ?? 0, tone },
        { text: String(b.qty), n: b.qty },
        m(b.qty * p.cost),
      ]);
    });
  });

  return {
    title: 'Batches & expiry',
    cols: [
      { h: 'Item / lot' }, { h: 'Expires' }, { h: 'Left', r: true },
      { h: 'Qty', r: true }, { h: 'Value', r: true },
    ],
    rows,
    foot: ['Total', '', '', { text: String(qty), n: qty }, m(value)],
    note: rows.length ? 'Items whose lots expire soonest come first.' : 'No tracked lot is holding stock.',
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

/*
 * Receivable and payable statements: every customer (or supplier) with money
 * moving in the period or a balance carried into it — their opening balance,
 * each bill and payment with a running balance, and what they close on.
 * Owed is shown positive both ways: what a customer owes you, what you owe a
 * supplier.
 */
function statementReport(db: DB, from: number, to: number, type: 'customer' | 'supplier'): ReportResult {
  const title = type === 'customer' ? 'Receivable statement' : 'Payable statement';
  const cols: ReportCol[] = [
    { h: 'Date' }, { h: type === 'customer' ? 'Customer' : 'Supplier' }, { h: 'Detail' },
    { h: type === 'customer' ? 'Billed' : 'Paid', r: true }, { h: type === 'customer' ? 'Received' : 'Billed', r: true }, { h: 'Balance', r: true },
  ];
  const sign = type === 'customer' ? 1 : -1;
  const rows: Cell[][] = [];
  const refs: (RowRef | null)[] = [];
  let totalDr = 0; let totalCr = 0; let totalClose = 0; let parties = 0;
  db.parties.filter((p) => p.type === type).forEach((p) => {
    const all = partyLedgerRows(db, p.id);
    const before = all.filter((r) => from && new Date(r.ts).getTime() < from);
    const inRange = all.filter((r) => within(r.ts, from, to));
    const opening = sign * (before.length ? before[before.length - 1].balance : 0);
    if (!inRange.length && Math.abs(opening) < 0.5) return;
    parties++;
    rows.push([from ? shortDay(new Date(from).toISOString()) : '', p.name, 'Opening balance', '', '', m(opening)]);
    refs.push(null);
    let run = opening;
    inRange.forEach((r) => {
      run += sign * (r.debit - r.credit);
      const a = type === 'customer' ? r.debit : r.debit;
      const b = type === 'customer' ? r.credit : r.credit;
      totalDr += a; totalCr += b;
      rows.push([shortDay(r.ts), p.name, r.memo, dash(a, 'accent'), dash(b, 'good'), m(run)]);
      refs.push(r.ref || null);
    });
    rows.push(['', p.name, 'Closing balance', '', '', { text: money0(run), n: run, tone: run > 0 ? 'warn' : 'good' }]);
    refs.push(null);
    totalClose += run;
  });
  if (!parties) return empty(title, cols, 'No ' + type + ' has a balance or any sales in this period.');
  return {
    title,
    stats: [
      { k: type === 'customer' ? 'Customers' : 'Suppliers', v: String(parties) },
      { k: type === 'customer' ? 'Owed to you' : 'You owe', v: money0(totalClose), tone: totalClose > 0 ? 'w' : 'g' },
    ],
    cols,
    rows,
    rowRefs: refs,
    foot: ['Total', '', '', m(totalDr), m(totalCr), m(totalClose)],
    note: (type === 'customer' ? 'Every customer' : 'Every supplier') + ' with a balance or activity in the period, oldest first.',
  };
}
RPT['receivable-statement'] = (db, from, to) => statementReport(db, from, to, 'customer');
RPT['payable-statement'] = (db, from, to) => statementReport(db, from, to, 'supplier');

/* --- Party statement — reference 4072. The prototype read the chosen party
       from `UI.params`; with no picker here it runs on the first active
       party, which the note says. --- */
RPT['party-statement'] = (db, from, to) => {
  const cols: ReportCol[] = [
    { h: 'Party' }, { h: 'Type' }, { h: 'Debit', r: true }, { h: 'Credit', r: true }, { h: 'Balance', r: true },
  ];
  const parties = db.parties.filter((x) => x.active);
  if (!parties.length) return empty('Party statement', cols, 'No parties yet — add a customer or supplier first.');
  const rows: Cell[][] = [];
  const rowRefs: RowRef[] = [];
  parties
    .map((p) => {
      const all = partyLedgerRows(db, p.id);
      const inRange = all.filter((r) => within(r.ts, from, to));
      const closing = all.filter((r) => new Date(r.ts).getTime() <= to).reduce((t, r) => t + r.debit - r.credit, 0);
      return { p, dr: inRange.reduce((t, r) => t + r.debit, 0), cr: inRange.reduce((t, r) => t + r.credit, 0), closing };
    })
    .sort((a, b) => Math.abs(b.closing) - Math.abs(a.closing))
    .forEach(({ p, dr, cr, closing }) => {
      rows.push([p.name, p.type === 'supplier' ? 'Supplier' : 'Customer', dash(dr, 'accent'), dash(cr, 'good'), {
        text: money0(Math.abs(closing)) + (closing >= 0 ? ' Dr' : ' Cr'), n: closing, tone: closing > 0 ? 'warn' : closing < 0 ? 'good' : 'muted',
      }]);
      rowRefs.push({ kind: 'party', id: p.id });
    });
  return {
    title: 'Party statement',
    cols,
    rows,
    foot: ['Total', '', m(sumCol(rows, 2)), m(sumCol(rows, 3)), m(sumCol(rows, 4))],
    rowRefs,
    searchable: true,
    note: 'Tap a customer or supplier for their statement over the range.',
  };
};

/* --- Ledger summary — a high-level account roll-up for the period --- */
RPT['ledger-summary'] = (db, from, to) => {
  const ids = orderedLedgerIds(db);
  const rows: Cell[][] = ids.map((id) => {
    let dr = 0; let cr = 0;
    let opening = 0;
    db.journal.forEach((e) => {
      const at = new Date(e.ts).getTime();
      if (at < from && !from) return;
      if (from && at < from) {
        e.lines.forEach((l) => { if (l.acc === id) { opening += (l.dr || 0) - (l.cr || 0); } });
      }
      if (!within(e.ts, from, to)) return;
      e.lines.forEach((l) => {
        if (l.acc !== id) return;
        dr += l.dr || 0;
        cr += l.cr || 0;
      });
    });
    const current = dr - cr;
    const closing = opening + current;
    return [accName(db, id), m(dr), m(cr), { text: money0(Math.abs(closing)) + (closing >= 0 ? ' Dr' : ' Cr'), n: closing }, { text: money0(Math.abs(opening)) + (opening >= 0 ? ' Dr' : ' Cr'), n: opening }, { text: money0(Math.abs(current)) + (current >= 0 ? ' Dr' : ' Cr'), n: current }];
  });
  return {
    title: 'Ledger summary',
    cols: [{ h: 'Ledger' }, { h: 'Debit', r: true }, { h: 'Credit', r: true }, { h: 'Closing', r: true }, { h: 'Opening', r: true }, { h: 'Current', r: true }],
    rows,
    foot: ['Total', m(sumCol(rows, 1)), m(sumCol(rows, 2)), m(sumCol(rows, 3)), m(sumCol(rows, 4)), m(sumCol(rows, 5))],
    rowRefs: ids.map((id) => ({ kind: 'ledger', id })),
    note: 'All ledgers, grouped by asset, equity and liability, with opening, current and closing balances. Tap one for its postings.',
    searchable: true,
  };
};

/* --- Voucher summary — every journal voucher in the period, with a debit and credit total --- */
RPT['voucher-summary'] = (db, from, to) => {
  // every voucher in the range, gathered under the kind of transaction it records
  const groups = new Map<string, { n: number; dr: number; cr: number }>();
  db.journal.filter((e) => within(e.ts, from, to)).forEach((e) => {
    const t = voucherTypeOf(db, e);
    const g = groups.get(t) || { n: 0, dr: 0, cr: 0 };
    g.n += 1;
    g.dr += e.lines.reduce((a, l) => a + (l.dr || 0), 0);
    g.cr += e.lines.reduce((a, l) => a + (l.cr || 0), 0);
    groups.set(t, g);
  });
  const order = [...groups.entries()].sort((x, y) => VOUCHER_ORDER.indexOf(x[0]) - VOUCHER_ORDER.indexOf(y[0]));
  const rows: Cell[][] = order.map(([t, g]) => [t, { text: String(g.n), n: g.n }, m(g.dr), m(g.cr)]);
  return {
    title: 'Voucher summary',
    cols: [{ h: 'Vch Type' }, { h: 'Vouchers', r: true }, { h: 'Debit', r: true }, { h: 'Credit', r: true }],
    rows,
    foot: ['Total', { text: String(sumCol(rows, 1)), n: sumCol(rows, 1) }, m(sumCol(rows, 2)), m(sumCol(rows, 3))],
    rowRefs: order.map(([t]) => ({ kind: 'vouchertype' as const, id: t })),
    searchable: true,
    note: 'Vouchers in the range by type. Tap a type for its vouchers, and a voucher for the ledgers it moved.',
  };
};

/* --- Chart of accounts — the shop's ledger list with balance and type --- */
RPT['chart-of-accounts'] = (db) => {
  const ledgers = (db.coa && db.coa.length ? db.coa : allAccountIds(db).map((id) => ({ id, code: id, name: accName(db, id), type: accType(db, id), builtin: false, active: true }))) as Array<{ id: string; code?: string; name: string; type?: string; builtin?: boolean; active?: boolean }>;
  const ordered = [...ledgers].sort((a, b) => {
    const ord = accountTypeOrder(a.type || accType(db, a.id)) - accountTypeOrder(b.type || accType(db, b.id));
    if (ord !== 0) return ord;
    return (a.code || a.name).localeCompare(b.code || b.name);
  });
  const rows: Cell[][] = [];
  const rowRefs: (RowRef | null)[] = [];
  let totalDr = 0; let totalCr = 0; let totalBalance = 0;
  [0, 1, 2, 3, 4].forEach((typeOrder) => {
    const group = ordered.filter((l) => accountTypeOrder(l.type || accType(db, l.id)) === typeOrder);
    if (!group.length) return;
    const label = typeOrder === 0 ? 'Assets' : typeOrder === 1 ? 'Equity' : typeOrder === 2 ? 'Liabilities' : typeOrder === 3 ? 'Income' : 'Expenses';
    rows.push([label, '', '', '', '', '']);
    rowRefs.push(null);
    let groupDr = 0; let groupCr = 0; let groupBalance = 0;
    group.forEach((l) => {
      let dr = 0; let cr = 0;
      db.journal.forEach((e) => e.lines.forEach((line) => {
        if (line.acc === l.id) { dr += line.dr || 0; cr += line.cr || 0; }
      }));
      const balance = dr - cr;
      groupDr += dr; groupCr += cr; groupBalance += balance;
      rows.push([l.code || l.id, l.name, (l.type || accType(db, l.id)).toString(), m(dr), m(cr), { text: money0(Math.abs(balance)) + (balance >= 0 ? ' Dr' : ' Cr'), n: balance }]);
      rowRefs.push({ kind: 'ledger', id: l.id });
    });
    totalDr += groupDr; totalCr += groupCr; totalBalance += groupBalance;
    rows.push(['', `Total ${label}`, '', m(groupDr), m(groupCr), { text: money0(Math.abs(groupBalance)) + (groupBalance >= 0 ? ' Dr' : ' Cr'), n: groupBalance }]);
    rowRefs.push(null);
  });
  return {
    title: 'Chart of accounts',
    cols: [{ h: 'Code' }, { h: 'Account' }, { h: 'Type' }, { h: 'Debit', r: true }, { h: 'Credit', r: true }, { h: 'Balance', r: true }],
    rows,
    foot: ['Total', '', '', m(totalDr), m(totalCr), { text: money0(Math.abs(totalBalance)) + (totalBalance >= 0 ? ' Dr' : ' Cr'), n: totalBalance }],
    rowRefs,
    note: 'The active account structure and running balances, grouped with subtotals for assets, equity, liabilities, income and expenses.',
  };
};

/* --- Trial balance — reference 4085 --- */
RPT['trial-balance'] = (db, _f, _t, money) => {
  const accs: Record<string, { d: number; c: number }> = {};
  db.journal.forEach((e) => e.lines.forEach((l) => {
    const a = accs[l.acc] || (accs[l.acc] = { d: 0, c: 0 });
    a.d += l.dr || 0; a.c += l.cr || 0;
  }));
  const keys = Object.keys(accs).sort((a, b) => {
    const ord = accountTypeOrder((db.coa?.find((l) => l.id === a)?.type || accType(db, a))) - accountTypeOrder((db.coa?.find((l) => l.id === b)?.type || accType(db, b)));
    if (ord !== 0) return ord;
    return accName(db, a).localeCompare(accName(db, b));
  });
  const td = keys.reduce((a, k) => { const n = accs[k].d - accs[k].c; return a + (n > 0 ? n : 0); }, 0);
  const tc = keys.reduce((a, k) => { const n = accs[k].d - accs[k].c; return a + (n < 0 ? -n : 0); }, 0);
  const rows: Cell[][] = [];
  const rowRefs: (RowRef | null)[] = [];
  const kinds: RowKind[] = [];
  [0, 1, 2, 3, 4].forEach((typeOrder) => {
    const group = keys.filter((id) => accountTypeOrder(accType(db, id)) === typeOrder);
    if (!group.length) return;
    const label = typeOrder === 0 ? 'Assets' : typeOrder === 1 ? 'Equity' : typeOrder === 2 ? 'Liabilities' : typeOrder === 3 ? 'Income' : 'Expenses';
    rows.push([label, '', '']);
    rowRefs.push(null);
    kinds.push('head');
    let groupDebit = 0; let groupCredit = 0;
    group.forEach((k) => {
      const net = accs[k].d - accs[k].c;
      const debit = net > 0 ? net : 0;
      const credit = net < 0 ? -net : 0;
      groupDebit += debit; groupCredit += credit;
      rows.push([accName(db, k), debit ? m(debit) : '', credit ? m(credit) : '']);
      rowRefs.push({ kind: 'ledger', id: k });
      kinds.push('line');
    });
    rows.push([`Total ${label}`, m(groupDebit), m(groupCredit)]);
    rowRefs.push(null);
    kinds.push('sub');
  });
  const ok = Math.abs(td - tc) < 2;
  return {
    rowKinds: kinds,
    title: 'Trial balance',
    stats: [{ k: ok ? 'Books balance' : 'Out by', v: ok ? '✓' : money(Math.abs(td - tc)), tone: ok ? 'g' : 'd' }],
    cols: [{ h: 'Account' }, { h: 'Debit', r: true }, { h: 'Credit', r: true }],
    rows,
    foot: ['Total', m(td), m(tc)],
    rowRefs,
    note: 'The trial balance is grouped by account type with a subtotal for each group.',
  };
};

/* --- General ledger — reference accountingView('ledger'), 3221 --- */
RPT['general-ledger'] = (db) => {
  const ids = orderedLedgerIds(db);
  const rows: Cell[][] = ids.map((id) => {
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
    rowRefs: ids.map((id) => ({ kind: 'ledger', id })),
    note: 'Ledger balances are grouped by asset, equity and liability to match the accounting structure.',
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
  // what the expenses went on, largest first
  const byCat = new Map<string, number>();
  const ledgerOf = new Map<string, string>();
  db.entries.filter((e) => e.direction === 'out' && within(e.ts, from, to))
    .forEach((e) => {
      const c = e.category || 'Other';
      byCat.set(c, (byCat.get(c) || 0) + e.amount);
      if (e.ledgerId) ledgerOf.set(c, e.ledgerId);
    });
  const cats = [...byCat.entries()].sort((x, y) => y[1] - x[1]);
  const neg = (n: number): Cell => ({ text: '(' + money0(n) + ')', n: -n, tone: 'muted' });
  const rows: Cell[][] = [];
  const kinds: RowKind[] = [];
  const refs: (RowRef | null)[] = [];
  const add = (row: Cell[], kind: RowKind, ref: RowRef | null = null) => { rows.push(row); kinds.push(kind); refs.push(ref); };
  add(['Trading', ''], 'head');
  add(['Sales (net of VAT)', m(sale)], 'line', { kind: 'ledger', id: 'n_sales' });
  add(['Less returns', neg(ret)], 'line');
  add(['Less cost of goods sold', neg(cogs)], 'line', { kind: 'ledger', id: 'n_cogs' });
  add(['Gross profit', mTone(gp, 'accent')], 'sub');
  add(['Other income', ''], 'head');
  add(['Other income', m(inc)], 'line', { kind: 'ledger', id: 'n_income' });
  add(['Expenses', ''], 'head');
  cats.forEach(([c, v]) => add([c, neg(v)], 'line', { kind: 'ledger', id: ledgerOf.get(c) || 'n_expense' }));
  add(['Less expenses', neg(exp)], 'sub', { kind: 'ledger', id: 'n_expense' });
  return {
    title: 'Profit & loss',
    stats: [
      { k: 'Gross profit', v: money(gp), tone: 'a' },
      { k: 'Net profit', v: money(np), tone: np >= 0 ? 'g' : 'd' },
    ],
    cols: [{ h: 'Line' }, { h: 'Amount', r: true }],
    rows,
    rowKinds: kinds,
    rowRefs: refs,
    foot: ['Net profit', m(np)],
  };
};

/* --- Balance sheet — reference accountingView('bs'), 3244, flattened to one
       table with a section column. --- */
RPT['balance-sheet'] = (db, _f, _t, money) => {
  const ids = allAccountIds(db);
  const assets = ids.filter((id) => accType(db, id) === 'asset')
    .map((id) => ({ id, n: accName(db, id), v: accountBalance(db, id) }));
  const liab = ids.filter((id) => accType(db, id) === 'liability')
    .map((id) => ({ id, n: accName(db, id), v: -accountBalance(db, id) }));
  const ta = assets.reduce((a, r) => a + r.v, 0);
  const tl = liab.reduce((a, r) => a + r.v, 0);
  const retained = ['n_sales', 'n_income', 'n_cogs', 'n_expense', 'n_discount', 'n_loyalty']
    .reduce((a, k) => a + nominalTotal(db, k), 0);
  const eq = -accountBalance(db, 'n_equity');
  const rows: Cell[][] = [
    ['Assets', 'Assets', ''],
    ...assets.map((r) => ['Assets', r.n, m(r.v)] as Cell[]),
    ['Assets', 'Total assets', mTone(ta, 'accent')],
    ['Liabilities', 'Liabilities', ''],
    ...liab.map((r) => ['Liabilities', r.n, m(r.v)] as Cell[]),
    ['Liabilities', 'Total liabilities', mTone(tl, 'accent')],
    ['Equity', 'Equity', ''],
    ['Equity', 'Owner equity', m(eq)],
    ['Equity', 'Retained profit', m(retained)],
    ['Equity', 'Total equity', mTone(eq + retained, 'accent')],
  ];
  const rowKinds: RowKind[] = [
    'head', ...assets.map(() => 'line' as RowKind), 'sub',
    'head', ...liab.map(() => 'line' as RowKind), 'sub',
    'head', 'line', 'line', 'sub',
  ];
  const rowRefs: (RowRef | null)[] = [
    null, ...assets.map((r) => ({ kind: 'ledger' as const, id: r.id })), null,
    null, ...liab.map((r) => ({ kind: 'ledger' as const, id: r.id })), null,
    null, { kind: 'ledger', id: 'n_equity' }, null, null,
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
    rowKinds,
    rowRefs,
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

function inventoryMetricReport(db: DB, from: number, to: number, metric: InventoryMetricReport): ReportResult {
  const rows: Cell[][] = [];
  const rowRefs: RowRef[] = [];
  db.products.filter((p) => p.active).forEach((p) => {
    const sample = metric === 'aamc' ? aamcSample(from, to)
      : metric === 'aawc' ? aawcSample(from, to)
        : { from, to };
    const s = inventoryMetricSnapshot(db, p, sample.from, sample.to);
    const firstMovement = db.movements.filter((m) => m.productId === p.id)
      .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())[0];
    const metricFrom = sample.from || (firstMovement ? startOfDay(new Date(firstMovement.ts)) : (to || Date.now()));
    const value = metricValue(metric, s, metricFrom, sample.to || Date.now());
    rows.push([
      p.name,
      { text: String(value), n: value, tone: metric === 'days-out-of-stock' && value > 0 ? 'danger' as CellTone : 'accent' as CellTone },
      ...(metric === 'days-out-of-stock' ? [] : [{ text: String(s.daysOut), n: s.daysOut, tone: s.daysOut > 0 ? 'danger' as CellTone : 'good' as CellTone }]),
      { text: String(s.consumption), n: s.consumption },
      { text: String(s.closing), n: s.closing },
    ]);
    rowRefs.push({ kind: 'product', id: p.id });
  });
  const label = metricLabel(metric);
  return {
    title: reportById(metric)?.name || label,
    cols: metric === 'days-out-of-stock'
      ? [{ h: 'Item' }, { h: 'Days out', r: true }, { h: 'Consumed', r: true }, { h: 'Closing', r: true }]
      : [{ h: 'Item' }, { h: label, r: true }, { h: 'Days out', r: true }, { h: 'Consumed', r: true }, { h: 'Closing', r: true }],
    rows,
    rowRefs,
    foot: metric === 'days-out-of-stock'
      ? ['Total', { text: String(sumCol(rows, 1)), n: sumCol(rows, 1) }, { text: String(sumCol(rows, 2)), n: sumCol(rows, 2) }, { text: String(sumCol(rows, 3)), n: sumCol(rows, 3) }]
      : ['Total', { text: String(sumCol(rows, 1)), n: sumCol(rows, 1) }, { text: String(sumCol(rows, 2)), n: sumCol(rows, 2) }, { text: String(sumCol(rows, 3)), n: sumCol(rows, 3) }, { text: String(sumCol(rows, 4)), n: sumCol(rows, 4) }],
    note: metric === 'days-out-of-stock'
      ? 'Stockout days are derived automatically from the movement history. The clock starts when running stock reaches zero and stops when replenishment makes it positive.'
      : metric === 'amc'
        ? 'AMC is consumption divided by calendar months in the selected period.'
        : metric === 'aamc'
          ? 'AAMC is consumption normalized by months with stock available, excluding stockout time.'
          : 'AAWC is consumption normalized by weeks with stock available, excluding stockout time.',
  };
}

INVENTORY_METRIC_REPORTS.forEach((metric) => {
  RPT[metric] = (db, from, to) => inventoryMetricReport(db, from, to, metric);
});

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


/* ------------------------------------------------------------------ */
/* Drill-downs: one ledger, one party, one voucher                     */
/* ------------------------------------------------------------------ */

/** Every posting to one ledger in the range, after its opening balance, with a running balance. */
export function ledgerDrill(db: DB, accId: string, from: number, to: number): ReportResult {
  const name = accName(db, accId);
  let opening = 0;
  const lines: { ts: string; ref: string; memo: string; dr: number; cr: number }[] = [];
  db.journal.forEach((e) => {
    const at = new Date(e.ts).getTime();
    e.lines.forEach((l) => {
      if (l.acc !== accId) return;
      if (at < from) opening += (l.dr || 0) - (l.cr || 0);
      else if (at <= to) lines.push({ ts: e.ts, ref: e.ref || '', memo: e.memo || '', dr: l.dr || 0, cr: l.cr || 0 });
    });
  });
  lines.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const bal = (n: number): Cell => ({ text: money0(Math.abs(n)) + (n >= 0 ? ' Dr' : ' Cr'), n });
  let run = opening;
  const rows: Cell[][] = [['', 'Opening Balance', '', '', bal(opening)]];
  const rowRefs: (RowRef | null)[] = [null];
  lines.forEach((l) => {
    run += l.dr - l.cr;
    rows.push([shortDay(l.ts), (l.ref ? l.ref + ' · ' : '') + l.memo, dash(l.dr, 'accent'), dash(l.cr, 'good'), bal(run)]);
    const sale = l.ref ? db.sales.find((x) => x.no === l.ref) : undefined;
    const pu = !sale && l.ref ? db.purchases.find((x) => x.no === l.ref) : undefined;
    rowRefs.push(sale ? { kind: 'sale', id: sale.id } : pu ? { kind: 'purchase', id: pu.id } : null);
  });
  const dr = lines.reduce((t, l) => t + l.dr, 0);
  const cr = lines.reduce((t, l) => t + l.cr, 0);
  return {
    title: name,
    stats: [
      { k: 'Opening', v: money0(opening), tone: 'a' },
      { k: 'Closing', v: money0(run), tone: run >= 0 ? 'g' : 'w' },
    ],
    cols: [{ h: 'Date' }, { h: 'Particulars' }, { h: 'Debit', r: true }, { h: 'Credit', r: true }, { h: 'Balance', r: true }],
    rows,
    foot: ['Closing', '', m(dr), m(cr), bal(run)],
    rowRefs,
    searchable: true,
    note: lines.length ? undefined : 'Nothing was posted to ' + name + ' in this range.',
  };
}

/** One customer's or supplier's statement over the range, from their opening balance. */
export function partyDrill(db: DB, partyId: string, from: number, to: number): ReportResult {
  const p = db.parties.find((x) => x.id === partyId);
  const all = partyLedgerRows(db, partyId);
  const opening = all.filter((r) => new Date(r.ts).getTime() < from).reduce((t, r) => t + r.debit - r.credit, 0);
  const inRange = all.filter((r) => within(r.ts, from, to));
  let run = opening;
  const rows: Cell[][] = [['', 'Opening Balance', '', '', m(opening)]];
  const rowRefs: (RowRef | null)[] = [null];
  inRange.forEach((r) => {
    run += r.debit - r.credit;
    rows.push([shortDay(r.ts), r.memo, dash(r.debit, 'accent'), dash(r.credit, 'good'), m(run)]);
    rowRefs.push(r.ref || null);
  });
  return {
    title: p?.name || 'Party',
    stats: [
      { k: 'Opening', v: money0(opening), tone: 'a' },
      { k: 'Closing', v: money0(run), tone: run > 0 ? 'w' : 'g' },
    ],
    cols: [{ h: 'Date' }, { h: 'Detail' }, { h: 'Debit', r: true }, { h: 'Credit', r: true }, { h: 'Balance', r: true }],
    rows,
    foot: ['Closing balance', '', m(inRange.reduce((t, r) => t + r.debit, 0)), m(inRange.reduce((t, r) => t + r.credit, 0)), m(run)],
    rowRefs,
    searchable: true,
  };
}

/** The ledgers one journal voucher moved; each opens its ledger. */
export function voucherDrill(db: DB, entryId: string): ReportResult {
  const e = db.journal.find((x) => x.id === entryId);
  if (!e) return empty('Voucher', [{ h: 'Ledger' }, { h: 'Debit', r: true }, { h: 'Credit', r: true }], 'That voucher is gone.');
  const rows: Cell[][] = e.lines.map((l) => [accName(db, l.acc), dash(l.dr || 0, 'accent'), dash(l.cr || 0, 'good')]);
  return {
    title: (e.ref || 'Voucher') + ' · ' + shortDay(e.ts),
    cols: [{ h: 'Ledger' }, { h: 'Debit', r: true }, { h: 'Credit', r: true }],
    rows,
    foot: ['Total', m(sumCol(rows, 1)), m(sumCol(rows, 2))],
    rowRefs: e.lines.map((l) => ({ kind: 'ledger' as const, id: l.acc })),
    note: e.memo || undefined,
  };
}


/* ------------------------------------------------------------------ */
/* Voucher types                                                       */
/* ------------------------------------------------------------------ */

const VOUCHER_ORDER = [
  'Cash sale', 'Sales invoice', 'Cost of sales', 'Sale void', 'Credit note', 'Receipt',
  'Purchase', 'Purchase void', 'Payment', 'Expense', 'Income', 'Contra',
  'Stock adjustment', 'Production', 'Cash short / over', 'Opening balance', 'Correction', 'Journal',
];

/** What a journal voucher records, read from the reference and narration it was posted with. */
export function voucherTypeOf(db: DB, e: { ref?: string; memo?: string }): string {
  const ref = e.ref || '';
  const memo = e.memo || '';
  if (/^Transfer\b/.test(memo)) return 'Contra';
  const sale = ref ? db.sales.find((x) => x.no === ref) : undefined;
  if (sale) {
    if (/ — against /.test(memo)) return 'Expense';
    if (/^(Cost of sale|Reverse cost)/.test(memo)) return 'Cost of sales';
    if (/^Void/.test(memo)) return 'Sale void';
    return sale.method === 'credit' || (sale.paidAtSale ?? sale.total) < sale.total ? 'Sales invoice' : 'Cash sale';
  }
  if (ref && db.purchases.some((x) => x.no === ref)) return /^Void/.test(memo) ? 'Purchase void' : 'Purchase';
  if (ref && (db.creditNotes || []).some((x) => x.no === ref)) return 'Credit note';
  if (ref === 'RCT') return 'Receipt';
  if (ref === 'PAY') return 'Payment';
  if (ref === 'EDIT' || ref === 'DEL') return /receipt/i.test(memo) ? 'Receipt' : /payment/i.test(memo) ? 'Payment' : 'Correction';
  if (ref === 'EXP') return 'Expense';
  if (ref === 'INC') return 'Income';
  if (ref === 'OPENING' || ref === 'BRANCH') return 'Opening balance';
  if (ref === 'SHIFT') return 'Cash short / over';
  if (/^Production run/.test(memo)) return 'Production';
  if (/stock|adjust/i.test(memo)) return 'Stock adjustment';
  return 'Journal';
}

/** The vouchers of one type in the range; each opens its lines. */
export function voucherTypeDrill(db: DB, type: string, from: number, to: number): ReportResult {
  const list = db.journal
    .filter((e) => within(e.ts, from, to) && voucherTypeOf(db, e) === type)
    .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  const rows: Cell[][] = list.map((e) => {
    const dr = e.lines.reduce((a, l) => a + (l.dr || 0), 0);
    return [shortDay(e.ts), e.ref || '—', e.memo || '—', m(dr)];
  });
  return {
    title: type,
    cols: [{ h: 'Date' }, { h: 'Vch No' }, { h: 'Narration' }, { h: 'Amount', r: true }],
    rows,
    foot: ['Total', '', '', m(sumCol(rows, 3))],
    rowRefs: list.map((e) => ({ kind: 'voucher' as const, id: e.id })),
    searchable: true,
    note: rows.length ? undefined : 'No ' + type.toLowerCase() + ' vouchers in this range.',
  };
}

/* ------------------------------------------------------------------ */
/* Detailed ledgers: groups, their ledgers, opening and closing        */
/* ------------------------------------------------------------------ */

/** The detailed view of a statement, where it has one. */
export const DETAIL_VIEW: Record<string, string> = {
  'trial-balance': 'trial-balance-detail',
  'balance-sheet': 'balance-sheet-detail',
  'general-ledger': 'general-ledger-detail',
};

function detailedLedgers(db: DB, from: number, to: number, title: string, types: AccType[]): ReportResult {
  const bal = (n: number): CellObj => ({ text: n ? money0(Math.abs(n)) + (n >= 0 ? ' Dr' : ' Cr') : '—', n, tone: n ? undefined : 'muted' });
  const label: Record<AccType, string> = { asset: 'Assets', liability: 'Liabilities', equity: 'Equity', income: 'Income', expense: 'Expenses' };
  const ids = orderedLedgerIds(db);
  const rows: Cell[][] = [];
  const rowRefs: (RowRef | null)[] = [];
  const total = { o: 0, d: 0, c: 0, x: 0 };
  types.forEach((t) => {
    const mine = ids.filter((id) => accType(db, id) === t).map((id) => {
      let o = 0; let d = 0; let c = 0;
      db.journal.forEach((e) => {
        const at = new Date(e.ts).getTime();
        e.lines.forEach((l) => {
          if (l.acc !== id) return;
          if (at < from) o += (l.dr || 0) - (l.cr || 0);
          else if (at <= to) { d += l.dr || 0; c += l.cr || 0; }
        });
      });
      return { id, o, d, c, x: o + d - c };
    }).filter((r) => r.o || r.d || r.c);
    if (!mine.length) return;
    rows.push([{ text: label[t].toUpperCase(), tone: 'accent' }, '', '', '', '']);
    rowRefs.push(null);
    const g = { o: 0, d: 0, c: 0, x: 0 };
    mine.forEach((r) => {
      rows.push(['   ' + accName(db, r.id), bal(r.o), dash(r.d, 'accent'), dash(r.c, 'good'), bal(r.x)]);
      rowRefs.push({ kind: 'ledger', id: r.id });
      g.o += r.o; g.d += r.d; g.c += r.c; g.x += r.x;
    });
    rows.push([{ text: 'Total ' + label[t], tone: 'accent' }, bal(g.o), m(g.d), m(g.c), bal(g.x)]);
    rowRefs.push(null);
    total.o += g.o; total.d += g.d; total.c += g.c; total.x += g.x;
  });
  return {
    title,
    cols: [{ h: 'Group / ledger' }, { h: 'Opening', r: true }, { h: 'Debit', r: true }, { h: 'Credit', r: true }, { h: 'Closing', r: true }],
    rows,
    foot: ['Total', bal(total.o), m(total.d), m(total.c), bal(total.x)],
    rowRefs,
    searchable: true,
    note: 'Opening is the balance before the range; debit and credit are the movement within it. Tap a ledger for its postings.',
  };
}

RPT['trial-balance-detail'] = (db, from, to) =>
  detailedLedgers(db, from, to, 'Trial balance · detailed', ['asset', 'equity', 'liability', 'income', 'expense']);
RPT['balance-sheet-detail'] = (db, from, to) =>
  detailedLedgers(db, from, to, 'Balance sheet · detailed', ['asset', 'liability', 'equity']);
RPT['general-ledger-detail'] = (db, from, to) =>
  detailedLedgers(db, from, to, 'General ledger · detailed', ['asset', 'equity', 'liability', 'income', 'expense']);

/** Reports that show what was earned — behind "View profit". */
export const PROFIT_REPORTS = new Set(['profit-margin', 'bill-profit', 'user-profit', 'sales-by-items', 'pnl']);

/** The permission a report needs beyond "Reports: view", if any. */
export function reportPermission(id: string): string | null {
  if (PROFIT_REPORTS.has(id)) return 'inventory.view_profit';
  const cat = reportById(id)?.cat;
  if (cat === 'Money' || cat === 'Tax & books') return 'reports.money';
  return null;
}
