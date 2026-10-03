/**
 * The chart of accounts.
 *
 * Postings already name their ledger by id — 'n_sales', 'acc_cash' and so on —
 * but until now those ids had no record behind them, only a hardcoded label map.
 * This gives every ledger a real row that can be renamed, coded, deactivated and
 * read back, without changing a single existing posting.
 */
import type { DB, JournalEntry } from './types';
import { activeBranchId, branchJournal } from './branch';

export type LedgerType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export interface Ledger {
  id: string;
  code: string;
  name: string;
  type: LedgerType;
  /** A built-in ledger the postings depend on; it can be renamed but not removed. */
  builtin: boolean;
  active: boolean;
  note?: string;
}

export const LEDGER_TYPES: Array<{ v: LedgerType; l: string; sign: 'dr' | 'cr' }> = [
  { v: 'asset', l: 'Assets', sign: 'dr' },
  { v: 'liability', l: 'Liabilities', sign: 'cr' },
  { v: 'equity', l: 'Equity', sign: 'cr' },
  { v: 'income', l: 'Income', sign: 'cr' },
  { v: 'expense', l: 'Expenses', sign: 'dr' },
];

/** A debit raises an asset or expense; it lowers everything else. */
export function debitPositive(type: LedgerType): boolean {
  return type === 'asset' || type === 'expense';
}

const BUILTIN: Array<Omit<Ledger, 'builtin' | 'active'>> = [
  { id: 'n_inventory', code: '1200', name: 'Inventory', type: 'asset' },
  { id: 'n_ar', code: '1100', name: 'Accounts receivable', type: 'asset' },
  { id: 'n_ap', code: '2100', name: 'Accounts payable', type: 'liability' },
  { id: 'n_tax', code: '2200', name: 'Tax payable', type: 'liability' },
  { id: 'n_equity', code: '3000', name: 'Owner equity', type: 'equity' },
  { id: 'n_sales', code: '4000', name: 'Sales', type: 'income' },
  { id: 'n_income', code: '4900', name: 'Other income', type: 'income' },
  { id: 'n_cogs', code: '5000', name: 'Cost of goods sold', type: 'expense' },
  { id: 'n_expense', code: '6000', name: 'Expenses', type: 'expense' },
  { id: 'n_discount', code: '6100', name: 'Discounts given', type: 'expense' },
  { id: 'n_loyalty', code: '6200', name: 'Loyalty redemptions', type: 'expense' },
];

/**
 * Builds the chart from the built-ins, the shop's real cash/bank accounts, and
 * anything a posting has referenced that neither covers. Called on load, so an
 * older book gains a chart without losing its history.
 */
export function ensureCoa(d: any): Ledger[] {
  const existing: Ledger[] = Array.isArray(d.coa) ? d.coa : [];
  const byId = new Map(existing.map((l) => [l.id, l]));

  BUILTIN.forEach((b) => {
    const cur = byId.get(b.id);
    if (cur) { cur.builtin = true; return; }
    byId.set(b.id, { ...b, builtin: true, active: true });
  });

  // cash, bank and wallet accounts are asset ledgers in their own right
  (d.accounts || []).forEach((a: any, i: number) => {
    const cur = byId.get(a.id);
    if (cur) { cur.name = cur.name || a.name; return; }
    byId.set(a.id, {
      id: a.id,
      code: String(1000 + i + 1),
      name: a.name,
      type: 'asset',
      builtin: true,
      active: true,
    });
  });

  // anything posted to but never declared
  (d.journal || []).forEach((e: JournalEntry) => {
    e.lines.forEach((l) => {
      if (byId.has(l.acc)) return;
      byId.set(l.acc, {
        id: l.acc, code: '9' + String(byId.size).padStart(3, '0'),
        name: l.acc, type: 'equity', builtin: false, active: true,
      });
    });
  });

  const out = [...byId.values()].sort((a, b) => a.code.localeCompare(b.code));
  d.coa = out;
  return out;
}

