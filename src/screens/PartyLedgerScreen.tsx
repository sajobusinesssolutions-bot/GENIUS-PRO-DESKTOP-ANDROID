import React, { useMemo } from 'react';
import { View, Text, FlatList } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Empty, StatGrid, SectionLabel } from '../components/ui';
import { Icon } from '../components/icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'PartyLedger'>;

export default function PartyLedgerScreen({ route }: Props) {
  const { colors } = useTheme();
  const { db, money, party } = useAppData();
  const pt = party(route.params.partyId);

  const rows = useMemo(() => {
    if (!db || !pt) return [];
    const out: { ts: string; memo: string; debit: number; credit: number }[] = [];
    if (pt.openingBalance) out.push({ ts: '', memo: 'Opening balance', debit: pt.openingBalance, credit: 0 });
    db.sales.forEach((s) => { if (s.partyId === pt.id && s.status !== 'void') out.push({ ts: s.ts, memo: 'Sale ' + s.no, debit: s.total, credit: s.paidAtSale || 0 }); });
    db.purchases.forEach((x) => { if (x.partyId === pt.id) out.push({ ts: x.ts, memo: 'Purchase ' + x.no, debit: x.paid || 0, credit: x.total }); });
    db.payments.forEach((x) => { if (x.partyId === pt.id) out.push({ ts: x.ts, memo: (x.direction === 'in' ? 'Receipt' : 'Payment') + (x.note ? ' — ' + x.note : ''), debit: x.direction === 'out' ? x.amount : 0, credit: x.direction === 'in' ? x.amount : 0 }); });
    out.sort((a, b) => new Date(a.ts || 0).getTime() - new Date(b.ts || 0).getTime());
    let run = 0;
    return out.map((r) => { run += r.debit - r.credit; return { ...r, balance: run }; });
  }, [db, pt]);

  const closing = rows.length ? rows[rows.length - 1].balance : 0;
  const charged = rows.reduce((a, r) => a + r.debit, 0);
  const settled = rows.reduce((a, r) => a + r.credit, 0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={[...rows].reverse()}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20, flexGrow: 1 }}
        ListHeaderComponent={
          <View style={{ paddingTop: 14, marginBottom: 14 }}>
            <StatGrid
              items={[
                { icon: closing > 0 ? 'alert' : 'check', label: closing > 0 ? 'Owes you' : 'In credit', value: money(Math.abs(closing)), tone: closing > 0 ? 'danger' : 'good' },
                { icon: 'receipt', label: 'Entries', value: String(rows.length), tone: 'accent' },
                { icon: 'up', label: 'Charged', value: money(charged), tone: 'warn' },
                { icon: 'down', label: 'Settled', value: money(settled), tone: 'good' },
              ]}
            />
            {rows.length ? (
              <View style={{ marginTop: 20 }}>
                <SectionLabel right={<Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>newest first</Text>}>
                  {pt?.name || 'Ledger'}
                </SectionLabel>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={<Empty title="No transactions" subtitle="Sales and payments for this contact will appear here." />}
        renderItem={({ item }) => {
          const net = item.debit - item.credit;
          return (
            <View
              style={{
                backgroundColor: colors.surface, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 13,
                marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12,
                shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2,
              }}
            >
              <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: net >= 0 ? colors.warnSoft : colors.goodSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={net >= 0 ? 'up' : 'down'} size={19} color={net >= 0 ? colors.warn : colors.good} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{item.memo}</Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                  {item.ts ? new Date(item.ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Brought forward'}
                  {net !== 0 ? ' · ' + (net > 0 ? '+' : '−') + money(Math.abs(net)) : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{money(item.balance)}</Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>balance</Text>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}
