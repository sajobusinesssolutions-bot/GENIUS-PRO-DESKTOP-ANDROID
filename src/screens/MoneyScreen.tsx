/**
 * CASH & BANK.
 *
 * Where the money is, and what moved in the period picked at the top. One card
 * with the total held and the period's money in and out, then one card per
 * account — drawer, bank, mobile money — with its balance and its own in/out.
 * Tapping an account opens its statement for the same period, day by day.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { SectionLabel, EmptyBlock } from '../components/ui';
import { Icon, IconName } from '../components/icons';
import { RangeBar, periodFor, Period } from '../components/RangeBar';
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
  const [period, setPeriod] = useState<Period>(periodFor('today'));

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

  const tint = (type: string) => (type === 'cash' ? [colors.goodSoft, colors.good]
    : type === 'bank' ? [colors.accentSoft, colors.accent] : [colors.warnSoft, colors.warn]);

  const actions: Array<{ label: string; icon: IconName; fg: string; go: () => void }> = [
    { label: 'Money in', icon: 'down', fg: colors.good, go: () => navigation.navigate('EntryNew', { direction: 'in' }) },
    { label: 'Money out', icon: 'up', fg: colors.danger, go: () => navigation.navigate('EntryNew', { direction: 'out' }) },
    { label: 'Transfer', icon: 'swap', fg: colors.accent, go: () => navigation.navigate('Transfer') },
    { label: 'Payment', icon: 'card', fg: colors.warn, go: () => navigation.navigate('PaymentNew') },
  ];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      <RangeBar value={period} onChange={setPeriod} />

      {/* the total */}
      <View style={{ marginTop: 14, backgroundColor: colors.surface, borderRadius: 20, padding: 18, borderWidth: 1, borderColor: colors.line }}>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint }}>Held across all accounts · end of {period.label.toLowerCase()}</Text>
        <Text style={{ fontFamily: fonts.uiExtra, fontSize: 30, color: colors.ink, marginTop: 4, letterSpacing: -0.8 }} numberOfLines={1} adjustsFontSizeToFit>
          {money(total.held)}
        </Text>
        <View style={{ flexDirection: 'row', marginTop: 14, gap: 10 }}>
          <View style={{ flex: 1, backgroundColor: colors.goodSoft, borderRadius: 14, padding: 12 }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11.5, color: colors.good }}>Money in</Text>
            <Text style={{ fontFamily: fonts.monoSemi, fontSize: 15, color: colors.good, marginTop: 3 }} numberOfLines={1} adjustsFontSizeToFit>+{money(total.inflow)}</Text>
          </View>
          <View style={{ flex: 1, backgroundColor: colors.dangerSoft, borderRadius: 14, padding: 12 }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11.5, color: colors.danger }}>Money out</Text>
            <Text style={{ fontFamily: fonts.monoSemi, fontSize: 15, color: colors.danger, marginTop: 3 }} numberOfLines={1} adjustsFontSizeToFit>−{money(total.outflow)}</Text>
          </View>
        </View>
      </View>

      {/* quick actions, one row */}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
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
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11.5, color: colors.ink }}>{a.label}</Text>
          </Pressable>
        ))}
      </View>

      <SectionLabel style={{ marginTop: 22 }}>Accounts</SectionLabel>
      {flows.length ? flows.map(({ a, f }) => {
        const [bg, fg] = tint(a.type);
        return (
          <Pressable
            key={a.id}
            onPress={() => navigation.navigate('AccountDetail', { accountId: a.id, period: period.key, from: period.from, to: period.to } as any)}
            style={({ pressed }) => ({
              backgroundColor: pressed ? colors.sunk : colors.surface, borderRadius: 18, padding: 16, marginBottom: 10,
              borderWidth: 1, borderColor: colors.line,
            })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={ACCOUNT_ICON[a.type] || 'bank'} size={20} color={fg} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }} numberOfLines={1}>{a.name}</Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 1 }}>{KIND[a.type] || 'Account'}</Text>
              </View>
              <Text style={{ fontFamily: fonts.uiExtra, fontSize: 16, color: colors.ink }}>{money(f.closing)}</Text>
              <Icon name="chev" size={14} color={colors.faint} />
            </View>
            <View style={{ flexDirection: 'row', marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.line }}>
              <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>
                In <Text style={{ fontFamily: fonts.monoSemi, color: colors.good }}>+{money(f.inflow)}</Text>
              </Text>
              <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>
                Out <Text style={{ fontFamily: fonts.monoSemi, color: colors.danger }}>−{money(f.outflow)}</Text>
              </Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{f.rows.length} moves</Text>
            </View>
          </Pressable>
        );
      }) : <EmptyBlock icon="bank" title="No accounts set up" />}
    </ScrollView>
  );
}
