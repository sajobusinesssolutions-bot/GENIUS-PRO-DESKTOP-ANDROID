/**
 * Parties (redesign 2b) — shown under Sales → Parties, and on its own.
 *
 *  - One card: net balance first, then "You are owed" / "You owe".
 *  - Search by name or phone, then All / Customers / Suppliers chips with counts.
 *  - Contacts in one card, biggest balance first. Tap opens the party.
 */
import { FAB_COLORS } from '../components/ui';
import React, { useState, useMemo } from 'react';
import { View, FlatList, Pressable, Text } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { ListPage, StatusChips, SummaryTiles, SortBar } from '../components/DocList';
import { Icon } from '../components/icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { vocab } from '../data/editions';
import { partyTotals } from '../data/logic';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, any>;
type PType = 'all' | 'customer' | 'supplier';
type PSort = 'balance' | 'az' | 'za' | 'owesMost' | 'oweMost';
const PARTY_SORTS: { v: PSort; l: string }[] = [
  { v: 'balance', l: 'Biggest balance first' }, { v: 'az', l: 'Name A–Z' }, { v: 'za', l: 'Name Z–A' },
  { v: 'owesMost', l: 'Owes you most' }, { v: 'oweMost', l: 'You owe most' },
];

export default function PartiesScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { db, money, partyBalance } = useAppData();
  const V = vocab(db);
  const [q, setQ] = useState('');
  const [type, setType] = useState<PType>('all');
  const [sort, setSort] = useState<PSort>('az');

  const all = db?.parties || [];

  const parties = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter((p) => (type === 'all' || p.type === type)
        && (!needle || p.name.toLowerCase().includes(needle) || (p.phone || '').includes(needle)))
      .map((p) => ({ p, bal: partyBalance(p.id) }))
      .sort(sort === 'az' ? (a, b) => a.p.name.localeCompare(b.p.name)
        : sort === 'za' ? (a, b) => b.p.name.localeCompare(a.p.name)
        : sort === 'owesMost' ? (a, b) => b.bal - a.bal
        : sort === 'oweMost' ? (a, b) => a.bal - b.bal
        : (a, b) => Math.abs(b.bal) - Math.abs(a.bal));
  }, [db, q, type, sort, partyBalance]);

  /* The same figures as Customer statements and Supplier statements: every
     customer's balances added (those in credit taken off), and every
     supplier's. Before, a customer in credit was counted in "you owe" and a
     supplier paid ahead in "you are owed", so these cards showed figures the
     statements never did. Tapping a card opens its statement. */
  const totals = useMemo(() => (db ? { c: partyTotals(db, 'customer'), s: partyTotals(db, 'supplier') } : null), [db]);
  const customers = all.filter((p) => p.type === 'customer').length;
  const suppliers = all.filter((p) => p.type === 'supplier').length;

  return (
    <ListPage
      top={(
        <>
          <StatusChips value={type} onChange={setType} options={[
            { v: 'all', l: 'All ' + all.length }, { v: 'customer', l: V.customers + ' ' + customers }, { v: 'supplier', l: V.suppliers + ' ' + suppliers },
          ]} />
          {totals ? <SummaryTiles tiles={[
            ...(type !== 'supplier' ? [{ label: V.customers + ' owe you', value: money(totals.c.net), tone: colors.good,
              sub: totals.c.credit > 0.5 ? money(totals.c.owed) + ' owed, ' + money(totals.c.credit) + ' in credit' : undefined,
              onPress: () => (navigation as any).navigate('ReportDetail', { id: 'customer-balance-summary' }) }] : []),
            ...(type !== 'customer' ? [{ label: 'You owe ' + V.suppliers.toLowerCase(), value: money(totals.s.net), tone: colors.danger,
              sub: totals.s.credit > 0.5 ? money(totals.s.owed) + ' owed, ' + money(totals.s.credit) + ' paid ahead' : undefined,
              onPress: () => (navigation as any).navigate('ReportDetail', { id: 'supplier-balance-summary' }) }] : []),
          ]} /> : null}
        </>
      )}
      search={{ value: q, onChange: setQ, placeholder: 'Search by name or phone' }}
      data={parties}
      keyExtractor={(x) => x.p.id}
      empty={{ text: q ? 'No one matches that search.' : 'No customers or suppliers yet. Add your first with Add contact.' }}
      add={{ label: 'Add contact', color: FAB_COLORS.addContact, onPress: () => navigation.navigate('PartyEdit', {}) }}
      renderItem={({ item }) => {
        const { p, bal } = item;
        const cust = p.type === 'customer';
        const owes = bal > 0.01, credit = bal < -0.01;
        const tone = cust ? colors.accent : colors.warn;
        /* name, then whether a customer or a supplier, then the phone; the balance on the right */
        return (
          <Pressable
            onPress={() => navigation.navigate('PartyDetail', { partyId: p.id })}
            style={({ pressed }) => ({
              marginHorizontal: 16, marginBottom: 6, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 10,
              flexDirection: 'row', alignItems: 'center', gap: 10,
              backgroundColor: pressed ? colors.sunk : colors.surface, borderWidth: 1, borderColor: colors.line,
            })}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 14.5, color: colors.ink }}>{p.name}</Text>
              <View style={{ alignSelf: 'flex-start', marginTop: 4, paddingVertical: 1.5, paddingHorizontal: 6, borderRadius: 4, backgroundColor: cust ? colors.accentSoft : colors.warnSoft }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 9.5, letterSpacing: 0.5, color: tone }}>{(cust ? V.customer : V.supplier).toUpperCase()}</Text>
              </View>
              <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 3 }}>{p.phone || 'No phone'}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: owes ? colors.good : credit ? (cust ? colors.accent : colors.danger) : colors.faint }}>
                {owes || credit ? money(Math.abs(bal)) : 'Settled'}
              </Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 2 }}>
                {owes ? 'Owes you' : credit ? (cust ? 'In credit' : 'You owe') : 'Nothing owing'}
              </Text>
            </View>
          </Pressable>
        );
      }}
    />
  );
}
