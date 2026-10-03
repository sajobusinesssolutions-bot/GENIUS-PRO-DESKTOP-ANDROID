import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TextInput, Platform, Alert } from 'react-native';
import { Pressable } from '../components/Press';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { saleTotals, pricesIncludeTax, sellLimit } from '../data/logic';
import { Button, Field, FieldShell, InfoBanner } from '../components/ui';
import { Icon } from '../components/icons';
import Sheet from '../components/Sheet';
import { useToast } from '../components/Toast';
import BarcodeScannerModal from '../components/BarcodeScannerModal';
import ImeiSheet from '../components/ImeiSheet';
import SegmentSlider from '../components/SegmentSlider';
import { conditionLabel } from '../components/SerialEditor';
import BatchPicker from '../components/BatchPicker';
import CheckoutSheet, { CheckoutButton } from '../components/CheckoutSheet';
import QtyPicker from '../components/QtyPicker';
import ItemSearchSheet from '../components/ItemSearchSheet';
import LineEditSheet from '../components/LineEditSheet';
import { CustomerPickerSheet, CustomerFormSheet } from '../components/CustomerSheets';
import { useWho } from '../components/WhoSheet';
import { useOwnerPin } from '../components/OwnerPin';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';
import { Product, ProductBatch, PayMethod, SaleLine } from '../data/types';
import { liveBatches } from '../data/batches';

type Props = NativeStackScreenProps<RootStackParamList, 'NewSale'>;

