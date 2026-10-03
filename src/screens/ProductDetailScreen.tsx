/**
 * New / edit item — the full-screen item editor (redesign 3a / 3b).
 *
 *  - Basics opens with a Product / Service switch, so the kind is chosen first
 *    and can still be changed.
 *  - Products get two small "Track" chips (Batches, IMEI / serial) right under
 *    the switch; their editors live on the Stock tab.
 *  - Four tabs: Basics · Price · Stock (Delivery for a service) · More.
 *  - Save is pinned on every tab. Only the name is required; a missing name
 *    jumps back to Basics and marks the field. A row of summary chips above the
 *    buttons shows what will be saved.
 *  - The second unit, previously on both Pricing and Stock, is now in one place
 *    (Price). The batch toggle, previously on Basics and Stock, is one state
 *    driven from both the chip and the Stock tab.
 *
 * The second unit's own math is kept exactly as LineEditSheet.tsx's unitsFor()
 * already expects it, not re-derived here: `unit` is the item's own selling
 * unit and `price` is set for it, `secondaryUnit` is a smaller breakdown (a
 * piece off a carton), and `conversionRate` is how many of those fit in one
 * `unit` — so the secondary price is the main price divided down. Asking the
 * other way round, or multiplying, would price a carton at a fraction of a
 * piece the moment nobody types an explicit override.
 *
 * Every field, sheet and rule from the previous editor is kept.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Alert, TextInput, Image } from 'react-native';
import { Pressable } from '../components/Press';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useToast } from '../components/Toast';
import {
  Card, Cap, Button, Grid, KV, Pill, ChipStrip, TopTabs,
  TypeChips, HighlightToggle, InfoBanner,
  Field, SelectField, ChipRow, ActionChip, FieldNote, ToggleRow, Swatch, Seg, Sw,
} from '../components/ui';
import { Icon, CAT_ICON, IconName } from '../components/icons';
import { Sheet } from '../components/Sheet';
import { Foot } from '../components/AppBar';
import BarcodeScannerModal from '../components/BarcodeScannerModal';
import * as ImagePicker from 'expo-image-picker';
import { keepPhoto } from '../data/photos';
import { ITEM_COLOR, ITEM_EMOJI, SERVICE_RATE } from '../data/defaults';
import type { Product, ProductBatch, ProductKind, ServiceRate, SerialInfo } from '../data/types';
import BatchEditor from '../components/BatchEditor';
import SerialEditor from '../components/SerialEditor';
import SegmentSlider from '../components/SegmentSlider';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'ProductDetail'>;
type Tab = 'basics' | 'pricing' | 'stock' | 'more';

const num = (v: string) => Number(String(v).replace(/[^0-9.\-]/g, '')) || 0;

/** Reference makeBarcode() — 13 digits, ours starts 62 like the prototype's. */
function makeBarcode(): string {
  let s = '62';
  for (let i = 0; i < 11; i++) s += Math.floor(Math.random() * 10);
  return s;
}

/** Reference marginCard(cost, price), line 7015. */
function MarginCard({ cost, price }: { cost: number; price: number }) {
  const { colors } = useTheme();
  const { money } = useAppData();
  const m = price ? Math.round((price - cost) / price * 100) : 0;
  const profit = price - cost;
  const tone = !price ? colors.sunk : m < 10 ? colors.dangerSoft : m < 25 ? colors.warnSoft : colors.goodSoft;
  const fg = !price ? colors.soft : m < 10 ? colors.danger : m < 25 ? colors.warn : colors.good;
  return (
    <View style={{
      backgroundColor: tone, borderRadius: radius.md, padding: 12, marginBottom: 12,
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    }}>
      <View>
        <Cap style={{ color: fg }}>Profit on each one</Cap>
        <Text style={{ fontFamily: fonts.monoSemi, fontSize: 15, color: fg, marginTop: 3 }}>{money(profit)}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Cap style={{ color: fg }}>Margin</Cap>
        <Text style={{ fontFamily: fonts.monoSemi, fontSize: 15, color: fg, marginTop: 3 }}>{m}%</Text>
      </View>
    </View>
  );
}

function SectionCap({ children, style }: { children: React.ReactNode; style?: any }) {
  return <Cap style={[{ marginTop: 4, marginBottom: 8 }, style]}>{children}</Cap>;
}

/** `.scanbox` / `.scanline` — reference SHEETS.scanBarcode, line 9399. */
function ScanBox() {
  const { colors } = useTheme();
  return (
    <View style={{
      height: 128, borderRadius: radius.lg, backgroundColor: colors.sunk,
      borderWidth: 1, borderColor: colors.lineHard, alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden', marginBottom: 12,
    }}>
      <View style={{ position: 'absolute', left: 18, right: 18, height: 2, backgroundColor: colors.danger, opacity: 0.8 }} />
      <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>Point the camera at the barcode</Text>
    </View>
  );
}

/** A small on/off chip — the "Track" line under the kind switch. */
function TrackChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={{
        paddingVertical: 6, paddingHorizontal: 11, borderRadius: radius.pill,
        backgroundColor: on ? colors.accentSoft : colors.surface,
        borderWidth: 1, borderColor: on ? colors.accent : colors.line,
      }}
    >
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: on ? colors.accent : colors.soft }}>
        {(on ? '✓ ' : '+ ') + label}
      </Text>
    </Pressable>
  );
}

/** Summary chip above the save buttons. */
function SumChip({ label, on }: { label: string; on: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ paddingVertical: 4, paddingHorizontal: 8, borderRadius: radius.pill, backgroundColor: on ? colors.goodSoft : colors.sunk }}>
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: on ? colors.good : colors.faint }}>{label}</Text>
    </View>
  );
}

