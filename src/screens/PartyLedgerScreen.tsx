import React, { useEffect, useMemo } from 'react';
import { View, Text, FlatList } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Empty } from '../components/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'PartyLedger'>;

export default function PartyLedgerScreen({ route, navigation }: Props) {
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

  // the party's name is the title, so nothing on the page repeats it
  useEffect(() => { if (pt) navigation.setOptions({ title: pt.name }); }, [navigation, pt?.name]);

  const cell = { fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint } as const;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={[...rows].reverse()}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={{ paddingBottom: 20, flexGrow: 1 }}
        ListHeaderComponent={
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 16 }}>
              <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint }}>
                {closing > 0.01 ? 'Owes you' : closing < -0.01 ? 'In credit' : 'Settled up'}
              </Text>
              <Text style={{ fontFamily: fonts.uiExtra, fontSize: 24, color: closing > 0.01 ? colors.danger : closing < -0.01 ? colors.good : colors.ink }}>
                {money(Math.abs(closing))}
              </Text>
            </View>
            {rows.length ? (
              <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.sunk }}>
                <Text style={[cell, { width: 64 }]}>DATE</Text>
                <Text style={[cell, { flex: 1 }]}>DETAILS</Text>
                <Text style={[cell, { width: 90, textAlign: 'right' }]}>AMOUNT</Text>
                <Text style={[cell, { width: 90, textAlign: 'right' }]}>BALANCE</Text>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={<Empty title="No transactions" subtitle="Sales and payments will appear here." />}
        renderItem={({ item }) => {
          const net = item.debit - item.credit;
          return (
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line }}>
              <Text style={[cell, { width: 64 }]}>
                {item.ts ? new Date(item.ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : 'B/F'}
              </Text>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink }}>{item.memo}</Text>
              <Text style={{ width: 90, textAlign: 'right', fontFamily: fonts.uiSemi, fontSize: 13.5, color: net > 0 ? colors.danger : net < 0 ? colors.good : colors.faint }}>
                {net === 0 ? '—' : (net > 0 ? '+' : '−') + money(Math.abs(net))}
              </Text>
              <Text style={{ width: 90, textAlign: 'right', fontFamily: fonts.uiBold, fontSize: 13.5, color: colors.ink }}>{money(item.balance)}</Text>
            </View>
          );
        }}
      />
    </View>
  );
}
