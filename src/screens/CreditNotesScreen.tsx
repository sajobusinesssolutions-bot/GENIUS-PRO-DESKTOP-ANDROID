import React, { useState } from 'react';
import { View, Text, FlatList, Pressable, ScrollView, TextInput } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import {
  Empty, Button, Cap, Chip, DocCard, Panel, Badge, SectionLabel, EmptyBlock, InfoBanner,
  Search, Field, OptionTiles, StickyBar, DetailRow,
} from '../components/ui';
import { Icon } from '../components/icons';
import { useToast } from '../components/Toast';
import { useWho } from '../components/WhoSheet';
import { LineEditor, CartLine } from '../components/LineEditor';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'CreditNotes'>;

export default function CreditNotesScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { db, money, party } = useAppData();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={[...(db?.creditNotes || [])].reverse()}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 96, flexGrow: 1 }}
        ListEmptyComponent={<Empty title="No credit notes" subtitle="Return items against a past sale" />}
        renderItem={({ item }) => (
          <DocCard
            icon="arrow"
            tone="danger"
            title={item.partyId ? party(item.partyId)?.name || 'Walk-in' : 'Walk-in'}
            subtitle={item.reason || 'Return'}
            amount={'− ' + money(item.total)}
            amountTone={colors.danger}
            no={item.no}
            date={new Date(item.ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
          />
        )}
      />
      <Pressable onPress={() => navigation.navigate('CreditNoteNew', {})} style={{ position: 'absolute', right: 18, bottom: 18, width: 52, height: 52, borderRadius: 16, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.accentInk, fontSize: 24, fontFamily: fonts.uiBold }}>+</Text>
      </Pressable>
    </View>
  );
}

/**
 * Returning goods.
 *
 * A return starts from the bill it came off, not from a blank line editor —
 * that is the only way to know what was actually sold, at what price, and how
 * much of it is still returnable. Pick the invoice, set a quantity per line,
 * say how the customer is made good, and withhold a charge if the shop does.
 */
