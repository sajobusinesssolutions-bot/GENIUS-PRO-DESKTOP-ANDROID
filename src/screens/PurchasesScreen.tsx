import React, { useMemo, useState } from 'react';
import { View, FlatList, Text, Pressable } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Empty, Badge, Search, SectionLabel, StatGrid, FAB } from '../components/ui';
import { Icon } from '../components/icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';
import { listRange, inRange } from '../data/helpers';
import { ListFilters } from '../components/ListFilters';

type Props = NativeStackScreenProps<RootStackParamList, any>;
type Status = 'all' | 'paid' | 'due';
const day = (n: number) => new Date(n).toISOString().slice(0, 10);

export default function PurchasesScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { db, money, party } = useAppData();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<Status>('all');
  const initialRange = listRange('month');
  const [from, setFrom] = useState(day(initialRange.from));
  const [to, setTo] = useState(day(initialRange.to));
  const [supplierFilter, setSupplierFilter] = useState('all');

  const all = useMemo(
    () => [...(db?.purchases || [])].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()),
    [db],
  );

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((p) => {
      const rangeFrom = new Date(from + 'T00:00:00').getTime();
      const rangeTo = new Date(to + 'T23:59:59').getTime();
      if (!inRange(p.ts, rangeFrom, rangeTo)) return false;
      if (status === 'paid' && p.due > 0.01) return false;
      if (status === 'due' && p.due <= 0.01) return false;
      if (supplierFilter !== 'all' && p.partyId !== supplierFilter) return false;
      if (!needle) return true;
      const supplier = party(p.partyId)?.name || '';
      return p.no.toLowerCase().includes(needle) || supplier.toLowerCase().includes(needle);
    });
  }, [all, q, status, supplierFilter, from, to, party]);

  const activeFilter = status !== 'all' ? 'status:' + status : supplierFilter !== 'all' ? 'supplier:' + supplierFilter : 'all';
  const filterOptions = [
    { v: 'all', l: 'All purchases' },
    { v: 'status:paid', l: 'Status · Paid' },
    { v: 'status:due', l: 'Status · Unpaid' },
    ...(db?.parties || []).filter((p) => p.type === 'supplier' && p.active).map((p) => ({ v: 'supplier:' + p.id, l: 'Supplier · ' + p.name })),
  ];

  function applyFilter(value: string) {
    setStatus('all');
    setSupplierFilter('all');
    const [group, selected] = value.split(':');
    if (group === 'status') setStatus(selected as Status);
    if (group === 'supplier') setSupplierFilter(selected);
  }

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
            <ListFilters
              filterValue={activeFilter}
              filterOptions={filterOptions}
              onFilterChange={applyFilter}
              from={from}
              to={to}
              onDateChange={(f, t) => {
                setFrom(f);
                setTo(t);
              }}
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
                backgroundColor: colors.surface,
                borderRadius: 12,
                paddingHorizontal: 11,
                paddingVertical: 9,
                marginBottom: 6,
                shadowColor: '#0B1D2A',
                shadowOpacity: 0.06,
                shadowRadius: 14,
                shadowOffset: { width: 0, height: 4 },
                elevation: 2,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.warnSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="cart" size={16} color={colors.warn} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 13.5, color: colors.ink }}>
                    {party(item.partyId)?.name || 'Supplier'}
                  </Text>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 1 }}>
                    {item.no} · {item.lines.length} line{item.lines.length === 1 ? '' : 's'} · {item.method}
                  </Text>
                </View>
                <Text style={{ fontFamily: fonts.uiExtra, fontSize: 14.5, color: colors.ink }}>{money(item.total)}</Text>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 6 }}>
                <Badge label={due ? money(item.due) + ' due' : 'Paid'} tone={due ? 'danger' : 'good'} />
                <View style={{ flex: 1 }} />
                <Text style={{ fontFamily: fonts.ui, fontSize: 10.5, color: colors.faint }}>
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
