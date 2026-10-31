import { useSyncRun } from '../data/useSyncRun';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { docDefaults, defaultTermsFor } from '../data/docDefaults';
import { View, Text, TextInput, Platform, Alert } from 'react-native';
import ScrollView from '../components/KeyScroll';
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
import { isRestaurant } from '../data/restaurant';
import { editionOf } from '../data/editions';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { onItemCreatedForBill } from '../data/newItemBus';
import type { RootStackParamList } from '../nav/types';
import PriceListPicker from '../components/PriceListPicker';
import { priceFor, repriceLines } from '../data/priceLists';
import * as ImagePicker from 'expo-image-picker';
import { keepPhoto } from '../data/photos';
import FirstTimeTip from '../components/FirstTimeTip';
import { useConfirmLeave } from '../components/useConfirmLeave';
import { Product, PayMethod, SaleLine } from '../data/types';

type Props = NativeStackScreenProps<RootStackParamList, 'NewSale'>;

export default function NewSaleScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { db, money, stockOf, commitSale, editSale: editSaleTransaction, addParty, can, partyBalance, markEstimateConverted } = useAppData();
  const { takeSaleNumber } = useSyncRun();
  /** A quotation being turned into a sale: its lines fill the bill, to change before saving. */
  const fromQuote = db?.estimates.find((e) => e.id === route.params?.fromEstimateId && e.status === 'open');
  const editingSale = db?.sales.find((sale) => sale.id === route.params?.editSaleId);
  /** What the cart starts from: the sale being edited, or one being duplicated. */
  const seed = editingSale || db?.sales.find((sale) => sale.id === route.params?.copyFromId);
  /** Owner and manager are trusted with prices and discounts; everyone else follows Settings. */
  const trusted = db?.session.role === 'owner';
  const { success, error } = useToast();
  const who = useWho('Who served this sale?');
  useEffect(() => {
    if (isRestaurant(db) && !route.params?.editSaleId && !route.params?.fromEstimateId && !route.params?.copyFromId) navigation.replace('Order');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ownerPin = useOwnerPin();

  const [cart, setCart] = useState<SaleLine[]>(() => (seed || fromQuote) ? (seed || fromQuote)!.lines.map((line) => ({ ...line })) : []);
  // Settings → "Default payment"
  const [method, setMethod] = useState<PayMethod>(seed?.method || (db?.settings.defaultMethod as PayMethod) || 'cash');
  const [methods, setMethods] = useState<Array<{ method: PayMethod; amount: number }> | undefined>(editingSale?.methods);
  const [partyId, setPartyId] = useState<string | null>(seed?.partyId || fromQuote?.partyId || null);
  /* the customer's balance, worked out once per customer, not on every keystroke */
  const partyBal = useMemo(() => (partyId ? partyBalance(partyId) : 0), [partyId, db?.sales, db?.purchases]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [discount, setDiscount] = useState(seed?.discount || fromQuote?.discount || 0);
  const [additionalCharges, setAdditionalCharges] = useState(seed?.additionalCharges || 0);
  /** Tax on this bill: as set on each item, none at all, or the shop's rate on everything. */
  const [taxMode, setTaxMode] = useState<'items' | 'none' | 'added' | 'included'>(
    // a new bill starts with no tax; the cashier switches it on. A bill being changed keeps what it had.
    () => (seed && (seed.tax || 0) > 0 ? 'items' : 'none'));
  /** The customer keeps back withholding tax on this bill. */
  const [whtOn, setWhtOn] = useState(false);
  const [discPct, setDiscPct] = useState('');
  const [description, setDescription] = useState(editingSale?.note ?? (seed || fromQuote ? '' : docDefaults(db).description));
  const startTerms = defaultTermsFor(db, 'invoice');
  const [terms, setTerms] = useState(editingSale?.terms ?? startTerms.text);
  const [termsId, setTermsId] = useState<string | null>(editingSale ? null : startTerms.id);
  /** This invoice prints the shop's payment details (Documents & terms). */
  const [showPayment, setShowPayment] = useState(editingSale?.showPayment ?? docDefaults(db).paymentOnInvoice);
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
  const allowLeave = useConfirmLeave(navigation, cart.length > 0, editingSale ? 'these changes' : 'this sale');
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
  /** The price list the bill is priced from; null for each item's own price. */
  const [priceListId, setPriceListId] = useState<string | null>(editingSale?.priceListId || null);
  const priceList = (db?.priceLists || []).find((l) => l.id === priceListId) || null;
  function choosePriceList(id: string | null) {
    setPriceListId(id);
    const l = (db?.priceLists || []).find((x) => x.id === id) || null;
    // what is already on the bill is priced again from the new list
    setCart((prev) => repriceLines(prev, l, db?.products || []));
  }
  /** The prescription for the Rx-only drugs on this bill has been seen. */
  const [rxSeen, setRxSeen] = useState(false);
  const [rxOpen, setRxOpen] = useState(false);
  /* checkout runs again from a timer after the prescription is recorded, from a render that still
     held rxSeen false, so it opened the prescription a second time; the ref is current */
  const rxSeenRef = useRef(false);
  const [rxForm, setRxForm] = useState({ prescriber: '', number: '', patient: '', facility: '', location: '', diagnosis: '', photo: '' });
  /* any pharmacy sale may carry the prescription it was filled from — optional,
     asked once before checkout and skippable; prescription-only drugs still need the prescriber */
  const rxAsk = editionOf(db) === 'pharmacy';
  const rxNeeded = cart.some((l) => (db?.products || []).find((x) => x.id === l.productId)?.rxOnly);
  async function rxPhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { error('Allow the camera to photograph the prescription.'); return; }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.5 });
    if (!r.canceled && r.assets?.[0]?.uri) {
      const kept = await keepPhoto(r.assets[0].uri, 'rx');
      setRxForm((f) => ({ ...f, photo: kept }));
    }
  }
  function rxSkip() {
    setRxSeen(true);
    rxSeenRef.current = true;
    setRxOpen(false);
    setTimeout(checkout, 300);
  }
  function rxConfirm() {
    if (rxNeeded && !rxForm.prescriber.trim()) { error('Write who prescribed it — the doctor or clinician.'); return; }
    setRxSeen(true);
    rxSeenRef.current = true;
    setRxOpen(false);
    setTimeout(checkout, 300);
  }

  const customers = useMemo(() => (db?.parties || []).filter((p) => p.type === 'customer' && p.active), [db]);
  const selectedParty = partyId ? customers.find((p) => p.id === partyId) : undefined;

  const subtotal = cart.reduce((s, l) => s + l.qty * l.price, 0);
  const savings = cart.reduce((s, l) => s + l.qty * Math.max(0, (l.listPrice ?? l.price) - l.price), 0);
  const totalQty = cart.reduce((s, l) => s + l.qty, 0);
  // Worked out exactly as the sale will be posted, so the total on the button
  // is the total on the receipt — including tax added on top, where it is.
  const shopRate = Number(db?.settings.taxRate) || 0;
  const taxedLines = db?.settings.taxEnabled === false || taxMode === 'none' ? cart.map((l) => ({ ...l, taxRate: 0 }))
    : taxMode === 'added' || taxMode === 'included' ? cart.map((l) => ({ ...l, taxRate: l.taxRate || shopRate })) : cart;
  /* added: on top of the prices, so the total grows; included: inside them; otherwise as the shop is set */
  const inclusive = taxMode === 'added' ? false : taxMode === 'included' ? true : db ? pricesIncludeTax(db) : true;
  const priced = saleTotals(taxedLines, discount, inclusive);
  const taxOnTop = !inclusive ? priced.tax : 0;
  const grandTotal = Math.max(0, priced.total) + Math.max(0, additionalCharges);
  const whtRate = Number(db?.settings.whtRate ?? 6) || 0;
  const whtAmt = db?.settings.withholding && whtOn ? Math.round(Math.max(0, priced.total - priced.tax) * whtRate) / 100 : 0;

  /** Opens the item entry: blank, on a scanned item, or on a line to change. */
  /* an item made on the full item screen from this bill comes straight back as its next line */
  useEffect(() => onItemCreatedForBill((p) => openEntry(p)), []);   // eslint-disable-line react-hooks/exhaustive-deps

  function openEntry(p: Product | null, index: number | null = null) {
    setScanning(false);
    setEntryProduct(p);
    setEntryIndex(index);
    setEntryOpen(true);
  }
  const openProduct = (p: Product) => openEntry(p);

  function customerChosen(id: string | null) {
    setPartyId(id);
    // a customer with their own price list is priced from it straight away
    const own = id ? db?.parties.find((x) => x.id === id)?.priceListId : undefined;
    if (own && (db?.priceLists || []).some((l) => l.id === own && l.status === 'Active') && own !== priceListId) {
      choosePriceList(own);
      success('Priced from ' + (db?.priceLists || []).find((l) => l.id === own)?.name);
    }
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

  function saveEntry(e: EntryLine, andNew: boolean, more = false) {
    const line: SaleLine = {
      productId: e.product.id, name: e.product.name, sku: e.product.sku, unit: e.unit,
      qty: e.qty, price: e.price, listPrice: e.listPrice, discountPct: e.discountPct,
      cost: e.cost, taxRate: e.product.taxExempt ? 0 : e.product.taxRate || (db?.settings.taxEnabled === false ? 0 : Number((db?.settings as any)?.taxRate) || 0), batchNo: e.batchNo,
      ...(e.unitFactor !== 1 ? { unitFactor: e.unitFactor } : {}),
      ...(e.note ? { note: e.note } : {}),
      ...(e.serials ? { serials: e.serials, serialNo: e.serials[0]?.imei } : {}),
    };
    // a quantity spread over batches: the first part takes the line being changed, the rest are added
    const at = more ? null : entryIndex;
    setCart((prev) => {
      // a dish's choices are not edited here: they stay with it while it is the same dish
      if (at !== null) return prev.map((l, i) => (i === at ? (l.productId === line.productId && l.modifiers ? { ...line, modifiers: l.modifiers } : line) : l));
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

  /* QUICK SALE: the shop's best sellers of late, one tap for one more */
  const topItems = useMemo(() => {
    const sales = db?.sales || [];
    const count = new Map<string, number>();
    for (let i = sales.length - 1, seen = 0; i >= 0 && seen < 400; i--) {
      const s = sales[i];
      if (s.status === 'void') continue;
      seen++;
      s.lines.forEach((l) => count.set(l.productId, (count.get(l.productId) || 0) + 1));
    }
    const byId = new Map((db?.products || []).map((p) => [p.id, p]));
    return [...count.entries()].sort((a, b) => b[1] - a[1])
      .map(([id]) => byId.get(id)).filter((p): p is Product => !!p && p.active !== false).slice(0, 12);
  }, [db?.sales.length]);   // eslint-disable-line react-hooks/exhaustive-deps
  function quickAdd(p: Product) {
    // anything needing a batch, an IMEI or another unit goes through the full entry
    if (p.trackBatches || p.trackSerials) { openEntry(p); return; }
    const inCart = cart.filter((l) => l.productId === p.id).reduce((s, l) => s + l.qty * (l.unitFactor || 1), 0);
    const limit = db ? sellLimit(db, p, stockOf(p)) : Infinity;
    if (inCart + 1 > limit) { error(p.name + ' — only ' + Math.max(0, limit) + ' ' + p.unit + ' left.'); return; }
    const price = priceFor(priceList, p);
    setCart((prev) => {
      const i = prev.findIndex((l) => l.productId === p.id && !l.batchNo && !l.serials && l.price === price && l.unit === p.unit && !l.note);
      if (i >= 0) return prev.map((l, k) => (k === i ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, {
        productId: p.id, name: p.name, sku: p.sku, unit: p.unit, qty: 1, price, listPrice: price, cost: p.cost,
        taxRate: p.taxExempt ? 0 : p.taxRate || (db?.settings.taxEnabled === false ? 0 : Number((db?.settings as any)?.taxRate) || 0),
      }];
    });
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

    // a prescription-only drug: the counter confirms it has seen the prescription
    const rx = cart.filter((l) => productOf(l)?.rxOnly);
    if ((rx.length || rxAsk) && !rxSeen && !rxSeenRef.current) {
      // the prescription is recorded: who wrote it, its number, for whom, and a photo if there is one
      setRxOpen(true);
      return;
    }

    // Settings → "Biggest discount a cashier may give", on the bill as a whole
    if (!trusted && st && subtotal > 0 && discount > subtotal * (Number(st.maxDiscountPct) || 0) / 100) {
      ownerPin.ask(
        'Approve a discount wider than the cashier limit on this sale.',
        () => askCustomer(),
      );
      return;
    }

    // Settings → "Below cost": warn, block, or allow
    /* the line's own cost, or the item's when the line carries none (items made on the PC) */
    const costOf = (l: SaleLine) => l.cost || ((db?.products || []).find((x) => x.id === l.productId)?.cost || 0) * (l.unitFactor || 1);
    const under = cart.filter((l) => costOf(l) > 0 && l.price < costOf(l));
    const belowCost = (st as any)?.belowCost || 'warn';
    /* "Stop selling below cost" stops everyone, the owner too, as on the PC */
    if (under.length && belowCost === 'block') {
      error(under[0].name + ' is below its cost of ' + money(costOf(under[0])) + '. Selling below cost is switched off in Settings.');
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

    if (under.length && belowCost === 'warn' && !trusted) {
      ownerPin.ask(
        'Approve selling below cost for ' + under.map((l) => l.name).slice(0, 3).join(', ') + (under.length > 3 ? ' and others' : '') + '.',
        () => askCustomer(),
      );
      return;
    }
    askCustomer();
  }

  async function postSale(userId: string, userName: string) {
    setLoading(true);
    let taken: { no: string; drop: () => void } | null = null;
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
        allowLeave();
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
      // the number comes from the server, so every till follows one run; offline it is temporary until the next sync
      if (!invoiceNo.trim()) taken = await takeSaleNumber(db?.session.warehouse).catch(() => null);
      const sale = commitSale({
        lines: taxedLines, partyId, method, wht: whtAmt || undefined, taxOnTop: !inclusive,
        discount: discount + roundDown,
        additionalCharges: additionalCharges + roundUp,
        description, terms, showPayment,
        methods: splitMethods, no: invoiceNo.trim() || taken?.no || undefined, ts: invoiceAt.toISOString(),
        received: method === 'credit' ? received : undefined,
        receivedVia: method === 'credit' ? receivedVia : undefined,
        momoNetwork: (method === 'momo' || (method === 'credit' && receivedVia === 'momo')) ? momoNetwork : undefined,
        momoRef: (method === 'momo' || (method === 'credit' && receivedVia === 'momo')) ? momoRef : undefined,
        userId,
        priceListId: priceListId || undefined,
        ...(rxSeen && (rxForm.prescriber.trim() || rxForm.diagnosis.trim() || rxForm.facility.trim()) ? {
          rx: {
            prescriber: rxForm.prescriber.trim(), number: rxForm.number.trim() || undefined, patient: rxForm.patient.trim() || undefined,
            facility: rxForm.facility.trim() || undefined, photo: rxForm.photo || undefined,
            location: rxForm.location.trim() || undefined, diagnosis: rxForm.diagnosis.trim() || undefined,
            seenBy: userName, seenAt: new Date().toISOString(),
          },
        } : {}),
      });
      if (fromQuote) markEstimateConverted(fromQuote.id, sale.id);
      success((fromQuote ? fromQuote.no + ' became ' : '') + sale.no + ' · saved by ' + userName);
      setCart([]);
      setRxSeen(false);
      rxSeenRef.current = false;
      setRxForm({ prescriber: '', number: '', patient: '', facility: '', location: '', diagnosis: '', photo: '' });
      setMethod((db?.settings.defaultMethod as PayMethod) || 'cash');
      setMethods(undefined);
      setDiscount(0);
      setAdditionalCharges(0);
      setDescription(docDefaults(db).description);
      setTerms(startTerms.text); setTermsId(startTerms.id);
      setInvoiceNo('');
      setInvoiceAt(new Date());
      setReceived(0);
      setReceivedVia('cash');
      setMomoNetwork('mtn');
      setMomoRef('');
      setCheckoutVisible(false);
      allowLeave();
      navigation.replace('Receipt', { saleId: sale.id });
    } catch (e: any) {
      // The sale did not post. An alert sits above the open sheet, so this
      // cannot be scrolled past the way a banner could be.
      taken?.drop();
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
        <FirstTimeTip
          id="first-sale"
          when={!cart.length && !editingSale}
          title="Your first sale"
          text="Choose the customer (or Walk-in), then type an item's name or scan its barcode. Tap Checkout to take the money — the receipt prints and the stock goes out."
        />
        {fromQuote ? (
          <InfoBanner tone="accent" icon="doc" text={'From quotation ' + fromQuote.no + '. Change anything you need, then save — the quotation closes only once this sale is saved.'} />
        ) : null}
        {/* the document's details in one row: price list (when the shop has any), date and time, number */}
        <View style={{ flexDirection: 'row', backgroundColor: colors.surface, borderRadius: 4, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' }}>
          {/* always there: the shop chooses a price list for this sale, or keeps ordinary prices */}
          <PriceListPicker compact value={priceListId} onChange={choosePriceList} />
          <View style={{ width: 1, backgroundColor: colors.line }} />
          <Pressable onPress={() => setPickerMode('date')} style={{ flex: 1.15, minWidth: 0, paddingHorizontal: 10, paddingVertical: 8 }} accessibilityLabel="Date">
            <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint }}>Date</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink }}>
                {invoiceAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' })}
              </Text>
              <Pressable onPress={() => setPickerMode('time')} hitSlop={8}>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.accent }}>
                  {invoiceAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </Pressable>
            </View>
          </Pressable>
          <View style={{ width: 1, backgroundColor: colors.line }} />
          <View style={{ flex: 1, minWidth: 0, paddingHorizontal: 10, paddingVertical: 8 }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint }}>Invoice no.</Text>
            <TextInput
              value={invoiceNo}
              onChangeText={setInvoiceNo}
              placeholder={defaultInvoiceNo}
              placeholderTextColor={colors.faint}
              autoCapitalize="characters"
              accessibilityLabel="Invoice number, blank for the next in sequence"
              style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink, padding: 0, marginTop: 2 }}
            />
          </View>
        </View>

        {/* cash or credit */}
        <SegmentSlider
          value={method === 'credit' ? 'credit' : 'cash'}
          options={[{ v: 'cash', l: 'Cash sale', i: 'cash' }, { v: 'credit', l: 'Credit sale', i: 'user' }]}
          onChange={(v) => setMethod(v as PayMethod)}
          style={{ marginBottom: 0 }}
        />

        {/* the customer */}
        <View style={{ backgroundColor: colors.surface, borderRadius: 4, overflow: 'hidden', borderWidth: 1, borderColor: colors.line }}>
          <Pressable
            onPress={() => setPartyPickerVisible(true)}
            style={{ paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
                Customer{method === 'credit' ? ' · required' : ''}
              </Text>
              <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 14, color: selectedParty ? colors.ink : colors.soft, marginTop: 3 }}>
                {selectedParty?.name || 'Walk-in customer'}
              </Text>
              {selectedParty?.address ? (
                <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>{selectedParty.address}</Text>
              ) : null}
            </View>
            {selectedParty ? <BalanceTag balance={partyBal} money={money} /> : null}
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
              width: 56, borderRadius: 4, borderWidth: 1.4, borderColor: colors.line,
              alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.sunk : colors.surface,
            })}
          >
            <Icon name="barcode" size={24} color={colors.ink} />
          </Pressable>
        </View>

        {topItems.length ? (
          <View>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: colors.faint, marginBottom: 6 }}>Quick add · best sellers</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {topItems.map((p) => {
                const n = cart.filter((l) => l.productId === p.id).reduce((s, l) => s + l.qty, 0);
                return (
                  <Pressable key={p.id} onPress={() => quickAdd(p)} onLongPress={() => openEntry(p)} accessibilityLabel={'Add one ' + p.name}
                    style={({ pressed }: { pressed: boolean }) => ({
                      width: '31.8%', minHeight: 54, padding: 8, borderRadius: 4, borderWidth: 1.2,
                      borderColor: n ? colors.accent : colors.line, backgroundColor: pressed ? colors.sunk : n ? colors.accentSoft : colors.surface,
                    })}>
                    <Text numberOfLines={2} style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: colors.ink }}>{p.name}</Text>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 'auto' }}>
                      <Text numberOfLines={1} style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.faint }}>{money(priceFor(priceList, p))}</Text>
                      {n ? <Text style={{ fontFamily: fonts.uiBold, fontSize: 11, color: colors.accent }}>×{n}</Text> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        <BilledItems
          lines={cart.map((l) => {
            const short = productOf(l)?.trackSerials && (l.serials || []).length !== Math.floor(l.qty);
            return { ...l, warning: short ? 'IMEI ' + (l.serials || []).length + ' of ' + Math.floor(l.qty) + ' · tap to finish' : undefined };
          })}
          money={money}
          taxTotal={db?.settings.taxEnabled === false ? undefined : priced.tax}
          taxInclusive={inclusive}
          taxName={db?.settings.taxName || 'Tax'}
          onPress={(i) => openEntry(null, i)}
        />

        {/* tax, discount and charges for the bill as a whole, right under its lines */}
        {cart.length > 0 && (
          <View style={{ backgroundColor: colors.surface, borderRadius: 4, borderWidth: 1, borderColor: colors.line, padding: 12, gap: 10 }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: colors.faint, letterSpacing: 0.4 }}>TAX, DISCOUNT & CHARGES</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 0.7 }}>
                <Field label="Discount %" value={discPct} numeric decimal placeholder="0" style={{ marginBottom: 0 }}
                  onChangeText={(v) => { setDiscPct(v); const p = Math.min(100, Math.max(0, parseFloat(v) || 0)); setDiscount(Math.round(subtotal * p) / 100); }} />
              </View>
              <View style={{ flex: 1 }}>
                <Field label="Discount" value={discount ? String(discount) : ''} numeric decimal money placeholder="0" style={{ marginBottom: 0 }}
                  onChangeText={(v) => { const n = Math.min(subtotal, Math.max(0, parseFloat(v) || 0)); setDiscount(n); setDiscPct(subtotal ? String(Math.round((n / subtotal) * 1000) / 10) : ''); }} />
              </View>
            </View>
            <Field label="Additional charges" value={additionalCharges ? String(additionalCharges) : ''} numeric decimal money placeholder="0" style={{ marginBottom: 0 }}
              onChangeText={(v) => setAdditionalCharges(Math.max(0, parseFloat(v) || 0))} />
            {db?.settings.taxEnabled !== false ? (
              <View>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginBottom: 6 }}>{db?.settings.taxName || 'Tax'} on this bill</Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {([['items', 'As each item'], ['added', (db?.settings.taxName || 'Tax') + ' ' + shopRate + '% added'], ['included', 'Included'], ['none', 'No tax']] as const).map(([v, l]) => (
                    <Pressable key={v} onPress={() => setTaxMode(v)}
                      style={{ flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 4, borderWidth: 1.2,
                        borderColor: taxMode === v ? colors.accent : colors.line, backgroundColor: taxMode === v ? colors.accentSoft : colors.surface }}>
                      <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: taxMode === v ? colors.accent : colors.ink }}>{l}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
            {db?.settings.withholding ? (
              <Pressable onPress={() => setWhtOn((x) => !x)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}>
                <View style={{ width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: whtOn ? colors.accent : colors.lineHard, backgroundColor: whtOn ? colors.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                  {whtOn ? <Icon name="check" size={13} color={colors.accentInk} /> : null}
                </View>
                <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 13, color: colors.ink }}>Less WHT {whtRate}% — the customer keeps it back</Text>
                {whtAmt ? <Text style={{ fontFamily: fonts.monoSemi, fontSize: 13, color: colors.danger }}>− {money(whtAmt)}</Text> : null}
              </Pressable>
            ) : null}
            <View style={{ height: 1, backgroundColor: colors.line }} />
            <View style={{ gap: 4 }}>
              <TotalRow label="Subtotal" value={money(subtotal)} colors={colors} />
              {discount > 0 ? <TotalRow label="Discount" value={'− ' + money(discount)} tone={colors.good} colors={colors} /> : null}
              {priced.tax > 0 ? <TotalRow label={(db?.settings.taxName || 'Tax') + (taxOnTop > 0 ? ' added' : ' included')} value={(taxOnTop > 0 ? '+ ' : '') + money(priced.tax)} colors={colors} /> : null}
              {additionalCharges > 0 ? <TotalRow label="Charges" value={'+ ' + money(additionalCharges)} colors={colors} /> : null}
              {whtAmt > 0 ? <TotalRow label={'WHT ' + whtRate + '% kept back'} value={'− ' + money(whtAmt)} tone={colors.danger} colors={colors} /> : null}
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
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 18, color: colors.ink }}>{money(grandTotal - whtAmt)}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button label="Clear" disabled={!cart.length} onPress={() => { setCart([]); setDiscount(0); setAdditionalCharges(0); }} />
          </View>
          <View style={{ flex: 2 }}>
            <Button
              label="View cart"
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
        priceOf={(p) => priceFor(priceList, p)}
        start={entryIndex !== null && cart[entryIndex] ? {
          productId: cart[entryIndex].productId, qty: cart[entryIndex].qty, unit: cart[entryIndex].unit,
          listPrice: cart[entryIndex].listPrice ?? cart[entryIndex].price, discountPct: cart[entryIndex].discountPct,
          note: cart[entryIndex].note, batchNo: cart[entryIndex].batchNo, serials: cart[entryIndex].serials,
        } : null}
        startProduct={entryProduct}
        maxFor={maxFor}
        trackBatches
        trackImei
        blockExpired
        // The owner and managers are never limited; cashiers follow Settings.
        // role first ("Change prices at the till", "Give discounts"), then the till settings
        editRate={trusted || can('sales.price_edit') || db?.settings.allowPriceEdit === true}
        maxDiscountPct={!can('sales.discount') ? 0 : trusted ? 100 : Number(db?.settings.maxDiscountPct ?? 100)}
        belowCost={db?.settings.belowCost === 'block' ? 'block' : trusted ? 'allow' : (db?.settings.belowCost || 'warn')}
        canCreate={newItem.canCreate}
        units={newItem.units}
        onCreateProduct={newItem.create}
        onOpenItemForm={(typed) => { setEntryOpen(false); navigation.navigate('ProductDetail', { name: typed, forBill: true }); }}
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
        subtitle={totalQty + ' item' + (totalQty === 1 ? '' : 's') + (selectedParty ? ' · ' + selectedParty.name : '')}
        icon="receipt"
        full
        onClose={() => setCheckoutVisible(false)}
        footer={
          <View>
            <CheckoutButton
              label="Save"
              onPress={checkout}
              disabled={!cart.length || (method === 'credit' && !partyId)}
              loading={loading}
            />
          </View>
        }
      >
        <Sheet
          visible={rxOpen}
          title="Prescription"
          subtitle={rxNeeded ? cart.filter((l) => productOf(l)?.rxOnly).map((l) => l.name).join(', ') + ' — prescription only' : 'Optional — for the Prescriptions reports'}
          icon="shield"
          iconTone="warn"
          full
          onClose={() => setRxOpen(false)}
          footer={<View style={{ flexDirection: 'row', gap: 10 }}>
            {!rxNeeded && <View style={{ flex: 1 }}><Button label="Skip" onPress={rxSkip} /></View>}
            <View style={{ flex: 1 }}><Button variant="pri" label="Recorded — continue" onPress={rxConfirm} /></View>
          </View>}
        >
          <InfoBanner tone={rxNeeded ? 'warn' : 'accent'} icon="alert" text={rxNeeded ? 'Check the prescription, then record it. It is kept with the sale and listed in the Prescription register.' : 'Where the patient was seen, by whom and for what. Nothing here is required — Skip if there is no prescription.'} />
          <View style={{ height: 12 }} />
          <Field label={rxNeeded ? 'Prescribed by (doctor or clinician) *' : 'Doctor'} value={rxForm.prescriber} onChangeText={(v) => setRxForm({ ...rxForm, prescriber: v })} />
          <Field label="Prescription number" value={rxForm.number} onChangeText={(v) => setRxForm({ ...rxForm, number: v })} />
          <Field label="Patient" value={rxForm.patient} onChangeText={(v) => setRxForm({ ...rxForm, patient: v })} placeholder={selectedParty?.name || 'Name of the patient'} />
          <Field label="Diagnosis" value={rxForm.diagnosis} onChangeText={(v) => setRxForm({ ...rxForm, diagnosis: v })} placeholder="What the patient is treated for" />
          <Field label="Hospital or clinic" value={rxForm.facility} onChangeText={(v) => setRxForm({ ...rxForm, facility: v })} />
          <Field label="Where it is" value={rxForm.location} onChangeText={(v) => setRxForm({ ...rxForm, location: v })} placeholder="Town or area" />
          <Button label={rxForm.photo ? 'Photo taken — take again' : 'Photograph the prescription'} icon={<Icon name="camera" size={16} color={colors.ink} />} onPress={rxPhoto} />
        </Sheet>

        <CheckoutSheet
          total={subtotal}
          tax={db?.settings.taxEnabled === false ? 0 : priced.tax}
          taxAdded={taxOnTop > 0}
          taxName={db?.settings.taxName || 'Tax'}
          less={whtAmt}
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
          termsId={termsId}
          onTermsChoose={(id, text) => { setTermsId(id); setTerms(text); }}
          showPayment={docDefaults(db).paymentDetails ? showPayment : undefined}
          onShowPaymentChange={setShowPayment}
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
      style={({ pressed }: { pressed: boolean }) => ({ flex: 1, backgroundColor: pressed ? colors.sunk : colors.surface, borderRadius: 4, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 11, paddingVertical: 9 })}
    >
      <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{label}</Text>
      <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink, marginTop: 3 }}>{value}</Text>
    </Pressable>
  );
}

function Segment({ label, active, activeBg, activeFg, colors, onPress }: {
  label: string; active: boolean; activeBg: string; activeFg: string; colors: any; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1, paddingVertical: 11, borderRadius: 4, alignItems: 'center', backgroundColor: active ? activeBg : 'transparent' }}>
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