export function ledgerOf(d: DB, id: string): Ledger | undefined {
  return (d.coa || []).find((l) => l.id === id);
}

export function ledgerName(d: DB, id: string): string {
  return ledgerOf(d, id)?.name || id;
}

/** Net movement on a ledger, signed so a positive figure reads naturally. */
/**
 * Every ledger's debits and credits in a single pass.
 *
 * The chart of accounts and the trial balance both used to call a per-ledger
 * helper that walked the whole journal, so the work grew with ledgers × entries
 * and the screen slowed down as the books filled up. One pass over the journal
 * answers for all of them.
 */
/**
 * The journal a reader should see.
 *
 * Leaving the branch out means the one being worked in, which is what every
 * ordinary finance screen wants — a branch is run as its own business, so its
 * trial balance must not carry another branch's postings. Passing null asks for
 * all of them, for the owner's cross-branch view.
 */
function scopeOf(d: DB, branch: string | null | undefined) {
  return branchJournal(d, branch === undefined ? activeBranchId(d) : branch);
}

export function ledgerSums(
  d: DB,
  from = 0,
  to = Number.MAX_SAFE_INTEGER,
  branch?: string | null,
): Map<string, { dr: number; cr: number }> {
  const out = new Map<string, { dr: number; cr: number }>();
  scopeOf(d, branch).forEach((e) => {
    const t = new Date(e.ts).getTime();
    if (t < from || t > to) return;
    e.lines.forEach((x) => {
      let acc = out.get(x.acc);
      if (!acc) { acc = { dr: 0, cr: 0 }; out.set(x.acc, acc); }
      acc.dr += x.dr || 0;
      acc.cr += x.cr || 0;
    });
  });
  return out;
}

/** Signed balances for every ledger, from one pass. */
export function ledgerBalances(
  d: DB,
  from = 0,
  to = Number.MAX_SAFE_INTEGER,
  branch?: string | null,
): Map<string, number> {
  const sums = ledgerSums(d, from, to, branch);
  const out = new Map<string, number>();
  (d.coa || []).forEach((l) => {
    const s = sums.get(l.id) || { dr: 0, cr: 0 };
    const net = s.dr - s.cr;
    out.set(l.id, debitPositive(l.type) ? net : -net);
  });
  return out;
}

export function ledgerBalance(d: DB, id: string, from = 0, to = Number.MAX_SAFE_INTEGER, branch?: string | null): number {
  const l = ledgerOf(d, id);
  let dr = 0;
  let cr = 0;
  scopeOf(d, branch).forEach((e) => {
    const t = new Date(e.ts).getTime();
    if (t < from || t > to) return;
    e.lines.forEach((x) => {
      if (x.acc !== id) return;
      dr += x.dr || 0;
      cr += x.cr || 0;
    });
  });
  const net = dr - cr;
  return l && debitPositive(l.type) ? net : -net;
}

export interface LedgerPosting {
  id: string;
  ts: string;
  memo: string;
  ref: string;
  dr: number;
  cr: number;
  /** Balance after this posting, oldest to newest. */
  balance: number;
}

/** Every posting that touched a ledger, newest first, with a running balance. */
export function ledgerHistory(d: DB, id: string, branch?: string | null): LedgerPosting[] {
  const l = ledgerOf(d, id);
  const pos = debitPositive(l?.type || 'asset');
  const rows: Omit<LedgerPosting, 'balance'>[] = [];

  scopeOf(d, branch).forEach((e) => {
    e.lines.forEach((x) => {
      if (x.acc !== id) return;
      rows.push({ id: e.id + ':' + rows.length, ts: e.ts, memo: e.memo, ref: e.ref, dr: x.dr || 0, cr: x.cr || 0 });
    });
  });

  rows.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  let run = 0;
  const withBalance = rows.map((r) => {
    run += pos ? r.dr - r.cr : r.cr - r.dr;
    return { ...r, balance: run };
  });
  return withBalance.reverse();
}

