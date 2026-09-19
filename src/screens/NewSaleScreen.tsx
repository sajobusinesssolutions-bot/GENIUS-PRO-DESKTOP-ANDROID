import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Platform, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { saleTotals, pricesIncludeTax, sellLimit } from '../data/logic';
import { Button, Field, InfoBanner } from '../components/ui';
import { Icon } from '../components/icons';
import Sheet from '../components/Sheet';
import { useToast } from '../components/Toast';
import BarcodeScannerModal from '../components/BarcodeScannerModal';
import BatchPicker from '../components/BatchPicker';
import CheckoutSheet, { CheckoutButton } from '../components/CheckoutSheet';
import QtyPicker from '../components/QtyPicker';
import ItemSearchSheet from '../components/ItemSearchSheet';
import LineEditSheet from '../components/LineEditSheet';
import { CustomerPickerSheet, CustomerFormSheet } from '../components/CustomerSheets';
import { useWho } from '../components/WhoSheet';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';
import { Product, ProductBatch, PayMethod, SaleLine } from '../data/types';
import { liveBatches } from '../data/batches';

type Props = NativeStackScreenProps<RootStackParamList, 'NewSale'>;

export default function NewSaleScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { db, money, stockOf, commitSale, addParty } = useAppData();
  /** Owner and manager are trusted with prices and discounts; everyone else follows Settings. */
  const trusted = db?.session.role === 'owner' || db?.session.role === 'manager';
  const { success, error } = useToast();
  const who = useWho('Who served this sale?');

  const [cart, setCart] = useState<SaleLine[]>([]);
  // Settings → "Default payment"
  const [method, setMethod] = useState<PayMethod>((db?.settings.defaultMethod as PayMethod) || 'cash');
  const [methods, setMethods] = useState<Array<{ method: PayMethod; amount: number }>>();
  const [partyId, setPartyId] = useState<string | null>(null);
  const [discount, setDiscount] = useState(0);
  const [additionalCharges, setAdditionalCharges] = useState(0);
  const [description, setDescription] = useState('');
  const [terms, setTerms] = useState('');
  const [loading, setLoading] = useState(false);
  /** What the customer actually hands over on a credit sale. */
  const [received, setReceived] = useState(0);
  const [receivedVia, setReceivedVia] = useState<'cash' | 'momo' | 'bank'>('cash');

  const defaultInvoiceNo = 'INV-' + String(100000 + (db?.counters?.sale || 0) + 1).slice(1);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceAt, setInvoiceAt] = useState(() => new Date());

  const [searchVisible, setSearchVisible] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [qtyPickerVisible, setQtyPickerVisible] = useState(false);
  const [batchPickerVisible, setBatchPickerVisible] = useState(false);
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

  function checkout() {
    if (!cart.length || (method === 'credit' && !partyId)) return;
    const st = db?.settings;

    // Settings → "Biggest discount a cashier may give", on the bill as a whole
    if (!trusted && st && subtotal > 0 && discount > subtotal * (Number(st.maxDiscountPct) || 0) / 100) {
      Alert.alert('Discount too large', 'The most you can take off is ' + st.maxDiscountPct + '% of the bill. Ask a manager to give more.');
      return;
    }

    // Settings → "Below cost": warn, block, or allow
    const under = cart.filter((l) => l.cost > 0 && l.price < l.cost);
    const belowCost = (st as any)?.belowCost || 'warn';
    if (under.length && belowCost === 'block' && !trusted) {
      Alert.alert('Selling below cost', under[0].name + ' is priced under what it costs. A manager has to approve that.');
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
      Alert.alert(
        'Selling below cost',
        under.map((l) => l.name).slice(0, 3).join(', ') + (under.length > 3 ? ' and others' : '') + ' will sell for less than they cost.',
        [{ text: 'Go back', style: 'cancel' }, { text: 'Sell anyway', onPress: askCustomer }],
      );
      return;
    }
    askCustomer();
  }

  function postSale(userId: string, userName: string) {
    setLoading(true);
    try {
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

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 14, paddingBottom: 190 + insets.bottom, gap: 12 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Invoice meta — every tile is tappable to edit. */}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <MetaTile
            label="Invoice no."
            value={invoiceNo.trim() || defaultInvoiceNo}
            onPress={() => { setMetaField('no'); setMetaVisible(true); }}
            colors={colors}
          />
          <MetaTile
            label="Date"
            value={invoiceAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}
            onPress={() => setPickerMode('date')}
            colors={colors}
          />
          <MetaTile
            label="Time"
            value={invoiceAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            onPress={() => setPickerMode('time')}
            colors={colors}
          />
        </View>

        {/* Payment terms */}
        <View style={{ flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 4, gap: 4 }}>
          <Segment label="Cash sale" active={method === 'cash'} activeBg={colors.goodSoft} activeFg={colors.good} colors={colors} onPress={() => setMethod('cash')} />
          <Segment label="Credit sale" active={method === 'credit'} activeBg={colors.accentSoft} activeFg={colors.accent} colors={colors} onPress={() => setMethod('credit')} />
        </View>

        {/* Parties */}
        <View style={{ backgroundColor: colors.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2 }}>
          <View style={{ paddingHorizontal: 14, paddingVertical: 11, backgroundColor: colors.sunk, borderBottomWidth: 1, borderBottomColor: colors.line }}>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 12, color: colors.soft, letterSpacing: 0.4 }}>BILL DETAILS</Text>
          </View>
          <View style={{ paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>From</Text>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink, marginTop: 3 }}>{db?.firm?.name || 'Your business'}</Text>
          </View>
          <Pressable
            onPress={() => setPartyPickerVisible(true)}
            style={{ paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>
                Customer{method === 'credit' ? ' · required' : ''}
              </Text>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: selectedParty ? colors.ink : colors.faint, marginTop: 3 }}>
                {selectedParty?.name || 'Walk-in customer'}
              </Text>
              {selectedParty?.address ? (
                <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 2 }}>{selectedParty.address}</Text>
              ) : null}
            </View>
            <Icon name="chev" size={18} color={colors.faint} />
          </Pressable>
          {method === 'credit' && !partyId ? (
            <View style={{ paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.warnSoft }}>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11.5, color: colors.warn }}>Pick a customer to record a credit sale.</Text>
            </View>
          ) : null}
        </View>

        {/* Items */}
        <View style={{ backgroundColor: colors.surface, borderRadius: 16, overflow: 'hidden', shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2 }}>
          <View style={{ paddingHorizontal: 14, paddingVertical: 11, backgroundColor: colors.sunk, borderBottomWidth: 1, borderBottomColor: colors.line, flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 12, color: colors.soft, letterSpacing: 0.4 }}>ITEMS</Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>
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
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 12, color: colors.accent }}>{idx + 1}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 14.5, color: colors.ink }}>{line.name}</Text>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 2 }}>
                    {line.qty} {line.unit} × {money(line.price)}
                    {disc > 0 ? ' · ' + disc + '% off' : ''}
                  </Text>
                  {line.batchNo ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 }}>
                      <Icon name="box" size={12} color={colors.accent} />
                      <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 11.5, color: colors.accent }}>
                        Batch {line.batchNo}
                        {batchExpiryOf(line) ? ' · exp ' + batchExpiryOf(line) : ''}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <Text style={{ fontFamily: fonts.monoSemi, fontSize: 14, color: colors.ink }}>{money(line.qty * line.price)}</Text>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 10, color: colors.accent }}>Tap to edit</Text>
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

          {!cart.length && (
            <View style={{ paddingVertical: 30, alignItems: 'center', gap: 6 }}>
              <Icon name="cart" size={26} color={colors.faint} />
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.faint }}>No items on this bill yet</Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint }}>Search the catalogue or scan a barcode.</Text>
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 10, padding: 12 }}>
            <View style={{ flex: 2 }}>
              <Button label="Add item" variant="pri" icon={<Icon name="plus" size={16} color={colors.accentInk} />} onPress={() => setSearchVisible(true)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Scan" icon={<Icon name="box" size={16} color={colors.ink} />} onPress={() => setScanning(true)} />
            </View>
          </View>
        </View>

        {/* Totals */}
        {cart.length > 0 && (
          <View style={{ backgroundColor: colors.surface, borderRadius: 16, padding: 16, gap: 10, shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2 }}>
            <TotalRow label="Subtotal" value={money(subtotal)} colors={colors} />
            {savings > 0 ? <TotalRow label="Item discounts" value={'− ' + money(savings)} tone={colors.good} colors={colors} /> : null}
            {discount > 0 ? <TotalRow label="Bill discount" value={'− ' + money(discount)} tone={colors.good} colors={colors} /> : null}
            {additionalCharges > 0 ? <TotalRow label="Additional charges" value={'+ ' + money(additionalCharges)} colors={colors} /> : null}
            {taxOnTop > 0 ? <TotalRow label={(db?.settings.taxName || 'Tax') + ' added'} value={'+ ' + money(taxOnTop)} colors={colors} /> : null}
            <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 3 }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>Amount due</Text>
              <Text style={{ fontFamily: fonts.uiExtra, fontSize: 26, color: colors.ink }}>{money(grandTotal)}</Text>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Sticky action bar */}
      <View style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line,
        paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10 + insets.bottom, gap: 10,
      }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{totalQty} item{totalQty === 1 ? '' : 's'}</Text>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 21, color: colors.ink }}>{money(grandTotal)}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button label="Clear" disabled={!cart.length} onPress={() => { setCart([]); setDiscount(0); setAdditionalCharges(0); }} />
          </View>
          <View style={{ flex: 2 }}>
            <Button
              label="Review & save"
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

      <QtyPicker
        visible={qtyPickerVisible}
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
        // The owner and managers are never limited; cashiers follow Settings.
        canEditPrice={trusted || db?.settings.allowPriceEdit !== false}
        maxDiscountPct={trusted ? 100 : Number(db?.settings.maxDiscountPct ?? 100)}
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
          onChange={(_e, d) => {
            setPickerMode(null);
            if (d) setInvoiceAt(d);
          }}
        />
      ) : null}

      {who.sheet}

      <Sheet
        visible={checkoutVisible}
        title="Review & save"
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
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 13.5, color: grandTotal - received > 0 ? colors.danger : colors.good }}>
                  Balance {money(Math.max(0, grandTotal - received))}
                </Text>
              </View>
            ) : null}
            <CheckoutButton
              label={method === 'credit'
                ? (received > 0
                  ? 'Take ' + money(Math.min(received, grandTotal)) + ' · owe ' + money(Math.max(0, grandTotal - received))
                  : 'Put ' + money(grandTotal) + ' on account')
                : 'Complete sale · ' + money(grandTotal)}
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
    <Pressable onPress={onPress} style={{ flex: 1, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 11, paddingVertical: 9 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 10.5, color: colors.faint }}>{label}</Text>
        <Icon name="pencil" size={11} color={colors.accent} />
      </View>
      <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 14.5, color: colors.ink, marginTop: 4 }}>{value}</Text>
    </Pressable>
  );
}

function Segment({ label, active, activeBg, activeFg, colors, onPress }: {
  label: string; active: boolean; activeBg: string; activeFg: string; colors: any; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1, paddingVertical: 11, borderRadius: 11, alignItems: 'center', backgroundColor: active ? activeBg : 'transparent' }}>
      <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: active ? activeFg : colors.faint }}>{label}</Text>
    </Pressable>
  );
}

function TotalRow({ label, value, colors, tone }: { label: string; value: string; colors: any; tone?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint }}>{label}</Text>
      <Text style={{ fontFamily: fonts.monoSemi, fontSize: 13, color: tone || colors.ink }}>{value}</Text>
    </View>
  );
}
