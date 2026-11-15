/**
 * The detailed balance sheet, general ledger and profit & loss: each group
 * under its heading, its accounts as rows that open in place to show what
 * moved them, and a bold total with a rule above it at the end of the group.
 * Figures come from data/statementDetail.ts, which reads the same journal as
 * the summary statements, so both views always come to the same totals.
 *
 * Laid out as the other reports are: no cards above the list and no colour;
 * the bottom line is on the totals bar at the foot (detailedTotals).
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { fonts } from '../theme';
import type { DB } from '../data/types';
import {
  statementAccounts, StatementAccount, AccClass, runningBalances, pctOf, fmtSigned, fmtParen, drCr,
} from '../data/statementDetail';
import { FactRow, GroupHead, GroupTotal, useReportPalette } from './ReportList';

export type DetailedKind = 'balance-sheet' | 'general-ledger' | 'pnl';

const day = (ts: string) => new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
const LABEL: Record<AccClass, string> = { asset: 'Assets', liability: 'Liabilities', equity: 'Equity', income: 'Income', expense: 'Expenses' };

/* two decimals, and nothing as a dash */
const none = (n: number) => Math.abs(n) < 0.005;
const sg = (n: number) => (none(n) ? '—' : fmtSigned(n, 2));
const pn = (n: number) => (none(n) ? '—' : fmtParen(n, 2));
const dc = (n: number) => (none(n) ? '—' : drCr(n, 2));

/* ── the sums each statement is built on, shared by the list and the totals bar ── */

function balanceSheet(accounts: StatementAccount[], live: (a: StatementAccount) => unknown) {
  // a debit balance on an asset, a credit balance on a liability or equity, are both positive here
  const bal = (a: StatementAccount) => (a.cls === 'asset' ? a.closing : -a.closing);
  const income = accounts.filter((a) => a.cls === 'income').reduce((s, a) => s + (a.credits - a.debits), 0);
  const expense = accounts.filter((a) => a.cls === 'expense').reduce((s, a) => s + (a.debits - a.credits), 0);
  // the year's profit so far belongs to the owner until it is closed off: it is shown in equity
  const profit = income - expense;
  const sec = (cls: AccClass) => accounts.filter((a) => a.cls === cls && live(a));
  const all = (cls: AccClass) => accounts.filter((a) => a.cls === cls);
  const assets = sec('asset'), liabilities = sec('liability'), equity = sec('equity');
  const tA = all('asset').reduce((s, a) => s + bal(a), 0);
  const tL = all('liability').reduce((s, a) => s + bal(a), 0);
  const tE = all('equity').reduce((s, a) => s + bal(a), 0) + profit;
  return { bal, profit, assets, liabilities, equity, tA, tL, tE, diff: Math.round((tA - tL - tE) * 100) / 100 };
}

function profitAndLoss(accounts: StatementAccount[]) {
  const inc = (a: StatementAccount) => a.credits - a.debits;
  const exp = (a: StatementAccount) => a.debits - a.credits;
  const moved = (a: StatementAccount) => a.debits || a.credits;
  const otherIncome = accounts.filter((a) => a.cls === 'income' && a.id !== 'n_sales' && a.id !== 'n_discount' && a.id !== 'n_loyalty' && moved(a));
  const cogs = accounts.filter((a) => a.cls === 'expense' && (a.id === 'n_cogs' || a.id === 'n_transitloss') && moved(a));
  // discounts and loyalty sit with the expenses in the books; here they come off sales
  const discounts = accounts.filter((a) => (a.id === 'n_discount' || a.id === 'n_loyalty') && moved(a));
  const expenses = accounts.filter((a) => a.cls === 'expense' && !cogs.includes(a) && !discounts.includes(a) && moved(a));
  const sales = accounts.filter((a) => a.id === 'n_sales');
  const netSales = sales.reduce((s, a) => s + inc(a), 0) - discounts.reduce((s, a) => s + exp(a), 0);
  const tCogs = cogs.reduce((s, a) => s + exp(a), 0);
  const gross = netSales - tCogs;
  const tOther = otherIncome.reduce((s, a) => s + inc(a), 0);
  const tExp = expenses.reduce((s, a) => s + exp(a), 0);
  return { inc, exp, sales, discounts, cogs, otherIncome, expenses, netSales, tCogs, gross, tOther, tExp, net: gross + tOther - tExp };
}