export default function NewSaleScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { db, money, stockOf, commitSale, editSale: editSaleTransaction, addParty, can } = useAppData();
  const editingSale = db?.sales.find((sale) => sale.id === route.params?.editSaleId);
  /** What the cart starts from: the sale being edited, or one being duplicated. */
  const seed = editingSale || db?.sales.find((sale) => sale.id === route.params?.copyFromId);
  /** Owner and manager are trusted with prices and discounts; everyone else follows Settings. */
  const trusted = db?.session.role === 'owner' || db?.session.role === 'manager';
  const { success, error } = useToast();
  const who = useWho('Who served this sale?');
  const ownerPin = useOwnerPin();

  const [cart, setCart] = useState<SaleLine[]>(() => seed ? seed.lines.map((line) => ({ ...line })) : []);
  // Settings → "Default payment"
  const [method, setMethod] = useState<PayMethod>(seed?.method || (db?.settings.defaultMethod as PayMethod) || 'cash');
  const [methods, setMethods] = useState<Array<{ method: PayMethod; amount: number }> | undefined>(editingSale?.methods);
  const [partyId, setPartyId] = useState<string | null>(seed?.partyId || null);
  const [discount, setDiscount] = useState(seed?.discount || 0);
  const [additionalCharges, setAdditionalCharges] = useState(seed?.additionalCharges || 0);
  const [description, setDescription] = useState('');
  const [terms, setTerms] = useState('');
  const [loading, setLoading] = useState(false);
  /** What the customer actually hands over on a credit sale. */
  const [received, setReceived] = useState(editingSale?.paidAtSale || 0);
  const [receivedVia, setReceivedVia] = useState<'cash' | 'momo' | 'bank'>(editingSale?.receivedVia || 'cash');
  const [momoNetwork, setMomoNetwork] = useState<'mtn' | 'airtel'>(editingSale?.momoNetwork || 'mtn');
  const [momoRef, setMomoRef] = useState(editingSale?.momoRef || '');

  const defaultInvoiceNo = 'INV-' + String(100000 + (db?.counters?.sale || 0) + 1).slice(1);
  const [invoiceNo, setInvoiceNo] = useState(editingSale?.no || '');
  const [invoiceAt, setInvoiceAt] = useState(() => editingSale ? new Date(editingSale.ts) : new Date());

  const [searchVisible, setSearchVisible] = useState(false);
  const [scanning, setScanning] = useState(false);
  /** The cart line whose IMEIs are being entered. */
  const [imeiFor, setImeiFor] = useState<number | null>(null);
  const [qtyPickerVisible, setQtyPickerVisible] = useState(false);
  const [batchPickerVisible, setBatchPickerVisible] = useState(false);
  const [lineBatchPickerVisible, setLineBatchPickerVisible] = useState(false);
  const [batchEditIndex, setBatchEditIndex] = useState<number | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<ProductBatch | null>(null);
  const [pendingQty, setPendingQty] = useState(1);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [partyPickerVisible, setPartyPickerVisible] = useState(false);
  const [customerFormVisible, setCustomerFormVisible] = useState(false);
  const [metaVisible, setMetaVisible] = useState(false);
  const [metaField, setMetaField] = useState<'no' | 'date' | 'time'>('no');
  const [pickerMode, setPickerMode] = useState<'date' | 'time' | null>(null);
  const [checkoutVisible, setCheckoutVisible] = useState(false);

  const cats = useMemo(() => ['All', ...Array.from(new Set((db?.products || []).map((p) => p.category)))], [db]);
  const customers = useMemo(() => (db?.parties || []).filter((p) => p.type === 'customer' && p.active), [db]);
  const selectedParty = partyId ? customers.find((p) => p.id === partyId) : undefined;

  const subtotal = cart.reduce((s, l) => s + l.qty * l.price, 0);
  const savings = cart.reduce((s, l) => s + l.qty * Math.max(0, (l.listPrice ?? l.price) - l.price), 0);
  const totalQty = cart.reduce((s, l) => s + l.qty, 0);
  // Worked out exactly as the sale will be posted, so the total on the button
  // is the total on the receipt — including tax added on top, where it is.
  const taxedLines = db?.settings.taxEnabled === false ? cart.map((l) => ({ ...l, taxRate: 0 })) : cart;
  const priced = saleTotals(taxedLines, discount, db ? pricesIncludeTax(db) : true);
  const taxOnTop = db && !pricesIncludeTax(db) ? priced.tax : 0;
  const grandTotal = Math.max(0, priced.total) + Math.max(0, additionalCharges);

  function openProduct(p: Product) {
    setSearchVisible(false);
    setScanning(false);
    setSelectedProduct(p);
    setQtyPickerVisible(true);
  }

  /** After the quantity is known, a batch-tracked item goes on to pick batches. */
  function afterQty(qty: number) {
    const p = selectedProduct;
    setQtyPickerVisible(false);
    if (!p) return;
    if (p.trackBatches && liveBatches(p).length) {
      setPendingQty(qty);
      setBatchPickerVisible(true);
      return;
    }
    addToCart(p, qty);
    setSelectedProduct(null);
  }

  function findByCode(code: string) {
    const needle = code.trim().toLowerCase();
    return (db?.products || []).find((x) =>
      x.sku.toLowerCase() === needle || (x.barcodes || []).some((b) => b.toLowerCase() === needle));
  }

  function describeCode(code: string) {
    const p = findByCode(code);
    if (!p) return { title: 'Unknown code', subtitle: code, ok: false };
    const stock = stockOf(p);
    if (db && sellLimit(db, p, stock) <= 0) return { title: p.name, subtitle: 'Out of stock', ok: false };
    return { title: p.name, subtitle: money(p.price) + ' · ' + stock + ' ' + p.unit + ' in stock', ok: true };
  }

  function handleScan(code: string) {
    const p = findByCode(code);
    if (p) openProduct(p);
  }

  function addToCart(p: Product, qty: number, batchNo?: string) {
    setCart((prev) => {
      const i = prev.findIndex((l) => l.productId === p.id && l.batchNo === batchNo);
      if (p.trackSerials) setTimeout(() => setImeiFor(i >= 0 ? i : prev.length), 350);
      if (i >= 0) return prev.map((l, idx) => idx === i ? { ...l, qty: l.qty + qty } : l);
      return [...prev, {
        productId: p.id, name: p.name, sku: p.sku, unit: p.unit,
        qty, price: p.price, listPrice: p.price, discountPct: 0,
        cost: p.cost, taxRate: p.taxRate, batchNo,
      }];
    });
  }

  /** The expiry printed under a cart line, read back off the product's batch. */
  function batchExpiryOf(line: SaleLine) {
    if (!line.batchNo) return '';
    const prod = (db?.products || []).find((x) => x.id === line.productId);
    const b = (prod?.batches || []).find((x) => x.no === line.batchNo);
    if (!b?.expiry) return '';
    return new Date(b.expiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
  }

  function stockForLine(line: SaleLine) {
    const p = (db?.products || []).find((x) => x.id === line.productId);
    if (!p) return line.qty;
    if (line.batchNo) return (p.batches || []).find((b) => b.no === line.batchNo)?.qty ?? line.qty;
    // Infinity for a service, or when the shop allows selling below zero
    return db ? sellLimit(db, p, stockOf(p)) : stockOf(p);
  }

  const productOf = (line: SaleLine) => (db?.products || []).find((x) => x.id === line.productId);
  /** Lines selling IMEI-tracked phones that do not yet have one IMEI per unit. */
  const missingImei = cart.findIndex((l) => productOf(l)?.trackSerials && (l.serials || []).length !== Math.floor(l.qty));

  function checkout() {
    if (!cart.length || (method === 'credit' && !partyId)) return;
    if (missingImei >= 0) {
      Alert.alert('IMEI needed', 'Enter the IMEI of each ' + cart[missingImei].name + ' before completing the sale.', [
        { text: 'Enter IMEI', onPress: () => setImeiFor(missingImei) },
      ]);
      return;
    }
    const st = db?.settings;

    // Settings → "Biggest discount a cashier may give", on the bill as a whole
    if (!trusted && st && subtotal > 0 && discount > subtotal * (Number(st.maxDiscountPct) || 0) / 100) {
      ownerPin.ask(
        'Approve a discount wider than the cashier limit on this sale.',
        () => askCustomer(),
      );
      return;
    }

    // Settings → "Below cost": warn, block, or allow
    const under = cart.filter((l) => l.cost > 0 && l.price < l.cost);
    const belowCost = (st as any)?.belowCost || 'warn';
    if (under.length && belowCost === 'block' && !trusted) {
      ownerPin.ask(
        'Approve a sale that sells below cost for ' + under[0].name + '.',
        () => askCustomer(),
      );
      return;
    }

    const go = () => who.ask((server) => postSale(server.userId, server.userName));
    const askCustomer = () => {
      // Settings → "Ask for the customer on every sale"
      if (st?.askCustomer && !partyId) {
        Alert.alert('Who is this sale for?', 'Settings ask for a customer on every sale.', [
          { text: 'Choose a customer', onPress: () => setPartyPickerVisible(true) },
          { text: 'Walk-in customer', onPress: go },
        ]);
        return;
      }
      go();
    };

    if (under.length && belowCost === 'warn') {
      ownerPin.ask(
        'Approve selling below cost for ' + under.map((l) => l.name).slice(0, 3).join(', ') + (under.length > 3 ? ' and others' : '') + '.',
        () => askCustomer(),
      );
      return;
    }
    askCustomer();
  }

  function postSale(userId: string, userName: string) {
    setLoading(true);
    try {
      if (editingSale) {
        const out = editSaleTransaction(editingSale.id, {
          lines: cart,
          partyId,
          discount,
          note: description,
        }, 'Edited on the sale');
        if (!out) throw new Error('That sale can no longer be changed.');
        success(out.no + ' updated by ' + userName);
        setCheckoutVisible(false);
        navigation.replace('Receipt', { saleId: out.id });
        return;
      }
      const splitMethods = (methods && methods.length > 1) ? methods : undefined;
      // Settings → "Round totals to": the difference is a discount when rounding
      // down and a charge when rounding up, so the books still tie out.
      const step = Number(db?.settings.roundTo) || 0;
      const rounded = step > 0 && method !== 'credit' && !splitMethods ? Math.round(grandTotal / step) * step : grandTotal;
      const roundDown = Math.max(0, grandTotal - rounded);
      const roundUp = Math.max(0, rounded - grandTotal);
      const sale = commitSale({
        lines: cart, partyId, method,
        discount: discount + roundDown,
        additionalCharges: additionalCharges + roundUp,
        description, terms,
        methods: splitMethods, no: invoiceNo.trim() || undefined, ts: invoiceAt.toISOString(),
        received: method === 'credit' ? received : undefined,
        receivedVia: method === 'credit' ? receivedVia : undefined,
        momoNetwork: (method === 'momo' || (method === 'credit' && receivedVia === 'momo')) ? momoNetwork : undefined,
        momoRef: (method === 'momo' || (method === 'credit' && receivedVia === 'momo')) ? momoRef : undefined,
        userId,
      });
      success(sale.no + ' saved by ' + userName);
      setCart([]);
      setMethod((db?.settings.defaultMethod as PayMethod) || 'cash');
      setMethods(undefined);
      setDiscount(0);
      setAdditionalCharges(0);
      setDescription('');
      setTerms('');
      setInvoiceNo('');
      setInvoiceAt(new Date());
      setReceived(0);
      setReceivedVia('cash');
      setMomoNetwork('mtn');
      setMomoRef('');
      setCheckoutVisible(false);
      navigation.replace('Receipt', { saleId: sale.id });
    } catch (e: any) {
      // The sale did not post. An alert sits above the open sheet, so this
      // cannot be scrolled past the way a banner could be.
      const why = e?.message || 'The sale could not be saved.';
      Alert.alert('Sale not saved', why, [{ text: 'Go back and fix it' }]);
      error(why);
    } finally {
      setLoading(false);
    }
  }

  const editLine = editIndex !== null ? cart[editIndex] ?? null : null;
  const batchEditLine = batchEditIndex !== null ? cart[batchEditIndex] ?? null : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 14, paddingBottom: 190 + insets.bottom, gap: 12 }}
        showsVerticalScrollIndicator={false}
      >
        {/* date and time in one box; the number below, blank for the next in sequence */}
        <View>
          <FieldShell
            label="Date"
            icon="calendar"
            style={{ marginBottom: 8 }}
            onPress={() => setPickerMode('date')}
            right={
              <Pressable onPress={() => setPickerMode('time')} hitSlop={8} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: colors.sunk }}>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.soft }}>
                  {invoiceAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </Pressable>
            }
          >
            <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 15, color: colors.ink }}>
              {invoiceAt.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </Text>
          </FieldShell>
          <Field
            icon="tag"
            label="Invoice Number (optional)"
            value={invoiceNo}
            onChangeText={setInvoiceNo}
            placeholder={defaultInvoiceNo}
            autoCapitalize="characters"
            style={{ marginBottom: 0 }}
          />
        </View>

        {/* cash or credit */}
        <SegmentSlider
          value={method === 'credit' ? 'credit' : 'cash'}
          options={[{ v: 'cash', l: 'Cash sale', i: 'cash' }, { v: 'credit', l: 'Credit sale', i: 'user' }]}
          onChange={(v) => setMethod(v as PayMethod)}
          style={{ marginBottom: 0 }}
        />

        {/* the customer */}
        <View style={{ backgroundColor: colors.surface, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: colors.line }}>
          <Pressable
            onPress={() => setPartyPickerVisible(true)}
            style={{ paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
                Customer{method === 'credit' ? ' · required' : ''}
              </Text>
              <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 15, color: selectedParty ? colors.ink : colors.soft, marginTop: 3 }}>
                {selectedParty?.name || 'Walk-in customer'}
              </Text>
              {selectedParty?.address ? (
                <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>{selectedParty.address}</Text>
              ) : null}
            </View>
            <Icon name="chev" size={18} color={colors.faint} />
          </Pressable>
          {method === 'credit' && !partyId ? (
            <View style={{ paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.warnSoft }}>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.warn }}>Pick a customer to record a credit sale.</Text>
            </View>
          ) : null}
        </View>

        {/* Items */}
        <View style={{ backgroundColor: colors.surface, borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: colors.line }}>
          <View style={{ paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.sunk, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.soft, letterSpacing: 0.4 }}>ITEMS</Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
              {cart.length ? cart.length + ' line' + (cart.length > 1 ? 's' : '') + ' · ' + totalQty + ' qty' : 'Empty'}
            </Text>
          </View>

          {cart.map((line, idx) => {
            const disc = line.discountPct ?? 0;
            return (
              <Pressable
                key={`${line.productId}-${line.batchNo || ''}-${idx}`}
                onPress={() => setEditIndex(idx)}
                style={{ paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: 'row', alignItems: 'center', gap: 12 }}
              >
                <View style={{ width: 28, height: 28, borderRadius: 9, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: colors.accent }}>{idx + 1}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 15, color: colors.ink }}>{line.name}</Text>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>
                    {line.qty} {line.unit} × {money(line.price)}
                    {disc > 0 ? ' · ' + disc + '% off' : ''}
                  </Text>
                  {productOf(line)?.trackSerials ? (
                    <Pressable onPress={() => setImeiFor(idx)} hitSlop={6} style={{ marginTop: 6, gap: 2 }}>
                      {(line.serials || []).length ? (line.serials || []).map((sr) => (
                        <Text key={sr.imei} numberOfLines={1} style={{ fontFamily: fonts.mono, fontSize: 12.5, color: colors.accent }}>
                          IMEI {sr.imei}{sr.imei2 ? ' / ' + sr.imei2 : ''}{sr.condition ? ' · ' + conditionLabel(sr.condition) : ''}
                        </Text>
                      )) : null}
                      {(line.serials || []).length !== Math.floor(line.qty) ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                          <Icon name="camera" size={12} color={colors.warn} />
                          <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: colors.warn }}>
                            {(line.serials || []).length ? 'IMEI ' + (line.serials || []).length + ' of ' + Math.floor(line.qty) + ' · tap to finish' : 'Tap to add the IMEI'}
                          </Text>
                        </View>
                      ) : null}
                    </Pressable>
                  ) : null}
                  {line.batchNo ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 }}>
                      <Icon name="box" size={12} color={colors.accent} />
                      <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.accent }}>
                        Batch {line.batchNo}
                        {batchExpiryOf(line) ? ' · exp ' + batchExpiryOf(line) : ''}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <Text style={{ fontFamily: fonts.mono, fontSize: 15, color: colors.ink }}>{money(line.qty * line.price)}</Text>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.accent }}>Tap to edit</Text>
                </View>
                <Pressable
                  hitSlop={10}
                  onPress={() => setCart((prev) => prev.filter((_, i) => i !== idx))}
                  style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.dangerSoft, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Icon name="trash" size={15} color={colors.danger} />
                </Pressable>
              </Pressable>
            );
          })}

          {/* the totals, straight under the lines */}
          {cart.length > 0 && (
          <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4, gap: 8 }}>
            <TotalRow label="Subtotal" value={money(subtotal)} colors={colors} />
            {savings > 0 ? <TotalRow label="Item discounts" value={'− ' + money(savings)} tone={colors.good} colors={colors} /> : null}
            {discount > 0 ? <TotalRow label="Sale discount" value={'− ' + money(discount)} tone={colors.good} colors={colors} /> : null}
            {additionalCharges > 0 ? <TotalRow label="Additional charges" value={'+ ' + money(additionalCharges)} colors={colors} /> : null}
            {taxOnTop > 0 ? <TotalRow label={(db?.settings.taxName || 'Tax') + ' added'} value={'+ ' + money(taxOnTop)} colors={colors} /> : null}
            <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 2 }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.soft }}>Amount due</Text>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 20, color: colors.ink }}>{money(grandTotal)}</Text>
            </View>
          </View>
          )}

          <View style={{ flexDirection: 'row', gap: 10, padding: 12 }}>
            <View style={{ flex: 1 }}>
              <Button label={cart.length ? 'Add another item' : 'Add item'} variant="pri" icon={<Icon name="plus" size={16} color={colors.accentInk} />} onPress={() => setSearchVisible(true)} />
            </View>
            <Pressable
              onPress={() => setScanning(true)}
              accessibilityLabel="Scan a barcode"
              style={({ pressed }) => ({
                width: 56, borderRadius: 14, borderWidth: 1.4, borderColor: colors.line,
                alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.sunk : colors.surface,
              })}
            >
              <Icon name="barcode" size={24} color={colors.ink} />
            </Pressable>
          </View>
        </View>
      </ScrollView>

      {/* Sticky action bar */}
      <View style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line,
        paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10 + insets.bottom, gap: 10,
      }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{totalQty} item{totalQty === 1 ? '' : 's'}</Text>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 20, color: colors.ink }}>{money(grandTotal)}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button label="Clear" disabled={!cart.length} onPress={() => { setCart([]); setDiscount(0); setAdditionalCharges(0); }} />
          </View>
          <View style={{ flex: 2 }}>
            <Button
              label="Cart"
              variant="pri"
              disabled={!cart.length}
              onPress={() => { if (cart.length) setCheckoutVisible(true); else error('Add at least one item'); }}
            />
          </View>
        </View>
      </View>

      <ItemSearchSheet
        visible={searchVisible}
        products={db?.products || []}
        categories={cats}
        money={money}
        stockOf={stockOf}
        canSell={(p) => !!db && sellLimit(db, p, stockOf(p)) > 0}
        onPick={openProduct}
        onScan={() => { setSearchVisible(false); setScanning(true); }}
        onClose={() => setSearchVisible(false)}
      />

      <ImeiSheet
        visible={imeiFor !== null && !!cart[imeiFor]}
        product={imeiFor !== null && cart[imeiFor] ? productOf(cart[imeiFor]) || null : null}
        qty={imeiFor !== null && cart[imeiFor] ? cart[imeiFor].qty : 1}
        value={imeiFor !== null && cart[imeiFor] ? cart[imeiFor].serials || [] : []}
        taken={cart.flatMap((l, i) => (i === imeiFor ? [] : (l.serials || []).flatMap((x) => [x.imei, x.imei2 || ''].filter(Boolean))))}
        onClose={() => setImeiFor(null)}
        onDone={(serials) => {
          const at = imeiFor;
          setCart((prev) => prev.map((l, i) => (i === at ? { ...l, serials, serialNo: serials[0]?.imei } : l)));
          setImeiFor(null);
        }}
      />

      <BarcodeScannerModal
        visible={scanning}
        describe={describeCode}
        onClose={() => setScanning(false)}
        onScan={handleScan}
      />

      <BatchPicker
        visible={batchPickerVisible}
        productName={selectedProduct?.name || ''}
        batches={selectedProduct?.batches || []}
        qty={pendingQty}
        onConfirm={(picks) => {
          const p = selectedProduct;
          setBatchPickerVisible(false);
          if (p) picks.forEach((pick) => addToCart(p, pick.qty, pick.no));
          setSelectedProduct(null);
          setSelectedBatch(null);
        }}
        onCancel={() => { setBatchPickerVisible(false); setSelectedProduct(null); setSelectedBatch(null); }}
      />

      <BatchPicker
        visible={lineBatchPickerVisible}
        productName={batchEditLine?.name || ''}
        batches={batchEditLine ? (db?.products.find((p) => p.id === batchEditLine.productId)?.batches || []) : []}
        qty={batchEditLine?.qty || 1}
        onConfirm={(picks) => {
          const index = batchEditIndex;
          if (index !== null && picks.length) {
            // the line becomes one line per batch it draws from, each with its share
            setCart((prev) => prev.flatMap((line, i) => i === index
              ? picks.map((pick) => ({ ...line, batchNo: pick.no, qty: pick.qty }))
              : [line]));
          }
          setLineBatchPickerVisible(false);
          setBatchEditIndex(null);
          if (index !== null) setEditIndex(index);
        }}
        onCancel={() => {
          const index = batchEditIndex;
          setLineBatchPickerVisible(false);
          setBatchEditIndex(null);
          if (index !== null) setEditIndex(index);
        }}
      />

      <QtyPicker
        visible={qtyPickerVisible}
        start={selectedProduct?.startQtyFilled ? String(selectedProduct.defaultQty || 1) : ''}
        productName={selectedProduct?.name || ''}
        price={selectedProduct?.price || 0}
        maxStock={selectedProduct && db ? sellLimit(db, selectedProduct, stockOf(selectedProduct)) : 0}
        money={money}
        onConfirm={afterQty}
        onCancel={() => { setQtyPickerVisible(false); setSelectedProduct(null); setSelectedBatch(null); }}
      />

      <LineEditSheet
        visible={editLine !== null}
        line={editLine}
        maxStock={editLine ? stockForLine(editLine) : 0}
        money={money}
        product={editLine ? db?.products.find((x) => x.id === editLine.productId) : null}
        onChooseBatch={() => {
          if (editIndex === null) return;
          setBatchEditIndex(editIndex);
          setEditIndex(null);
          setLineBatchPickerVisible(true);
        }}
        // The owner and managers are never limited; cashiers follow Settings.
        // role first ("Change prices at the till", "Give discounts"), then the till settings
        canEditPrice={trusted || can('sales.price_edit') || db?.settings.allowPriceEdit === true}
        maxDiscountPct={!can('sales.discount') ? 0 : trusted ? 100 : Number(db?.settings.maxDiscountPct ?? 100)}
        onSave={(patch) => {
          setCart((prev) => prev.map((l, i) => i === editIndex ? { ...l, ...patch } : l));
          setEditIndex(null);
        }}
        onRemove={() => {
          setCart((prev) => prev.filter((_, i) => i !== editIndex));
          setEditIndex(null);
        }}
        onClose={() => setEditIndex(null)}
      />

      <CustomerPickerSheet
        visible={partyPickerVisible}
        customers={customers}
        selectedId={partyId}
        onSelect={setPartyId}
        onCreate={() => { setPartyPickerVisible(false); setCustomerFormVisible(true); }}
        onClose={() => setPartyPickerVisible(false)}
      />

      <CustomerFormSheet
        visible={customerFormVisible}
        onClose={() => setCustomerFormVisible(false)}
        onSave={(p) => {
          const created = addParty(p);
          setPartyId(created.id);
          setCustomerFormVisible(false);
          success(created.name + ' added');
        }}
      />

      <Sheet
        visible={metaVisible}
        title="Invoice details"
        icon="calendar"
        onClose={() => { setMetaVisible(false); setPickerMode(null); }}
        footer={<Button label="Done" variant="pri" onPress={() => { setMetaVisible(false); setPickerMode(null); }} />}
      >
        <Field
          icon="doc"
          label="Invoice number"
          value={invoiceNo}
          onChangeText={setInvoiceNo}
          placeholder={defaultInvoiceNo}
          autoCapitalize="characters"
        />
        <InfoBanner tone="neutral" icon="bulb" text="Leave it blank to use the next number in sequence." />
      </Sheet>

      {/* the date and time pickers open on their own, never stacked on a sheet */}
      {pickerMode ? (
        <DateTimePicker
          value={invoiceAt}
          mode={pickerMode}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onDismiss={() => setPickerMode(null)}
          onValueChange={(_e, d) => {
            setPickerMode(null);
            if (d) setInvoiceAt(d);
          }}
        />
      ) : null}

      {who.sheet}

      <Sheet
        visible={checkoutVisible}
        title="Cart"
        subtitle={totalQty + ' item' + (totalQty === 1 ? '' : 's') + ' · ' + money(grandTotal)}
        icon="receipt"
        full
        onClose={() => setCheckoutVisible(false)}
        footer={
          <View>
            {method === 'credit' ? (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
                  Received {money(Math.min(received, grandTotal))}
                </Text>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: grandTotal - received > 0 ? colors.danger : colors.good }}>
                  Balance {money(Math.max(0, grandTotal - received))}
                </Text>
              </View>
            ) : null}
            <CheckoutButton
              label={method === 'credit'
                ? (received > 0
                  ? 'Take ' + money(Math.min(received, grandTotal)) + ' · owe ' + money(Math.max(0, grandTotal - received))
                  : 'Put ' + money(grandTotal) + ' on account')
                : 'Save · ' + money(grandTotal)}
              onPress={checkout}
              disabled={!cart.length || (method === 'credit' && !partyId)}
              loading={loading}
            />
          </View>
        }
      >
        <CheckoutSheet
          total={subtotal}
          money={money}
          method={method}
          onMethodChange={setMethod}
          methods={methods}
          onMethodsChange={setMethods}
          discount={discount}
          onDiscountChange={setDiscount}
          additionalCharges={additionalCharges}
          onAdditionalChargesChange={setAdditionalCharges}
          description={description}
          onDescriptionChange={setDescription}
          terms={terms}
          onTermsChange={setTerms}
          partyId={partyId}
          onPartyChange={setPartyId}
          parties={customers}
          received={received}
          onReceivedChange={setReceived}
          receivedVia={receivedVia}
          onReceivedViaChange={setReceivedVia}
          momoNetwork={momoNetwork}
          onMomoNetworkChange={setMomoNetwork}
          momoRef={momoRef}
          onMomoRefChange={setMomoRef}
          onCheckout={checkout}
          loading={loading}
          canCheckout={cart.length > 0 && (method !== 'credit' || !!partyId)}
        />
      </Sheet>
    </View>
  );
}

function MetaTile({ label, value, onPress, colors }: { label: string; value: string; onPress: () => void; colors: any }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label + ' ' + value}
      style={({ pressed }: { pressed: boolean }) => ({ flex: 1, backgroundColor: pressed ? colors.sunk : colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 11, paddingVertical: 9 })}
    >
      <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{label}</Text>
      <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink, marginTop: 3 }}>{value}</Text>
    </Pressable>
  );
}

function Segment({ label, active, activeBg, activeFg, colors, onPress }: {
  label: string; active: boolean; activeBg: string; activeFg: string; colors: any; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1, paddingVertical: 11, borderRadius: 11, alignItems: 'center', backgroundColor: active ? activeBg : 'transparent' }}>
      <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: active ? activeFg : colors.faint }}>{label}</Text>
    </Pressable>
  );
}

function TotalRow({ label, value, colors, tone }: { label: string; value: string; colors: any; tone?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.soft }}>{label}</Text>
      <Text style={{ fontFamily: fonts.mono, fontSize: 12.5, color: tone || colors.ink }}>{value}</Text>
    </View>
  );
}
