/**
 * QUOTATIONS — open, closed (turned into a bill) and void, with the next step
 * on each card: Convert an open quote, or go to the bill a closed one became.
 */
import React, { useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { useAppData } from '../data/AppDataContext';
import { ListPage, DocRow, StatusChips, SummaryTiles } from '../components/DocList';
import { useTheme } from '../theme';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Estimates'>;
type Filter = 'all' | 'open' | 'closed';

export default function EstimatesScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { db, money, party, convertEstimate, voidEstimate } = useAppData();
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');

  const all = useMemo(() => [...(db?.estimates || [])].reverse(), [db?.estimates]);
  const nameOf = (id: string | null) => (id ? party(id)?.name || 'Walk-in' : 'Walk-in');
  const list = all.filter((e) => {
    if (filter === 'open' && e.status !== 'open') return false;
    if (filter === 'closed' && e.status === 'open') return false;
    const needle = q.trim().toLowerCase();
    return !needle || (nameOf(e.partyId) + ' ' + e.no).toLowerCase().includes(needle);
  });
  const open = all.filter((e) => e.status === 'open');
  const saleNo = (id?: string | null) => (id ? db?.sales.find((s) => s.id === id)?.no : undefined);

  return (
    <ListPage
      top={(
        <>
          <StatusChips value={filter} onChange={setFilter} options={[{ v: 'all', l: 'All' }, { v: 'open', l: 'Open' }, { v: 'closed', l: 'Closed' }]} />
          <SummaryTiles tiles={[
            { label: 'Open quotes', value: String(open.length) },
            { label: 'Open value', value: money(open.reduce((s, e) => s + e.total, 0)), tone: colors.accent },
          ]} />
        </>
      )}
      search={{ value: q, onChange: setQ, placeholder: 'Search quotations' }}
      data={list}
      keyExtractor={(e) => e.id}
      empty={{ text: 'No quotations here yet. Make one for a customer with Add quotation.' }}
      add={{ label: 'Add quotation', onPress: () => navigation.navigate('EstimateNew') }}
      renderItem={({ item: e }) => {
        const no = saleNo(e.convertedSaleId);
        return (
          <DocRow
            title={nameOf(e.partyId)}
            pill={e.status === 'open' ? { label: 'Open', tone: 'warn' } : e.status === 'converted' ? { label: 'Closed', tone: 'good' } : { label: 'Void', tone: 'danger' }}
            amount={money(e.total)}
            refText={'Quote #' + e.no}
            ts={e.ts}
            dim={e.status === 'void'}
            lines={[{ label: 'Items', value: String(e.lines.length) }]}
            action={e.status === 'open'
              ? {
                label: 'Convert',
                onPress: () => Alert.alert('Turn ' + e.no + ' into a sale?', 'A cash sale for ' + money(e.total) + ' is recorded.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Void the quote', style: 'destructive', onPress: () => voidEstimate(e.id) },
                  { text: 'Convert', onPress: () => { const sale = convertEstimate(e.id, 'cash'); if (sale) navigation.navigate('Receipt', { saleId: sale.id }); } },
                ]),
              }
              : e.status === 'converted' && e.convertedSaleId
                ? { label: 'See invoice' + (no ? ' #' + no : ''), onPress: () => navigation.navigate('Receipt', { saleId: e.convertedSaleId! }) }
                : undefined}
          />
        );
      }}
    />
  );
}
