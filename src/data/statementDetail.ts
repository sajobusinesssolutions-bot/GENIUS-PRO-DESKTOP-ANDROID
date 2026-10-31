/**
 * THE DETAILED STATEMENTS — balance sheet, general ledger, profit & loss.
 *
 * Every ledger's opening, debits, credits and closing for a range, with the
 * entries that moved it, read from the journal in one pass. The screen
 * (components/DetailedStatement.tsx) groups and expands them; the sums here are
 * the same ones the summary statements use, so the two views always agree.
 */
import { groupNum } from './helpers';
import type { DB } from './types';
import { ensureCoa } from './coa';

export type AccClass = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export interface StatementEntry { id: string; ts: string; ref: string; description: string; debit: number; credit: number }
export interface StatementAccount {
  id: string; name: string; cls: AccClass;
  /** Before the range; for income and expense, zero (they start each period afresh). */
  opening: number; debits: number; credits: number; closing: number;
  /** Oldest first. */
  entries: StatementEntry[];
}

/** Every ledger with its figures for the range [from, to]. Debit-positive, as the journal is. */
export function statementAccounts(db: DB, from: number, to: number): StatementAccount[] {
  const coa = ensureCoa(db);
  const by = new Map<string, StatementAccount>();
  coa.forEach((l) => by.set(l.id, { id: l.id, name: l.name, cls: l.type as AccClass, opening: 0, debits: 0, credits: 0, closing: 0, entries: [] }));
  (db.accounts || []).forEach((a) => { if (!by.has(a.id)) by.set(a.id, { id: a.id, name: a.name, cls: 'asset', opening: 0, debits: 0, credits: 0, closing: 0, entries: [] }); });
  for (const e of db.journal) {
    const at = new Date(e.ts).getTime();
    if (at > to) continue;
    for (const l of e.lines) {
      let a = by.get(l.acc);
      if (!a) { a = { id: l.acc, name: l.acc, cls: 'asset', opening: 0, debits: 0, credits: 0, closing: 0, entries: [] }; by.set(l.acc, a); }
      const dr = l.dr || 0, cr = l.cr || 0;
      if (at < from) { if (a.cls !== 'income' && a.cls !== 'expense') a.opening += dr - cr; continue; }
      a.debits += dr; a.credits += cr;
      a.entries.push({ id: e.id, ts: e.ts, ref: e.ref || '', description: e.memo || '', debit: dr, credit: cr });
    }
  }
  const out = [...by.values()];
  out.forEach((a) => {
    a.closing = round(a.opening + a.debits - a.credits);
    a.entries.sort((x, y) => x.ts.localeCompare(y.ts));
  });
  return out;
}

/** A balance after each entry, starting from the opening — debit-positive. */
export function runningBalances(opening: number, entries: Array<{ debit: number; credit: number }>): number[] {
  let b = opening;
  return entries.map((e) => (b = round(b + e.debit - e.credit)));
}

/** A share of a whole, to one decimal; nothing of nothing is 0. */
export function pctOf(part: number, whole: number): number {
  return whole ? Math.round((part / whole) * 1000) / 10 : 0;
}

/** en-US grouping, no currency; a minus sign for a negative (balance sheet). */
export function fmtSigned(n: number, decimals = 0): string {
  const v = groupNum(Math.abs(n), decimals);
  return n < 0 && Math.abs(n) >= 0.5 * Math.pow(10, -decimals) ? '-' + v : v;
}

/** en-US grouping, a negative in parentheses (profit & loss). */
export function fmtParen(n: number, decimals = 0): string {
  const v = groupNum(Math.abs(n), decimals);
  return n < 0 && Math.abs(n) >= 0.5 * Math.pow(10, -decimals) ? '(' + v + ')' : v;
}

/** A balance with its side: "26,500 Dr", "1,200 Cr", "0". */
export function drCr(n: number, decimals = 0): string {
  if (Math.abs(n) < 0.005) return '0';
  return fmtSigned(Math.abs(n), decimals) + (n > 0 ? ' Dr' : ' Cr');
}

function round(n: number) { return Math.round(n * 100) / 100; }