export default function ProductDetailScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const ctx = useAppData();
  const { db, product, updateProduct, addProduct, money, can, addUnit, addCategory } = ctx;
  const { error } = useToast();
  const existing = route.params?.productId ? product(route.params.productId) : undefined;

  /* ---- the form, reference UI.itemForm seeded by A.newItem / A.editItem ---- */
  const [tab, setTab] = useState<Tab>('basics');
  const [nameErr, setNameErr] = useState(false);
  const [kind, setKind] = useState<ProductKind>(existing?.kind || 'product');
  const [name, setName] = useState(existing?.name || '');
  const [sku, setSku] = useState(existing?.sku || '');
  const [unit, setUnit] = useState(existing?.unit || 'PC');
  // no category is picked for the owner: they choose one, or make their own
  const [category, setCategory] = useState(existing?.category || '');
  const [description, setDescription] = useState(existing?.description || '');
  const [barcodes, setBarcodes] = useState<string[]>(existing?.barcodes || []);
  const [image, setImage] = useState(existing?.emoji || existing?.image || '📦');
  const [color, setColor] = useState(existing?.color || '');

  const [cost, setCost] = useState(String(existing?.cost ?? ''));
  const [price, setPrice] = useState(String(existing?.price ?? ''));
  const [taxRate, setTaxRate] = useState(existing ? String(existing.taxRate ?? '') : '');
  const [taxExempt, setTaxExempt] = useState(!!existing?.taxExempt);
  /** A real photo taken or chosen from the gallery; falls back to the emoji. */
  const [photo, setPhoto] = useState(existing?.photo || '');
  const [secondaryUnit, setSecondaryUnit] = useState(existing?.secondaryUnit || '');
  const [conversionRate, setConversionRate] = useState(String(existing?.conversionRate || ''));
  const [secondaryPrice, setSecondaryPrice] = useState(String(existing?.secondaryPrice || ''));
  const [priceChangeAllowed, setPriceChangeAllowed] = useState(!!existing?.priceChangeAllowed);

  const [trackInventory, setTrackInventory] = useState(existing?.trackInventory !== false);
  const [reorder, setReorder] = useState(existing?.reorder ? String(existing.reorder) : '');
  const [warrantyMonths, setWarrantyMonths] = useState(existing?.warrantyMonths ? String(existing.warrantyMonths) : '');
  // a new item starts with the shop's own choice: Settings → "Track batches and expiry"
  const [trackBatches, setTrackBatches] = useState(existing ? !!existing.trackBatches : !!ctx.db?.settings.trackBatches);
  const [batchList, setBatchList] = useState<ProductBatch[]>(existing?.batches || []);
  const [trackSerials, setTrackSerials] = useState(!!existing?.trackSerials);
  const [serialList, setSerialList] = useState<string[]>(existing?.serials || []);
  const [serialInfo, setSerialInfo] = useState<Record<string, SerialInfo>>(existing?.serialInfo || {});
  const [dualImei, setDualImei] = useState(!!existing?.dualImei);
  const [askCondition, setAskCondition] = useState(!!existing?.askCondition);
  /** Opening stock of a new item, into the branch this phone is working in. */
  const [openingQty, setOpeningQty] = useState('');
  const [codeFocus, setCodeFocus] = useState(false);

  const [startQtyFilled, setStartQtyFilled] = useState(!!existing?.startQtyFilled);
  const [defaultQty, setDefaultQty] = useState(existing?.defaultQty && existing.defaultQty !== 1 ? String(existing.defaultQty) : '');
  const [note, setNote] = useState(existing?.note || '');
  const [salesAccount, setSalesAccount] = useState(existing?.salesAccount || 'n_sales');
  const [cogsAccount, setCogsAccount] = useState(existing?.cogsAccount || 'n_cogs');
  const [active, setActive] = useState(existing?.active !== false);

  // service-only — reference the wrapper at 16893
  const [rateType, setRateType] = useState<ServiceRate>(existing?.rateType || 'fixed');
  const [duration, setDuration] = useState(existing?.duration || '');
  const [staffId, setStaffId] = useState(existing?.staffId || '');
  const [bookable, setBookable] = useState(!!existing?.bookable);
  const [materials, setMaterials] = useState(!!existing?.materials);

  /* ---- sheets ---- */
  const [sheet, setSheet] = useState<null | 'photo' | 'unit' | 'secondUnit' | 'category'>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [newUnit, setNewUnit] = useState('');
  const [newCat, setNewCat] = useState('');
  const [typedCode, setTypedCode] = useState('');

  const svc = kind === 'service';
  /* Reference showCost() at 7796 — the cost boxes only exist for a role that may see them. */
  const showCost = can('inventory.view_cost_price');

  const units = db?.units || ['PC'];
  const cats = db?.categories || ['General'];

  const totalOpening = num(openingQty);

  /**
   * What the batches are a breakdown of: the opening stock typed in for a new
   * item, or what an existing one holds across its branches.
   */
  const batchTarget = existing
    ? Object.values(existing.stock || {}).reduce((s, q) => s + (Number(q) || 0), 0)
    : totalOpening;
  const batchTotal = batchList.reduce((s, b) => s + (Number(b.qty) || 0), 0);

  if (!db) return null;

  /* ---- barcodes, reference A.genBarcode / addBarcodeTo (9384-9420) ---- */
  function addBarcode(code: string) {
    const c = String(code).trim();
    if (!c) return;
    const owner = db!.products.find((p) => (p.barcodes || []).indexOf(c) > -1);
    if (owner && owner.id !== existing?.id) {
      error(c + ' already belongs to ' + owner.name + '.');
      return;
    }
    if (barcodes.indexOf(c) > -1) return;
    setBarcodes((b) => b.concat([c]));
  }

  /* ---- A.markup, reference line 9369 — round to the nearest 50 ---- */
  function applyMarkup(pct: number) {
    const c = num(cost);
    if (!c) { error('Enter what it costs you before pricing off a markup.'); return; }
    setPrice(String(Math.round(c * (1 + pct / 100) / 50) * 50));
  }

  /** Turning batches on from the Basics chip: keep counting on, which batches need. */
  function toggleBatches() {
    const next = !trackBatches;
    setTrackBatches(next);
    if (next && !trackInventory) setTrackInventory(true);
  }
  function toggleSerials() {
    const next = !trackSerials;
    setTrackSerials(next);
    if (next && !trackInventory) setTrackInventory(true);
  }

  function save() {
    if (!name.trim()) {
      setNameErr(true);
      setTab('basics');
      error('Give it a name.');
      return;
    }
    if (!svc && trackBatches && batchTarget > 0 && batchTotal > batchTarget) {
      setTab('stock');
      error('The batches add up to ' + batchTotal + ' but the item holds ' + batchTarget + '. Reduce a batch before saving.');
      return;
    }
    // every product is counted: stock has to be accounted for
    const track = !svc;
    const patch: Partial<Product> = {
      name: name.trim(),
      sku: sku.trim() || 'ITM-' + (db!.products.length + 1),
      kind, unit: unit || 'PC',
      secondaryUnit: svc ? '' : secondaryUnit,
      conversionRate: num(conversionRate),
      secondaryPrice: num(secondaryPrice),
      category: category || 'General',
      description: description.trim(),
      cost: num(cost), price: num(price),
      taxRate: taxExempt ? 0 : (num(taxRate) || db!.settings.taxRate),
      reorder: svc ? 0 : num(reorder),
      warrantyMonths: num(warrantyMonths),
      barcodes: svc ? [] : barcodes,
      trackInventory: track,
      trackBatches: svc ? false : trackBatches,
      batches: svc || !trackBatches ? [] : batchList.map((b, i) => ({ ...b, no: b.no.trim() || (sku || 'B').toUpperCase().slice(0, 4) + '-' + String(i + 1).padStart(3, '0') })),
      trackSerials: svc ? false : trackSerials,
      serials: svc || !trackSerials ? [] : serialList,
      serialInfo: svc || !trackSerials ? {} : serialInfo,
      dualImei: !svc && trackSerials && dualImei,
      askCondition: !svc && trackSerials && askCondition,
      priceChangeAllowed, defaultQty: num(defaultQty) || 1, startQtyFilled,
      note, color, emoji: image, image,
      photo: photo || undefined,
      taxExempt,
      salesAccount, cogsAccount, active,
      rateType: svc ? rateType : undefined,
      duration: svc ? duration : undefined,
      staffId: svc ? staffId : undefined,
      bookable: svc ? bookable : undefined,
      materials: svc ? materials : undefined,
    };
    if (existing) {
      updateProduct(existing.id, patch);
    } else {
      const stock: Record<string, number> = {};
      const here = db!.session.warehouse || db!.warehouses[0]?.id;
      db!.warehouses.forEach((w) => { stock[w.id] = !svc && w.id === here ? num(openingQty) : 0; });
      addProduct({ ...(patch as Omit<Product, 'id'>), stock, bom: null, active });
    }
    navigation.goBack();
  }

  function remove() {
    if (!existing) return;
    Alert.alert('Remove this item', existing.name + ' will no longer be offered for sale.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { updateProduct(existing.id, { active: false }); navigation.goBack(); } },
    ]);
  }

  /** Chooses a picture from the gallery. */
  async function pickPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Photos', 'Allow access to your photos to attach one.'); return; }
    const r = await ImagePicker.launchImageLibraryAsync({ quality: 0.6, allowsEditing: true, aspect: [4, 3] });
    if (!r.canceled && r.assets?.[0]?.uri) setPhoto(await keepPhoto(r.assets[0].uri, 'item'));
  }

  /** Takes one with the camera. */
  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Camera', 'Allow camera access to take a picture.'); return; }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: true, aspect: [4, 3] });
    if (!r.canceled && r.assets?.[0]?.uri) setPhoto(await keepPhoto(r.assets[0].uri, 'item'));
  }

  /* ================= tab bodies ================= */

  /**
   * A box that opens a list — category, unit. Like a text field, its name is
   * the placeholder while empty and a small caption once something is chosen.
   */
  const pickBox = (label: string, value: string, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, marginBottom: 14,
        paddingHorizontal: 15, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1.4,
        borderColor: colors.line, backgroundColor: pressed ? colors.sunk : colors.surface,
      })}
    >
      <View style={{ flex: 1 }}>
        {value ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginBottom: 2 }}>{label}</Text> : null}
        <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 15, color: value ? colors.ink : colors.faint }}>{value || label}</Text>
      </View>
      <Icon name="down" size={16} color={colors.faint} />
    </Pressable>
  );

  const basics = (
    <>
      <View style={{ height: 12 }} />
      {/* what is it */}
      <SegmentSlider
        value={kind}
        options={[
          { v: 'product' as ProductKind, l: 'Product', i: 'box' as IconName },
          { v: 'service' as ProductKind, l: 'Service', i: 'tools' as IconName },
        ]}
        onChange={(k: ProductKind) => { setKind(k); if (k === 'service' && tab === 'stock') setTab('basics'); }}
      />

      <Field
        label="Name"
        value={name}
        onChangeText={(v: string) => { setName(v); if (nameErr && v.trim()) setNameErr(false); }}
        error={nameErr ? 'Give it a name.' : undefined}
      />

      {/* the photo: a field like the others, with the camera and the gallery inside it */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, marginBottom: 14,
        paddingLeft: photo ? 8 : 15, paddingRight: 6, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1.4,
        borderColor: colors.line, backgroundColor: colors.surface,
      }}>
        {photo ? (
          <Image source={{ uri: photo }} style={{ width: 44, height: 44, borderRadius: 9 }} />
        ) : null}
        <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 15, color: photo ? colors.ink : colors.faint }}>
          {photo ? 'Photo added' : 'Photo'}
        </Text>
        <Pressable onPress={() => void takePhoto()} accessibilityLabel="Take a photo" hitSlop={4}
          style={({ pressed }) => ({ width: 42, height: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.accentSoft : 'transparent' })}>
          <Icon name="camera" size={20} color={colors.accent} />
        </Pressable>
        <Pressable onPress={() => void pickPhoto()} accessibilityLabel="Choose from the gallery" hitSlop={4}
          style={({ pressed }) => ({ width: 42, height: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.accentSoft : 'transparent' })}>
          <Icon name="image" size={20} color={colors.accent} />
        </Pressable>
        {photo ? (
          <Pressable onPress={() => setPhoto('')} accessibilityLabel="Remove the photo" hitSlop={4}
            style={{ width: 34, height: 42, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="x" size={16} color={colors.faint} />
          </Pressable>
        ) : null}
      </View>

      <Field label="Item code" value={sku} onChangeText={setSku} placeholder="Leave empty and one is made" />
      {pickBox('Category', category, () => setSheet('category'))}
      {pickBox('Unit', unit ? unit + (secondaryUnit ? ' · also by ' + secondaryUnit + (num(conversionRate) ? ' (' + num(conversionRate) + ' in one)' : '') : '') : '', () => setSheet('unit'))}

      {svc ? null : (
        <>
          {/* one barcode box: type and press enter, scan with the camera, or let the app make one */}
          <Field
            label="Barcode"
            value={typedCode}
            onChangeText={setTypedCode}
            onSubmitEditing={() => { addBarcode(typedCode); setTypedCode(''); }}
            onFocus={() => setCodeFocus(true)}
            onBlur={() => { setCodeFocus(false); if (typedCode.trim()) { addBarcode(typedCode); setTypedCode(''); } }}
            placeholder={barcodes.length ? 'Another barcode, then press enter' : 'Type, then press enter'}
            numeric
            keepFocus
            returnKeyType="done"
            style={{ marginBottom: barcodes.length ? 8 : 14 }}
            trailing={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: -6 }}>
                <Pressable
                  onPress={() => addBarcode(makeBarcode())}
                  accessibilityLabel="Create a barcode"
                  style={({ pressed }) => ({
                    paddingHorizontal: 11, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
                    flexDirection: 'row', gap: 5, backgroundColor: pressed ? colors.accent : colors.accentSoft,
                  })}
                >
                  <Icon name="plus" size={14} color={colors.accent} />
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: colors.accent }}>Auto</Text>
                </Pressable>
                <Pressable
                  onPress={() => setScanOpen(true)}
                  accessibilityLabel="Scan a barcode"
                  style={({ pressed }) => ({
                    width: 40, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: pressed ? colors.accentSoft : 'transparent',
                  })}
                >
                  <Icon name="camera" size={21} color={colors.accent} />
                </Pressable>
              </View>
            }
          />
          {barcodes.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              {barcodes.map((b) => (
                <View key={b} style={{
                  flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 12, paddingRight: 8, paddingVertical: 7,
                  borderRadius: radius.pill, backgroundColor: colors.sunk,
                }}>
                  <Text style={{ fontFamily: fonts.mono, fontSize: 12.5, letterSpacing: 0.5, color: colors.ink }}>{b}</Text>
                  <Pressable hitSlop={8} onPress={() => setBarcodes(barcodes.filter((x) => x !== b))} accessibilityLabel={'Remove ' + b}>
                    <Icon name="x" size={14} color={colors.faint} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
        </>
      )}

      <Field
        inset
        label="Description"
        value={description}
        onChangeText={setDescription}
        multiline
        placeholder={svc ? 'What is included, how it is done' : 'Condition, specifications, colour, size…'}
      />
    </>
  );

  const pricing = (
    <>
      <View style={{ height: 14 }} />
      {svc ? (
        <ChipRow
          value={rateType}
          options={SERVICE_RATE.map((r) => ({ v: r[0], l: r[1] }))}
          onChange={setRateType}
          style={{ marginBottom: 14 }}
        />
      ) : null}

      {showCost ? (
        <>
          <Grid cols={2} gap={12}>
            <Field inset icon="money" label={svc ? 'Cost to you' : 'Cost price'} value={cost} onChangeText={setCost} numeric decimal placeholder="0" />
            <Field inset icon="coins" label="Sale price" value={price} onChangeText={setPrice} numeric decimal placeholder="0" />
          </Grid>
          {can('inventory.view_profit') ? <MarginCard cost={num(cost)} price={num(price)} /> : null}
        </>
      ) : (
        <Field inset icon="coins" label="Sale price" value={price} onChangeText={setPrice} numeric placeholder="0" />
      )}

      {db.settings.taxEnabled === false ? null : (
        <>
          <HighlightToggle
            tone="warn"
            title={(db.settings.taxName || 'VAT') + ' exempt'}
            sub={'No ' + (db.settings.taxName || 'VAT') + ' is charged on it'}
            on={taxExempt}
            onChange={setTaxExempt}
          />
          {!taxExempt ? (
            <Field inset icon="pie" label={(db.settings.taxName || 'VAT') + ' %'} value={taxRate} onChangeText={setTaxRate} numeric decimal placeholder={String(db.settings.taxRate ?? 18) + ' (the shop rate)'} />
          ) : null}
        </>
      )}
      <ToggleRow label="Staff may change the price at the till" on={priceChangeAllowed} onChange={setPriceChangeAllowed} />

    </>
  );

  /** A service's Delivery tab. */
  const delivery = (
    <>
      <View style={{ height: 14 }} />
      <Field inset icon="clock" label="How long it usually takes" value={duration} onChangeText={setDuration} placeholder={rateType === 'hour' ? '2 hours' : 'Half a day'} />
      <SelectField
        label="Who normally does it"
        value={staffId}
        options={[{ v: '', l: 'Anyone' }].concat(db.users.filter((u) => u.active).map((u) => ({ v: u.id, l: u.name })))}
        onChange={setStaffId}
      />
      <Card style={{ paddingHorizontal: 13, marginBottom: 12 }}>
        <ToggleRow label="Needs booking in advance" on={bookable} onChange={setBookable} bare />
        <View style={{ height: 1, backgroundColor: colors.line }} />
        <ToggleRow label="Materials billed separately" on={materials} onChange={setMaterials} bare />
      </Card>
      <Field inset icon="shield" label="Warranty (months)" value={warrantyMonths} onChangeText={setWarrantyMonths} numeric />
    </>
  );

  const onHand = existing ? Object.values(existing.stock || {}).reduce((s, q) => s + (Number(q) || 0), 0) : 0;
  const stock = (
    <>
      <View style={{ height: 14 }} />
      {/* the one figure this tab is about */}
      {!existing ? (
        <Field
          inset
          big
          label="Opening stock"
          value={openingQty}
          onChangeText={setOpeningQty}
          numeric
          placeholder="0"
          suffix={unit}
        />
      ) : (
        <View style={{ borderRadius: radius.md, borderWidth: 1.4, borderColor: colors.line, backgroundColor: colors.surface, paddingHorizontal: 15, paddingVertical: 12, marginBottom: 14 }}>
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint }}>On hand</Text>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 34, color: colors.ink }}>
            {onHand} <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.faint }}>{unit}</Text>
          </Text>
          {db.warehouses.length > 1 ? (
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>
              {db.warehouses.map((w) => w.name + ' ' + ((existing.stock || {})[w.id] || 0)).join(' · ')}
            </Text>
          ) : null}
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 4 }}>Change it with a stock adjustment or a purchase.</Text>
        </View>
      )}

      <Grid cols={2} gap={12}>
        <Field inset icon="alert" label="Reorder at" value={reorder} onChangeText={setReorder} numeric />
        <Field inset icon="shield" label="Warranty (months)" value={warrantyMonths} onChangeText={setWarrantyMonths} numeric />
      </Grid>

      <Card style={{ paddingHorizontal: 13, paddingVertical: 2, marginBottom: 10 }}>
        <ToggleRow label="Track batches and expiry" on={trackBatches} onChange={() => toggleBatches()} bare />
        {trackBatches ? (
          <View style={{ paddingBottom: 12 }}>
            <BatchEditor
              batches={batchList}
              onChange={setBatchList}
              target={batchTarget}
              unit={unit || 'pcs'}
              suggestNo={() => (sku || 'B').toUpperCase().slice(0, 4) + '-' + String(batchList.length + 1).padStart(3, '0')}
            />
          </View>
        ) : null}
      </Card>

      <Card style={{ paddingHorizontal: 13, paddingVertical: 2 }}>
        <ToggleRow label="Track IMEI" on={trackSerials} onChange={() => toggleSerials()} bare />
        {trackSerials ? (
          <View style={{ paddingBottom: 12 }}>
            {/* how many IMEIs each phone carries, and whether to ask its condition */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.soft }}>IMEIs per phone</Text>
              <Seg
                value={dualImei ? '2' : '1'}
                onChange={(v) => setDualImei(v === '2')}
                options={[{ v: '1', l: 'One' }, { v: '2', l: 'Two' }]}
                style={{ width: 150, padding: 3 }}
              />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.soft }}>Condition</Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 1 }}>New or used, printed on the receipt</Text>
              </View>
              <Sw on={askCondition} onPress={() => setAskCondition(!askCondition)} />
            </View>
            <SerialEditor
              serials={serialList}
              onChange={setSerialList}
              info={serialInfo}
              onInfoChange={setSerialInfo}
              dual={dualImei}
              askCondition={askCondition}
              expected={existing ? onHand : num(openingQty) || undefined}
            />
          </View>
        ) : null}
      </Card>
    </>
  );

  const more = (
    <>
      <View style={{ height: 14 }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14, borderRadius: radius.md, borderWidth: 1.4, borderColor: colors.line, backgroundColor: colors.surface, paddingHorizontal: 15, paddingVertical: 10 }}>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint }}>Colour</Text>
        <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {ITEM_COLOR.map((c) => <Swatch key={c || 'none'} color={c} on={color === c} onPress={() => setColor(c)} />)}
        </View>
      </View>
      <ToggleRow
        label="Fill in the quantity on a bill"
        sub={startQtyFilled ? 'The quantity starts at the number below' : 'Off: the cashier types the quantity each time'}
        on={startQtyFilled}
        onChange={setStartQtyFilled}
      />
      {startQtyFilled ? (
        <Field label="Starts at" value={defaultQty} onChangeText={setDefaultQty} numeric placeholder="1" suffix={unit} />
      ) : null}
      <Field inset icon="doc" label="Note for staff" value={note} onChangeText={setNote} multiline placeholder="Anything they should know when selling it" />
      <Grid cols={2}>
        <SelectField
          label="Sales account"
          value={salesAccount}
          options={[{ v: 'n_sales', l: 'Sales' }, { v: 'n_income', l: 'Other income' }]}
          onChange={setSalesAccount}
        />
        <SelectField
          label="Cost account"
          value={cogsAccount}
          options={[{ v: 'n_cogs', l: 'Cost of sales' }, { v: 'n_expense', l: 'Expenses' }]}
          onChange={setCogsAccount}
        />
      </Grid>
      {can('inventory.delete') || active === false ? (
        <ToggleRow label="Active — offer it for sale" on={active} onChange={setActive} />
      ) : null}
      {existing && can('inventory.delete') ? (
        <View style={{ marginTop: 16 }}>
          <Button variant="dngr" label="Remove this item" onPress={remove} />
        </View>
      ) : null}
    </>
  );

  const body = tab === 'basics' ? basics
    : tab === 'pricing' ? pricing
      : tab === 'stock' ? (svc ? delivery : stock)
        : more;

  /* what will be saved — a glance, so nobody has to open every tab before saving */
  const summary: { l: string; on: boolean }[] = [
    { l: num(price) ? money(num(price)) : 'No price', on: !!num(price) },
  ];
  if (svc) {
    summary.push({ l: (SERVICE_RATE.find((r) => r[0] === rateType) || SERVICE_RATE[0])[1], on: true });
    summary.push({ l: bookable ? 'Booking' : 'Walk-in', on: bookable });
  } else {
    summary.push({ l: existing ? onHand + ' ' + unit + ' on hand' : (num(openingQty) || 0) + ' ' + unit + ' opening', on: true });
    if (trackBatches) summary.push({ l: 'Batches', on: true });
    if (trackSerials) summary.push({ l: 'IMEI', on: true });
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TopTabs
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        options={[
          { v: 'basics', l: nameErr ? 'Basics •' : 'Basics', i: 'doc' },
          { v: 'pricing', l: 'Price', i: 'coins' },
          { v: 'stock', l: svc ? 'Delivery' : 'Stock', i: 'box' },
          { v: 'more', l: 'More', i: 'dots' },
        ]}
      />

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        {body}
      </ScrollView>

      <Foot>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginBottom: 9 }}>
          {summary.map((c) => <SumChip key={c.l} label={c.l} on={c.on} />)}
        </View>
        <View style={{ flexDirection: 'row', gap: 9 }}>
          <View style={{ flex: 1 }}><Button label="Cancel" onPress={() => navigation.goBack()} /></View>
          <View style={{ flex: 1.5 }}>
            <Button
              variant="pri"
              label={existing ? 'Save item' : 'Create item'}
              icon={<Icon name="check" size={16} color={colors.accentInk} />}
              onPress={save}
            />
          </View>
        </View>
      </Foot>

      {/* the picture: camera, gallery or an emoji */}
      <Sheet visible={sheet === 'photo'} title="Picture" icon="camera" onClose={() => setSheet(null)}>
        <View style={{ gap: 8 }}>
          <Button label={photo ? 'Take a new photo' : 'Take a photo'} icon={<Icon name="camera" size={16} color={colors.ink} />} onPress={() => { setSheet(null); void takePhoto(); }} />
          <Button label="Choose from the gallery" icon={<Icon name="image" size={16} color={colors.ink} />} onPress={() => { setSheet(null); void pickPhoto(); }} />
        </View>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint, marginTop: 16, marginBottom: 8 }}>Or an emoji</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {ITEM_EMOJI.map((e) => (
            <Pressable
              key={e}
              onPress={() => { setImage(e); setPhoto(''); setSheet(null); }}
              style={{
                width: 50, height: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
                backgroundColor: e === image && !photo ? colors.accentSoft : colors.sunk,
                borderWidth: 1, borderColor: e === image && !photo ? colors.accent : 'transparent',
              }}
            >
              <Text style={{ fontSize: 24 }}>{e}</Text>
            </Pressable>
          ))}
        </View>
        {photo || image ? (
          <View style={{ marginTop: 14 }}>
            <Button size="sm" variant="dngr" label="No picture" onPress={() => { setImage(''); setPhoto(''); setSheet(null); }} />
          </View>
        ) : null}
      </Sheet>

      <PickSheet
        visible={sheet === 'category'}
        title="Category"
        options={cats}
        value={category}
        onClose={() => setSheet(null)}
        onPick={(v) => { setCategory(v); setSheet(null); }}
        onCreate={(v) => { addCategory(v); setCategory(v); setSheet(null); }}
        createHint="A new category"
        newLabel="New category"
      />
      <UnitSheet
        visible={sheet === 'unit'}
        units={units}
        unit={unit}
        secondaryUnit={secondaryUnit}
        conversionRate={conversionRate}
        secondaryPrice={secondaryPrice}
        price={num(price)}
        money={money}
        onUnit={setUnit}
        onSecondary={setSecondaryUnit}
        onConversion={setConversionRate}
        onSecondaryPrice={setSecondaryPrice}
        onAddUnit={addUnit}
        onClose={() => setSheet(null)}
      />

      <BarcodeScannerModal
        visible={scanOpen}
        onClose={() => setScanOpen(false)}
        onScan={(code) => { setScanOpen(false); addBarcode(code); }}
      />
    </View>
  );
}

