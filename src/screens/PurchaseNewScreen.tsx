import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import {
  Button, Panel, SectionLabel, DetailRow, InfoBanner, StickyBar,
  EmptyBlock, OptionTiles, Field, Badge,
} from '../components/ui';
import { Icon } from '../components/icons';
import { useWho } from '../components/WhoSheet';
import ItemSearchSheet from '../components/ItemSearchSheet';
import BarcodeScannerModal from '../components/BarcodeScannerModal';
import { CustomerPickerSheet, CustomerFormSheet } from '../components/CustomerSheets';
import { QuickItemSheet, QuickItem } from '../components/QuickItemSheet';
import { useToast } from '../components/Toast';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';
import { PurchaseLine, PayMethod, Product } from '../data/types';

type Props = NativeStackScreenProps<RootStackParamList, 'PurchaseNew'>;

function defaultExpiry(months = 12) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function newBatchNo(p: Product) {
  return (p.sku || 'B').toUpperCase().slice(0, 4) + '-' + new Date().toISOString().slice(2, 10).replace(/-/g, '');
}

const num = (s: string) => Number(String(s).replace(/,/g, '')) || 0;

/**
 * Receiving a delivery.
 *
 * Built to be as quick as ringing up a sale: the same search sheet (and
 * scanner) as the till, a supplier that can be added on the spot, and a new
 * item created from the search without leaving the purchase. Each line takes
 * its quantity, cost and — if it has changed — the new selling price.
 *
 * A batch-tracked line goes either into a new batch (lot number and expiry) or
 * on top of a batch the shop already holds, which is what a second delivery of
 * the same lot is.
 */
