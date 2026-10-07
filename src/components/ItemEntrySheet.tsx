/**
 * ADD AN ITEM TO A BILL — one screen with every field the line needs, laid out
 * in the order they are typed: item name, quantity and unit, batch and IMEI
 * where the item tracks them, rate, discount, description.
 *
 * Typing the name drops a list of saved items under it. The list carries a
 * count and a scroll bar that is always drawn, so it is plain that it is open
 * and holds more than fits. "Add New Item" turns whatever was typed into a new
 * item, saved with the line.
 *
 * Choosing an item fills in its unit and rate; the cursor never jumps on its
 * own, so the cashier taps the field they want next. "Save & New" keeps
 * the screen open for the next line; "Save" goes back to the bill.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, Text, TextInput, ScrollView, KeyboardAvoidingView, Platform, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable } from './Press';
import { ToastHost } from './Toast';
import { useTheme, fonts } from '../theme';
import { Icon } from './icons';
import { Field } from './form';
import ImeiSheet from './ImeiSheet';
import { unitsFor } from './LineEditSheet';
import { plain } from './BilledItems';
import { liveBatches } from '../data/batches';
import { useAppData } from '../data/AppDataContext';
import { vocab } from '../data/editions';
import type { Product, SoldSerial } from '../data/types';

/** What the screen hands back for one line. */
export interface EntryLine {
  product: Product;
  qty: number;
  unit: string;
  /** Stock units used by one of `unit`: 1 for the main unit. */
  unitFactor: number;
  /** Net rate, after the discount. */
  price: number;
  listPrice: number;
  discountPct: number;
  /** Cost per `unit`. */
  cost: number;
  note: string;
  batchNo?: string;
  serials?: SoldSerial[];
}

/** A line being changed, as the screen should open it. */
export interface EntryStart {
  productId: string;
  qty: number;
  unit?: string;
  listPrice: number;
  discountPct?: number;
  note?: string;
  batchNo?: string;
  serials?: SoldSerial[];
}

export interface NewItemDraft { name: string; unit: string; rate: number; sellPrice?: number }

/**
 * What every bill needs to offer "Add New Item": whether this role may, the
 * units to offer, and the call that saves it. `rateIs` says whether the rate
 * typed is the selling price (a sale, a quote) or the cost (a purchase).
 */
export function useNewItem(rateIs: 'price' | 'cost' = 'price') {
  const { db, addProduct, can } = useAppData();
  const units = db?.units?.length ? db.units : ['Pcs'];
  const create = (d: NewItemDraft): Product => addProduct({
    sku: 'ITM-' + ((db?.products.length || 0) + 1),
    name: d.name, unit: d.unit, category: 'General',
    cost: rateIs === 'cost' ? d.rate : 0,
    price: rateIs === 'cost' ? (d.sellPrice || 0) : d.rate,
    taxRate: db?.settings.taxRate ?? 0,
    stock: {}, reorder: 0, warrantyMonths: 0, active: true,
    kind: 'product', trackInventory: true, batches: [], barcodes: [],
  });
  return { canCreate: can('inventory.create'), units, create };
}