/**
 * Choose one from a list, or make a new one right there — the category and
 * unit pickers. Typing narrows the list; if nothing matches, the typed name
 * can be created with one tap.
 */
function PickSheet({ visible, title, options, value, onClose, onPick, onCreate, createHint, noneLabel, upper, newLabel }: {
  visible: boolean; title: string; options: string[]; value: string;
  onClose: () => void; onPick: (v: string) => void; onCreate: (v: string) => void;
  createHint: string; noneLabel?: string; upper?: boolean;
  /** An always-visible row that starts making a new one. */
  newLabel?: string;
}) {
  const { colors } = useTheme();
  const [q, setQ] = useState('');
  const [making, setMaking] = useState(false);
  const [draft, setDraft] = useState('');
  React.useEffect(() => { if (visible) { setQ(''); setMaking(false); setDraft(''); } }, [visible]);
  const typed = upper ? q.trim().toUpperCase() : q.trim();
  const shown = options.filter((o) => o.toLowerCase().includes(q.trim().toLowerCase()));
  const exists = options.some((o) => o.toLowerCase() === typed.toLowerCase());
  const row = (label: string, on: boolean, onPress: () => void, create?: boolean) => (
    <Pressable
      key={(create ? '+' : '') + label}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 4,
        borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: pressed ? colors.sunk : 'transparent',
      })}
    >
      <Icon name={create ? 'plus' : 'tag'} size={17} color={create || on ? colors.accent : colors.faint} />
      <Text style={{ flex: 1, fontFamily: on || create ? fonts.uiBold : fonts.ui, fontSize: 15, color: create || on ? colors.accent : colors.ink }}>{label}</Text>
      {on ? <Icon name="check" size={18} color={colors.accent} /> : null}
    </Pressable>
  );
  return (
    <Sheet visible={visible} title={title} icon="tag" onClose={onClose}>
      {making ? (
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}>
            <Field label={'Name of the ' + (newLabel || title).replace(/^New /, '').toLowerCase()} value={draft} onChangeText={setDraft} autoFocus autoCapitalize={upper ? 'characters' : 'sentences'} />
          </View>
          <View style={{ width: 96, marginTop: 6 }}>
            <Button variant="pri" label="Add" disabled={!draft.trim()} onPress={() => onCreate(upper ? draft.trim().toUpperCase() : draft.trim())} />
          </View>
        </View>
      ) : (
        <Field label="Search" value={q} onChangeText={setQ} placeholder={createHint} autoCapitalize={upper ? 'characters' : 'sentences'} />
      )}
      {newLabel && !making ? row('＋ ' + newLabel, false, () => { setMaking(true); setDraft(q.trim()); }, true) : null}
      <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled">
        {typed && !exists && !making ? row('Create “' + typed + '”', false, () => onCreate(typed), true) : null}
        {noneLabel ? row(noneLabel, !value, () => onPick('')) : null}
        {shown.map((o) => row(o, o === value, () => onPick(o)))}
        {!options.length && !typed ? (
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, textAlign: 'center', paddingVertical: 18 }}>
            None yet. Type a name above to create the first.
          </Text>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}