export default function PurchaseNewScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { db, createPurchase, money, stockOf, addParty, addProduct, can } = useAppData();
  const { error } = useToast();
  const who = useWho('Who recorded this purchase?');

  const suppliers = useMemo(() => (db?.parties || []).filter((p) => p.type === 'supplier' && p.active !== false), [db]);
  const [partyId, setPartyId] = useState<string | null>(suppliers.length === 1 ? suppliers[0].id : null);
  const [method, setMethod] = useState<PayMethod>('credit');
  const [lines, setLines] = useState<PurchaseLine[]>([]);
  const [picking, setPicking] = useState<string | null>(null);

  const [supplierPicker, setSupplierPicker] = useState(false);
  const [supplierForm, setSupplierForm] = useState(false);
  const [searching, setSearching] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [creating, setCreating] = useState<{ name: string; barcode?: string } | null>(null);

  const cats = useMemo(() => ['All', ...Array.from(new Set((db?.products || []).map((p) => p.category)))], [db]);
  const supplier = suppliers.find((s) => s.id === partyId);
  const canSetPrice = can('inventory.edit');

  function findByCode(code: string) {
    const needle = code.trim().toLowerCase();
    return (db?.products || []).find((x) =>
      x.sku.toLowerCase() === needle || (x.barcodes || []).some((b) => b.toLowerCase() === needle));
  }

  function addLine(p: Product) {
    setSearching(false);
    setLines((prev) => {
      if (prev.some((l) => l.productId === p.id)) {
        return prev.map((l) => (l.productId === p.id ? { ...l, qty: l.qty + 1 } : l));
      }
      const line: PurchaseLine = { productId: p.id, qty: 1, cost: p.cost };
      if (p.trackBatches) {
        line.batchNo = newBatchNo(p);
        line.expiry = defaultExpiry();
      }
      return [...prev, line];
    });
  }

  function createItem(it: QuickItem) {
    try {
      const p = addProduct({
        sku: 'ITM-' + ((db?.products.length || 0) + 1),
        name: it.name, unit: it.unit, category: it.category || 'General',
        cost: it.cost, price: it.price, taxRate: db?.settings.taxRate ?? 0,
        stock: {}, reorder: 0, warrantyMonths: 0, active: true,
        kind: 'product', trackInventory: true, trackBatches: it.trackBatches, batches: [],
        barcodes: creating?.barcode ? [creating.barcode] : [],
      });
      setCreating(null);
      addLine(p);
    } catch (e: any) {
      error(e?.why || e?.message || 'The item could not be added.');
    }
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
        <Pressable
          onPress={() => (suppliers.length ? setSupplierPicker(true) : setSupplierForm(true))}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 62,
            borderRadius: radius.md, borderWidth: 1.4, borderColor: colors.line,
            backgroundColor: colors.surface, paddingHorizontal: 15, marginBottom: 14,
          }}
        >
          <Icon name="factory" size={19} color={colors.accent} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11.5, color: colors.faint }}>Received from</Text>
            <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: supplier ? colors.ink : colors.faint, marginTop: 2 }}>
              {supplier ? supplier.name : suppliers.length ? 'Choose a supplier' : 'No suppliers yet — add one'}
            </Text>
          </View>
          <Icon name={suppliers.length ? 'chev' : 'plus'} size={16} color={colors.accent} />
        </Pressable>

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
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable
            onPress={() => setSearching(true)}
            style={{
              flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, height: 54,
              borderRadius: radius.md, borderWidth: 1.4, borderColor: colors.lineHard,
              backgroundColor: colors.sunk, paddingHorizontal: 14,
            }}
          >
            <Icon name="search" size={18} color={colors.faint} />
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14.5, color: colors.faint }}>Search items, or create one</Text>
          </Pressable>
          <Pressable
            onPress={() => setScanning(true)}
            accessibilityLabel="Scan a barcode"
            style={{ width: 54, height: 54, borderRadius: radius.md, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="box" size={20} color={colors.accentInk} />
          </Pressable>
        </View>

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
          const held = (p?.batches || []).filter((b) => b.qty > 0 || b.no === l.batchNo);
          const existing = held.find((b) => b.no === l.batchNo);
          const intoExisting = !!existing;
          const price = l.price ?? p?.price ?? 0;
          const margin = price > 0 && l.cost > 0 ? Math.round(((price - l.cost) / price) * 100) : null;
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
                    {p ? stockOf(p) + ' ' + p.unit + ' in stock now' : ''}
                  </Text>
                </View>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{money(l.qty * l.cost)}</Text>
                <Pressable
                  onPress={() => setQty(l.productId, 0)}
                  accessibilityLabel="Remove line"
                  style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: colors.dangerSoft, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Icon name="trash" size={16} color={colors.danger} />
                </Pressable>
              </View>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                <View style={{ flex: 1 }}>
                  <Field
                    compact
                    label={'Qty (' + (p?.unit || '') + ')'}
                    value={String(l.qty)}
                    onChangeText={(v) => patch(l.productId, { qty: num(v) })}
                    decimal
                  />
                </View>
                <View style={{ flex: 1.3 }}>
                  <Field
                    compact
                    label="Cost each"
                    value={String(l.cost)}
                    onChangeText={(v) => patch(l.productId, { cost: num(v) })}
                    decimal
                  />
                </View>
              </View>
              {canSetPrice ? (
                <Field
                  compact
                  label={'Selling price' + (margin !== null ? ' · ' + margin + '% margin' : '')}
                  value={String(price)}
                  onChangeText={(v) => patch(l.productId, { price: num(v) })}
                  decimal
                  error={price > 0 && price < l.cost ? 'Selling below the new cost' : undefined}
                />
              ) : null}

              {tracked ? (
                <View style={{ marginTop: 4 }}>
                  <View style={{ height: 1, backgroundColor: colors.line, marginBottom: 12 }} />
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint, marginBottom: 8 }}>Goes into</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                    {[{ no: '', label: 'A new batch' }, ...held.filter((b) => b.qty > 0).map((b) => ({
                      no: b.no,
                      label: b.no + ' · ' + b.qty + ' left' + (b.expiry ? ' · ' + new Date(b.expiry).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) : ''),
                    }))].map((o) => {
                      const on = o.no ? l.batchNo === o.no : !intoExisting;
                      return (
                        <Pressable
                          key={o.no || 'new'}
                          onPress={() => {
                            if (!o.no) { if (intoExisting && p) patch(l.productId, { batchNo: newBatchNo(p), expiry: defaultExpiry() }); return; }
                            const b = held.find((x) => x.no === o.no)!;
                            patch(l.productId, { batchNo: b.no, expiry: b.expiry });
                          }}
                          style={{
                            paddingVertical: 9, paddingHorizontal: 13, borderRadius: radius.pill,
                            borderWidth: 1.4, borderColor: on ? colors.accent : colors.line,
                            backgroundColor: on ? colors.accentSoft : colors.surface,
                          }}
                        >
                          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: on ? colors.accent : colors.soft }}>
                            {o.no ? '+ ' : ''}{o.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {intoExisting ? (
                    <InfoBanner
                      tone="accent"
                      icon="check"
                      text={l.qty + ' ' + (p?.unit || '') + ' will be added to batch ' + existing!.no
                        + ', making ' + (existing!.qty + l.qty) + '.'}
                    />
                  ) : (
                    <>
                      <Field
                        icon="tag"
                        label="New batch / lot no."
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
                            ? 'Expires ' + new Date(l.expiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
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
                    </>
                  )}
                </View>
              ) : null}
            </View>
          );
        })}

        {!lines.length ? (
          <Panel>
            <EmptyBlock icon="cart" title="Nothing on this delivery yet" hint="Search or scan above to add what arrived." />
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

      <ItemSearchSheet
        visible={searching}
        title="Add to purchase"
        products={db.products.filter((p) => p.kind !== 'service')}
        categories={cats}
        money={money}
        stockOf={stockOf}
        canSell={() => true}
        priceOf={(p) => p.cost}
        onPick={addLine}
        onCreate={can('inventory.create') ? (name) => { setSearching(false); setCreating({ name }); } : undefined}
        onScan={() => { setSearching(false); setScanning(true); }}
        onClose={() => setSearching(false)}
      />

      <BarcodeScannerModal
        visible={scanning}
        describe={(code: string) => {
          const p = findByCode(code);
          return p
            ? { title: p.name, subtitle: 'Cost ' + money(p.cost), ok: true }
            : { title: 'New code', subtitle: code + ' · create it as a new item', ok: true };
        }}
        onClose={() => setScanning(false)}
        onScan={(code: string) => {
          setScanning(false);
          const p = findByCode(code);
          if (p) addLine(p);
          else if (can('inventory.create')) setCreating({ name: '', barcode: code });
        }}
      />

      <QuickItemSheet
        visible={!!creating}
        initialName={creating?.name || ''}
        units={db.units?.length ? db.units : ['pcs']}
        categories={db.categories?.length ? db.categories : ['General']}
        batchesDefault={!!db.settings.trackBatches}
        onClose={() => setCreating(null)}
        onSave={createItem}
      />

      <CustomerPickerSheet
        kind="supplier"
        visible={supplierPicker}
        customers={suppliers}
        selectedId={partyId}
        onSelect={(id) => setPartyId(id)}
        onCreate={() => { setSupplierPicker(false); setSupplierForm(true); }}
        onClose={() => setSupplierPicker(false)}
      />
      <CustomerFormSheet
        kind="supplier"
        visible={supplierForm}
        onClose={() => setSupplierForm(false)}
        onSave={(p) => {
          try {
            const made = addParty(p);
            setPartyId(made.id);
            setSupplierForm(false);
          } catch (e: any) {
            error(e?.why || e?.message || 'The supplier could not be added.');
          }
        }}
      />

      <StickyBar>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
            {supplier ? supplier.name : 'Choose a supplier'}
          </Text>
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