/** What the totals bar says for a detailed statement: its bottom line, and the figures beside it. */
export function detailedTotals(kind: DetailedKind, db: DB, from: number, to: number): { label: string; value: string; others: { label: string; value: string }[] } {
  const accounts = statementAccounts(db, from, to);
  if (kind === 'balance-sheet') {
    const b = balanceSheet(accounts, () => true);
    return { label: Math.abs(b.diff) < 1 ? 'Total assets · balanced' : 'Total assets · out by ' + sg(b.diff), value: sg(b.tA),
      others: [{ label: 'Liabilities', value: sg(b.tL) }, { label: 'Equity', value: sg(b.tE) }, { label: 'Liabilities + equity', value: sg(b.tL + b.tE) }] };
  }
  if (kind === 'general-ledger') {
    const tDr = accounts.reduce((s, a) => s + a.debits, 0), tCr = accounts.reduce((s, a) => s + a.credits, 0);
    const diff = Math.round((tDr - tCr) * 100) / 100;
    return { label: Math.abs(diff) < 1 ? 'Total debits · balanced' : 'Total debits · out by ' + sg(diff), value: sg(tDr), others: [{ label: 'Total credits', value: sg(tCr) }] };
  }
  const p = profitAndLoss(accounts);
  const pc = (n: number) => pctOf(n, p.netSales).toFixed(1) + '%';
  return { label: (p.net >= 0 ? 'Net profit' : 'Net loss') + ' · ' + pc(p.net), value: pn(p.net),
    others: [{ label: 'Gross profit', value: pn(p.gross) }, { label: 'Expenses', value: pn(p.tExp) }, { label: 'Net sales', value: pn(p.netSales) }, { label: 'Other income', value: pn(p.tOther) }] };
}

