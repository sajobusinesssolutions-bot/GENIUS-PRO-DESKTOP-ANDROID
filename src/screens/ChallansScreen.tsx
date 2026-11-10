import React, { useState } from 'react';
import { View, Text, FlatList, Pressable } from 'react-native';
import { Panel, DetailRow, ActionGrid, StickyBar, SectionLabel } from '../components/ui';
import { Icon } from '../components/icons';
import ScrollView from '../components/KeyScroll';
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
          onPress={() => navigation.navigate('ChallanDetail', { challanId: c.id })}
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

export function ChallanNewScreen({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'ChallanNew'>) {
  const { db, createChallan, updateChallan } = useAppData();
  /* a note still out, being changed (Activity → a delivery note → Edit) */
  const editing = db?.challans.find((c) => c.id === route?.params?.editChallanId && c.status === 'dispatched');
  /* made from a sale (Activity → Make delivery note): its customer and goods, ready to send */
  const fromSale = db?.sales.find((s) => s.id === route?.params?.saleId);
  const [partyId, setPartyId] = useState<string | null>(editing ? editing.partyId : fromSale?.partyId || null);
  const [lines, setLines] = useState<CartLine[]>(() => (editing
    ? editing.lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, price: db?.products.find((p) => p.id === l.productId)?.price || 0, unit: l.unit }))
    : fromSale ? fromSale.lines.map((l) => ({
      productId: l.productId, name: l.name, qty: l.qty, price: l.price, unit: l.unit, ...(l.unitFactor ? { unitFactor: l.unitFactor } : {}),
    })) : []));
  const [driver, setDriver] = useState(editing?.driver || '');
  const [vehicle, setVehicle] = useState(editing?.vehicle || '');

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
      saveLabel={editing ? 'Save changes' : 'Create delivery note'}
      askWho="Who dispatched this?"
      summary={
        <InfoBanner
          tone="neutral"
          icon="bulb"
          text="A delivery note moves goods without invoicing. Raise the bill separately when the customer is charged."
        />
      }
      onSave={() => {
        const out = {
          partyId,
          ...(driver.trim() ? { driver: driver.trim() } : {}),
          ...(vehicle.trim() ? { vehicle: vehicle.trim() } : {}),
          lines: lines.map((l) => {
            const prod = db!.products.find((x) => x.id === l.productId)!;
            return { productId: prod.id, name: prod.name, qty: l.qty, unit: prod.unit };
          }),
        };
        if (editing) updateChallan(editing.id, out);
        else createChallan({ saleId: fromSale?.id || null, ...out });
        navigation.goBack();
      }}
    >
      <Field icon="user" label="Driver" value={driver} onChangeText={setDriver} placeholder="Who is carrying it" />
      <Field icon="taxi" label="Vehicle / plate" value={vehicle} onChangeText={setVehicle} placeholder="Optional" />
    </DocEntry>
  );
}

/**
 * ONE DELIVERY NOTE — to whom, what went out, who carried it and in what,
 * and whether it has arrived; changed while it is still out, marked delivered
 * when it gets there, and the sale it came from a tap away.
 */
export function ChallanDetailScreen({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'ChallanDetail'>) {
  const { colors } = useTheme();
  const { db, party, markChallanDelivered, can, user } = useAppData();
  const c = db?.challans.find((x) => x.id === route.params.challanId);
  if (!db || !c) return null;
  const out = c.status === 'dispatched';
  const who = c.partyId ? party(c.partyId) : undefined;
  const sale = c.saleId ? db.sales.find((s) => s.id === c.saleId) : undefined;
  const pieces = c.lines.reduce((sum, l) => sum + l.qty, 0);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 200 }}>
        <Panel>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 48, height: 48, borderRadius: 4, backgroundColor: out ? colors.warnSoft : colors.goodSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="swap" size={23} color={out ? colors.warn : colors.good} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiExtra, fontSize: 18, color: colors.ink }}>{c.no}</Text>
              <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                {new Date(c.ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
            <Badge label={out ? 'Out' : 'Delivered'} tone={out ? 'warn' : 'good'} />
          </View>
        </Panel>

        <View style={{ height: 12 }} />
        <Panel>
          <DetailRow label="Deliver to" value={who?.name || 'Walk-in customer'} />
          {who?.phone ? <DetailRow label="Phone" value={who.phone} /> : null}
          <DetailRow label="Driver" value={c.driver || '—'} />
          <DetailRow label="Vehicle" value={c.vehicle || '—'} />
          <DetailRow label="Pieces" value={String(pieces)} />
          {sale ? <DetailRow label="From sale" value={sale.no} tone={colors.accent} last /> : <DetailRow label="From sale" value="—" last />}
        </Panel>

        <View style={{ height: 20 }} />
        <SectionLabel>Goods</SectionLabel>
        <Panel>
          {c.lines.map((l, i) => (
            <DetailRow key={i} label={l.name} value={l.qty + ' ' + (l.unit || '')} last={i === c.lines.length - 1} />
          ))}
        </Panel>
      </ScrollView>

      <StickyBar>
        <ActionGrid
          actions={[
            ...(out && can('challans.create') ? [{ label: 'Edit', icon: 'pencil' as const, tone: 'accent' as const, onPress: () => navigation.navigate('ChallanNew', { editChallanId: c.id }) }] : []),
            ...(out && can('challans.deliver') ? [{ label: 'Mark delivered', icon: 'check' as const, tone: 'good' as const, filled: true, onPress: () => markChallanDelivered(c.id) }] : []),
            ...(sale ? [{ label: 'Open sale ' + sale.no, icon: 'receipt' as const, tone: 'accent' as const, onPress: () => navigation.navigate('SaleDetail', { saleId: sale.id }) }] : []),
          ]}
        />
      </StickyBar>
    </View>
  );
}
