import React, { useState } from 'react';
import { View, Text, FlatList, Pressable, ScrollView } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Empty, Button, Cap, Chip, DocCard, Badge, FAB, Field, InfoBanner } from '../components/ui';
import DocEntry from '../components/DocEntry';
import { ListPage, DocRow, StatusChips, SummaryTiles } from '../components/DocList';
import { LineEditor, CartLine } from '../components/LineEditor';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Challans'>;

export default function ChallansScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { db, party, markChallanDelivered } = useAppData();
  const [filter, setFilter] = React.useState<'all' | 'out' | 'delivered'>('all');
  const [q, setQ] = React.useState('');
  const all = [...(db?.challans || [])].reverse();
  const nameOf = (id: string | null) => (id ? party(id)?.name || 'Walk-in' : 'Walk-in');
  const needle = q.trim().toLowerCase();
  const list = all.filter((c) => {
    if (filter === 'out' && c.status !== 'dispatched') return false;
    if (filter === 'delivered' && c.status !== 'delivered') return false;
    return !needle || (nameOf(c.partyId) + ' ' + c.no).toLowerCase().includes(needle);
  });
  return (
    <ListPage
      top={(
        <>
          <StatusChips value={filter} onChange={setFilter} options={[{ v: 'all', l: 'All' }, { v: 'out', l: 'Still out' }, { v: 'delivered', l: 'Delivered' }]} />
          <SummaryTiles tiles={[
            { label: 'Still out', value: String(all.filter((c) => c.status === 'dispatched').length), tone: colors.warn },
            { label: 'Delivered', value: String(all.filter((c) => c.status === 'delivered').length) },
          ]} />
        </>
      )}
      search={{ value: q, onChange: setQ, placeholder: 'Search delivery notes' }}
      data={list}
      keyExtractor={(c) => c.id}
      empty={{ text: 'No delivery notes yet. Send goods out without invoicing with Add delivery note.' }}
      add={{ label: 'Add delivery note', onPress: () => navigation.navigate('ChallanNew', {}) }}
      renderItem={({ item: c }) => (
        <DocRow
          title={nameOf(c.partyId)}
          pill={c.status === 'delivered' ? { label: 'Delivered', tone: 'good' } : { label: 'Out', tone: 'warn' }}
          amount={c.lines.length + ' item' + (c.lines.length === 1 ? '' : 's')}
          refText={'Note #' + c.no}
          ts={c.ts}
          lines={[{ label: 'Pieces', value: String(c.lines.reduce((s, l) => s + l.qty, 0)) }]}
          action={c.status === 'dispatched' ? { label: 'Mark delivered', onPress: () => markChallanDelivered(c.id) } : undefined}
        />
      )}
    />
  );
}

export function ChallanNewScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'ChallanNew'>) {
  const { db, createChallan } = useAppData();
  const [partyId, setPartyId] = useState<string | null>(null);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [driver, setDriver] = useState('');
  const [vehicle, setVehicle] = useState('');

  return (
    <DocEntry
      kind="Delivery note"
      icon="swap"
      tone="warn"
      partyType="customer"
      partyLabel="Deliver to"
      partyId={partyId}
      onPartyChange={setPartyId}
      lines={lines}
      onLinesChange={setLines}
      linesLabel="Goods to dispatch"
      showTotals={false}
      saveLabel="Create delivery note"
      askWho="Who dispatched this?"
      summary={
        <InfoBanner
          tone="neutral"
          icon="bulb"
          text="A delivery note moves goods without invoicing. Raise the bill separately when the customer is charged."
        />
      }
      onSave={() => {
        createChallan({
          saleId: null,
          partyId,
          lines: lines.map((l) => {
            const prod = db!.products.find((x) => x.id === l.productId)!;
            return { productId: prod.id, name: prod.name, qty: l.qty, unit: prod.unit };
          }),
        });
        navigation.goBack();
      }}
    >
      <Field icon="user" label="Driver" value={driver} onChangeText={setDriver} placeholder="Who is carrying it" />
      <Field icon="taxi" label="Vehicle / plate" value={vehicle} onChangeText={setVehicle} placeholder="Optional" />
    </DocEntry>
  );
}