export default function DetailedStatement({ kind, db, from, to, focus, onOpenLedger, hideZero = true }: {
  kind: DetailedKind; db: DB; from: number; to: number;
  /** An account to open straight away (from the balance sheet's "View ledger"). */
  focus?: string;
  onOpenLedger?: (accountId: string) => void;
  /** Accounts with nothing on them are left out (More → Hide zero balances). */
  hideZero?: boolean;
}) {
  const pal = useReportPalette();
  const accounts = useMemo(() => statementAccounts(db, from, to), [db, from, to]);
  /* one account open at a time */
  const [open, setOpen] = useState<string | null>(focus || null);
  // a new range starts every account closed again
  useEffect(() => { setOpen(focus || null); }, [from, to, focus]);
  const toggle = (id: string) => setOpen((o) => (o === id ? null : id));
  const live = (a: StatementAccount) => !hideZero || a.debits || a.credits || Math.abs(a.closing) > 0.005;
  const isZero = (a: StatementAccount) => !a.debits && !a.credits && Math.abs(a.closing) < 0.005;

  const muted = { fontFamily: fonts.ui, fontSize: 12, color: pal.muted };
  const num = { fontVariant: ['tabular-nums' as const] };
  /** An entry inside an open account: what it was, when, and its figure. */
  const entry = (key: string, when: string, what: string, sub: string, value: string, first: boolean) => (
    <View key={key} style={{ flexDirection: 'row', gap: 10, paddingVertical: 7, borderTopWidth: first ? 0 : 1, borderTopColor: pal.row }}>
      <Text style={{ ...muted, width: 46 }}>{when}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: fonts.ui, fontSize: 14, color: pal.text }}>{what || '—'}</Text>
        {sub ? <Text style={[muted, num]}>{sub}</Text> : null}
      </View>
      <Text style={[{ fontFamily: fonts.ui, fontSize: 14, color: pal.text, textAlign: 'right' }, num]}>{value}</Text>
    </View>
  );
  const quiet = <Text style={{ ...muted, paddingVertical: 6 }}>No transactions this period.</Text>;
  const rule = <View style={{ height: 1, backgroundColor: pal.row, marginVertical: 6 }} />;
  const wrap = (kids: React.ReactNode) => <View style={{ backgroundColor: pal.card, borderTopWidth: 1, borderBottomWidth: 1, borderColor: pal.section }}>{kids}</View>;

  /* ─────────────── balance sheet ─────────────── */
  if (kind === 'balance-sheet') {
    const b = balanceSheet(accounts, live);
    const section = (cls: AccClass, list: StatementAccount[], total: number, extra?: React.ReactNode) => (list.length || extra ? (
      <View key={cls}>
        <GroupHead label={LABEL[cls]} right="closing" />
        {list.map((a) => {
          const last = a.entries.slice(-3).reverse();
          return (
            <FactRow key={a.id} title={a.name}
              sub={isZero(a) ? 'No movement' : 'Dr ' + sg(a.debits) + ' · Cr ' + sg(a.credits) + ' · ' + pctOf(b.bal(a), total) + '% of ' + LABEL[cls].toLowerCase()}
              value={sg(b.bal(a))} valueLabel="Closing" zero={isZero(a)}
              open={open === a.id} onToggle={() => toggle(a.id)}
              lines={[
                { label: 'Opening', value: sg(a.cls === 'asset' ? a.opening : -a.opening) },
                { label: 'Debits', value: sg(a.debits) },
                { label: 'Credits', value: sg(a.credits) },
                { label: 'Closing', value: sg(b.bal(a)), bold: true },
              ]}
              action={onOpenLedger ? (a.entries.length > 3 ? 'View all ' + a.entries.length + ' entries in ledger' : 'View ledger') : undefined}
              onAction={onOpenLedger ? () => onOpenLedger(a.id) : undefined}>
              {rule}
              {last.length ? last.map((e, i) => entry(e.id + i, day(e.ts), e.description, e.ref || '', e.debit ? 'Dr ' + sg(e.debit) : 'Cr ' + sg(e.credit), i === 0)) : quiet}
            </FactRow>
          );
        })}
        {extra}
        <GroupTotal label={'Total ' + LABEL[cls].toLowerCase()} value={sg(total)} />
      </View>
    ) : null);
    return wrap(
      <>
        {section('asset', b.assets, b.tA)}
        {section('liability', b.liabilities, b.tL)}
        {section('equity', b.equity, b.tE, Math.abs(b.profit) > 0.005 ? (
          <FactRow title={(b.profit >= 0 ? 'Profit' : 'Loss') + ' for the period'} sub="Belongs to the owner until the year is closed" value={sg(b.profit)} valueLabel="Closing" />
        ) : null)}
        <GroupTotal label="Liabilities + equity" value={sg(b.tL + b.tE)} note={Math.abs(b.diff) < 1 ? 'equal to total assets' : 'out by ' + sg(b.diff)} />
      </>,
    );
  }

  /* ─────────────── general ledger ─────────────── */
  if (kind === 'general-ledger') {
    const order: AccClass[] = ['asset', 'liability', 'equity', 'income', 'expense'];
    return wrap(
      <>
        {order.map((cls) => {
          const list = accounts.filter((a) => a.cls === cls && live(a));
          if (!list.length) return null;
          const net = accounts.filter((a) => a.cls === cls).reduce((s, a) => s + a.closing, 0);
          return (
            <View key={cls}>
              <GroupHead label={LABEL[cls]} right="closing" />
              {list.map((a) => {
                const isOpen = open === a.id;
                const runs = isOpen ? runningBalances(a.opening, a.entries) : [];
                return (
                  <FactRow key={a.id} title={a.name}
                    sub={isZero(a) ? 'No movement' : 'Opening ' + dc(a.opening) + ' · Dr ' + sg(a.debits) + ' · Cr ' + sg(a.credits)}
                    value={dc(a.closing)} valueLabel="Closing" zero={isZero(a)}
                    open={isOpen} onToggle={() => toggle(a.id)}
                    lines={[
                      { label: 'Opening', value: dc(a.opening) },
                      { label: 'Debit', value: sg(a.debits) },
                      { label: 'Credit', value: sg(a.credits) },
                      { label: 'Closing', value: dc(a.closing), bold: true },
                    ]}>
                    {rule}
                    <Text style={{ ...muted, fontSize: 11, paddingBottom: 2 }}>Every entry, with the balance after it</Text>
                    {a.entries.length ? a.entries.map((e, i) => entry(e.id + i, day(e.ts), e.description,
                      (e.ref ? e.ref + ' · ' : '') + (e.debit ? 'Dr ' + sg(e.debit) : 'Cr ' + sg(e.credit)), dc(runs[i]), i === 0)) : quiet}
                  </FactRow>
                );
              })}
              <GroupTotal label={'Total ' + LABEL[cls].toLowerCase()} value={dc(net)} />
            </View>
          );
        })}
      </>,
    );
  }

  /* ─────────────── profit & loss ─────────────── */
  const p = profitAndLoss(accounts);
  const pcs = (n: number) => pctOf(n, p.netSales).toFixed(1) + '%';
  const block = (title: string, rows: Array<{ a: StatementAccount; v: number }>, total: number, totalLabel: string) => (rows.length ? (
    <View key={title}>
      <GroupHead label={title} right="% of sales" />
      {rows.map(({ a, v }) => (
        <FactRow key={a.id} title={a.name} sub={pcs(v) + ' of sales · ' + a.entries.length + ' entr' + (a.entries.length === 1 ? 'y' : 'ies')}
          value={pn(v)} zero={none(v)}
          open={open === a.id} onToggle={() => toggle(a.id)}>
          {a.entries.length ? a.entries.map((e, i) => entry(e.id + i, day(e.ts), e.description, e.ref || '', pn(a.cls === 'income' ? e.credit - e.debit : e.debit - e.credit), i === 0)) : quiet}
        </FactRow>
      ))}
      <GroupTotal label={totalLabel} value={pn(total)} note={pcs(total) + ' of sales'} />
    </View>
  ) : null);
  return wrap(
    <>
      {block('Sales (net)', [...p.sales.map((a) => ({ a, v: p.inc(a) })), ...p.discounts.map((a) => ({ a, v: -p.exp(a) }))], p.netSales, 'Net sales')}
      {block('Less cost of goods sold', p.cogs.map((a) => ({ a, v: p.exp(a) })), p.tCogs, 'Cost of goods sold')}
      <GroupTotal label="Gross profit" value={pn(p.gross)} note={pcs(p.gross) + ' margin'} />
      {block('Other income', p.otherIncome.map((a) => ({ a, v: p.inc(a) })), p.tOther, 'Other income')}
      {block('Expenses', p.expenses.map((a) => ({ a, v: p.exp(a) })), p.tExp, 'Expenses')}
      <GroupTotal label={p.net >= 0 ? 'Net profit' : 'Net loss'} value={pn(p.net)} note={pcs(p.net) + ' margin'} />
    </>,
  );
}
