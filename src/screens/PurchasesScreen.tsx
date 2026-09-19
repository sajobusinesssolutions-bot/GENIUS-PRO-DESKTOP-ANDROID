import React, { useMemo, useState } from 'react';
import { View, FlatList, Text, Pressable } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Empty, Badge, Search, FilterChips, SectionLabel, StatGrid, FAB } from '../components/ui';
import { Icon } from '../components/icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, any>;
type Status = 'all' | 'paid' | 'due';

export default function PurchasesScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { db, money, party } = useAppData();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<Status>('all');

  const all = useMemo(
    () => [...(db?.purchases || [])].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()),
    [db],
  );

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((p) => {
      if (status === 'paid' && p.due > 0.01) return false;
      if (status === 'due' && p.due <= 0.01) return false;
      if (!needle) return true;
      const supplier = party(p.partyId)?.name || '';
      return p.no.toLowerCase().includes(needle) || supplier.toLowerCase().includes(needle);
    });
  }, [all, q, status, party]);

  const spent = all.reduce((s, p) => s + p.total, 0);
  const owing = all.reduce((s, p) => s + Math.max(0, p.due), 0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={list}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 96, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ paddingTop: 14, gap: 14, marginBottom: 14 }}>
            <StatGrid
              items={[
                { icon: 'cart', label: 'Total spent', value: money(spent), tone: 'accent' },
                { icon: 'alert', label: 'Still owing', value: money(owing), tone: 'danger' },
                { icon: 'doc', label: 'Bills', value: String(all.length), tone: 'good' },
                { icon: 'factory', label: 'Suppliers', value: String(new Set(all.map((p) => p.partyId)).size), tone: 'warn' },
              ]}
            />
            <Search value={q} onChange={setQ} placeholder="Search bill no. or supplier" />
            <FilterChips
              value={status}
              onChange={setStatus}
              options={[{ v: 'all', l: 'All' }, { v: 'paid', l: 'Paid' }, { v: 'due', l: 'Unpaid' }]}
            />
            {list.length ? (
              <SectionLabel right={<Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{list.length} shown</Text>}>
                Purchase bills
              </SectionLabel>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <Empty
            title={q || status !== 'all' ? 'No bill matches' : 'No purchases yet'}
            subtitle={q || status !== 'all' ? 'Try another search or filter.' : 'Record a purchase to start tracking stock and supplier balances.'}
            actionLabel="New purchase"
            onAction={() => navigation.navigate('PurchaseNew')}
          />
        }
        renderItem={({ item }) => {
          const due = item.due > 0.01;
          return (
            <Pressable
              onPress={() => navigation.navigate('PurchaseDetail', { purchaseId: item.id })}
              style={{
                backgroundColor: colors.surface, borderRadius: 16, paddingHorizontal: 15, paddingVertical: 14, marginBottom: 10,
                shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: colors.warnSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="cart" size={20} color={colors.warn} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 15.5, color: colors.ink }}>
                    {party(item.partyId)?.name || 'Supplier'}
                  </Text>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                    {item.lines.length} line{item.lines.length === 1 ? '' : 's'} · {item.method}
                  </Text>
                </View>
                <Text style={{ fontFamily: fonts.uiExtra, fontSize: 17, color: colors.ink }}>{money(item.total)}</Text>
              </View>

              <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 12 }} />

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                <Text style={{ fontFamily: fonts.monoSemi, fontSize: 12, color: colors.faint }}>{item.no}</Text>
                <Badge label={due ? money(item.due) + ' due' : 'Paid'} tone={due ? 'danger' : 'good'} />
                <View style={{ flex: 1 }} />
                <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>
                  {new Date(item.ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />

      <FAB label="New purchase" icon="plus" tone="accent" onPress={() => navigation.navigate('PurchaseNew')} />
    </View>
  );
}
