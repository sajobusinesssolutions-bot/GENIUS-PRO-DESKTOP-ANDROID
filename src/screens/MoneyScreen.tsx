import React, { useMemo } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import {
  Panel, Button, AccentHead, SectionLabel, ListRow, StatGrid, EmptyBlock,
} from '../components/ui';
import { Icon, IconName } from '../components/icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, any>;

const ACCOUNT_ICON: Record<string, IconName> = { cash: 'cash', bank: 'bank', wallet: 'phone' };

export default function MoneyScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { db, money, accountBalance } = useAppData();

  const accounts = db?.accounts || [];
  const payments = useMemo(() => (db?.payments || []).slice(-15).reverse(), [db]);

  const totals = useMemo(() => {
    let held = 0;
    accounts.forEach((a) => { held += accountBalance(a.id); });
    const inflow = (db?.payments || []).filter((p) => p.direction === 'in').reduce((s, p) => s + p.amount, 0);
    const outflow = (db?.payments || []).filter((p) => p.direction === 'out').reduce((s, p) => s + p.amount, 0);
    return { held, inflow, outflow };
  }, [db, accounts, accountBalance]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
      <StatGrid
        items={[
          { icon: 'coins', label: 'Held across accounts', value: money(totals.held), tone: 'good' },
          { icon: 'down', label: 'Money in', value: money(totals.inflow), tone: 'accent' },
          { icon: 'up', label: 'Money out', value: money(totals.outflow), tone: 'danger' },
          { icon: 'bank', label: 'Accounts', value: String(accounts.length), tone: 'warn' },
        ]}
      />

      <View style={{ height: 20 }} />
      <AccentHead title="Accounts" tone="good" />
      <Panel flush>
        {accounts.map((a, i) => (
          <ListRow
            key={a.id}
            icon={ACCOUNT_ICON[a.type] || 'bank'}
            tone={a.type === 'cash' ? 'good' : a.type === 'bank' ? 'accent' : 'warn'}
            title={a.name}
            subtitle={a.type === 'cash' ? 'Cash drawer' : a.type === 'bank' ? 'Bank account' : 'Mobile wallet'}
            value={money(accountBalance(a.id))}
            last={i === accounts.length - 1}
          />
        ))}
        {!accounts.length ? <EmptyBlock icon="bank" title="No accounts set up" /> : null}
      </Panel>

      <View style={{ height: 20 }} />
      <SectionLabel>Record a movement</SectionLabel>
      <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
        {([
          { label: 'Money in', icon: 'down', tone: colors.good, bg: colors.goodSoft, go: () => navigation.navigate('EntryNew', { direction: 'in' }) },
          { label: 'Money out', icon: 'up', tone: colors.danger, bg: colors.dangerSoft, go: () => navigation.navigate('EntryNew', { direction: 'out' }) },
          { label: 'Transfer', icon: 'swap', tone: colors.accent, bg: colors.accentSoft, go: () => navigation.navigate('Transfer') },
          { label: 'Payment', icon: 'card', tone: colors.warn, bg: colors.warnSoft, go: () => navigation.navigate('PaymentNew') },
        ] as const).map((a) => (
          <Pressable
            key={a.label}
            onPress={a.go}
            style={{
              flexGrow: 1, flexBasis: '46%', backgroundColor: colors.surface, borderRadius: 16,
              paddingVertical: 16, alignItems: 'center', gap: 9,
              shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2,
            }}
          >
            <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: a.bg, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={a.icon} size={21} color={a.tone} />
            </View>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>{a.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ height: 20 }} />
      <AccentHead title="Recent payments" tone="accent" />
      <Panel flush>
        {payments.length ? payments.map((p, i) => (
          <ListRow
            key={p.id}
            icon={p.direction === 'in' ? 'down' : 'up'}
            tone={p.direction === 'in' ? 'good' : 'danger'}
            title={p.note || (p.direction === 'in' ? 'Receipt' : 'Payment')}
            subtitle={new Date(p.ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
            value={(p.direction === 'in' ? '+' : '−') + money(p.amount)}
            valueTone={p.direction === 'in' ? colors.good : colors.danger}
            last={i === payments.length - 1}
            onPress={() => navigation.navigate('PaymentDetail', { paymentId: p.id })}
          />
        )) : (
          <EmptyBlock icon="card" title="No payments recorded" hint="Receipts and payments you record will appear here." />
        )}
      </Panel>
    </ScrollView>
  );
}
