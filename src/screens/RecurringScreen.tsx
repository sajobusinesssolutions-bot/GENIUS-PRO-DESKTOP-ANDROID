import React, { useState } from 'react';
import { ListPage, DocRow, StatusChips, SummaryTiles } from '../components/DocList';
import { View, Text, FlatList, Pressable, ScrollView, Alert } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import {
  Empty, Button, Cap, Chip, DocCard, Badge, FAB, Panel, SectionLabel, DetailRow, InfoBanner, SegPill,
} from '../components/ui';
import DocEntry from '../components/DocEntry';
import { LineEditor, CartLine } from '../components/LineEditor';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Recurring'>;

export default function RecurringScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { db, money, party, dueRecurring, runRecurring, updateRecurring } = useAppData();
  const [filter, setFilter] = useState<'all' | 'due' | 'active' | 'paused'>('all');
  const [q, setQ] = useState('');
  const due = dueRecurring();
  const isDue = (id: string) => due.some((d) => d.id === id);
  const all = db?.recurringInvoices || [];
  const totalOf = (r: typeof all[number]) => r.lines.reduce((s, l) => s + l.qty * l.price, 0);
  const needle = q.trim().toLowerCase();
  const list = all.filter((r) => {
    if (filter === 'due' && !isDue(r.id)) return false;
    if (filter === 'active' && !r.active) return false;
    if (filter === 'paused' && r.active) return false;
    return !needle || (party(r.partyId)?.name || '').toLowerCase().includes(needle);
  });
  const perMonth = all.filter((r) => r.active).reduce((s, r) => s + totalOf(r) * (r.frequency === 'weekly' ? 52 / 12 : 1), 0);
  const day = (t: string | null) => (t ? new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : 'Never');
  return (
    <ListPage
      top={(
        <>
          <StatusChips value={filter} onChange={setFilter} options={[{ v: 'all', l: 'All' }, { v: 'due', l: 'Due now' }, { v: 'active', l: 'Active' }, { v: 'paused', l: 'Paused' }]} />
          <SummaryTiles tiles={[
            { label: 'Due now', value: String(due.length), tone: due.length ? colors.warn : undefined },
            { label: 'Per month', value: money(Math.round(perMonth)) },
          ]} />
        </>
      )}
      search={{ value: q, onChange: setQ, placeholder: 'Search by customer' }}
      data={list}
      keyExtractor={(r) => r.id}
      empty={{ text: 'No repeating sales yet. Charge a customer on a schedule with Add recurring sale.' }}
      add={{ label: 'Add recurring sale', onPress: () => navigation.navigate('RecurringNew') }}
      renderItem={({ item: r }) => (
        <DocRow
          title={party(r.partyId)?.name || 'Customer'}
          pill={isDue(r.id) ? { label: 'Due now', tone: 'warn' } : r.active ? { label: r.frequency, tone: 'accent' } : { label: 'Paused', tone: 'neutral' }}
          amount={money(totalOf(r))}
          refText={r.frequency === 'weekly' ? 'Every week' : 'Every month'}
          sideText={'Next ' + day(r.nextDue)}
          dim={!r.active}
          lines={[{ label: 'Last run', value: day(r.lastRun) }, { label: 'Items', value: String(r.lines.length) }]}
          action={r.active ? { label: 'Run now', onPress: () => runRecurring(r.id) } : undefined}
          onMore={() => Alert.alert(party(r.partyId)?.name || 'Recurring sale', undefined, [
            { text: r.active ? 'Pause' : 'Resume', onPress: () => updateRecurring(r.id, { active: !r.active }) },
            { text: 'Cancel', style: 'cancel' },
          ])}
        />
      )}
    />
  );
}

export function RecurringNewScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'RecurringNew'>) {
  const { db, money, scheduleRecurring } = useAppData();
  const [partyId, setPartyId] = useState<string | null>(null);
  const [frequency, setFrequency] = useState<'weekly' | 'monthly'>('monthly');
  const [lines, setLines] = useState<CartLine[]>([]);

  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const perYear = frequency === 'weekly' ? 52 : 12;

  /** The next few dates, so the shop can see what it has committed to. */
  const upcoming = React.useMemo(() => {
    const out: string[] = [];
    const d = new Date();
    for (let i = 0; i < 3; i += 1) {
      if (frequency === 'weekly') d.setDate(d.getDate() + 7);
      else d.setMonth(d.getMonth() + 1);
      out.push(d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }));
    }
    return out;
  }, [frequency]);

  return (
    <DocEntry
      kind="Recurring bill"
      icon="clock"
      tone="accent"
      partyType="customer"
      partyRequired
      partyId={partyId}
      onPartyChange={setPartyId}
      lines={lines}
      onLinesChange={setLines}
      linesLabel="What is billed each time"
      saveLabel={'Schedule · ' + money(total) + ' ' + frequency}
      askWho="Who set up this schedule?"
      summary={
        <Panel>
          <SectionLabel>Next three runs</SectionLabel>
          {upcoming.map((d, i) => (
            <DetailRow key={d} label={'Run ' + (i + 1)} value={d} last={i === upcoming.length - 1} />
          ))}
          <View style={{ height: 12 }} />
          <InfoBanner
            tone="neutral"
            icon="coins"
            text={'About ' + money(total * perYear) + ' a year at this rate. Each run raises a real sale you can still edit.'}
          />
        </Panel>
      }
      onSave={() => {
        scheduleRecurring({
          partyId: partyId!,
          lines: lines.map((l) => {
            const prod = db!.products.find((x) => x.id === l.productId)!;
            return { productId: prod.id, name: prod.name, sku: prod.sku, unit: prod.unit, qty: l.qty, price: l.price, cost: prod.cost, taxRate: prod.taxRate };
          }),
          discount: 0,
          frequency,
        });
        navigation.goBack();
      }}
    >
      <SectionLabel>How often</SectionLabel>
      <SegPill
        value={frequency}
        onChange={setFrequency}
        tone="accent"
        options={[
          { v: 'weekly' as const, l: 'Every week', i: 'calendar' },
          { v: 'monthly' as const, l: 'Every month', i: 'clock' },
        ]}
      />
      <View style={{ height: 16 }} />
    </DocEntry>
  );
}
