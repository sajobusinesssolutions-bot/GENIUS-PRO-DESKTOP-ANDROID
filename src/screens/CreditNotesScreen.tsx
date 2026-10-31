import { tsMs } from '../data/helpers';
import React, { useState } from 'react';
import { ListPage, DocRow, SummaryTiles, PeriodBar, listPeriod, inPeriod } from '../components/DocList';
import { View, Text, FlatList, TextInput, Alert } from 'react-native';
import ScrollView from '../components/KeyScroll';
import { Pressable } from '../components/Press';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useBookFrom } from '../data/useBookFrom';
import {
  Empty, Button, Cap, Chip, DocCard, Panel, Badge, SectionLabel, EmptyBlock, InfoBanner,
  Search, Field, OptionTiles, StickyBar, DetailRow,
} from '../components/ui';
import { Icon } from '../components/icons';
import { useToast } from '../components/Toast';
import { useWho } from '../components/WhoSheet';
import { LineEditor, CartLine } from '../components/LineEditor';
import DocEntry from '../components/DocEntry';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'CreditNotes'>;

export default function CreditNotesScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { db, money, party, deleteCreditNote, can } = useAppData();
  const [period, setPeriod] = useState(listPeriod('month'));
  const [q, setQ] = useState('');
  /* older returns point at sales no longer in memory; read the period from disk */
  const { book } = useBookFrom(db, period.from);
  const inRange = [...(db?.creditNotes || [])].filter((c) => inPeriod(c.ts, period)).reverse();
  const nameOf = (id: string | null) => (id ? party(id)?.name || 'Walk-in' : 'Walk-in');
  const needle = q.trim().toLowerCase();
  const list = inRange.filter((c) => !needle || (nameOf(c.partyId) + ' ' + c.no + ' ' + (c.reason || '')).toLowerCase().includes(needle));
  const REFUND: Record<string, string> = { cash: 'Cash back', bank: 'Bank', momo: 'Mobile money', account: 'Off what they owe' };
  return (
    <ListPage
      top={(
        <>
          <PeriodBar value={period} onChange={setPeriod} />
          <SummaryTiles tiles={[
            { label: 'Returns', value: String(inRange.length) },
            { label: 'Refunded', value: money(inRange.reduce((s, c) => s + c.total, 0)), tone: colors.danger },
          ]} />
        </>
      )}
      search={{ value: q, onChange: setQ, placeholder: 'Search returns' }}
      data={list}
      keyExtractor={(c) => c.id}
      empty={{ text: 'No returns in this period. Take one back against a past sale with Add return.' }}
      add={{ label: 'Add return', onPress: () => navigation.navigate('CreditNoteNew', {}) }}
      renderItem={({ item: c }) => {
        const sale = c.saleId ? (book || db)?.sales.find((x) => x.id === c.saleId) : undefined;
        return (
          <DocRow
            title={nameOf(c.partyId)}
            pill={{ label: REFUND[c.refund || 'cash'] || 'Return', tone: c.refund === 'account' ? 'accent' : 'danger' }}
            amount={'− ' + money(c.total)}
            amountTone={colors.danger}
            refText={'Return #' + c.no}
            ts={c.ts}
            lines={[
              ...(c.reason ? [{ label: 'Reason', value: c.reason }] : []),
              ...(sale ? [{ label: 'From sale', value: sale.no }] : []),
            ]}
            action={sale ? { label: 'See invoice', onPress: () => navigation.navigate('Receipt', { saleId: sale.id }) } : undefined}
            onMore={can('sales.refund') ? () => Alert.alert(c.no, 'Return of ' + money(c.total), [
              { text: 'Delete', style: 'destructive', onPress: () => Alert.alert('Delete ' + c.no + '?', 'The goods go back out of stock, the refund is undone, and the bill owes again what this took off it.', [
                { text: 'Keep it', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => { deleteCreditNote(c.id); } },
              ]) },
              { text: 'Close', style: 'cancel' },
            ]) : undefined}
          />
        );
      }}
    />
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
  const { db, money, party, createCreditNote, deleteCreditNote } = useAppData();
  const { success, error } = useToast();
  const who = useWho('Who is taking this return?');

  /* a credit note being corrected: its bill, quantities, reason and refund fill the form; saving puts the right one in its place */
  const editing = route.params?.editCreditNoteId ? (db?.creditNotes || []).find((c) => c.id === route.params!.editCreditNoteId) : undefined;
  const preset = route.params?.saleId || editing?.saleId || null;
  const [saleId, setSaleId] = useState<string | null>(preset);
  const [q, setQ] = useState('');
  const [qty, setQty] = useState<Record<string, string>>(() => (editing ? Object.fromEntries(editing.lines.map((l) => [l.productId, String(l.qty)])) : {}));
  const [reason, setReason] = useState(editing?.reason || '');
  const [charges, setCharges] = useState(editing?.charges ? String(editing.charges) : '');
  /** A return with no bill behind it: the customer and the goods entered as on a new sale. */
  const [free, setFree] = useState(!!route.params?.free || (!!editing && !editing.saleId));
  const [refund, setRefund] = useState<'cash' | 'bank' | 'momo' | 'account'>('cash');

  const sale = saleId ? db?.sales.find((x) => x.id === saleId) : null;
  /* a named customer: the return comes off what they owe (a credit note, as Tally makes it); a walk-in is paid back in cash */
  React.useEffect(() => { setRefund(editing?.refund || (sale && sale.partyId ? 'account' : 'cash')); }, [sale?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  /** How much of a line has already gone back on an earlier note. */
  const returnedSoFar = React.useMemo(() => {
    const m: Record<string, number> = {};
    if (!db || !saleId) return m;
    db.creditNotes.filter((c) => c.saleId === saleId && c.id !== editing?.id).forEach((c) => {
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
      .sort((a, b) => tsMs(b.ts) - tsMs(a.ts))
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
      if (editing) deleteCreditNote(editing.id);
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
      success((editing ? editing.no + ' corrected' : 'Return recorded') + ' by ' + server.userName);
      navigation.goBack();
    });
  }

  if (!db) return null;

  /* ---- a return with no bill: entered like a new sale ---- */
  if (free) return <FreeReturn navigation={navigation} editing={editing} />;

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
              <Button label="Return without a bill" icon={<Icon name="plus" size={16} color={colors.ink} />} onPress={() => setFree(true)} />
              <SectionLabel right={<Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{candidates.length} shown</Text>}>
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
                  backgroundColor: colors.surface, borderRadius: 4, paddingHorizontal: 15, paddingVertical: 14,
                  marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12,
                  shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2,
                }}
              >
                <View style={{ width: 42, height: 42, borderRadius: 4, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="receipt" size={20} color={colors.accent} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 14, color: colors.ink }}>{name}</Text>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                    {item.no} · {item.lines.length} item{item.lines.length === 1 ? '' : 's'} · {item.method}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 3 }}>
                  <Text style={{ fontFamily: fonts.uiExtra, fontSize: 14, color: colors.ink }}>{money(item.total)}</Text>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
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
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 190 }} keyboardShouldPersistTaps="handled">
        {/* as on New sale: the bill's details in one row, then the customer */}
        <View style={{ flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 4, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', marginBottom: 12 }}>
          <View style={{ flex: 1, minWidth: 0, paddingHorizontal: 10, paddingVertical: 8 }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint }}>Return against</Text>
            <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink, marginTop: 2 }}>{sale.no}</Text>
          </View>
          <View style={{ width: 1, backgroundColor: colors.line }} />
          <View style={{ flex: 1, minWidth: 0, paddingHorizontal: 10, paddingVertical: 8 }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint }}>Sold on</Text>
            <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink, marginTop: 2 }}>
              {new Date(sale.ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
            </Text>
          </View>
          {!preset ? (
            <>
              <View style={{ width: 1, backgroundColor: colors.line }} />
              <Pressable onPress={() => { setSaleId(null); setQty({}); }} style={{ paddingHorizontal: 14, justifyContent: 'center' }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: colors.accent }}>Change</Text>
              </Pressable>
            </>
          ) : null}
        </View>
        <View style={{ backgroundColor: colors.surface, borderRadius: 4, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 14 }}>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>Customer</Text>
          <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 14, color: colors.ink, marginTop: 3 }}>{customer?.name || 'Walk-in customer'}</Text>
        </View>
        <SectionLabel right={<Badge label={picked.length + ' of ' + rows.length} tone={picked.length ? 'danger' : 'neutral'} />}>
          What is coming back
        </SectionLabel>

        {rows.map((r) => (
          <Panel key={r.l.productId + (r.l.batchNo || '')} style={{ marginBottom: 12, opacity: r.left ? 1 : 0.55 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink }}>{r.l.name}</Text>
                <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                  {r.l.qty} sold at {money(r.l.price)}
                  {r.already ? ' · ' + r.already + ' already back' : ''}
                  {r.l.batchNo ? ' · batch ' + r.l.batchNo : ''}
                </Text>
              </View>
              {r.want > 0 ? (
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: colors.danger }}>{money(r.value)}</Text>
              ) : null}
            </View>

            {r.left ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 13 }}>
                <Pressable onPress={() => bump(r.l.productId, -1, r.left)} style={stepper(colors)}>
                  <Text style={{ color: colors.ink, fontFamily: fonts.uiBold, fontSize: 18 }}>−</Text>
                </Pressable>
                {/* typed, or stepped with − and + */}
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <TextInput
                    value={qty[r.l.productId] || ''}
                    onChangeText={(v) => {
                      const n = Number(v.replace(/[^0-9.]/g, '')) || 0;
                      setQty((prev) => ({ ...prev, [r.l.productId]: n > r.left ? String(r.left) : v.replace(/[^0-9.]/g, '') }));
                    }}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={colors.faint}
                    selectTextOnFocus
                    accessibilityLabel={'Quantity of ' + r.l.name + ' coming back'}
                    style={{ minWidth: 64, textAlign: 'center', fontFamily: fonts.uiExtra, fontSize: 18, color: colors.ink,
                      borderWidth: 1.2, borderColor: colors.line, borderRadius: 4, paddingVertical: 6, paddingHorizontal: 8, backgroundColor: colors.surface }}
                  />
                  <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>of {r.left}</Text>
                </View>
                <Pressable onPress={() => bump(r.l.productId, 1, r.left)} style={stepper(colors)}>
                  <Text style={{ color: colors.ink, fontFamily: fonts.uiBold, fontSize: 18 }}>+</Text>
                </Pressable>
                <Pressable
                  onPress={() => setQty((prev) => ({ ...prev, [r.l.productId]: String(r.left) }))}
                  style={{ paddingHorizontal: 14, paddingVertical: 11, borderRadius: 4, borderWidth: 1.4, borderColor: colors.line }}
                >
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: colors.accent }}>All</Text>
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
        <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginBottom: 8, marginTop: -4 }}>Unpaid takes it off what they owe; the others hand the money back.</Text>
        <OptionTiles
          value={refund}
          onChange={setRefund}
          tone="danger"
          options={[
            { v: 'account' as const, l: 'Unpaid', i: 'card' },
            { v: 'cash' as const, l: 'Cash back', i: 'cash' },
            { v: 'bank' as const, l: 'Bank', i: 'bank' },
            { v: 'momo' as const, l: 'Mobile', i: 'phone' },
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
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 18, color: colors.ink }}>{money(refundDue)}</Text>
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
    width: 40, height: 40, borderRadius: 4, borderWidth: 1.4, borderColor: colors.line,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  };
}

