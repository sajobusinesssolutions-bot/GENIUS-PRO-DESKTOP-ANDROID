import React, { useEffect, useMemo, useState } from 'react';
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
import CheckoutSheet, { CheckoutButton } from '../components/CheckoutSheet';
import ItemEntrySheet, { EntryLine, useNewItem } from '../components/ItemEntrySheet';
import BilledItems from '../components/BilledItems';
import { CustomerPickerSheet, CustomerFormSheet, BalanceTag } from '../components/CustomerSheets';
import { useWho } from '../components/WhoSheet';
import { useOwnerPin } from '../components/OwnerPin';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';
import { Product, PayMethod, SaleLine } from '../data/types';

type Props = NativeStackScreenProps<RootStackParamList, 'NewSale'>;

export default function NewSaleScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { db, money, stockOf, commitSale, editSale: editSaleTransaction, addParty, can, partyBalance } = useAppData();
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

  const [scanning, setScanning] = useState(false);
  /** The cart line whose IMEIs are being entered. */
  const [imeiFor, setImeiFor] = useState<number | null>(null);
  /** The item entry: open, on which line (null for a new one), and on which item. */
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryIndex, setEntryIndex] = useState<number | null>(null);
  const [entryProduct, setEntryProduct] = useState<Product | null>(null);
  const newItem = useNewItem('price');
  const [partyPickerVisible, setPartyPickerVisible] = useState(false);
  const [customerFormVisible, setCustomerFormVisible] = useState(false);
  const [metaVisible, setMetaVisible] = useState(false);
  const [metaField, setMetaField] = useState<'no' | 'date' | 'time'>('no');
  const [pickerMode, setPickerMode] = useState<'date' | 'time' | null>(null);
  const [checkoutVisible, setCheckoutVisible] = useState(false);

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

  /** Opens the item entry: blank, on a scanned item, or on a line to change. */
  function openEntry(p: Product | null, index: number | null = null) {
    setScanning(false);
    setEntryProduct(p);
    setEntryIndex(index);
    setEntryOpen(true);
  }
  const openProduct = (p: Product) => openEntry(p);

  // a new sale is typed in order: the customer, then the first item
  useEffect(() => {
    if (seed) return;
    const t = setTimeout(() => setPartyPickerVisible(true), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function customerChosen(id: string | null) {
    setPartyId(id);
    if (!cart.length) setTimeout(() => openEntry(null), 350);
  }

  /**
   * What is left of an item for this line: the stock limit less what the
   * other lines of this bill already take, all in the item's main unit.
   */
  function maxFor(p: Product, batchNo?: string) {
    const others = cart.reduce((s, l, i) => (i !== entryIndex && l.productId === p.id && (!batchNo || l.batchNo === batchNo)
      ? s + l.qty * (l.unitFactor || 1) : s), 0);
    const base = batchNo
      ? (p.batches || []).find((b) => b.no === batchNo)?.qty ?? 0
      : db ? sellLimit(db, p, stockOf(p)) : stockOf(p);
    return base - others;
  }

  function saveEntry(e: EntryLine, andNew: boolean) {
    const line: SaleLine = {
      productId: e.product.id, name: e.product.name, sku: e.product.sku, unit: e.unit,
      qty: e.qty, price: e.price, listPrice: e.listPrice, discountPct: e.discountPct,
      cost: e.cost, taxRate: e.product.taxRate, batchNo: e.batchNo,
      ...(e.unitFactor !== 1 ? { unitFactor: e.unitFactor } : {}),
      ...(e.note ? { note: e.note } : {}),
      ...(e.serials ? { serials: e.serials, serialNo: e.serials[0]?.imei } : {}),
    };
    const at = entryIndex;
    setCart((prev) => {
      if (at !== null) return prev.map((l, i) => (i === at ? line : l));
      // the same item at the same rate adds to its line, unless each unit has its own IMEI
      const same = e.serials ? -1 : prev.findIndex((l) => l.productId === line.productId && l.batchNo === line.batchNo
        && l.unit === line.unit && l.price === line.price && !l.serials && (l.note || '') === (line.note || ''));
      if (same >= 0) return prev.map((l, i) => (i === same ? { ...l, qty: l.qty + line.qty } : l));
      return [...prev, line];
    });
    setEntryIndex(null);
    setEntryProduct(null);
    if (!andNew) setEntryOpen(false);
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
            {selectedParty ? <BalanceTag balance={partyBalance(selectedParty.id)} money={money} /> : null}
            <Icon name="chev" size={18} color={colors.faint} />
          </Pressable>
          {method === 'credit' && !partyId ? (
            <View style={{ paddingHorizontal: 14, paddingVertical: 9, backgroundColor: colors.warnSoft }}>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.warn }}>Pick a customer to record a credit sale.</Text>
            </View>
          ) : null}
        </View>

        {/* Items: add first, then a card per line, then what it all comes to */}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button label={cart.length ? 'Add another item' : 'Add item'} variant="pri" icon={<Icon name="plus" size={16} color={colors.accentInk} />} onPress={() => openEntry(null)} />
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

        <BilledItems
          lines={cart.map((l) => {
            const short = productOf(l)?.trackSerials && (l.serials || []).length !== Math.floor(l.qty);
            return { ...l, warning: short ? 'IMEI ' + (l.serials || []).length + ' of ' + Math.floor(l.qty) + ' · tap to finish' : undefined };
          })}
          money={money}
          taxTotal={db?.settings.taxEnabled === false ? undefined : priced.tax}
          onPress={(i) => openEntry(null, i)}
        />

        {cart.length > 0 && (
          <View style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, paddingVertical: 12 }}>
          <View style={{ gap: 8 }}>
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

      <ItemEntrySheet
        visible={entryOpen}
        title={entryIndex !== null ? 'Edit Item' : 'Add Items to Sale'}
        products={db?.products || []}
        money={money}
        stockOf={stockOf}
        priceOf={(p) => p.price}
        start={entryIndex !== null && cart[entryIndex] ? {
          productId: cart[entryIndex].productId, qty: cart[entryIndex].qty, unit: cart[entryIndex].unit,
          listPrice: cart[entryIndex].listPrice ?? cart[entryIndex].price, discountPct: cart[entryIndex].discountPct,
          note: cart[entryIndex].note, batchNo: cart[entryIndex].batchNo, serials: cart[entryIndex].serials,
        } : null}
        startProduct={entryProduct}
        maxFor={maxFor}
        trackBatches
        trackImei
        // The owner and managers are never limited; cashiers follow Settings.
        // role first ("Change prices at the till", "Give discounts"), then the till settings
        editRate={trusted || can('sales.price_edit') || db?.settings.allowPriceEdit === true}
        maxDiscountPct={!can('sales.discount') ? 0 : trusted ? 100 : Number(db?.settings.maxDiscountPct ?? 100)}
        canCreate={newItem.canCreate}
        units={newItem.units}
        onCreateProduct={newItem.create}
        takenImeis={cart.flatMap((l, i) => (i === entryIndex ? [] : (l.serials || []).flatMap((x) => [x.imei, x.imei2 || ''].filter(Boolean))))}
        onSave={saveEntry}
        onRemove={() => {
          const at = entryIndex;
          setCart((prev) => prev.filter((_, i) => i !== at));
          setEntryIndex(null);
          setEntryOpen(false);
        }}
        onClose={() => { setEntryOpen(false); setEntryIndex(null); setEntryProduct(null); }}
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

      <CustomerPickerSheet
        visible={partyPickerVisible}
        customers={customers}
        selectedId={partyId}
        onSelect={customerChosen}
        balanceOf={partyBalance}
        money={money}
        onCreate={() => { setPartyPickerVisible(false); setCustomerFormVisible(true); }}
        onClose={() => setPartyPickerVisible(false)}
      />

      <CustomerFormSheet
        visible={customerFormVisible}
        onClose={() => setCustomerFormVisible(false)}
        onSave={(p) => {
          const created = addParty(p);
          customerChosen(created.id);
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
