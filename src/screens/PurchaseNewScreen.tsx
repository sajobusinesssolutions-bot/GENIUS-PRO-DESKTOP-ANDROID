import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import {
  Button, Panel, SectionLabel, DetailRow, InfoBanner, StickyBar, Search, ListRow,
  EmptyBlock, SelectField, OptionTiles, Field, Badge,
} from '../components/ui';
import { Icon } from '../components/icons';
import { useWho } from '../components/WhoSheet';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';
import { PurchaseLine, PayMethod } from '../data/types';

type Props = NativeStackScreenProps<RootStackParamList, 'PurchaseNew'>;

function defaultExpiry(months = 12) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

/**
 * Receiving a delivery. A batch-tracked line asks for the lot number and its
 * expiry as it is received, so the stock lands on a batch rather than a bare
 * warehouse total.
 */
export default function PurchaseNewScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { db, createPurchase, money } = useAppData();
  const who = useWho('Who received this delivery?');

  const suppliers = useMemo(() => (db?.parties || []).filter((p) => p.type === 'supplier'), [db]);
  const [partyId, setPartyId] = useState<string | null>(suppliers[0]?.id || null);
  const [method, setMethod] = useState<PayMethod>('credit');
  const [lines, setLines] = useState<PurchaseLine[]>([]);
  const [q, setQ] = useState('');
  const [picking, setPicking] = useState<string | null>(null);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    return (db?.products || [])
      .filter((p) => p.name.toLowerCase().includes(needle) || p.sku.toLowerCase().includes(needle))
      .slice(0, 20);
  }, [db, q]);

  function addLine(productId: string) {
    const p = db?.products.find((x) => x.id === productId);
    if (!p) return;
    setQ('');
    setLines((prev) => {
      if (prev.some((l) => l.productId === productId)) {
        return prev.map((l) => (l.productId === productId ? { ...l, qty: l.qty + 1 } : l));
      }
      const line: PurchaseLine = { productId, qty: 1, cost: p.cost };
      if (p.trackBatches) {
        line.batchNo = (p.sku || 'B').toUpperCase().slice(0, 4) + '-' + new Date().toISOString().slice(2, 10).replace(/-/g, '');
        line.expiry = defaultExpiry();
      }
      return [...prev, line];
    });
  }

  function patch(id: string, p: Partial<PurchaseLine>) {
    setLines((prev) => prev.map((l) => (l.productId === id ? { ...l, ...p } : l)));
  }

  function setQty(id: string, qty: number) {
    setLines((prev) => (qty <= 0 ? prev.filter((l) => l.productId !== id) : prev.map((l) => (l.productId === id ? { ...l, qty } : l))));
  }

  const total = lines.reduce((s, l) => s + l.qty * l.cost, 0);
  const needsBatch = lines.some((l) => {
    const p = db?.products.find((x) => x.id === l.productId);
    return p?.trackBatches && !String(l.batchNo || '').trim();
  });

  function save() {
    if (!partyId || !lines.length || needsBatch) return;
    who.ask((server) => {
      createPurchase(partyId, lines, method, server.userId);
      navigation.goBack();
    });
  }

  if (!db) return null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 170 }} keyboardShouldPersistTaps="handled">
        <SectionLabel>Supplier</SectionLabel>
        <SelectField
          icon="factory"
          label="Received from"
          value={partyId || ''}
          options={suppliers.map((p) => ({ v: p.id, l: p.name }))}
          onChange={(v) => setPartyId(v)}
          placeholder="Choose a supplier"
        />

        <SectionLabel>How it was paid</SectionLabel>
        <OptionTiles
          value={method}
          onChange={setMethod}
          tone="warn"
          options={[
            { v: 'cash' as PayMethod, l: 'Cash', i: 'cash' },
            { v: 'bank' as PayMethod, l: 'Bank', i: 'bank' },
            { v: 'momo' as PayMethod, l: 'Mobile', i: 'phone' },
            { v: 'credit' as PayMethod, l: 'On credit', i: 'card' },
          ]}
        />

        <View style={{ height: 20 }} />
        <SectionLabel>Add goods</SectionLabel>
        <Search value={q} onChange={setQ} placeholder="Search name or code" />
        {q.length > 0 ? (
          <View style={{ marginTop: 10 }}>
            <Panel flush>
              {matches.map((p, i) => (
                <ListRow
                  key={p.id}
                  icon="box"
                  tone="warn"
                  title={p.name}
                  subtitle={p.sku + (p.trackBatches ? ' · batch tracked' : '')}
                  value={money(p.cost)}
                  onPress={() => addLine(p.id)}
                  last={i === matches.length - 1}
                />
              ))}
              {!matches.length ? <EmptyBlock icon="search" title="Nothing matches" /> : null}
            </Panel>
          </View>
        ) : null}

        <View style={{ height: 20 }} />
        <SectionLabel right={
          <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>
            {lines.length} line{lines.length === 1 ? '' : 's'}
          </Text>
        }>
          On this delivery
        </SectionLabel>

        {lines.map((l) => {
          const p = db.products.find((x) => x.id === l.productId);
          const tracked = !!p?.trackBatches;
          return (
            <View
              key={l.productId}
              style={{
                backgroundColor: colors.surface, borderRadius: 16, padding: 14, marginBottom: 10,
                shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, elevation: 2,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>
                      {p?.name || l.productId}
                    </Text>
                    {tracked ? <Badge label="Batch" tone="accent" /> : null}
                  </View>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 3 }}>
                    {money(l.cost)} each
                  </Text>
                </View>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{money(l.qty * l.cost)}</Text>
              </View>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 13 }}>
                <Pressable onPress={() => setQty(l.productId, l.qty - 1)} style={stepper(colors)}>
                  <Text style={{ color: colors.ink, fontFamily: fonts.uiBold, fontSize: 19 }}>−</Text>
                </Pressable>
                <Text style={{ flex: 1, textAlign: 'center', fontFamily: fonts.uiExtra, fontSize: 18, color: colors.ink }}>
                  {l.qty} <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint }}>{p?.unit}</Text>
                </Text>
                <Pressable onPress={() => setQty(l.productId, l.qty + 1)} style={stepper(colors)}>
                  <Text style={{ color: colors.ink, fontFamily: fonts.uiBold, fontSize: 19 }}>+</Text>
                </Pressable>
                <Pressable
                  onPress={() => setQty(l.productId, 0)}
                  style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: colors.dangerSoft, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Icon name="trash" size={17} color={colors.danger} />
                </Pressable>
              </View>

              {tracked ? (
                <View style={{ marginTop: 14, gap: 0 }}>
                  <View style={{ height: 1, backgroundColor: colors.line, marginBottom: 14 }} />
                  <Field
                    icon="tag"
                    label="Batch / lot no."
                    value={l.batchNo || ''}
                    onChangeText={(v) => patch(l.productId, { batchNo: v })}
                    autoCapitalize="characters"
                    error={!String(l.batchNo || '').trim() ? 'A tracked item needs a lot number.' : undefined}
                  />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                    {[3, 6, 12, 24].map((m) => {
                      const iso = defaultExpiry(m);
                      const on = l.expiry === iso;
                      return (
                        <Pressable
                          key={m}
                          onPress={() => patch(l.productId, { expiry: iso })}
                          style={{
                            paddingVertical: 9, paddingHorizontal: 14, borderRadius: radius.pill,
                            borderWidth: 1.4, borderColor: on ? colors.accent : colors.line,
                            backgroundColor: on ? colors.accentSoft : colors.surface,
                          }}
                        >
                          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: on ? colors.accent : colors.soft }}>
                            {m < 12 ? m + ' months' : m / 12 + (m === 12 ? ' year' : ' years')}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Pressable
                    onPress={() => setPicking(l.productId)}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 11,
                      borderRadius: radius.md, borderWidth: 1.4, borderColor: colors.line,
                      backgroundColor: colors.sunk, paddingHorizontal: 14, paddingVertical: 13,
                    }}
                  >
                    <Icon name="calendar" size={19} color={colors.accent} />
                    <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 14.5, color: l.expiry ? colors.ink : colors.faint }}>
                      {l.expiry
                        ? new Date(l.expiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                        : 'No expiry set'}
                    </Text>
                    <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: colors.accent }}>Change</Text>
                  </Pressable>
                  {picking === l.productId ? (
                    <DateTimePicker
                      value={l.expiry && Number.isFinite(new Date(l.expiry).getTime()) ? new Date(l.expiry) : new Date()}
                      mode="date"
                      display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                      onChange={(_e, date) => {
                        if (Platform.OS !== 'ios') setPicking(null);
                        if (date) patch(l.productId, { expiry: date.toISOString().slice(0, 10) });
                      }}
                    />
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}

        {!lines.length ? (
          <Panel>
            <EmptyBlock icon="cart" title="Nothing on this delivery yet" hint="Search above to add what arrived." />
          </Panel>
        ) : (
          <Panel>
            <DetailRow label="Lines" value={String(lines.length)} />
            <DetailRow label="Units" value={String(lines.reduce((s, l) => s + l.qty, 0))} />
            <DetailRow label="Total cost" value={money(total)} bold last />
          </Panel>
        )}

        {needsBatch ? (
          <View style={{ marginTop: 14 }}>
            <InfoBanner tone="danger" text="A batch-tracked line still needs its lot number before this can be recorded." />
          </View>
        ) : null}
      </ScrollView>

      {who.sheet}

      <StickyBar>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>Total cost</Text>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 21, color: colors.ink }}>{money(total)}</Text>
        </View>
        <Button
          label="Record purchase"
          variant="pri"
          disabled={!partyId || !lines.length || needsBatch}
          icon={<Icon name="check" size={17} color={colors.accentInk} />}
          onPress={save}
        />
      </StickyBar>
    </View>
  );
}

function stepper(colors: any) {
  return {
    width: 40, height: 40, borderRadius: 13, borderWidth: 1.4, borderColor: colors.line,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  };
}