/**
 * A return with no bill to find — goods bought long ago, or on another till:
 * the customer and the goods entered as on a new sale (the shared document
 * screen), then how they are made good. Unpaid takes it off what they owe.
 */
function FreeReturn({ navigation, editing }: { navigation: any; editing?: import('../data/types').CreditNote }) {
  const { colors } = useTheme();
  const { db, createCreditNote, deleteCreditNote } = useAppData();
  const { success } = useToast();
  const [partyId, setPartyId] = useState<string | null>(editing?.partyId || null);
  const [lines, setLines] = useState<CartLine[]>(() => (editing ? editing.lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, price: l.price })) : []));
  const [refund, setRefund] = useState<'cash' | 'bank' | 'momo' | 'account'>(editing?.refund || 'account');
  const [reason, setReason] = useState(editing?.reason || '');
  if (!db) return null;
  const how = !partyId && refund === 'account' ? 'cash' : refund;
  return (
    <DocEntry
      kind="Return"
      icon="swap"
      tone="warn"
      partyType="customer"
      partyLabel="Returned by"
      partyId={partyId}
      onPartyChange={setPartyId}
      lines={lines}
      onLinesChange={setLines}
      saveLabel={editing ? 'Save changes' : 'Save return'}
      askWho="Who took this return?"
      blockedReason={refund === 'account' && !partyId ? 'Choose the customer, or a refund in cash — a walk-in has no account to take it off.' : undefined}
      onSave={(server) => {
        if (editing) deleteCreditNote(editing.id);
        createCreditNote({
          saleId: null, partyId,
          lines: lines.map((l) => {
            const p = db.products.find((x) => x.id === l.productId);
            return { productId: l.productId, name: l.name, qty: l.qty * (l.unitFactor || 1), price: l.price / (l.unitFactor || 1), cost: p?.cost || 0, taxRate: p?.taxExempt ? 0 : p?.taxRate || 0 };
          }),
          reason: reason.trim() || 'Goods returned', refund: how, userId: server.userId,
        });
        success((editing ? editing.no + ' corrected' : 'Return recorded') + ' by ' + server.userName);
        navigation.goBack();
      }}
    >
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint, marginBottom: 6 }}>How the customer is made good</Text>
      <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12 }}>
        {([['account', 'Unpaid'], ['cash', 'Cash back'], ['bank', 'Bank'], ['momo', 'Mobile']] as const).map(([v, l]) => (
          <Pressable key={v} onPress={() => setRefund(v)} style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 4, borderWidth: 1.2,
            borderColor: refund === v ? colors.accent : colors.line, backgroundColor: refund === v ? colors.accentSoft : colors.surface }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: refund === v ? colors.accent : colors.ink }}>{l}</Text>
          </Pressable>
        ))}
      </View>
      <Field icon="doc" label="Reason" value={reason} onChangeText={setReason} placeholder="Damaged, wrong item, changed mind…" />
    </DocEntry>
  );
}
