/**
 * THE DAY ON ONE SCREEN. Sales by how they were paid, money in on debts,
 * what went out, the cash the drawer should hold, profit and what is owed both
 * ways — for any day, with a button to send it on WhatsApp. The text sent is
 * the owner's day summary (daySummary.ts).
 *
 * Laid out as the other reports are: the day chosen on the strip under the
 * bar, the figures in plain groups, and the day's sales on the bar at the foot.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Pressable } from '../components/Press';
import { fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Icon } from '../components/icons';
import { IconBtn } from '../components/AppBar';
import { daySummary } from '../data/daySummary';
import { sendVia } from '../data/messages';
import { ControlRow, GroupHead, FactRow, TotalBar, amt, useReportPalette } from '../components/ReportList';

export default function DayReportScreen() {
  const pal = useReportPalette();
  const nav = useNavigation<any>();
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

  const send = () => {
    if (!db) return;
    const end = new Date(day); end.setHours(23, 59, 59, 999);
    void sendVia('whatsapp', { text: daySummary(db, money, isToday ? new Date() : end), phone: db.settings.ownerSummary?.whatsapp || db.firm?.phone });
  };
  /* the bar: what the screen is, and Send (the day on WhatsApp) where Export sits on the other reports */
  useEffect(() => {
    nav.setOptions({
      subtitle: 'Sales, money in and out, and the cash drawer',
      headerRight: () => <IconBtn name="share" size={22} color={pal.primary} onPress={send} />,
    });
  });   // eslint-disable-line react-hooks/exhaustive-deps

  if (!db || !f) return null;
  const owedToYou = db.parties.filter((p) => p.type === 'customer').length ? db.sales.reduce((n, s) => n + (s.status !== 'void' ? s.due : 0), 0) : 0;
  const youOwe = db.purchases.reduce((n, x) => n + (x.status !== 'void' ? x.due : 0), 0);
  const step = (n: number) => { const d = new Date(day); d.setDate(d.getDate() + n); if (d.getTime() <= today.getTime()) setDay(d); };
  const line = (label: string, n: number, strong?: boolean) => <FactRow key={label} title={label} value={amt(n)} zero={Math.abs(n) < 0.005} strong={strong} />;

  return (
    <View style={{ flex: 1, backgroundColor: pal.bg }}>
      <ControlRow>
        <Pressable onPress={() => step(-1)} accessibilityLabel="Day before" style={{ width: 44, height: 44, marginLeft: -10, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="left" size={20} color={pal.text} />
        </Pressable>
        <Text style={{ flex: 1, textAlign: 'center', fontFamily: fonts.uiSemi, fontSize: 15, color: pal.text }}>
          {isToday ? 'Today' : day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
        </Text>
        <Pressable onPress={() => step(1)} disabled={isToday} accessibilityLabel="Next day" style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chev" size={20} color={isToday ? pal.section : pal.text} />
        </Pressable>
      </ControlRow>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
        <GroupHead label="How it was paid" />
        {line('Cash', f.cash)}
        {line('Mobile money', f.momo)}
        {line('Bank', f.bank)}
        {line('On credit', f.onCredit)}

        <GroupHead label="Other money" />
        {line('Received on debts', f.received)}
        {line('Other money in', f.moneyIn)}
        {line('Expenses', f.expenses)}
        {line('Paid to suppliers', f.paidSuppliers)}
        {line('Bought', f.bought)}

        <GroupHead label="Cash drawer" />
        {line('Cash in', f.cashIn)}
        {line('Cash out', f.cashOut)}
        {line('Net cash for the day', f.cashIn - f.cashOut, true)}
        {line('Cash held now', accountBalance('acc_cash'), true)}

        <GroupHead label="Owed now" />
        {line('Customers owe you', owedToYou)}
        {line('You owe suppliers', youOwe)}
      </ScrollView>

      <TotalBar label={'Sales · ' + f.bills + ' bill' + (f.bills === 1 ? '' : 's')} value={amt(f.total)} others={[
        { label: 'Gross profit', value: amt(f.profit) },
        { label: 'Net cash', value: amt(f.cashIn - f.cashOut) },
      ]} />
    </View>
  );
}