/** Trial balance across the chart, for the period given. */
export function trialBalance(d: DB, from = 0, to = Number.MAX_SAFE_INTEGER, branch?: string | null) {
  const sums = ledgerSums(d, from, to, branch);
  const rows = (d.coa || []).map((l) => {
    const { dr, cr } = sums.get(l.id) || { dr: 0, cr: 0 };
    const net = dr - cr;
    return { ledger: l, dr, cr, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
  }).filter((r) => r.dr || r.cr);

  return {
    rows,
    totalDebit: rows.reduce((s, r) => s + r.debit, 0),
    totalCredit: rows.reduce((s, r) => s + r.credit, 0),
  };
}

/* ---------------------------------------------------------------- */
/* Ledgers a business of each kind usually needs                      */
/* ---------------------------------------------------------------- */

type Starter = { name: string; type: LedgerType };

/** What almost every shop spends on. */
const COMMON: Starter[] = [
  { name: 'Rent', type: 'expense' },
  { name: 'Salaries & wages', type: 'expense' },
  { name: 'Electricity & water', type: 'expense' },
  { name: 'Transport & fuel', type: 'expense' },
  { name: 'Airtime & internet', type: 'expense' },
  { name: 'Repairs & maintenance', type: 'expense' },
  { name: 'Bank & mobile money charges', type: 'expense' },
  { name: 'Licences & taxes', type: 'expense' },
  { name: 'Marketing', type: 'expense' },
];

/** What a business of this kind adds to that. Keys match the onboarding choices. */
const BY_TYPE: Record<string, Starter[]> = {
  retail: [{ name: 'Packaging', type: 'expense' }, { name: 'Breakages & losses', type: 'expense' }],
  hardware: [{ name: 'Loading & delivery', type: 'expense' }, { name: 'Delivery charges', type: 'income' }, { name: 'Cutting & fitting fees', type: 'income' }],
  restaurant: [
    { name: 'Kitchen supplies', type: 'expense' }, { name: 'Gas & charcoal', type: 'expense' },
    { name: 'Food spoilage', type: 'expense' }, { name: 'Service charge', type: 'income' },
  ],
  pharmacy: [
    { name: 'Expired stock written off', type: 'expense' }, { name: 'Professional licence fees', type: 'expense' },
    { name: 'Consultation fees', type: 'income' },
  ],
  salon: [{ name: 'Salon supplies', type: 'expense' }, { name: 'Commission to staff', type: 'expense' }, { name: 'Service income', type: 'income' }],
  wholesale: [{ name: 'Loading & delivery', type: 'expense' }, { name: 'Agent commission', type: 'expense' }, { name: 'Delivery charges', type: 'income' }],
  electronics: [
    { name: 'Spare parts', type: 'expense' }, { name: 'Warranty repairs', type: 'expense' },
    { name: 'Repair services', type: 'income' }, { name: 'Installation fees', type: 'income' },
  ],
};

/**
 * Adds the ledgers a business of this type usually needs, skipping any the
 * chart already has by name. Returns how many were added.
 */
export function addStarterLedgers(d: any, businessType?: string): number {
  d.coa = Array.isArray(d.coa) ? d.coa : [];
  const want = [...COMMON, ...(BY_TYPE[businessType || ''] || [])];
  let added = 0;
  want.forEach((w) => {
    if (d.coa.some((l: Ledger) => l.name.trim().toLowerCase() === w.name.toLowerCase())) return;
    const base = w.type === 'income' ? 4100 : 6300;
    const top = w.type === 'income' ? 4900 : 7000;
    const used = d.coa.map((l: Ledger) => Number(l.code)).filter((n: number) => n >= base && n < top);
    const code = String(used.length ? Math.max(...used) + 10 : base);
    d.coa.push({ id: 'led_' + Math.random().toString(36).slice(2, 8), code, name: w.name, type: w.type, builtin: false, active: true });
    added += 1;
  });
  d.coa.sort((a: Ledger, b: Ledger) => a.code.localeCompare(b.code));
  return added;
}