export default function ItemEntrySheet({
  visible, title, products, money, stockOf, priceOf, rateLabel = 'Rate (Price/Unit)',
  start, startProduct, onSave, onRemove, onClose,
  maxFor, canCreate, onCreateProduct, units = ['Pcs'],
  trackBatches = false, trackImei = false, discount = true, editRate = true, maxDiscountPct = 100, belowCost = 'allow',
  askSellPrice = false, takenImeis = [],
}: {
  visible: boolean;
  title: string;
  products: Product[];
  money: (n: number) => string;
  stockOf: (p: Product) => number;
  /** The rate an item starts at: its selling price, or its cost on a purchase. */
  priceOf: (p: Product) => number;
  rateLabel?: string;
  /** A line already on the bill, opened to be changed. */
  start?: EntryStart | null;
  /** An item already chosen, such as one just scanned. */
  startProduct?: Product | null;
  /** `andNew` keeps the screen open, cleared, for the next line. */
  onSave: (line: EntryLine, andNew: boolean) => void;
  /** Offered when changing a line already on the bill. */
  onRemove?: () => void;
  onClose: () => void;
  /** Most of an item (in its main unit) this line may take; leave out for no limit. */
  maxFor?: (p: Product, batchNo?: string) => number;
  canCreate?: boolean;
  /** Saves a new item and returns it; may throw with the reason it could not. */
  onCreateProduct?: (draft: NewItemDraft) => Product;
  /** Units offered for a new item. */
  units?: string[];
  trackBatches?: boolean;
  trackImei?: boolean;
  discount?: boolean;
  editRate?: boolean;
  maxDiscountPct?: number;
  /** Settings → "Below cost" for this person: warn under the rate, or refuse the line. */
  belowCost?: 'allow' | 'warn' | 'block';
  /** A purchase also asks what a new item sells for. */
  askSellPrice?: boolean;
  /** IMEIs already on other lines of this bill. */
  takenImeis?: string[];
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // Drug, Dish or Item, with an example name to match
  const V = vocab(useAppData().db);

  const [name, setName] = useState('');
  const [product, setProduct] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [nameFocused, setNameFocused] = useState(false);
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('');
  const [rate, setRate] = useState('');
  const [disc, setDisc] = useState('');
  const [note, setNote] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [batchNo, setBatchNo] = useState<string | undefined>(undefined);
  const [serials, setSerials] = useState<SoldSerial[]>([]);
  const [imeiOpen, setImeiOpen] = useState(false);
  /** Set when Save found IMEIs missing: saving carries on once they are in. */
  const [saveAfterImei, setSaveAfterImei] = useState<null | boolean>(null);
  const [err, setErr] = useState('');

  const nameRef = useRef<TextInput>(null);
  const qtyRef = useRef<TextInput>(null);
  const rateRef = useRef<TextInput>(null);
  const discRef = useRef<TextInput>(null);
  const noteRef = useRef<TextInput>(null);
  const sellRef = useRef<TextInput>(null);
  const listRef = useRef<ScrollView>(null);

  const focus = (r: React.RefObject<TextInput | null>, delay = 60) => setTimeout(() => r.current?.focus(), delay);
  /**
   * Runs a tap that closes the saved-items list once the touch has finished.
   * Removing the list while Android is still delivering the tap to one of its
   * rows force-closed the app.
   */
  const afterTouch = (fn: () => void) => setTimeout(fn, 60);
  /**
   * Lets go of the name box before its text is replaced. Writing a new value
   * into a box the keyboard is still composing a word in crashes Android
   * outright, so the box is blurred first and filled a moment later.
   */
  const releaseName = (fn: () => void) => {
    nameRef.current?.blur();
    setTimeout(fn, 120);
  };

  function clear() {
    setName(''); setProduct(null); setCreating(false); setQty(''); setUnit(''); setRate('');
    setDisc(''); setNote(''); setSellPrice(''); setBatchNo(undefined); setSerials([]); setErr('');
  }

  function choose(p: Product, startQty?: string) {
    setProduct(p);
    setCreating(false);
    setName(p.name);
    setUnit(p.unit);
    setRate(String(priceOf(p)));
    setQty(startQty ?? (p.startQtyFilled ? String(p.defaultQty || 1) : ''));
    setBatchNo(trackBatches && p.trackBatches ? liveBatches(p)[0]?.no : undefined);
    setSerials([]);
    setErr('');
    // the cursor stays put: the cashier taps the field they want next
  }

  useEffect(() => {
    if (!visible) return;
    clear();
    if (start) {
      const p = products.find((x) => x.id === start.productId);
      if (p) {
        setProduct(p);
        setName(p.name);
        setUnit(start.unit || p.unit);
        setQty(String(start.qty));
        setRate(String(start.listPrice));
        setDisc(start.discountPct ? String(start.discountPct) : '');
        setNote(start.note || '');
        setBatchNo(start.batchNo);
        setSerials(start.serials || []);
        return;
      }
    }
    if (startProduct) { choose(startProduct); return; }
    focus(nameRef, 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const needle = name.trim().toLowerCase();
  const matches = useMemo(() => {
    const list = products.filter((p) => p.active !== false && (!needle
      || p.name.toLowerCase().includes(needle)
      || p.sku.toLowerCase().includes(needle)
      || (p.barcodes || []).some((b) => b.toLowerCase().includes(needle))));
    // names that start with what was typed come first
    return list.sort((a, b) => {
      const as = a.name.toLowerCase().startsWith(needle) ? 0 : 1;
      const bs = b.name.toLowerCase().startsWith(needle) ? 0 : 1;
      return as - bs || a.name.localeCompare(b.name);
    }).slice(0, 80);
  }, [products, needle]);

  const searching = nameFocused && !product && !creating;
  useEffect(() => {
    // draw the scroll bar for a moment each time the list opens or changes
    if (searching) setTimeout(() => listRef.current?.flashScrollIndicators(), 150);
  }, [searching, matches.length]);

  const unitChoices = product ? unitsFor(product) : [];
  const chosenUnit = unitChoices.find((u) => u.unit === unit) || unitChoices[0];
  const factor = chosenUnit?.factor || 1;

  const qtyNum = Math.max(0, Number(qty) || 0);
  const rateNum = Math.max(0, Number(rate) || 0);
  const discRaw = Math.min(100, Math.max(0, Number(disc) || 0));
  const discNum = discount ? Math.min(discRaw, maxDiscountPct) : 0;
  const net = rateNum * (1 - discNum / 100);
  const lineTotal = qtyNum * net;

  const limit = product && maxFor ? maxFor(product, batchNo) : Infinity;
  const over = Number.isFinite(limit) && qtyNum * factor > limit + 1e-9;
  const batches = product && trackBatches && product.trackBatches ? liveBatches(product) : [];
  const wantsImei = !!(product && trackImei && product.trackSerials);
  const unitCost = product ? (unitsFor(product).find((u) => u.unit === unit)?.cost ?? product.cost) : 0;
  const underCost = belowCost !== 'allow' && !!product && unitCost > 0 && qtyNum > 0 && net < unitCost - 1e-9;
  const imeiShort = wantsImei && serials.filter((s) => s.imei).length !== Math.floor(qtyNum);

  function pickUnit(u: string) {
    setUnit(u);
    const c = unitChoices.find((x) => x.unit === u);
    if (c && product) setRate(String(Math.round((priceOf(product) === product.cost ? c.cost : c.price) * 100) / 100));
  }

  function startNew() {
    if (!name.trim()) { setErr('Type the new item\'s name first.'); return; }
    setCreating(true);
    setProduct(null);
    setUnit(units[0] || 'Pcs');
    setQty('1');
    setErr('');
  }

  function onNameChange(v: string) {
    setName(v);
    setErr('');
    // typing over a chosen item goes back to searching
    if (product && v !== product.name) { setProduct(null); setBatchNo(undefined); setSerials([]); }
  }

  function save(andNew: boolean) {
    let p = product;
    if (!p && !creating) {
      const exact = products.find((x) => x.active !== false && x.name.trim().toLowerCase() === needle);
      if (exact) p = exact;
      else if (needle && canCreate && onCreateProduct) { setCreating(true); setUnit(units[0] || 'Pcs'); setErr('This is a new item. Check the unit and rate, then save.'); return; }
      else { setErr(needle ? 'Pick an item from the list.' : 'Type an item name.'); return; }
    }
    if (qtyNum <= 0) { setErr('Enter the quantity.'); return; }
    if (over) { setErr('Only ' + plain(limit / factor) + ' ' + (chosenUnit?.unit || '') + ' available.'); return; }
    if (underCost && belowCost === 'block') { setErr('Below cost (' + money(unitCost) + '). Settings do not allow selling under cost.'); return; }
    if (p && wantsImei && imeiShort) { setSaveAfterImei(andNew); setImeiOpen(true); Keyboard.dismiss(); return; }

    if (!p) {
      try {
        p = onCreateProduct!({ name: name.trim(), unit: unit || units[0] || 'Pcs', rate: rateNum, sellPrice: Number(sellPrice) || undefined });
      } catch (e: any) {
        setErr(e?.why || e?.message || 'The item could not be added.');
        return;
      }
    }

    const c = unitsFor(p).find((u) => u.unit === unit) || { unit: p.unit, factor: 1, cost: p.cost };
    onSave({
      product: p, qty: qtyNum, unit: c.unit, unitFactor: c.factor,
      price: net, listPrice: rateNum, discountPct: discNum, cost: c.cost,
      note: note.trim(), batchNo, serials: wantsImei ? serials : undefined,
    }, andNew);
    if (andNew) clear();
  }

  const stockText = (p: Product) => (p.kind === 'service' ? null : stockOf(p));

  return (
    <>
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          {/* header */}
          <View style={{
            paddingTop: insets.top + 6, paddingHorizontal: 8, paddingBottom: 8,
            flexDirection: 'row', alignItems: 'center', gap: 6,
            backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.line,
          }}>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Back" style={{ padding: 10 }}>
              <Icon name="back" size={22} color={colors.ink} />
            </Pressable>
            <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 18, color: colors.ink }}>{title}</Text>
            {start && onRemove ? (
              <Pressable onPress={onRemove} hitSlop={10} accessibilityLabel="Remove this line" style={{ padding: 10 }}>
                <Icon name="trash" size={20} color={colors.danger} />
              </Pressable>
            ) : null}
          </View>

          {/* the name stays put; the list or the rest of the form sits under it */}
          <View style={{ backgroundColor: colors.surface, paddingHorizontal: 16, paddingTop: 18 }}>
            <Field
              label={V.item + ' name'}
              placeholder={V.example}
              inputRef={nameRef}
              value={name}
              onChangeText={onNameChange}
              autoCorrect={false}
              autoCapitalize="characters"
              returnKeyType="done"
              onFocus={() => setNameFocused(true)}
              onBlur={() => setNameFocused(false)}
              onSubmitEditing={() => {
                if (product || creating) return;
                if (matches.length === 1) { const only = matches[0]; releaseName(() => choose(only)); }
                else if (matches.length === 0 && canCreate && onCreateProduct) startNew();
              }}
              style={{ marginBottom: searching ? 0 : 14 }}
              trailing={name ? (
                <Pressable onPress={() => releaseName(() => { onNameChange(''); setProduct(null); setCreating(false); })} hitSlop={8} accessibilityLabel="Clear the name">
                  <Icon name="x" size={16} color={colors.faint} />
                </Pressable>
              ) : null}
            />
          </View>

          {searching ? (
            <View style={{ flex: 1, paddingHorizontal: 12, paddingBottom: 8, backgroundColor: colors.bg }}>
              <View style={{
                flexShrink: 1, marginTop: 4, backgroundColor: colors.surface, borderRadius: 12,
                borderWidth: 1.4, borderColor: colors.accent, overflow: 'hidden',
                shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 8,
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 8 }}>
                  <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink }}>
                    Saved {V.items.toLowerCase()} <Text style={{ fontFamily: fonts.ui, color: colors.faint }}>{matches.length ? '· ' + matches.length + (matches.length > 5 ? ' · scroll' : '') : '· none match'}</Text>
                  </Text>
                  {canCreate && onCreateProduct ? (
                    <Pressable onPress={() => releaseName(startNew)} hitSlop={8} accessibilityLabel="Add new item">
                      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.accent }}>Add New Item</Text>
                    </Pressable>
                  ) : null}
                </View>

                <ScrollView
                  ref={listRef}
                  keyboardShouldPersistTaps="always"
                  persistentScrollbar
                  showsVerticalScrollIndicator
                  indicatorStyle="black"
                >
                  {matches.map((p, i) => {
                    const st = stockText(p);
                    // at or under the reorder level reads red, so low stock shows while picking
                    const low = st !== null && st <= (p.reorder || 0);
                    return (
                      <Pressable
                        key={p.id}
                        onPress={() => releaseName(() => choose(p))}
                        android_ripple={{ color: colors.accentSoft }}
                        style={{
                          flexDirection: 'row', alignItems: 'center', gap: 12,
                          paddingHorizontal: 14, paddingVertical: 10, minHeight: 46,
                          borderBottomWidth: i === matches.length - 1 ? 0 : 1, borderBottomColor: colors.line,
                        }}
                      >
                        <Text numberOfLines={2} style={{ flex: 1, fontFamily: fonts.ui, fontSize: 15, color: colors.ink }}>{p.name}</Text>
                        {st === null ? (
                          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>Service</Text>
                        ) : (
                          <View style={{
                            flexDirection: 'row', alignItems: 'baseline', gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8,
                            backgroundColor: low ? colors.dangerSoft : colors.sunk,
                          }}>
                            <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: low ? colors.danger : colors.ink }}>{plain(st)}</Text>
                            <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: low ? colors.danger : colors.faint }}>{p.unit}{low ? ' · low' : ''}</Text>
                          </View>
                        )}
                      </Pressable>
                    );
                  })}
                  {!matches.length ? (
                    <Pressable onPress={canCreate && onCreateProduct ? () => releaseName(startNew) : undefined} style={{ padding: 20, alignItems: 'center' }}>
                      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: canCreate ? colors.accent : colors.faint, textAlign: 'center' }}>
                        {canCreate && onCreateProduct ? 'Add “' + name.trim() + '” as a new ' + V.item.toLowerCase() : 'Nothing matches “' + name.trim() + '”'}
                      </Text>
                    </Pressable>
                  ) : null}
                </ScrollView>
                {matches.length > 5 ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 4, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.sunk }}>
                    <Icon name="down" size={12} color={colors.faint} />
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: colors.faint }}>Scroll the list for more items</Text>
                  </View>
                ) : null}
              </View>
            </View>
          ) : (
            <ScrollView
              style={{ flex: 1 }}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 24 }}
            >
              <View style={{ backgroundColor: colors.surface, paddingHorizontal: 16, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: colors.line }}>
                {creating ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -6, marginBottom: 12 }}>
                    <Icon name="plus" size={13} color={colors.accent} />
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.accent }}>New {V.item.toLowerCase()} — saved to your {V.items.toLowerCase()} with this line</Text>
                  </View>
                ) : product && product.kind !== 'service' ? (
                  <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: -6, marginBottom: 12 }}>
                    In stock: <Text style={{ color: stockOf(product) > 0 ? colors.good : colors.danger }}>{plain(stockOf(product))} {product.unit}</Text>
                    {Number.isFinite(limit) && batchNo ? '  ·  Batch ' + batchNo + ': ' + plain(limit) : ''}
                  </Text>
                ) : null}

                {/* quantity and unit side by side, as on paper */}
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Field
                      label="Quantity"
                      inputRef={qtyRef}
                      value={qty}
                      onChangeText={(v) => { setQty(v); setErr(''); }}
                      numeric
                      decimal
                      returnKeyType="done"
                      error={over ? 'Only ' + plain(limit / factor) + ' left' : undefined}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    {creating ? (
                      <UnitChips value={unit} options={units} onChange={setUnit} />
                    ) : unitChoices.length > 1 ? (
                      <UnitChips value={unit} options={unitChoices.map((u) => u.unit)} onChange={pickUnit} />
                    ) : (
                      <Field label="Unit" value={unit || product?.unit || ''} readOnly />
                    )}
                  </View>
                </View>

                {batches.length ? (
                  <View style={{ marginBottom: 14 }}>
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint, marginBottom: 7 }}>Batch</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{ gap: 8 }}>
                      {batches.map((b) => {
                        const on = b.no === batchNo;
                        return (
                          <Pressable
                            key={b.no}
                            onPress={() => setBatchNo(b.no)}
                            style={{
                              paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1.4,
                              borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accentSoft : colors.surface,
                            }}
                          >
                            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: on ? colors.accent : colors.ink }}>{b.no}</Text>
                            <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 1 }}>
                              {plain(b.qty)} left{b.expiry ? ' · exp ' + new Date(b.expiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : ''}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  </View>
                ) : null}

                {wantsImei ? (
                  <Pressable
                    onPress={() => { Keyboard.dismiss(); setSaveAfterImei(null); setImeiOpen(true); }}
                    style={{ marginBottom: 14, borderRadius: 10, backgroundColor: colors.accentSoft, paddingVertical: 12, paddingHorizontal: 14, alignItems: 'center', gap: 4 }}
                  >
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.accent }}>
                      {serials.filter((s) => s.imei).length ? 'IMEI / Serial No. · ' + serials.filter((s) => s.imei).length + ' of ' + Math.max(1, Math.floor(qtyNum)) : 'Select IMEI / Serial No.'}
                    </Text>
                    {serials.filter((s) => s.imei).map((s) => (
                      <Text key={s.imei} style={{ fontFamily: fonts.mono, fontSize: 12.5, color: colors.soft }}>{s.imei}{s.imei2 ? ' / ' + s.imei2 : ''}</Text>
                    ))}
                  </Pressable>
                ) : null}

                <Field
                  label={rateLabel}
                  inputRef={rateRef}
                  value={rate}
                  onChangeText={setRate}
                  readOnly={!editRate && !creating}
                  numeric
                  decimal
                  returnKeyType="done"
                  error={underCost ? 'Below cost of ' + money(unitCost) + (belowCost === 'block' ? ' — not allowed' : ' — needs approval at checkout') : undefined}
                />

                {creating && askSellPrice ? (
                  <Field
                    label="Sale price (Price/Unit)"
                    inputRef={sellRef}
                    value={sellPrice}
                    onChangeText={setSellPrice}
                    numeric
                    decimal
                    returnKeyType="done"
                  />
                ) : null}

                {discount ? (
                  <Field
                    label="Discount (%)"
                    inputRef={discRef}
                    value={disc}
                    onChangeText={setDisc}
                    readOnly={!(maxDiscountPct > 0)}
                    numeric
                    decimal
                    returnKeyType="done"
                    error={discRaw > maxDiscountPct ? 'The most you can give is ' + maxDiscountPct + '%' : undefined}
                  />
                ) : null}

                <Field
                  label="Description"
                  inputRef={noteRef}
                  value={note}
                  onChangeText={setNote}
                  placeholder="Colour, size, condition, anything to print on the line"
                  returnKeyType="done"
                />
              </View>

              {/* what the line comes to */}
              {qtyNum > 0 ? (
                <View style={{ margin: 16, padding: 14, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, gap: 7 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.soft }}>Subtotal</Text>
                    <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.soft }}>{plain(qtyNum)} {unit} x {plain(rateNum)} = {money(qtyNum * rateNum)}</Text>
                  </View>
                  {discNum > 0 ? (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.warn }}>Discount (%): {plain(discNum)}</Text>
                      <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.warn }}>{money(qtyNum * (rateNum - net))}</Text>
                    </View>
                  ) : null}
                  <View style={{ height: 1, backgroundColor: colors.line }} />
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>Total Amount</Text>
                    <Text style={{ fontFamily: fonts.uiExtra, fontSize: 18, color: colors.ink }}>{money(lineTotal)}</Text>
                  </View>
                </View>
              ) : null}
            </ScrollView>
          )}

          {err ? (
            <View style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.dangerSoft }}>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.danger }}>{err}</Text>
            </View>
          ) : null}

          {/* Save & New keeps going; Save returns to the bill */}
          <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.line, paddingBottom: insets.bottom, backgroundColor: colors.surface }}>
            <Pressable
              onPress={() => save(true)}
              style={({ pressed }) => ({ flex: 1, height: 56, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.sunk : colors.surface })}
            >
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 16, color: colors.soft }}>{start ? 'Save & Add New' : 'Save & New'}</Text>
            </Pressable>
            <Pressable
              onPress={() => save(false)}
              style={({ pressed }) => ({ flex: 1, height: 56, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1 })}
            >
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 16, color: colors.accentInk }}>Save</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
      <ToastHost />
    </Modal>

    {/* a sibling of the entry, never nested in it: a Modal mounted inside an open Modal crashed Android */}
    {imeiOpen && product ? (
        <ImeiSheet
          visible
          product={product}
          qty={Math.max(1, qtyNum)}
          value={serials}
          taken={takenImeis}
          onClose={() => { setImeiOpen(false); setSaveAfterImei(null); }}
          onDone={(s) => {
            setSerials(s);
            setImeiOpen(false);
            const then = saveAfterImei;
            setSaveAfterImei(null);
            // Save was pressed before the IMEIs were in: finish it now
            if (then !== null && product) {
              const c = unitsFor(product).find((u) => u.unit === unit) || { unit: product.unit, factor: 1, cost: product.cost };
              onSave({
                product, qty: qtyNum, unit: c.unit, unitFactor: c.factor,
                price: net, listPrice: rateNum, discountPct: discNum, cost: c.cost,
                note: note.trim(), batchNo, serials: s,
              }, then);
              if (then) clear();
            }
          }}
        />
    ) : null}
    </>
  );
}

/** The unit beside the quantity: a box that cycles, or chips when there are a few. */
function UnitChips({ value, options, onChange }: { value: string; options: string[]; onChange: (u: string) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: 14 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{ gap: 6, alignItems: 'center', minHeight: 54 }}>
        {options.map((u) => {
          const on = u === value;
          return (
            <Pressable
              key={u}
              onPress={() => onChange(u)}
              style={{
                paddingHorizontal: 12, height: 40, justifyContent: 'center', borderRadius: 10, borderWidth: 1.4,
                borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accentSoft : colors.surface,
              }}
            >
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: on ? colors.accent : colors.ink }}>{u}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