/** Units & categories — reference SCREENS.unitsCats, line 9440. Unchanged. */
export function UnitsCategoriesScreen() {
  const { colors } = useTheme();
  const { db, removeUnit, removeCategory, addUnit, addCategory, money, stockOf } = useAppData();
  const [view, setView] = useState<'units' | 'cats'>('units');
  const [sheet, setSheet] = useState<null | 'unit' | 'cat'>(null);
  const [draft, setDraft] = useState('');
  if (!db) return null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ChipStrip options={[['units', 'Units'], ['cats', 'Categories']]} value={view} onChange={(v) => setView(v as any)} />
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Card>
          {view === 'units'
            ? db.units.map((u, i) => {
              const n = db.products.filter((p) => p.active && (p.unit === u || p.secondaryUnit === u)).length;
              return (
                <View key={u} style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 14,
                  borderBottomWidth: i === db.units.length - 1 ? 0 : 1, borderBottomColor: colors.line,
                }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.ink }}>{u}</Text>
                    <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{n} item{n === 1 ? '' : 's'}</Text>
                  </View>
                  {n ? <Pill label="in use" /> : (
                    <Pressable hitSlop={8} onPress={() => removeUnit(u)}><Icon name="trash" size={15} color={colors.danger} /></Pressable>
                  )}
                </View>
              );
            })
            : db.categories.map((c, i) => {
              const items = db.products.filter((p) => p.active && p.category === c);
              const val = items.filter((p) => p.kind !== 'service').reduce((a, p) => a + stockOf(p) * p.price, 0);
              return (
                <View key={c} style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 14,
                  borderBottomWidth: i === db.categories.length - 1 ? 0 : 1, borderBottomColor: colors.line,
                }}>
                  <Icon name={CAT_ICON[c] || 'box'} size={17} color={colors.rail} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.ink }}>{c}</Text>
                    <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{items.length} item{items.length === 1 ? '' : 's'}</Text>
                  </View>
                  <Text style={{ fontFamily: fonts.monoSemi, fontSize: 12.5, color: colors.ink }}>{money(val)}</Text>
                  {items.length ? null : (
                    <Pressable hitSlop={8} onPress={() => removeCategory(c)}><Icon name="trash" size={15} color={colors.danger} /></Pressable>
                  )}
                </View>
              );
            })}
        </Card>
        <View style={{ height: 14 }} />
        <Button
          size="sm"
          label={view === 'units' ? '+ New unit' : '+ New category'}
          onPress={() => { setDraft(''); setSheet(view === 'units' ? 'unit' : 'cat'); }}
        />
      </ScrollView>

      <Sheet
        visible={sheet !== null}
        title={sheet === 'unit' ? 'New unit' : 'New category'}
        icon="plus"
        onClose={() => setSheet(null)}
        footer={<Button variant="pri" label="Add" onPress={() => {
          const v = draft.trim();
          if (!v) return;
          if (sheet === 'unit') addUnit(v.toUpperCase()); else addCategory(v);
          setSheet(null);
        }} />}
      >
        <Field label={sheet === 'unit' ? 'Short name' : 'Name'} value={draft} onChangeText={setDraft} placeholder={sheet === 'unit' ? 'CTN' : 'Hardware'} />
      </Sheet>
    </View>
  );
}

