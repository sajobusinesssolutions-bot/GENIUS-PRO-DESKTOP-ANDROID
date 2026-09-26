import type { BankReconciliation, BankStatementLine, DB, JournalEntry } from './types';
import { cents } from './logic';
import { uid, iso } from './uid';
import { ledgerBalance } from './coa';

export interface StatementInput {
  date: string; description: string; amount: number; reference?: string;
}

export interface StatementCsvResult {
  rows: StatementInput[];
  errors: string[];
}

export interface ReconciliationSummary {
  statementClosing: number;
  bookClosing: number;
  difference: number;
  matched: number;
  unmatched: number;
  ignored: number;
}

export function importStatementLines(d: DB, accountId: string, lines: StatementInput[], importedAt = new Date()): BankStatementLine[] {
  if (!d.bankStatementLines) d.bankStatementLines = [];
  const created = lines.map((line) => ({
    id: uid('stl'), accountId, date: line.date, description: line.description.trim(),
    amount: cents(line.amount), ...(line.reference ? { reference: line.reference.trim() } : {}),
    status: 'unmatched' as const, importedAt: iso(importedAt),
  }));
  d.bankStatementLines.push(...created);
  return created;
}

function journalAmount(entry: JournalEntry, accountId: string): number {
  const line = entry.lines.find((x) => x.acc === accountId);
  return line ? cents((line.dr || 0) - (line.cr || 0)) : 0;
}

export function candidateJournalEntries(d: DB, line: BankStatementLine, tolerance = 0.01): JournalEntry[] {
  const target = cents(line.amount);
  return d.journal.filter((entry) => {
    if (entry.ts.slice(0, 10) !== line.date.slice(0, 10)) return false;
    if (Math.abs(cents(journalAmount(entry, line.accountId) - target)) > tolerance) return false;
    if (line.reference && entry.ref && entry.ref.toLowerCase().includes(line.reference.toLowerCase())) return true;
    return !line.reference;
  });
}

export function matchStatementLine(d: DB, lineId: string, journalId: string): BankStatementLine | null {
  const line = (d.bankStatementLines || []).find((x) => x.id === lineId);
  const entry = d.journal.find((x) => x.id === journalId);
  if (!line || !entry || line.status !== 'unmatched' || Math.abs(journalAmount(entry, line.accountId) - line.amount) > 0.01) return null;
  line.matchedJournalId = journalId;
  line.status = 'matched';
  return line;
}

export function summarizeReconciliation(d: DB, accountId: string, from: string, to: string, closing: number): ReconciliationSummary {
  const lines = (d.bankStatementLines || []).filter((x) => x.accountId === accountId && x.date >= from && x.date <= to);
  const opening = d.accounts.find((x) => x.id === accountId)?.opening || 0;
  const bookClosing = cents(opening + ledgerBalance(
    d, accountId, new Date(from + 'T00:00:00.000Z').getTime(), new Date(to + 'T23:59:59.999Z').getTime(),
  ));
  return {
    statementClosing: cents(closing), bookClosing, difference: cents(closing - bookClosing),
    matched: lines.filter((x) => x.status === 'matched').length,
    unmatched: lines.filter((x) => x.status === 'unmatched').length,
    ignored: lines.filter((x) => x.status === 'ignored').length,
  };
}

export function completeReconciliation(d: DB, accountId: string, from: string, to: string, closing: number, userId: string): BankReconciliation | null {
  const summary = summarizeReconciliation(d, accountId, from, to, closing);
  if (summary.difference !== 0 || summary.unmatched > 0) return null;
  const result: BankReconciliation = {
    id: uid('rec'), accountId, from, to, opening: d.accounts.find((x) => x.id === accountId)?.opening || 0,
    closing: cents(closing), statementLineIds: (d.bankStatementLines || []).filter((x) => x.accountId === accountId && x.date >= from && x.date <= to).map((x) => x.id),
    completedAt: iso(), completedBy: userId,
  };
  if (!d.bankReconciliations) d.bankReconciliations = [];
  d.bankReconciliations.push(result);
  return result;
}

function csvRecord(text: string): string[] {
  const cells: string[] = [];
  let cell = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"' && quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { cells.push(cell.trim()); cell = ''; }
    else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

const headerName = (value: string) => value.toLowerCase().replace(/[^a-z]/g, '');
const amountValue = (value: string) => Number(value.replace(/[^0-9.-]/g, ''));

export function parseStatementCsv(text: string): StatementCsvResult {
  const records = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (!records.length) return { rows: [], errors: ['The statement is empty.'] };
  const headers = csvRecord(records[0]).map(headerName);
  const dateAt = headers.findIndex((x) => ['date', 'valuedate', 'transactiondate'].includes(x));
  const descriptionAt = headers.findIndex((x) => ['description', 'details', 'narration', 'particulars'].includes(x));
  const amountAt = headers.findIndex((x) => ['amount', 'value', 'transactionamount'].includes(x));
  const debitAt = headers.findIndex((x) => ['debit', 'withdrawal', 'withdrawals'].includes(x));
  const creditAt = headers.findIndex((x) => ['credit', 'deposit', 'deposits'].includes(x));
  const referenceAt = headers.findIndex((x) => ['reference', 'ref', 'transactionreference'].includes(x));
  if (dateAt < 0 || descriptionAt < 0 || (amountAt < 0 && debitAt < 0 && creditAt < 0)) {
    return { rows: [], errors: ['Include date, description, and amount columns (or debit and credit columns).'] };
  }

  const rows: StatementInput[] = [];
  const errors: string[] = [];
  records.slice(1).forEach((record, index) => {
    const cells = csvRecord(record);
    const date = cells[dateAt] || '';
    const description = cells[descriptionAt] || '';
    const rawAmount = amountAt >= 0 ? cells[amountAt] : '';
    const debit = debitAt >= 0 ? amountValue(cells[debitAt] || '') : NaN;
    const credit = creditAt >= 0 ? amountValue(cells[creditAt] || '') : NaN;
    const amount = amountAt >= 0 ? amountValue(rawAmount) : (Number.isFinite(credit) ? credit : 0) - (Number.isFinite(debit) ? debit : 0);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !description || !Number.isFinite(amount)) {
      errors.push('Row ' + (index + 2) + ': date must be YYYY-MM-DD, description is required, and amount must be numeric.');
      return;
    }
    rows.push({ date, description, amount, ...(referenceAt >= 0 && cells[referenceAt] ? { reference: cells[referenceAt] } : {}) });
  });
  return { rows, errors };
}

export function importStatementCsv(d: DB, accountId: string, text: string, importedAt = new Date()): StatementCsvResult {
  const parsed = parseStatementCsv(text);
  if (parsed.rows.length) importStatementLines(d, accountId, parsed.rows, importedAt);
  return parsed;
}