import React, { useState } from 'react';
import { View, Text, FlatList, Pressable, ScrollView } from 'react-native';
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
  const due = dueRecurring();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={db?.recurringInvoices || []}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        ListHeaderComponent={due.length ? (
          <View style={{ marginBottom: 8 }}>
            <Cap>{`Due now (${due.length})`}</Cap>
          </View>
        ) : null}
        ListEmptyComponent={<Empty title="No recurring invoices" subtitle="Auto-generate a sale for a party on a schedule" />}
        renderItem={({ item }) => {
          const total = item.lines.reduce((s, l) => s + l.qty * l.price, 0);
          const isDue = due.some((d) => d.id === item.id);
          return (
            <DocCard
              icon="clock"
              tone={isDue ? 'warn' : item.active ? 'accent' : 'neutral'}
              dim={!item.active}
              title={party(item.partyId)?.name || 'Customer'}
              subtitle={'Next due ' + new Date(item.nextDue).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
              amount={money(total)}
              badges={
                <>
                  <Badge label={item.active ? item.frequency : 'paused'} tone={isDue ? 'warn' : item.active ? 'accent' : 'neutral'} />
                  {isDue ? <Badge label="Due now" tone="warn" /> : null}
                </>
              }
            >
              <View style={{ flexDirection: 'row', gap: 10 }}>
                {item.active ? (
                  <View style={{ flex: 1 }}>
                    <Button size="sm" label="Run now" variant="pri" onPress={() => runRecurring(item.id)} />
                  </View>
                ) : null}
                <View style={{ flex: 1 }}>
                  <Button size="sm" label={item.active ? 'Pause' : 'Resume'} onPress={() => updateRecurring(item.id, { active: !item.active })} />
                </View>
              </View>
            </DocCard>
          );
        }}
      />
      <FAB label="New schedule" icon="plus" tone="accent" onPress={() => navigation.navigate('RecurringNew')} />
    </View>
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
            text={'About ' + money(total * perYear) + ' a year at this rate. Each run raises a real bill you can still edit.'}
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
