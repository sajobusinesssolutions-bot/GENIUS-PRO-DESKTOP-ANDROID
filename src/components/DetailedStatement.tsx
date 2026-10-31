/**
 * The detailed balance sheet, general ledger and profit & loss: grouped cards
 * whose accounts open in place to show what moved them. Figures come from
 * data/statementDetail.ts, which reads the same journal as the summary
 * statements, so both views always come to the same totals.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { Pressable } from './Press';
import { Icon } from './icons';
import { useTheme, fonts } from '../theme';
import type { DB } from '../data/types';
import {
  statementAccounts, StatementAccount, AccClass, runningBalances, pctOf, fmtSigned, fmtParen, drCr,
} from '../data/statementDetail';

export type DetailedKind = 'balance-sheet' | 'general-ledger' | 'pnl';

const day = (ts: string) => new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
const LABEL: Record<AccClass, string> = { asset: 'ASSETS', liability: 'LIABILITIES', equity: 'EQUITY', income: 'INCOME', expense: 'EXPENSES' };

export default function DetailedStatement({ kind, db, from, to, focus, onOpenLedger }: {
  kind: DetailedKind; db: DB; from: number; to: number;
  /** An account to open straight away (from the balance sheet's "Open in general ledger"). */
  focus?: string;
  onOpenLedger?: (accountId: string) => void;
}) {
  const { colors } = useTheme();
  const accounts = useMemo(() => statementAccounts(db, from, to), [db, from, to]);
  const [open, setOpen] = useState<Record<string, boolean>>(focus ? { [focus]: true } : {});
  const [hideZero, setHideZero] = useState(true);
  // a new range starts every account closed again
  useEffect(() => { setOpen(focus ? { [focus]: true } : {}); }, [from, to, focus]);
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const live = (a: StatementAccount) => !hideZero || a.debits || a.credits || Math.abs(a.closing) > 0.005;

  const card = { backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' as const };
  const muted = { fontFamily: fonts.ui, fontSize: 12, color: colors.faint };
  const num = { fontFamily: fonts.monoSemi, fontVariant: ['tabular-nums' as const] };
  const panel = { backgroundColor: colors.sunk, borderTopWidth: 1, borderTopColor: colors.line, padding: 12 };

  const chip = (label: string, on: boolean, onPress: () => void) => (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 4, borderWidth: 1.2,
      borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accentSoft : colors.surface }}>
      {on ? <Icon name="check" size={13} color={colors.accent} /> : null}
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: on ? colors.accent : colors.ink }}>{label}</Text>
    </Pressable>
  );
  const chevron = (isOpen: boolean) => (
    <View style={{ transform: [{ rotate: isOpen ? '90deg' : '0deg' }] }}><Icon name="chev" size={15} color={colors.faint} /></View>
  );
  const bar = (label: string, value: string, bad = false) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: 14, borderRadius: 8, backgroundColor: bad ? colors.danger : colors.accent }}>
      <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: '#fff', flexShrink: 1 }}>{label}</Text>
      <Text style={{ ...num, fontSize: 16, color: '#fff', flexShrink: 1, textAlign: 'right' }}>{value}</Text>
    </View>
  );
  const summary = (cells: Array<{ k: string; v: string; sub?: string; tone?: string }>) => (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      {cells.map((c) => (
        <View key={c.k} style={{ ...card, flex: 1, padding: 12 }}>
          <Text style={muted}>{c.k}</Text>
          <Text style={{ ...num, fontSize: 17, color: c.tone || colors.ink, marginTop: 4 }}>{c.v}</Text>
          {c.sub ? <Text style={{ ...muted, marginTop: 3 }}>{c.sub}</Text> : null}
        </View>
      ))}
    </View>
  );

  /* ─────────────── balance sheet ─────────────── */
  if (kind === 'balance-sheet') {
    // a debit balance on an asset, a credit balance on a liability or equity, are both positive here
    const bal = (a: StatementAccount) => (a.cls === 'asset' ? a.closing : -a.closing);
    const income = accounts.filter((a) => a.cls === 'income').reduce((s, a) => s + (a.credits - a.debits), 0);
    const expense = accounts.filter((a) => a.cls === 'expense').reduce((s, a) => s + (a.debits - a.credits), 0);
    // the year's profit so far belongs to the owner until it is closed off: it is shown in equity
    const profit = income - expense;
    const sec = (cls: AccClass) => accounts.filter((a) => a.cls === cls && live(a));
    const assets = sec('asset'), liabilities = sec('liability'), equity = sec('equity');
    const tA = assets.reduce((s, a) => s + bal(a), 0);
    const tL = liabilities.reduce((s, a) => s + bal(a), 0);
    const tE = equity.reduce((s, a) => s + bal(a), 0) + profit;
    const diff = Math.round((tA - tL - tE) * 100) / 100;
    const section = (cls: AccClass, list: StatementAccount[], total: number, extra?: React.ReactNode) => (list.length || extra ? (
      <View style={card}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.accentSoft }}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 12, letterSpacing: 0.7, color: colors.accent }}>{LABEL[cls]}</Text>
          <Text style={{ ...muted, fontSize: 11, letterSpacing: 0.5 }}>CLOSING · SHARE</Text>
        </View>
        {list.map((a) => {
          const isOpen = !!open[a.id];
          const last = a.entries.slice(-3).reverse();
          return (
            <View key={a.id} style={{ borderTopWidth: 1, borderTopColor: colors.line }}>
              <Pressable onPress={() => toggle(a.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 14, paddingVertical: 10 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink }}>{a.name}</Text>
                  <Text style={muted}>Dr {fmtSigned(a.debits)} · Cr {fmtSigned(a.credits)}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', maxWidth: '45%' }}>
                  <Text style={{ ...num, fontSize: 14, color: colors.ink, textAlign: 'right' }}>{fmtSigned(bal(a))}</Text>
                  <Text style={muted}>{pctOf(bal(a), total)}%</Text>
                </View>
                {chevron(isOpen)}
              </Pressable>
              {isOpen ? (
                <View style={panel}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 }}>
                    {([['Opening', a.cls === 'asset' ? a.opening : -a.opening], ['Debits', a.debits], ['Credits', a.credits], ['Closing', bal(a)]] as const).map(([k, v]) => (
                      <View key={k} style={{ width: '25%', minWidth: 72, paddingRight: 6 }}>
                        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 10.5, letterSpacing: 0.5, color: colors.faint }}>{k.toUpperCase()}</Text>
                        <Text style={{ ...num, fontSize: 13, color: colors.ink }}>{fmtSigned(v)}</Text>
                      </View>
                    ))}
                  </View>
                  {last.length ? (
                    <View style={{ marginTop: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 6, backgroundColor: colors.surface }}>
                      {last.map((e, i) => (
                        <View key={e.id + i} style={{ flexDirection: 'row', gap: 10, padding: 10, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
                          <Text style={{ ...muted, width: 46 }}>{day(e.ts)}</Text>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.ink }}>{e.description || '—'}</Text>
                            {e.ref ? <Text style={muted}>{e.ref}</Text> : null}
                          </View>
                          <Text style={{ ...num, fontSize: 12.5, color: e.debit ? colors.ink : colors.good }}>{e.debit ? 'Dr ' + fmtSigned(e.debit) : 'Cr ' + fmtSigned(e.credit)}</Text>
                        </View>
                      ))}
                    </View>
                  ) : <Text style={{ ...muted, marginTop: 10 }}>No transactions this period.</Text>}
                  {onOpenLedger ? (
                    <Pressable onPress={() => onOpenLedger(a.id)} style={{ paddingTop: 10, minHeight: 44, justifyContent: 'center' }}>
                      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.accent }}>
                        {a.entries.length > 3 ? 'View all ' + a.entries.length + ' entries in ledger ›' : 'Open in general ledger ›'}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
        {extra}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 11, backgroundColor: colors.accentSoft, borderTopWidth: 1, borderTopColor: colors.line }}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 13.5, color: colors.ink }}>Total {LABEL[cls].toLowerCase()}</Text>
          <Text style={{ ...num, fontSize: 13.5, color: colors.ink }}>{fmtSigned(total)}</Text>
        </View>
      </View>
    ) : null);
    return (
      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>{chip(hideZero ? 'Hide zero rows' : 'Show zero rows', hideZero, () => setHideZero((x) => !x))}</View>
        {summary([
          { k: 'Assets', v: fmtSigned(tA), sub: assets.length + ' account' + (assets.length === 1 ? '' : 's') },
          { k: 'Liabilities + equity', v: fmtSigned(tL + tE), sub: 'L ' + fmtSigned(tL) + ' · E ' + fmtSigned(tE) },
        ])}
        {section('asset', assets, tA)}
        {section('liability', liabilities, tL)}
        {section('equity', equity, tE, Math.abs(profit) > 0.005 ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.line }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink }}>{profit >= 0 ? 'Profit' : 'Loss'} for the period</Text>
            <Text style={{ ...num, fontSize: 14, color: profit >= 0 ? colors.good : colors.danger }}>{fmtSigned(profit)}</Text>
          </View>
        ) : null)}
        <View style={{ ...card, padding: 14, gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ fontFamily: fonts.ui, fontSize: 13.5, color: colors.soft }}>Total assets</Text><Text style={{ ...num, fontSize: 13.5, color: colors.ink }}>{fmtSigned(tA)}</Text></View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ fontFamily: fonts.ui, fontSize: 13.5, color: colors.soft }}>Liabilities + equity</Text><Text style={{ ...num, fontSize: 13.5, color: colors.ink }}>{fmtSigned(tL + tE)}</Text></View>
        </View>
        {bar('Balance · ' + (Math.abs(diff) < 1 ? 'Balanced' : 'Out by'), fmtSigned(diff), Math.abs(diff) >= 1)}
      </View>
    );
  }

  /* ─────────────── general ledger ─────────────── */
  if (kind === 'general-ledger') {
    const order: AccClass[] = ['asset', 'liability', 'equity', 'income', 'expense'];
    const tDr = accounts.reduce((s, a) => s + a.debits, 0);
    const tCr = accounts.reduce((s, a) => s + a.credits, 0);
    const diff = Math.round((tDr - tCr) * 100) / 100;
    return (
      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>{chip(hideZero ? 'Hide zero rows' : 'Show zero rows', hideZero, () => setHideZero((x) => !x))}</View>
        {order.map((cls) => {
          const list = accounts.filter((a) => a.cls === cls && live(a));
          if (!list.length) return null;
          const net = list.reduce((s, a) => s + a.closing, 0);
          return (
            <View key={cls} style={card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.accentSoft }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 12, letterSpacing: 0.7, color: colors.accent }}>{LABEL[cls]}</Text>
                <Text style={{ ...num, fontSize: 12.5, color: colors.accent }}>{drCr(net)}</Text>
              </View>
              {list.map((a) => {
                const isOpen = !!open[a.id];
                const runs = isOpen ? runningBalances(a.opening, a.entries) : [];
                return (
                  <View key={a.id} style={{ borderTopWidth: 1, borderTopColor: colors.line }}>
                    <Pressable onPress={() => toggle(a.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingLeft: 12, paddingRight: 14, paddingVertical: 10, borderLeftWidth: 3, borderLeftColor: colors.accentSoft }}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink }}>{a.name}</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 10 }}>
                          <Text style={muted}>Dr {fmtSigned(a.debits)}</Text><Text style={muted}>Cr {fmtSigned(a.credits)}</Text>
                        </View>
                      </View>
                      <View style={{ alignItems: 'flex-end', maxWidth: '45%' }}>
                        <Text style={{ ...num, fontSize: 14, color: colors.ink, textAlign: 'right' }}>{fmtSigned(Math.abs(a.closing))}</Text>
                        <Text style={muted}>{a.closing > 0.005 ? 'Dr' : a.closing < -0.005 ? 'Cr' : ''}</Text>
                      </View>
                      {chevron(isOpen)}
                    </Pressable>
                    {isOpen ? (
                      <View style={{ ...panel, paddingHorizontal: 10 }}>
                        <View style={{ flexDirection: 'row', paddingBottom: 6 }}>
                          <Text style={{ ...muted, fontSize: 10.5, width: 46 }}>DATE</Text>
                          <Text style={{ ...muted, fontSize: 10.5, flex: 1 }}>ENTRY</Text>
                          <Text style={{ ...muted, fontSize: 10.5, width: 104, textAlign: 'right' }}>BALANCE</Text>
                        </View>
                        <View style={{ flexDirection: 'row', paddingVertical: 6 }}>
                          <Text style={{ ...muted, width: 46 }}>{day(new Date(from || Date.now()).toISOString())}</Text>
                          <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 13, color: colors.soft }}>Opening balance</Text>
                          <Text style={{ ...num, fontSize: 12.5, width: 104, textAlign: 'right', color: colors.ink }}>{drCr(a.opening)}</Text>
                        </View>
                        {a.entries.map((e, i) => (
                          <View key={e.id + i} style={{ flexDirection: 'row', paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.line }}>
                            <Text style={{ ...muted, width: 46 }}>{day(e.ts)}</Text>
                            <View style={{ flex: 1, minWidth: 0, paddingRight: 6 }}>
                              <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.ink }}>{e.description || '—'}</Text>
                              <Text style={muted}>{(e.ref ? e.ref + ' · ' : '') + (e.debit ? 'Dr ' + fmtSigned(e.debit) : 'Cr ' + fmtSigned(e.credit))}</Text>
                            </View>
                            <Text style={{ ...num, fontSize: 12.5, width: 104, textAlign: 'right', color: colors.ink }}>{drCr(runs[i])}</Text>
                          </View>
                        ))}
                        <View style={{ flexDirection: 'row', paddingVertical: 8, paddingHorizontal: 6, marginTop: 4, borderRadius: 4, backgroundColor: colors.accentSoft }}>
                          <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 13, color: colors.ink }}>Closing balance</Text>
                          <Text style={{ ...num, fontSize: 13, color: colors.ink }}>{drCr(a.closing)}</Text>
                        </View>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          );
        })}
        <View style={{ ...card, padding: 14, gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ fontFamily: fonts.ui, fontSize: 13.5, color: colors.soft }}>Total debits</Text><Text style={{ ...num, fontSize: 13.5, color: colors.ink }}>{fmtSigned(tDr)}</Text></View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ fontFamily: fonts.ui, fontSize: 13.5, color: colors.soft }}>Total credits</Text><Text style={{ ...num, fontSize: 13.5, color: colors.ink }}>{fmtSigned(tCr)}</Text></View>
        </View>
        {bar('Trial balance · ' + (Math.abs(diff) < 1 ? 'Balanced' : 'Unbalanced'), fmtSigned(diff), Math.abs(diff) >= 1)}
        <Text style={{ ...muted, textAlign: 'center' }}>Tap an account to see every entry with its running balance.</Text>
      </View>
    );
  }

  /* ─────────────── profit & loss ─────────────── */
  const inc = (a: StatementAccount) => a.credits - a.debits;
  const exp = (a: StatementAccount) => a.debits - a.credits;
  const salesAccs = accounts.filter((a) => a.cls === 'income' && (a.id === 'n_sales' || a.id === 'n_discount' || a.id === 'n_loyalty'));
  const otherIncome = accounts.filter((a) => a.cls === 'income' && !salesAccs.includes(a) && (a.debits || a.credits));
  const cogs = accounts.filter((a) => a.cls === 'expense' && (a.id === 'n_cogs' || a.id === 'n_transitloss') && (a.debits || a.credits));
  const expenses = accounts.filter((a) => a.cls === 'expense' && !cogs.includes(a) && (a.debits || a.credits));
  // discounts and loyalty sit with the expenses in the books; here they come off sales
  const discounts = accounts.filter((a) => (a.id === 'n_discount' || a.id === 'n_loyalty') && (a.debits || a.credits));
  const sales = accounts.filter((a) => a.id === 'n_sales');
  const netSales = sales.reduce((s, a) => s + inc(a), 0) - discounts.reduce((s, a) => s + exp(a), 0);
  const tCogs = cogs.reduce((s, a) => s + exp(a), 0);
  const gross = netSales - tCogs;
  const tOther = otherIncome.reduce((s, a) => s + inc(a), 0);
  const tExp = expenses.filter((a) => !discounts.includes(a)).reduce((s, a) => s + exp(a), 0);
  const net = gross + tOther - tExp;
  const pcs = (n: number) => pctOf(n, netSales).toFixed(1) + '%';
  const block = (title: string, rows: Array<{ a: StatementAccount; v: number }>, total: number, totalLabel: string) => (rows.length ? (
    <View style={card}>
      <View style={{ flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.accentSoft }}>
        <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 12, letterSpacing: 0.7, color: colors.accent }}>{title.toUpperCase()}</Text>
        <Text style={{ ...muted, fontSize: 11, width: 92, textAlign: 'right' }}>{(db.settings.currency || '').toUpperCase()}</Text>
        <Text style={{ ...muted, fontSize: 11, width: 56, textAlign: 'right' }}>% SALES</Text>
        <View style={{ width: 20 }} />
      </View>
      {rows.map(({ a, v }) => {
        const isOpen = !!open[a.id];
        return (
          <View key={a.id} style={{ borderTopWidth: 1, borderTopColor: colors.line }}>
            <Pressable onPress={() => toggle(a.id)} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 14, paddingVertical: 10 }}>
              <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink, paddingRight: 6 }}>{a.name}</Text>
              <Text style={{ ...num, fontSize: 13.5, width: 92, textAlign: 'right', color: colors.ink }}>{fmtParen(v)}</Text>
              <Text style={{ ...muted, width: 56, textAlign: 'right' }}>{pcs(v)}</Text>
              <View style={{ width: 20, alignItems: 'flex-end' }}>{chevron(isOpen)}</View>
            </Pressable>
            {isOpen ? (
              <View style={{ ...panel, paddingLeft: 26 }}>
                {a.entries.length ? a.entries.map((e, i) => (
                  <View key={e.id + i} style={{ flexDirection: 'row', paddingVertical: 5 }}>
                    <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                      <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.ink }}>{e.description || '—'}</Text>
                      <Text style={muted}>{day(e.ts)}{e.ref ? ' · ' + e.ref : ''}</Text>
                    </View>
                    <Text style={{ ...num, fontSize: 13, color: colors.ink }}>{fmtParen(a.cls === 'income' ? e.credit - e.debit : e.debit - e.credit)}</Text>
                  </View>
                )) : <Text style={muted}>No transactions this period.</Text>}
              </View>
            ) : null}
          </View>
        );
      })}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11, backgroundColor: colors.accentSoft, borderTopWidth: 1, borderTopColor: colors.line }}>
        <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 13.5, color: colors.ink }}>{totalLabel}</Text>
        <Text style={{ ...num, fontSize: 13.5, width: 92, textAlign: 'right', color: colors.ink }}>{fmtParen(total)}</Text>
        <Text style={{ ...muted, width: 56, textAlign: 'right' }}>{pcs(total)}</Text>
        <View style={{ width: 20 }} />
      </View>
    </View>
  ) : null);
  return (
    <View style={{ gap: 12 }}>
      {summary([
        { k: 'Gross profit', v: fmtParen(gross), sub: pcs(gross) + ' margin', tone: gross >= 0 ? colors.good : colors.danger },
        { k: 'Net profit', v: fmtParen(net), sub: pcs(net) + ' margin', tone: net >= 0 ? colors.good : colors.danger },
      ])}
      {block('Sales (net)', [...sales.map((a) => ({ a, v: inc(a) })), ...discounts.map((a) => ({ a, v: -exp(a) }))], netSales, 'Net sales')}
      {block('Less cost of goods sold', cogs.map((a) => ({ a, v: exp(a) })), tCogs, 'Cost of goods sold')}
      {block('Other income', otherIncome.map((a) => ({ a, v: inc(a) })), tOther, 'Other income')}
      {block('Expenses', expenses.filter((a) => !discounts.includes(a)).map((a) => ({ a, v: exp(a) })), tExp, 'Expenses')}
      <View style={{ ...card, padding: 14, gap: 6 }}>
        {([['Gross profit', gross], ['Add other income', tOther], ['Less expenses', -tExp]] as const).map(([k, v]) => (
          <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 13.5, color: colors.soft }}>{k}</Text>
            <Text style={{ ...num, fontSize: 13.5, color: colors.ink }}>{fmtParen(v)}</Text>
          </View>
        ))}
      </View>
      {bar((net >= 0 ? 'Net profit' : 'Net loss') + ' · ' + pcs(net), fmtParen(net), net < 0)}
    </View>
  );
}