export function CreditNoteNewScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'CreditNoteNew'>) {
  const { colors } = useTheme();
  const { db, money, party, createCreditNote } = useAppData();
  const { success, error } = useToast();
  const who = useWho('Who is taking this return?');

  const preset = route.params?.saleId || null;
  const [saleId, setSaleId] = useState<string | null>(preset);
  const [q, setQ] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [charges, setCharges] = useState('');
  const [refund, setRefund] = useState<'cash' | 'bank' | 'momo' | 'account'>('cash');

  const sale = saleId ? db?.sales.find((x) => x.id === saleId) : null;

  /** How much of a line has already gone back on an earlier note. */
  const returnedSoFar = React.useMemo(() => {
    const m: Record<string, number> = {};
    if (!db || !saleId) return m;
    db.creditNotes.filter((c) => c.saleId === saleId).forEach((c) => {
      c.lines.forEach((l) => { m[l.productId] = (m[l.productId] || 0) + l.qty; });
    });
    return m;
  }, [db, saleId]);

  const candidates = React.useMemo(() => {
    if (!db) return [];
    const needle = q.trim().toLowerCase();
    return [...db.sales]
      .filter((x) => x.status !== 'void')
      .filter((x) => {
        if (!needle) return true;
        const name = x.partyId ? (party(x.partyId)?.name || '') : 'walk-in';
        return x.no.toLowerCase().includes(needle) || name.toLowerCase().includes(needle);
      })
      .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
      .slice(0, 25);
  }, [db, q, party]);

  const rows = (sale?.lines || []).map((l) => {
    const already = returnedSoFar[l.productId] || 0;
    const left = Math.max(0, l.qty - already);
    const want = Math.min(left, Number(String(qty[l.productId] || '').replace(/[^0-9.]/g, '')) || 0);
    return { l, already, left, want, value: want * l.price };
  });

  const goods = rows.reduce((s, r) => s + r.value, 0);
  const fee = Math.max(0, Math.min(Number(String(charges).replace(/[^0-9.]/g, '')) || 0, goods));
  const refundDue = goods - fee;
  const picked = rows.filter((r) => r.want > 0);
  const ready = !!sale && picked.length > 0;

  function bump(productId: string, by: number, max: number) {
    const cur = Number(String(qty[productId] || '').replace(/[^0-9.]/g, '')) || 0;
    const next = Math.max(0, Math.min(max, cur + by));
    setQty((prev) => ({ ...prev, [productId]: next ? String(next) : '' }));
  }

  function save() {
    if (!sale || !picked.length) return;
    who.ask((server) => {
      createCreditNote({
        saleId: sale.id,
        partyId: sale.partyId,
        lines: picked.map((r) => ({
          productId: r.l.productId, name: r.l.name, qty: r.want,
          price: r.l.price, cost: r.l.cost, taxRate: r.l.taxRate,
        })),
        reason: reason.trim() || 'Goods returned',
        refund,
        charges: fee,
        userId: server.userId,
      });
      success('Return recorded by ' + server.userName);
      navigation.goBack();
    });
  }

  if (!db) return null;

  /* ---- step one: find the bill ---- */
  if (!sale) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <FlatList
          data={candidates}
          keyExtractor={(x) => x.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 }}
          ListHeaderComponent={
            <View style={{ paddingTop: 14, gap: 14, marginBottom: 14 }}>
              <InfoBanner
                tone="accent"
                icon="bulb"
                text="Find the bill the goods came off. Returning against the original bill keeps the price, the stock and the customer's balance correct."
              />
              <Search value={q} onChange={setQ} placeholder="Invoice number or customer name" />
              <SectionLabel right={<Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{candidates.length} shown</Text>}>
                Recent bills
              </SectionLabel>
            </View>
          }
          ListEmptyComponent={
            <Panel><EmptyBlock icon="search" title="No bill matches" hint="Try the invoice number, or the customer's name." /></Panel>
          }
          renderItem={({ item }) => {
            const name = item.partyId ? (party(item.partyId)?.name || 'Walk-in') : 'Walk-in';
            return (
              <Pressable
                onPress={() => { setSaleId(item.id); setQty({}); }}
                style={{
                  backgroundColor: colors.surface, borderRadius: 16, paddingHorizontal: 15, paddingVertical: 14,
                  marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12,
                  shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2,
                }}
              >
                <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="receipt" size={20} color={colors.accent} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 15.5, color: colors.ink }}>{name}</Text>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                    {item.no} · {item.lines.length} item{item.lines.length === 1 ? '' : 's'} · {item.method}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 3 }}>
                  <Text style={{ fontFamily: fonts.uiExtra, fontSize: 16, color: colors.ink }}>{money(item.total)}</Text>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>
                    {new Date(item.ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      </View>
    );
  }

  /* ---- step two: how much of it is coming back ---- */
  const customer = sale.partyId ? party(sale.partyId) : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 190 }} keyboardShouldPersistTaps="handled">
        <Panel>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
            <View style={{ width: 46, height: 46, borderRadius: 15, backgroundColor: colors.dangerSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="arrow" size={21} color={colors.danger} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiExtra, fontSize: 18, color: colors.ink }}>{sale.no}</Text>
              <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                {customer?.name || 'Walk-in'} · {new Date(sale.ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
              </Text>
            </View>
            {!preset ? (
              <Pressable onPress={() => { setSaleId(null); setQty({}); }} hitSlop={8} style={{ padding: 4 }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: colors.accent }}>Change</Text>
              </Pressable>
            ) : null}
          </View>
        </Panel>

        <View style={{ height: 20 }} />
        <SectionLabel right={<Badge label={picked.length + ' of ' + rows.length} tone={picked.length ? 'danger' : 'neutral'} />}>
          What is coming back
        </SectionLabel>

        {rows.map((r) => (
          <Panel key={r.l.productId + (r.l.batchNo || '')} style={{ marginBottom: 12, opacity: r.left ? 1 : 0.55 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{r.l.name}</Text>
                <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                  {r.l.qty} sold at {money(r.l.price)}
                  {r.already ? ' · ' + r.already + ' already back' : ''}
                  {r.l.batchNo ? ' · batch ' + r.l.batchNo : ''}
                </Text>
              </View>
              {r.want > 0 ? (
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.danger }}>{money(r.value)}</Text>
              ) : null}
            </View>

            {r.left ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 13 }}>
                <Pressable onPress={() => bump(r.l.productId, -1, r.left)} style={stepper(colors)}>
                  <Text style={{ color: colors.ink, fontFamily: fonts.uiBold, fontSize: 19 }}>−</Text>
                </Pressable>
                <Text style={{ flex: 1, textAlign: 'center', fontFamily: fonts.uiExtra, fontSize: 18, color: colors.ink }}>
                  {r.want} <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint }}>of {r.left}</Text>
                </Text>
                <Pressable onPress={() => bump(r.l.productId, 1, r.left)} style={stepper(colors)}>
                  <Text style={{ color: colors.ink, fontFamily: fonts.uiBold, fontSize: 19 }}>+</Text>
                </Pressable>
                <Pressable
                  onPress={() => setQty((prev) => ({ ...prev, [r.l.productId]: String(r.left) }))}
                  style={{ paddingHorizontal: 14, paddingVertical: 11, borderRadius: 12, borderWidth: 1.4, borderColor: colors.line }}
                >
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: colors.accent }}>All</Text>
                </Pressable>
              </View>
            ) : (
              <View style={{ marginTop: 10 }}>
                <Badge label="Already fully returned" tone="neutral" />
              </View>
            )}
          </Panel>
        ))}

        <View style={{ height: 8 }} />
        <SectionLabel>How the customer is made good</SectionLabel>
        <OptionTiles
          value={refund}
          onChange={setRefund}
          tone="danger"
          options={[
            { v: 'cash' as const, l: 'Cash back', i: 'cash' },
            { v: 'bank' as const, l: 'Bank', i: 'bank' },
            { v: 'momo' as const, l: 'Mobile', i: 'phone' },
            { v: 'account' as const, l: 'To account', i: 'card' },
          ]}
        />

        <View style={{ height: 20 }} />
        <SectionLabel>Details</SectionLabel>
        <Field icon="doc" label="Reason" value={reason} onChangeText={setReason} placeholder="Damaged, wrong item, changed mind…" />
        <Field
          icon="tag"
          label="Charge withheld"
          value={charges}
          onChangeText={setCharges}
          numeric
          decimal
          placeholder="0"
        />

        <Panel>
          <DetailRow label="Goods coming back" value={money(goods)} />
          {fee ? <DetailRow label="Charge withheld" value={'− ' + money(fee)} tone={colors.warn} /> : null}
          <DetailRow
            label={refund === 'account' ? 'Credited to their account' : 'Refunded'}
            value={money(refundDue)}
            bold
            tone={colors.danger}
            last
          />
        </Panel>

        {fee ? (
          <View style={{ marginTop: 14 }}>
            <InfoBanner tone="neutral" icon="bulb" text="The charge is kept as other income; the sale is still reversed by the full value of the goods." />
          </View>
        ) : null}
      </ScrollView>

      {who.sheet}

      <StickyBar>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
            {refund === 'account' ? 'To credit' : 'To refund'}
          </Text>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 21, color: colors.ink }}>{money(refundDue)}</Text>
        </View>
        <Button
          label="Record the return"
          variant="pri"
          disabled={!ready}
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
