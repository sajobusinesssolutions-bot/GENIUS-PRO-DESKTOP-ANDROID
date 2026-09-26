import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, Platform, TextInput } from 'react-native';
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
import Sheet from '../components/Sheet';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';
import { PurchaseLine, PurchaseBatchAllocation, PayMethod, Product } from '../data/types';

type Props = NativeStackScreenProps<RootStackParamList, 'PurchaseNew'>;

function defaultExpiry(months = 12) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function newBatchNo(p: Product) {
  return (p.sku || 'B').toUpperCase().slice(0, 4) + '-' + new Date().toISOString().slice(2, 10).replace(/-/g, '');
}

function uniqueBatchNo(p: Product, used: string[]) {
  const base = newBatchNo(p);
  let candidate = base;
  let suffix = 2;
  while (used.includes(candidate)) candidate = base + '-' + suffix++;
  return candidate;
}

const num = (s: string) => Number(String(s).replace(/,/g, '')) || 0;

export function batchChoicesForProduct(product: Product | null | undefined, line: PurchaseLine | null | undefined) {
  const seen = new Set<string>();
  const chosen = new Map<string, PurchaseBatchAllocation>();
  const allocations = line ? allocationsFor(line, product as Product) : [];
  for (const a of allocations) {
    if (a.batchNo && a.batchNo.trim()) {
      seen.add(a.batchNo.trim());
      chosen.set(a.batchNo.trim(), a);
    }
  }
  const batches = (product?.batches || []).filter((b) => {
    if (!b.no || !b.no.trim()) return false;
    const key = b.no.trim();
    if (seen.has(key)) return true;
    return true;
  });
  const ordered = [...batches].sort((a, b) => {
    const qtyDelta = (a.qty || 0) - (b.qty || 0);
    if (qtyDelta !== 0) return qtyDelta;
    return (a.no || '').localeCompare(b.no || '');
  });
  return ordered.map((batch) => ({
    no: batch.no,
    qty: batch.qty,
    expiry: batch.expiry,
    selected: !!chosen.get(batch.no.trim()),
  }));
}

