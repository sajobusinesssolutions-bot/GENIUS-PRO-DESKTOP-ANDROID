/**
 * BRANCHES
 *
 * A branch is run as a separate business. It holds its own stock, takes its own
 * money, keeps its own drawer and answers for its own profit. Two branches of
 * the same firm share the catalogue of items, the customer list and the staff —
 * the things a business would genuinely keep in common — but nothing that has a
 * value attached to it.
 *
 * Stock was already separated: `product.stock[branchId]`, `Sale.warehouse` and
 * `Movement.wh` all key on the branch. Money was not, and that is what these
 * helpers close. Every figure the app reports about money is derived from
 * `db.journal`, so stamping the branch onto a journal entry and filtering on it
 * here separates the finance of every branch in one place, rather than threading
 * a branch through each of the thirty screens that ask about money.
 *
 * `undefined` on a record means "before branches kept their own books". Those
 * records belong to the first branch, and the storage migration stamps them, but
 * the readers below also treat an unstamped record as the first branch's so a
 * book that has not been migrated still adds up.
 */
import type { DB, Warehouse, JournalEntry, JournalLine } from './types';

/**
 * The branch the signed-in person is working in.
 *
 * Every field is read defensively: this is called from the posting path and
 * from every finance reader, including against partial books in tests and
 * against a book part-way through a migration. An empty string means the app
 * has no branches yet, and the readers then fall back to showing everything
 * rather than nothing.
 */
export function activeBranchId(d: DB): string {
  return d?.session?.warehouse || d?.settings?.defaultWarehouse || d?.warehouses?.[0]?.id || '';
}

export function activeBranch(d: DB): Warehouse | undefined {
  const id = activeBranchId(d);
  return d.warehouses.find((w) => w.id === id);
}

/** The branch every unstamped record is taken to belong to. */
export function originalBranchId(d: DB): string {
  return d?.warehouses?.[0]?.id || '';
}

export function branchName(d: DB, id: string | undefined): string {
  if (!id) return 'All branches';
  return d.warehouses.find((w) => w.id === id)?.name || 'Unknown branch';
}

export function liveBranches(d: DB): Warehouse[] {
  return (d?.warehouses || []).filter((w) => w.active !== false);
}

/**
 * Whether a record belongs to the branch being asked about.
 *
 * Passing no branch means "every branch", which is what the cross-branch
 * analysis and the owner's grand totals want.
 */
export function inBranch(d: DB, recordBranch: string | undefined, want: string | null | undefined): boolean {
  if (!want) return true;
  return (recordBranch || originalBranchId(d)) === want;
}

/** The journal entries belonging to one branch, or all of them. */
/**
 * The parties' opening balances as one entry dated before everything else:
 * what customers owed (debtors) and what was owed to suppliers (creditors)
 * when they were added, against opening-balance equity. They were never
 * posted, so the trial balance, balance sheet and general ledger left them out
 * while every party screen counted them — debtors and creditors did not match
 * the parties, and changing a party from "to pay" to "to receive" showed
 * nowhere in the accounts. Read from the parties each time, so an edit to an
 * opening balance (or which way it runs) is in the books at once.
 */
export const OPENING_ENTRY_ID = '__party_openings';
export function partyOpeningEntry(d: DB): JournalEntry | null {
  const lines: JournalLine[] = [];
  let net = 0;
  for (const p of d.parties || []) {
    const v = Math.round((Number(p.openingBalance) || 0) * 100) / 100;
    if (!v) continue;
    const acc = p.type === 'supplier' ? 'n_ap' : 'n_ar';
    lines.push(v > 0 ? { acc, dr: v } : { acc, cr: -v });
    net += v;
  }
  if (!lines.length) return null;
  net = Math.round(net * 100) / 100;
  if (net) lines.push(net > 0 ? { acc: 'n_equity', cr: net } : { acc: 'n_equity', dr: -net });
  return { id: OPENING_ENTRY_ID, ts: new Date(0).toISOString(), memo: 'Opening balances of customers and suppliers', ref: 'OPENING', lines, balanced: true } as JournalEntry;
}
/** The journal with the parties' opening balances in front of it. */
export function booksJournal(d: DB): JournalEntry[] {
  const o = partyOpeningEntry(d);
  return o ? [o, ...(d.journal || [])] : (d.journal || []);
}

export function branchJournal(d: DB, want: string | null | undefined) {
  if (!want) return booksJournal(d);
  return booksJournal(d).filter((e) => inBranch(d, e.branch, want));
}

/**
 * The accounts a branch can pay into or out of: its own, plus any account that
 * was never given a branch, which the whole firm shares.
 */
export function branchAccounts(d: DB, want: string | null | undefined) {
  if (!want) return d?.accounts || [];
  return (d?.accounts || []).filter((a) => !a.branch || a.branch === want);
}

/** What a branch is worth on the shelf, at cost. */
export function branchStockValue(d: DB, id: string): number {
  return d.products.reduce((sum, p) => sum + (p.stock?.[id] || 0) * p.cost, 0);
}

export function branchStockUnits(d: DB, id: string): number {
  return d.products.reduce((sum, p) => sum + (p.stock?.[id] || 0), 0);
}

/**
 * Whether a branch can be closed without losing anything.
 *
 * A branch holding stock or money is not empty, and deleting it would strand
 * both, so the branch screen offers to disable rather than delete.
 */
export function branchIsEmpty(d: DB, id: string): { empty: boolean; why: string } {
  const units = branchStockUnits(d, id);
  if (units > 0) return { empty: false, why: units + ' units of stock are still held here' };
  const sales = d.sales.filter((s) => s.warehouse === id).length;
  if (sales) return { empty: false, why: sales + ' sales were rung up here' };
  const posts = (d.journal || []).filter((e) => e.branch === id).length;
  if (posts) return { empty: false, why: posts + ' postings sit in its books' };
  return { empty: true, why: '' };
}

/**
 * The prefix a branch's documents carry.
 *
 * Branches run as separate businesses, so their paperwork has to be tellable
 * apart at a glance. The running number behind the prefix stays firm-wide, so
 * two branches can never issue the same number — only the same number under
 * different prefixes, which is the point.
 */
export function branchPrefix(d: DB, id: string | undefined): string {
  const w = (d?.warehouses || []).find((x) => x.id === id);
  const raw = (w?.prefix || '').trim().toUpperCase();
  return raw || 'INV';
}
