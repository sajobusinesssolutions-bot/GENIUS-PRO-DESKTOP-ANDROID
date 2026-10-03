/**
 * CASH & BANK.
 *
 * Where the money is, and what moved in the period picked at the top. One card
 * with the total held and the period's money in and out, then one card per
 * account — drawer, bank, mobile money — with its balance and its own in/out.
 * Tapping an account opens its statement for the same period, day by day.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Pressable } from '../components/Press';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Icon, IconName } from '../components/icons';
import { ListPage, DocRow, SummaryTiles, PeriodBar, listPeriod, ListPeriod } from '../components/DocList';
import { accountFlow } from '../data/accountFlow';
import { branchAccounts, activeBranchId } from '../data/branch';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, any>;

const ACCOUNT_ICON: Record<string, IconName> = { cash: 'cash', bank: 'bank', wallet: 'phone' };
const KIND: Record<string, string> = { cash: 'Cash drawer', bank: 'Bank account', wallet: 'Mobile money' };

export default function MoneyScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { db, money } = useAppData();
  const [period, setPeriod] = useState<ListPeriod>(listPeriod('today'));

  // this branch's own accounts, plus any the whole firm shares
  const accounts = useMemo(() => (db ? branchAccounts(db, activeBranchId(db)) : []), [db]);
  const flows = useMemo(
    () => (db ? accounts.map((a) => ({ a, f: accountFlow(db, a.id, period.from, period.to) })) : []),
    [db, accounts, period],
  );
  const total = flows.reduce((t, x) => ({
    held: t.held + x.f.closing, inflow: t.inflow + x.f.inflow, outflow: t.outflow + x.f.outflow,
  }), { held: 0, inflow: 0, outflow: 0 });

  if (!db) return null;

  const actions: Array<{ label: string; icon: IconName; fg: string; go: () => void }> = [
    { label: 'Money in', icon: 'down', fg: colors.good, go: () => navigation.navigate('EntryNew', { direction: 'in' }) },
    { label: 'Add expense', icon: 'up', fg: colors.danger, go: () => navigation.navigate('EntryNew', { direction: 'out' }) },
    { label: 'Transfer', icon: 'swap', fg: colors.accent, go: () => navigation.navigate('Transfer') },
  ];

  return (
    <ListPage
      top={(
        <>
          <PeriodBar value={period} onChange={setPeriod} />
          <SummaryTiles tiles={[
            { label: 'Held', value: money(total.held) },
            { label: 'Money in', value: '+' + money(total.inflow), tone: colors.good },
            { label: 'Money out', value: '−' + money(total.outflow), tone: colors.danger },
          ]} />
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 12 }}>
            {actions.map((a) => (
              <Pressable
                key={a.label}
                onPress={a.go}
                style={({ pressed }) => ({
                  flex: 1, alignItems: 'center', gap: 6, paddingVertical: 12, borderRadius: 14,
                  backgroundColor: pressed ? colors.sunk : colors.surface, borderWidth: 1, borderColor: colors.line,
                })}
              >
                <Icon name={a.icon} size={19} color={a.fg} />
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.ink }}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        </>
      )}
      data={flows}
      keyExtractor={(x) => x.a.id}
      empty={{ title: 'No accounts set up', text: 'Add a cash drawer, bank account or mobile money account to see where the money is.' }}
      renderItem={({ item: { a, f } }) => (
        <DocRow
          title={a.name}
          pill={{ label: KIND[a.type] || 'Account', tone: a.type === 'cash' ? 'good' : a.type === 'bank' ? 'accent' : 'warn' }}
          amount={money(f.closing)}
          refText={f.rows.length + ' move' + (f.rows.length === 1 ? '' : 's')}
          sideText={period.label}
          lines={[
            { label: 'In', value: '+' + money(f.inflow), tone: colors.good },
            { label: 'Out', value: '−' + money(f.outflow), tone: colors.danger },
          ]}
          onPress={() => navigation.navigate('AccountDetail', { accountId: a.id, period: 'custom', from: period.from, to: period.to } as any)}
        />
      )}
    />
  );
}
