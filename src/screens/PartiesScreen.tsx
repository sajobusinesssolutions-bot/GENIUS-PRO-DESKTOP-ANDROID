import React, { useState, useMemo } from 'react';
import { View, FlatList, Pressable, Text } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Empty, Badge, Search, FilterChips, SectionLabel, StatGrid, FAB, Panel } from '../components/ui';
import { Icon } from '../components/icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, any>;

export default function PartiesScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { db, money, partyBalance } = useAppData();
  const [q, setQ] = useState('');
  const [type, setType] = useState<'all' | 'customer' | 'supplier'>('all');

  const parties = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (db?.parties || []).filter((p) =>
      (type === 'all' || p.type === type)
      && (!needle || p.name.toLowerCase().includes(needle) || (p.phone || '').includes(needle)));
  }, [db, q, type]);

  const totals = useMemo(() => {
    let receivable = 0, payable = 0;
    (db?.parties || []).forEach((p) => {
      const bal = partyBalance(p.id);
      if (p.type === 'customer' && bal > 0) receivable += bal;
      if (p.type === 'supplier' && bal > 0) payable += bal;
    });
    return { receivable, payable, net: receivable - payable };
  }, [db, partyBalance]);

  const customers = (db?.parties || []).filter((p) => p.type === 'customer').length;
  const suppliers = (db?.parties || []).filter((p) => p.type === 'supplier').length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={parties}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 96, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View style={{ paddingTop: 14, gap: 14, marginBottom: 14 }}>
            {/* the grand balance across every contact */}
            <Panel>
              <View style={{ alignItems: 'center', gap: 4 }}>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
                  {totals.net >= 0 ? 'Net owed to you' : 'Net you owe'}
                </Text>
                <Text style={{ fontFamily: fonts.uiExtra, fontSize: 32, letterSpacing: -0.8, color: totals.net >= 0 ? colors.good : colors.danger }}>
                  {money(Math.abs(totals.net))}
                </Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 2 }}>
                  across {customers + suppliers} contact{customers + suppliers === 1 ? '' : 's'}
                </Text>
              </View>
            </Panel>
            <StatGrid
              items={[
                { icon: 'down', label: 'You are owed', value: money(totals.receivable), tone: 'good' },
                { icon: 'up', label: 'You owe', value: money(totals.payable), tone: 'danger' },
                { icon: 'user', label: 'Customers', value: String(customers), tone: 'accent' },
                { icon: 'factory', label: 'Suppliers', value: String(suppliers), tone: 'warn' },
              ]}
            />
            <Search value={q} onChange={setQ} placeholder="Search by name or phone" />
            <FilterChips
              value={type}
              onChange={setType}
              options={[
                { v: 'all', l: 'All' }, { v: 'customer', l: 'Customers' }, { v: 'supplier', l: 'Suppliers' },
              ]}
            />
            {parties.length ? (
              <SectionLabel right={<Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{parties.length} shown</Text>}>
                Contacts
              </SectionLabel>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <Empty
            title={q ? 'No match found' : 'No customers or suppliers yet'}
            subtitle={q ? 'Try a different search.' : 'Add your first contact to start tracking balances.'}
            actionLabel="Add contact"
            onAction={() => navigation.navigate('PartyEdit', {})}
          />
        }
        renderItem={({ item }) => {
          const bal = partyBalance(item.id);
          const owes = bal > 0.01;
          const credit = bal < -0.01;
          return (
            <Pressable
              onPress={() => navigation.navigate('PartyDetail', { partyId: item.id })}
              style={{
                backgroundColor: colors.surface, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 13,
                marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 70,
                shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2,
              }}
            >
              <View style={{
                width: 44, height: 44, borderRadius: 22,
                backgroundColor: item.type === 'customer' ? colors.accentSoft : colors.warnSoft,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ color: item.type === 'customer' ? colors.accent : colors.warn, fontFamily: fonts.uiBold, fontSize: 16 }}>
                  {item.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{item.name}</Text>
                  <Badge label={item.type === 'customer' ? 'Customer' : 'Supplier'} tone={item.type === 'customer' ? 'accent' : 'warn'} />
                </View>
                <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                  {item.phone || 'No phone'}{item.address ? ' · ' + item.address : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 3 }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: owes ? colors.danger : credit ? colors.good : colors.faint }}>
                  {money(Math.abs(bal))}
                </Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>
                  {owes ? 'due' : credit ? 'in credit' : 'settled'}
                </Text>
              </View>
              <Icon name="chev" size={17} color={colors.faint} />
            </Pressable>
          );
        }}
      />

      <FAB label="Add contact" icon="plus" tone="accent" onPress={() => navigation.navigate('PartyEdit', {})} />
    </View>
  );
}
