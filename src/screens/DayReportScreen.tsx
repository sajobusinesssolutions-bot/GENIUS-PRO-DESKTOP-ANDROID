/**
 * THE DAY ON ONE SCREEN. Sales by how they were paid, money in on debts,
 * what went out, the cash the drawer should hold, profit, what is owed both
 * ways, and what needs watching — for any day, with a button to send it on
 * WhatsApp. The text sent is the owner's day summary (daySummary.ts).
 */
import React, { useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import ScrollView from '../components/KeyScroll';
import { Pressable } from '../components/Press';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Icon } from '../components/icons';
import { Button } from '../components/ui';
import { Panel, DetailRow, SectionLabel } from '../components/kit';
import { daySummary } from '../data/daySummary';
import { sendVia } from '../data/messages';

export default function DayReportScreen() {
  const { colors } = useTheme();
  const { db, money, accountBalance } = useAppData();
  const [day, setDay] = useState(() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const isToday = day.getTime() === today.getTime();

  const f = useMemo(() => {
    if (!db) return null;
    const a = day.getTime(), b = a + 864e5;
    const inDay = (ts?: string) => { if (!ts) return false; const t = new Date(ts).getTime(); return t >= a && t < b; };
    const sales = db.sales.filter((s) => s.status !== 'void' && inDay(s.ts));
    const by = (m: string) => sales.reduce((n, s) => n + (s.methods && s.methods.length > 1
      ? s.methods.filter((x) => x.method === m).reduce((t, x) => t + x.amount, 0)
      : s.method === m ? s.total : s.method === 'credit' && s.receivedVia === m ? (s.paidAtSale || 0) : 0), 0);
    const onCredit = sales.filter((s) => s.method === 'credit').reduce((n, s) => n + s.due, 0);
    const payIn = db.payments.filter((p) => p.direction === 'in' && inDay(p.ts));
    const payOut = db.payments.filter((p) => p.direction === 'out' && inDay(p.ts));
    const expenses = db.entries.filter((e) => e.direction === 'out' && inDay(e.ts));
    const moneyIn = db.entries.filter((e) => e.direction === 'in' && inDay(e.ts));
    const purchases = db.purchases.filter((x) => x.status !== 'void' && inDay(x.ts));
    const sum = (xs: Array<{ amount: number }>) => xs.reduce((n, x) => n + x.amount, 0);
    const cashOf = (xs: Array<{ amount: number; accountId: string }>) => xs.filter((x) => x.accountId === 'acc_cash').reduce((n, x) => n + x.amount, 0);
    const total = sales.reduce((n, s) => n + s.total, 0);
    const profit = sales.reduce((n, s) => n + (s.total - (s.tax || 0)) - (s.cogs || 0), 0);
    const cashIn = by('cash') + cashOf(payIn) + cashOf(moneyIn);
    const cashOut = cashOf(payOut) + cashOf(expenses) + purchases.filter((x) => x.method === 'cash').reduce((n, x) => n + x.paid, 0);
    return {
      bills: sales.length, total, profit, cash: by('cash'), momo: by('momo'), bank: by('bank'), onCredit,
      received: sum(payIn), paidSuppliers: sum(payOut), expenses: sum(expenses), moneyIn: sum(moneyIn),
      bought: purchases.reduce((n, x) => n + x.total, 0), cashIn, cashOut,
    };
  }, [db, day]);

  if (!db || !f) return null;
  const owedToYou = db.parties.filter((p) => p.type === 'customer').length ? db.sales.reduce((n, s) => n + (s.status !== 'void' ? s.due : 0), 0) : 0;
  const youOwe = db.purchases.reduce((n, x) => n + (x.status !== 'void' ? x.due : 0), 0);
  const step = (n: number) => { const d = new Date(day); d.setDate(d.getDate() + n); if (d.getTime() <= today.getTime()) setDay(d); };
  const send = () => {
    const end = new Date(day); end.setHours(23, 59, 59, 999);
    void sendVia('whatsapp', { text: daySummary(db, money, isToday ? new Date() : end), phone: db.settings.ownerSummary?.whatsapp || db.firm?.phone });
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 110, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable onPress={() => step(-1)} hitSlop={10} accessibilityLabel="Day before"><Icon name="left" size={20} color={colors.ink} /></Pressable>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>
            {isToday ? 'Today' : day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
          </Text>
          <Pressable onPress={() => step(1)} hitSlop={10} disabled={isToday} accessibilityLabel="Next day"><Icon name="chev" size={20} color={isToday ? colors.line : colors.ink} /></Pressable>
        </View>

        <Panel>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>Sales · {f.bills} bill{f.bills === 1 ? '' : 's'}</Text>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 26, color: colors.ink, marginVertical: 4 }}>{money(f.total)}</Text>
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: f.profit >= 0 ? colors.good : colors.danger }}>Gross profit {money(f.profit)}</Text>
        </Panel>

        <SectionLabel>How it was paid</SectionLabel>
        <Panel>
          <DetailRow label="Cash" value={money(f.cash)} />
          <DetailRow label="Mobile money" value={money(f.momo)} />
          <DetailRow label="Bank" value={money(f.bank)} />
          <DetailRow label="On credit" value={money(f.onCredit)} tone={f.onCredit > 0 ? colors.warn : undefined} last />
        </Panel>

        <SectionLabel>Other money</SectionLabel>
        <Panel>
          <DetailRow label="Received on debts" value={money(f.received)} tone={colors.good} />
          <DetailRow label="Other money in" value={money(f.moneyIn)} tone={colors.good} />
          <DetailRow label="Expenses" value={money(f.expenses)} tone={colors.danger} />
          <DetailRow label="Paid to suppliers" value={money(f.paidSuppliers)} tone={colors.danger} />
          <DetailRow label="Bought" value={money(f.bought)} last />
        </Panel>

        <SectionLabel>Cash drawer</SectionLabel>
        <Panel>
          <DetailRow label="Cash in" value={money(f.cashIn)} tone={colors.good} />
          <DetailRow label="Cash out" value={money(f.cashOut)} tone={colors.danger} />
          <DetailRow label="Net cash for the day" value={money(f.cashIn - f.cashOut)} bold />
          <DetailRow label="Cash held now" value={money(accountBalance('acc_cash'))} bold last />
        </Panel>

        <SectionLabel>Owed now</SectionLabel>
        <Panel>
          <DetailRow label="Customers owe you" value={money(owedToYou)} tone={colors.warn} />
          <DetailRow label="You owe suppliers" value={money(youOwe)} tone={colors.danger} last />
        </Panel>
      </ScrollView>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 14, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line }}>
        <Button label="Send on WhatsApp" variant="pri" icon={<Icon name="share" size={16} color={colors.accentInk} />} onPress={send} />
      </View>
    </View>
  );
}