/*
 * The unit an item is sold in, and optionally a second, smaller one — a
 * carton and the pieces inside it, a sack and a kilo. Two dropdowns, then one
 * question: how many of the small one are inside the big one. Kept in the
 * direction LineEditSheet's unitsFor() expects: `unit` is what the price is
 * for, the second unit is the breakdown, and its price divides down.
 */
function UnitDropdown({ label, value, options, open, onOpen, onPick, onAdd, noneLabel }: {
  label: string; value: string; options: string[]; open: boolean;
  onOpen: () => void; onPick: (v: string) => void; onAdd: (v: string) => void; noneLabel?: string;
}) {
  const { colors } = useTheme();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  React.useEffect(() => { if (!open) { setAdding(false); setDraft(''); } }, [open]);
  const shown = value || noneLabel || '';
  const item = (text: string, on: boolean, onPress: () => void, accent?: boolean, last?: boolean) => (
    <Pressable
      key={text}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 15,
        borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.line,
        backgroundColor: on ? colors.accentSoft : pressed ? colors.sunk : colors.surface,
      })}
    >
      <Text style={{ flex: 1, fontFamily: on || accent ? fonts.uiSemi : fonts.ui, fontSize: 15, color: accent || on ? colors.accent : colors.ink }}>{text}</Text>
      {on ? <Icon name="check" size={17} color={colors.accent} /> : null}
    </Pressable>
  );
  return (
    <View style={{ marginBottom: 14 }}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => ({
          flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 15, paddingVertical: 8,
          borderRadius: radius.md, borderWidth: 1.4, borderColor: open ? colors.accent : colors.line,
          backgroundColor: pressed ? colors.sunk : colors.surface,
        })}
      >
        <View style={{ flex: 1 }}>
          {shown ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: open ? colors.accent : colors.faint, marginBottom: 2 }}>{label}</Text> : null}
          <Text style={{ fontFamily: fonts.ui, fontSize: 15, color: shown ? colors.ink : colors.faint }}>{shown || label}</Text>
        </View>
        <Icon name={open ? 'up' : 'down'} size={17} color={colors.faint} />
      </Pressable>
      {open ? (
        <View style={{ marginTop: 6, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: 'hidden' }}>
          <ScrollView style={{ maxHeight: 230 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {noneLabel ? item(noneLabel, !value, () => onPick('')) : null}
            {options.map((o) => item(o, o === value, () => onPick(o)))}
          </ScrollView>
          {adding ? (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 10, borderTopWidth: 1, borderTopColor: colors.line }}>
              <View style={{ flex: 1 }}>
                <Field label="New unit, e.g. CTN" value={draft} onChangeText={setDraft} autoFocus autoCapitalize="characters" style={{ marginBottom: 0 }} />
              </View>
              <View style={{ width: 84, marginTop: 6 }}>
                <Button variant="pri" label="Add" disabled={!draft.trim()} onPress={() => onAdd(draft.trim().toUpperCase())} />
              </View>
            </View>
          ) : (
            <View style={{ borderTopWidth: 1, borderTopColor: colors.line }}>
              {item('＋ New unit', false, () => setAdding(true), true, true)}
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}

function UnitSheet({
  visible, units, unit, secondaryUnit, conversionRate, secondaryPrice, price, money,
  onUnit, onSecondary, onConversion, onSecondaryPrice, onAddUnit, onClose,
}: {
  visible: boolean; units: string[]; unit: string; secondaryUnit: string;
  conversionRate: string; secondaryPrice: string; price: number; money: (n: number) => string;
  onUnit: (v: string) => void; onSecondary: (v: string) => void;
  onConversion: (v: string) => void; onSecondaryPrice: (v: string) => void;
  onAddUnit: (v: string) => void; onClose: () => void;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState<null | 'main' | 'second'>(null);
  React.useEffect(() => { if (visible) setOpen(null); }, [visible]);
  const rate = Number(String(conversionRate).replace(/[^0-9.]/g, '')) || 0;
  const big = unit || 'unit';

  return (
    <Sheet visible={visible} title="Unit" icon="box" onClose={onClose} footer={<Button variant="pri" label="Done" onPress={onClose} />}>
      <ScrollView style={{ maxHeight: 560 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
        <UnitDropdown
          label="Sold by"
          value={unit}
          options={units}
          open={open === 'main'}
          onOpen={() => setOpen(open === 'main' ? null : 'main')}
          onPick={(v) => { onUnit(v); if (secondaryUnit === v) onSecondary(''); setOpen(null); }}
          onAdd={(v) => { onAddUnit(v); onUnit(v); setOpen(null); }}
        />
        <UnitDropdown
          label="Also sold by (optional)"
          value={secondaryUnit}
          noneLabel="None"
          options={units.filter((u) => u !== unit)}
          open={open === 'second'}
          onOpen={() => setOpen(open === 'second' ? null : 'second')}
          onPick={(v) => { onSecondary(v); setOpen(null); }}
          onAdd={(v) => { onAddUnit(v); onSecondary(v); setOpen(null); }}
        />

        {secondaryUnit ? (
          <>
            <Field
              label={'How many ' + secondaryUnit + ' inside one ' + big + '?'}
              value={conversionRate}
              onChangeText={onConversion}
              numeric
              placeholder="e.g. 24"
              suffix={secondaryUnit}
            />
            <Field
              label={'Price per ' + secondaryUnit + ' (optional)'}
              value={secondaryPrice}
              onChangeText={onSecondaryPrice}
              numeric
              placeholder={rate > 0 ? String(Math.round(price / rate)) + ' — worked out from the ' + big + ' price' : ''}
            />
            {rate > 0 ? (
              <View style={{ borderRadius: radius.md, backgroundColor: colors.accentSoft, padding: 12 }}>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.accent }}>
                  1 {big} = {rate} {secondaryUnit}
                </Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.soft, marginTop: 2 }}>
                  {money(price)} a {big} · {money(Number(secondaryPrice) || Math.round(price / rate))} a {secondaryUnit}
                </Text>
              </View>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </Sheet>
  );
}
