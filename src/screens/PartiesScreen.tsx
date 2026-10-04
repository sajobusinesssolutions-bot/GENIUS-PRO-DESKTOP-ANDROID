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
import { ListPage, DocRow, StatusChips, SummaryTiles } from '../components/DocList';
import { Icon } from '../components/icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, any>;
type PType = 'all' | 'customer' | 'supplier';

export default function PartiesScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { db, money, partyBalance } = useAppData();
  const [q, setQ] = useState('');
  const [type, setType] = useState<PType>('all');

  const all = db?.parties || [];

  const parties = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter((p) => (type === 'all' || p.type === type)
        && (!needle || p.name.toLowerCase().includes(needle) || (p.phone || '').includes(needle)))
      .map((p) => ({ p, bal: partyBalance(p.id) }))
      .sort((a, b) => Math.abs(b.bal) - Math.abs(a.bal));
  }, [db, q, type, partyBalance]);

  const totals = useMemo(() => {
    let receivable = 0, payable = 0;
    all.forEach((p) => {
      const bal = partyBalance(p.id);
      if (p.type === 'customer' && bal > 0) receivable += bal;
      if (p.type === 'supplier' && bal > 0) payable += bal;
    });
    return { receivable, payable, net: receivable - payable };
  }, [db, partyBalance]);

  const customers = all.filter((p) => p.type === 'customer').length;
  const suppliers = all.filter((p) => p.type === 'supplier').length;

  return (
    <ListPage
      top={(
        <>
          <StatusChips value={type} onChange={setType} options={[
            { v: 'all', l: 'All ' + all.length }, { v: 'customer', l: 'Customers ' + customers }, { v: 'supplier', l: 'Suppliers ' + suppliers },
          ]} />
          <SummaryTiles tiles={[
            { label: 'You are owed', value: money(totals.receivable), tone: colors.good },
            { label: 'You owe', value: money(totals.payable), tone: colors.danger },
          ]} />
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
        return (
          <DocRow
            title={p.name}
            pill={{ label: cust ? 'Customer' : 'Supplier', tone: cust ? 'accent' : 'warn' }}
            amount={owes || credit ? money(Math.abs(bal)) : 'Settled'}
            amountTone={owes ? (cust ? colors.good : colors.danger) : credit ? colors.accent : colors.faint}
            refText={owes ? (cust ? 'Owes you' : 'You owe') : credit ? 'In credit' : 'Nothing owing'}
            sideText={p.phone || 'No phone'}
            lines={p.address ? [{ label: 'Address', value: p.address }] : undefined}
            onPress={() => navigation.navigate('PartyDetail', { partyId: p.id })}
          />
        );
      }}
    />
  );
}