function allocationsFor(line: PurchaseLine, product: Product): PurchaseBatchAllocation[] {
  if (line.batchAllocations?.length) return line.batchAllocations;
  if (line.batchNo) return [{ batchNo: line.batchNo, qty: line.qty, expiry: line.expiry }];
  return [];
}

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
export default function PurchaseNewScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const { db, createPurchase, editPurchase, money, stockOf, addParty, addProduct, can } = useAppData();
  const editingPurchase = db?.purchases.find((purchase) => purchase.id === route.params?.editPurchaseId);
  const { error } = useToast();
  const who = useWho('Who recorded this purchase?');

  const suppliers = useMemo(() => (db?.parties || []).filter((p) => p.type === 'supplier' && p.active !== false), [db]);
  const [partyId, setPartyId] = useState<string | null>(editingPurchase?.partyId || (suppliers.length === 1 ? suppliers[0].id : null));
  const [method, setMethod] = useState<PayMethod>(editingPurchase?.method || 'credit');
  const [lines, setLines] = useState<PurchaseLine[]>(() => editingPurchase ? editingPurchase.lines.map((line) => ({
    ...line,
    batchAllocations: line.batchAllocations?.map((allocation) => ({ ...allocation })),
  })) : []);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const qtyRefs = useRef<Record<string, TextInput | null>>({});
  const [batchChoice, setBatchChoice] = useState<string | null>(null);
  const [newBatchLineId, setNewBatchLineId] = useState<string | null>(null);
  const [newBatchNoText, setNewBatchNoText] = useState('');
  const [newBatchExpiry, setNewBatchExpiry] = useState('');
  const [newBatchQty, setNewBatchQty] = useState('');
  const [picking, setPicking] = useState<string | null>(null);
  const defaultInvoiceNo = 'PUR-' + String(100000 + (db?.counters?.purchase || 0) + 1).slice(1);
  const [invoiceNo, setInvoiceNo] = useState(editingPurchase?.no || '');
  const [invoiceAt, setInvoiceAt] = useState(() => editingPurchase ? new Date(editingPurchase.ts) : new Date());
  const [metaVisible, setMetaVisible] = useState(false);
  const [pickerMode, setPickerMode] = useState<'date' | 'time' | null>(null);

  const [supplierPicker, setSupplierPicker] = useState(false);
  const [supplierForm, setSupplierForm] = useState(false);
  const [searching, setSearching] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [creating, setCreating] = useState<{ name: string; barcode?: string } | null>(null);

  const cats = useMemo(() => ['All', ...Array.from(new Set((db?.products || []).map((p) => p.category)))], [db]);
  const supplier = suppliers.find((s) => s.id === partyId);
  const canSetPrice = can('inventory.edit');

  useEffect(() => {
    if (!expandedId) return;
    const timer = setTimeout(() => qtyRefs.current[expandedId]?.focus(), 80);
    return () => clearTimeout(timer);
  }, [expandedId]);

  function findByCode(code: string) {
    const needle = code.trim().toLowerCase();
    return (db?.products || []).find((x) =>
      x.sku.toLowerCase() === needle || (x.barcodes || []).some((b) => b.toLowerCase() === needle));
  }

  function addLine(p: Product) {
    setSearching(false);
    setExpandedId(p.id);
    setLines((prev) => {
      if (prev.some((l) => l.productId === p.id)) {
        return prev.map((l) => {
          if (l.productId !== p.id) return l;
          const allocations = l.batchAllocations?.length
            ? l.batchAllocations.map((a, i) => i === 0 ? { ...a, qty: a.qty + 1 } : a)
            : l.batchAllocations;
          return { ...l, qty: l.qty + 1, ...(allocations ? { batchAllocations: allocations } : {}) };
        });
      }
      const line: PurchaseLine = { productId: p.id, qty: 0, cost: p.cost };
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

  function setAllocations(line: PurchaseLine, product: Product, allocations: PurchaseBatchAllocation[]) {
    const next = allocations.filter((a) => a.batchNo.trim());
    patch(line.productId, {
      qty: next.reduce((sum, a) => sum + Math.max(0, a.qty), 0),
      batchNo: next[0]?.batchNo || '',
      expiry: next[0]?.expiry,
      batchAllocations: next,
    });
  }

  function addBatchAllocation(line: PurchaseLine, product: Product, batchNo: string, expiry?: string) {
    const allocations = allocationsFor(line, product);
    if (allocations.some((a) => a.batchNo === batchNo)) return;
    setAllocations(line, product, [...allocations, { batchNo, qty: 0, expiry }]);
    setBatchChoice(null);
  }

  function openNewBatch(line: PurchaseLine, product: Product) {
    setBatchChoice(null);
    setNewBatchLineId(line.productId);
    setNewBatchNoText(uniqueBatchNo(product, [...(product.batches || []).map((b) => b.no), ...allocationsFor(line, product).map((a) => a.batchNo)]));
    setNewBatchExpiry(defaultExpiry());
    setNewBatchQty('');
  }

  function finishNewBatch() {
    const line = lines.find((item) => item.productId === newBatchLineId);
    const product = line ? db?.products.find((item) => item.id === line.productId) : null;
    const qty = num(newBatchQty);
    if (!line || !product || !newBatchNoText.trim() || qty <= 0) return;
    const updated = allocationsFor(line, product).concat({ batchNo: newBatchNoText.trim(), qty, expiry: newBatchExpiry || undefined });
    setAllocations(line, product, updated);
    setNewBatchLineId(null);
  }

  function setQty(id: string, qty: number) {
    setLines((prev) => (qty <= 0 ? prev.filter((l) => l.productId !== id) : prev.map((l) => (l.productId === id ? { ...l, qty } : l))));
  }

  const total = lines.reduce((s, l) => s + l.qty * l.cost, 0);
  const needsBatch = lines.some((l) => {
    const p = db?.products.find((x) => x.id === l.productId);
    return l.qty <= 0 || (p?.trackBatches && (!l.batchAllocations?.length || l.batchAllocations.some((a) => !a.batchNo.trim() || a.qty <= 0)));
  });

  function save() {
    if (!partyId || !lines.length || needsBatch) return;
    who.ask((server) => {
      if (editingPurchase) {
        const out = editPurchase(editingPurchase.id, { partyId, lines, method, ref: invoiceNo.trim() }, 'Edited on the purchase');
        if (!out) { error('That purchase can no longer be changed.'); return; }
      } else {
        createPurchase(partyId, lines, method, server.userId, invoiceNo.trim() || undefined, invoiceAt.toISOString());
      }
      navigation.goBack();
    });
  }

  if (!db) return null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 170 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
          <MetaTile label="Invoice no." value={invoiceNo.trim() || defaultInvoiceNo} onPress={() => setMetaVisible(true)} colors={colors} />
          <MetaTile label="Date" value={invoiceAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })} onPress={() => setPickerMode('date')} colors={colors} />
          <MetaTile label="Time" value={invoiceAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} onPress={() => setPickerMode('time')} colors={colors} />
        </View>
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
          const held = batchChoicesForProduct(p, l).map((b) => ({ no: b.no, qty: b.qty, expiry: b.expiry }));
          const existing = held.find((b) => b.no === l.batchNo);
          const intoExisting = !!existing;
          const expanded = expandedId === l.productId;
          const price = l.price ?? p?.price ?? 0;
          const margin = price > 0 && l.cost > 0 ? Math.round(((price - l.cost) / price) * 100) : null;
          const batchAllocations = tracked ? allocationsFor(l, p!) : [];
          const batchReady = !tracked || (batchAllocations.length > 0 && batchAllocations.every((a) => a.batchNo.trim() && a.qty > 0));
          const batchSummary = tracked
            ? batchAllocations.length
              ? batchAllocations.map((a) => `${a.batchNo}${a.expiry ? ` · ${a.expiry}` : ''} · ${a.qty}`).join(' | ')
              : 'No batch assigned yet'
            : 'No batch tracking';
          return (
            <View
              key={l.productId}
              style={{
                backgroundColor: colors.surface, borderRadius: 16, padding: 14, marginBottom: 10,
                shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, elevation: 2,
              }}
            >
              <Pressable onPress={() => setExpandedId(expanded ? null : l.productId)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
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
                  onPress={(event) => { event.stopPropagation(); setQty(l.productId, 0); }}
                  accessibilityLabel="Remove line"
                  style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: colors.dangerSoft, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Icon name="trash" size={16} color={colors.danger} />
                </Pressable>
                <Icon name={expanded ? 'up' : 'down'} size={16} color={colors.faint} />
              </Pressable>

              {!expanded ? (
                <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 8 }}>
                  {l.qty} {p?.unit || 'units'}
                  {tracked ? ` · ${batchSummary}` : ''}
                  {' · Tap to edit'}
                </Text>
              ) : null}

              {expanded ? <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                <View style={{ flex: 1 }}>
                  <Field
                    compact
                    label={'Qty (' + (p?.unit || '') + ')'}
                    value={String(l.qty)}
                    onChangeText={(v) => {
                      const qty = num(v);
                      const allocations = tracked ? allocationsFor(l, p!).map((a, i) => i === 0 ? { ...a, qty } : a) : undefined;
                      patch(l.productId, { qty, ...(allocations ? { batchAllocations: allocations } : {}) });
                    }}
                    decimal
                    autoFocus={expanded && expandedId === l.productId}
                    inputRef={(ref) => { qtyRefs.current[l.productId] = ref; }}
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
              </View> : null}
              {expanded && canSetPrice ? (
                <Field
                  compact
                  label={'Selling price' + (margin !== null ? ' · ' + margin + '% margin' : '')}
                  value={String(price)}
                  onChangeText={(v) => patch(l.productId, { price: num(v) })}
                  decimal
                  error={price > 0 && price < l.cost ? 'Selling below the new cost' : undefined}
                />
              ) : null}

              {expanded && tracked ? (
                <View style={{ marginTop: 4 }}>
                  <View style={{ height: 1, backgroundColor: colors.line, marginBottom: 12 }} />
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint, marginBottom: 8 }}>Batch allocation</Text>
                  {!batchReady ? (
                    <View style={{ marginBottom: 10 }}>
                      <InfoBanner tone="danger" text={`Add a lot number and quantity before saving this ${p?.unit || 'item'}.`} />
                    </View>
                  ) : null}
                  {held.length ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 10 }}>
                      {held.map((batch) => {
                        const selected = allocationsFor(l, p!).some((a) => a.batchNo === batch.no);
                        return (
                          <Pressable
                            key={batch.no}
                            onPress={() => {
                              if (selected) return;
                              setAllocations(l, p!, [...allocationsFor(l, p!), { batchNo: batch.no, qty: 0, expiry: batch.expiry }]);
                            }}
                            style={{ paddingVertical: 7, paddingHorizontal: 9, borderRadius: 8, borderWidth: 1, borderColor: selected ? colors.accent : colors.line, backgroundColor: selected ? colors.accentSoft : colors.surface }}
                          >
                            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11, color: selected ? colors.accent : colors.soft }}>{batch.no} · {batch.qty} left</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                  {allocationsFor(l, p!).map((allocation, allocationIndex) => {
                    const heldBatch = held.find((b) => b.no === allocation.batchNo);
                    return (
                      <View key={allocationIndex} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <Pressable
                          onPress={() => {
                            const next = held.find((b) => b.no !== allocation.batchNo && !allocationsFor(l, p!).some((a) => a.batchNo === b.no));
                            if (next) {
                              const nextAllocations = allocationsFor(l, p!).map((a, i) => i === allocationIndex ? { batchNo: next.no, qty: a.qty, expiry: next.expiry } : a);
                              setAllocations(l, p!, nextAllocations);
                            }
                          }}
                          style={{ flex: 1, minHeight: 44, justifyContent: 'center', paddingHorizontal: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 9, backgroundColor: colors.sunk }}
                        >
                          <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: colors.ink }}>{allocation.batchNo}</Text>
                          <Text style={{ fontFamily: fonts.ui, fontSize: 10.5, color: colors.faint }}>
                            {heldBatch ? heldBatch.qty + ' available' : 'new batch'}
                            {allocation.expiry ? ' · expires ' + allocation.expiry : ' · no expiry'}
                          </Text>
                        </Pressable>
                        <View style={{ width: 92 }}>
                          <Field compact label="Qty" value={String(allocation.qty)} onChangeText={(v) => {
                            const next = allocationsFor(l, p!).map((a, i) => i === allocationIndex ? { ...a, qty: num(v) } : a);
                            setAllocations(l, p!, next);
                          }} numeric decimal />
                        </View>
                        <Pressable
                          onPress={() => {
                            const next = allocationsFor(l, p!).filter((_, i) => i !== allocationIndex);
                            if (next.length) setAllocations(l, p!, next);
                          }}
                          style={{ padding: 8 }}
                        >
                          <Icon name="trash" size={15} color={colors.danger} />
                        </Pressable>
                      </View>
                    );
                  })}
                  <Pressable
                    onPress={() => {
                      setBatchChoice(l.productId);
                    }}
                    style={{ alignSelf: 'flex-start', paddingVertical: 9, paddingHorizontal: 12, borderRadius: 9, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accentSoft }}
                  >
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: colors.accent }}>+ Add batch / lot</Text>
                  </Pressable>
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

      <Sheet
        visible={metaVisible}
        title="Purchase details"
        onClose={() => setMetaVisible(false)}
        footer={<Button label="Done" variant="pri" onPress={() => setMetaVisible(false)} />}
      >
        <Field
          label="Invoice number"
          value={invoiceNo}
          onChangeText={setInvoiceNo}
          placeholder={defaultInvoiceNo}
          autoCapitalize="characters"
        />
      </Sheet>

      {pickerMode ? (
        <DateTimePicker
          value={invoiceAt}
          mode={pickerMode}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={(_event, date) => {
            if (Platform.OS !== 'ios') setPickerMode(null);
            if (date) setInvoiceAt(date);
          }}
        />
      ) : null}

      <Sheet
        visible={!!batchChoice}
        title="Add batch allocation"
        subtitle="Choose an existing lot or create a new one"
        icon="box"
        onClose={() => setBatchChoice(null)}
      >
        {(() => {
          const line = lines.find((item) => item.productId === batchChoice);
          const product = line ? db.products.find((item) => item.id === line.productId) : null;
          if (!line || !product) return null;
          const allocations = allocationsFor(line, product);
          return (
            <>
              {batchChoicesForProduct(product, line).map((batch) => {
                const selected = allocations.some((allocation) => allocation.batchNo === batch.no);
                return (
                  <Pressable
                    key={batch.no}
                    disabled={selected}
                    onPress={() => addBatchAllocation(line, product, batch.no, batch.expiry)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line, opacity: selected ? 0.45 : 1 }}
                  >
                    <Icon name="box" size={18} color={selected ? colors.faint : colors.accent} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink }}>{batch.no}</Text>
                      <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 2 }}>{batch.qty} currently on hand{batch.expiry ? ' · expires ' + batch.expiry : ''}</Text>
                    </View>
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: selected ? colors.faint : colors.accent }}>{selected ? 'Added' : 'Choose'}</Text>
                  </Pressable>
                );
              })}
              <Pressable
                    onPress={() => openNewBatch(line, product)}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 16 }}
                  >
                    <Icon name="plus" size={18} color={colors.accent} />
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.accent }}>Create a new batch</Text>
              </Pressable>
            </>
          );
        })()}
      </Sheet>

      <Sheet
        visible={!!newBatchLineId}
        title="Create new batch"
        subtitle="Enter the lot details before adding it"
        icon="box"
        onClose={() => setNewBatchLineId(null)}
        footer={<Button label="Finish" variant="pri" disabled={!newBatchNoText.trim() || num(newBatchQty) <= 0} onPress={finishNewBatch} />}
      >
        <Field
          icon="tag"
          label="Batch / lot number"
          value={newBatchNoText}
          onChangeText={setNewBatchNoText}
          autoCapitalize="characters"
          autoFocus
        />
        <Field
          icon="calendar"
          label="Expiry date"
          value={newBatchExpiry}
          onChangeText={setNewBatchExpiry}
          placeholder="YYYY-MM-DD or leave blank"
        />
        <Field
          label="Quantity"
          value={newBatchQty}
          onChangeText={setNewBatchQty}
          numeric
          decimal
          autoFocus={false}
        />
      </Sheet>

      <StickyBar>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
            {supplier ? supplier.name : 'Choose a supplier'}
          </Text>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 21, color: colors.ink }}>{money(total)}</Text>
        </View>
        <Button
          label={editingPurchase ? 'Update purchase' : 'Record purchase'}
          variant="pri"
          disabled={!partyId || !lines.length || needsBatch}
          icon={<Icon name="check" size={17} color={colors.accentInk} />}
          onPress={save}
        />
      </StickyBar>
    </View>
  );
}

function MetaTile({ label, value, onPress, colors }: { label: string; value: string; onPress: () => void; colors: any }) {
  return (
    <Pressable
      onPress={onPress}
      style={{ flex: 1, minWidth: 0, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 10, paddingVertical: 9 }}
    >
      <Text style={{ fontFamily: fonts.ui, fontSize: 10.5, color: colors.faint }}>{label}</Text>
      <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.ink, marginTop: 3 }}>{value}</Text>
    </Pressable>
  );
}
