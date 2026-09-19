/**
 * New / edit item — the full-screen item editor.
 *
 * Reference: SCREENS.itemEdit (line 9192) with the wrapper that gives a service
 * its own Delivery tab and a product its second unit / batches / serials block
 * (16886), plus itemTabBody (9217), togRow (9346), A.markup (9369), the barcode
 * actions (9384-9420), SHEETS.pickEmoji (9378), SHEETS.newUnit / newCategory
 * (9424-9437) and marginCard / stockBits from the live SHEETS.product (6983).
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert, Image } from 'react-native';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useToast } from '../components/Toast';
import {
  Card, Cap, Button, Stat, Grid, KV, EmptyState, Pill, ChipStrip, TopTabs,
  TypeChips, HighlightToggle, DropZone, InfoBanner,
  Seg, Field, SelectField, ChipRow, ActionChip, FieldNote, ToggleRow, Swatch,
} from '../components/ui';
import { Icon, CAT_ICON, IconName } from '../components/icons';
import { Sheet } from '../components/Sheet';
import { Foot } from '../components/AppBar';
import BarcodeScannerModal from '../components/BarcodeScannerModal';
import * as ImagePicker from 'expo-image-picker';
import { keepPhoto } from '../data/photos';
import { ITEM_COLOR, ITEM_EMOJI, SERVICE_RATE } from '../data/defaults';
import type { Product, ProductBatch, ProductKind, ServiceRate } from '../data/types';
import BatchEditor from '../components/BatchEditor';
import SerialEditor from '../components/SerialEditor';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'ProductDetail'>;

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
        <Text style={{ fontFamily: fonts.monoSemi, fontSize: 16.5, color: fg, marginTop: 3 }}>{money(profit)}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Cap style={{ color: fg }}>Margin</Cap>
        <Text style={{ fontFamily: fonts.monoSemi, fontSize: 16.5, color: fg, marginTop: 3 }}>{m}%</Text>
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
      <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>Point the camera at the barcode</Text>
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
  const [tab, setTab] = useState<'basics' | 'pricing' | 'stock' | 'more'>('basics');
  const [kind, setKind] = useState<ProductKind>(existing?.kind || 'product');
  const [name, setName] = useState(existing?.name || '');
  const [sku, setSku] = useState(existing?.sku || '');
  const [unit, setUnit] = useState(existing?.unit || 'PC');
  const [category, setCategory] = useState(existing?.category || db?.categories[0] || 'General');
  const [barcodes, setBarcodes] = useState<string[]>(existing?.barcodes || []);
  const [image, setImage] = useState(existing?.emoji || existing?.image || '📦');
  const [color, setColor] = useState(existing?.color || '');

  const [cost, setCost] = useState(String(existing?.cost ?? ''));
  const [price, setPrice] = useState(String(existing?.price ?? ''));
  const [taxRate, setTaxRate] = useState(String(existing?.taxRate ?? db?.settings.taxRate ?? 18));
  const [taxExempt, setTaxExempt] = useState(!!existing?.taxExempt);
  /** A real photo taken or chosen from the gallery; falls back to the emoji. */
  const [photo, setPhoto] = useState(existing?.photo || '');
  const [secondaryUnit, setSecondaryUnit] = useState(existing?.secondaryUnit || '');
  const [conversionRate, setConversionRate] = useState(String(existing?.conversionRate || ''));
  const [secondaryPrice, setSecondaryPrice] = useState(String(existing?.secondaryPrice || ''));
  const [priceChangeAllowed, setPriceChangeAllowed] = useState(!!existing?.priceChangeAllowed);

  const [trackInventory, setTrackInventory] = useState(existing?.trackInventory !== false);
  const [reorder, setReorder] = useState(String(existing?.reorder ?? 0));
  const [warrantyMonths, setWarrantyMonths] = useState(String(existing?.warrantyMonths ?? 0));
  const [trackBatches, setTrackBatches] = useState(!!existing?.trackBatches);
  const [batchList, setBatchList] = useState<ProductBatch[]>(existing?.batches || []);
  const [trackSerials, setTrackSerials] = useState(!!existing?.trackSerials);
  const [serialList, setSerialList] = useState<string[]>(existing?.serials || []);
  const [opening, setOpening] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    (db?.warehouses || []).forEach((w) => { o[w.id] = '0'; });
    return o;
  });

  const [defaultQty, setDefaultQty] = useState(String(existing?.defaultQty || 1));
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
  const [sheet, setSheet] = useState<null | 'emoji' | 'unit' | 'category' | 'barcode'>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [newUnit, setNewUnit] = useState('');
  const [newCat, setNewCat] = useState('');
  const [typedCode, setTypedCode] = useState('');

  const svc = kind === 'service';
  /* Reference showCost() at 7796 — the cost boxes only exist for a role that may see them. */
  const showCost = can('inventory.view_cost_price');

  const units = db?.units || ['PC'];
  const cats = db?.categories || ['General'];

  const totalOpening = useMemo(
    () => Object.keys(opening).reduce((s, k) => s + num(opening[k]), 0),
    [opening],
  );

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

  function save() {
    if (!name.trim()) { error('Give it a name.'); return; }
    const track = svc ? false : trackInventory;
    const patch: Partial<Product> = {
      name: name.trim(),
      sku: sku.trim() || 'ITM-' + (db!.products.length + 1),
      kind, unit: unit || 'PC',
      secondaryUnit: svc ? '' : secondaryUnit,
      conversionRate: num(conversionRate),
      secondaryPrice: num(secondaryPrice),
      category: category || 'General',
      cost: num(cost), price: num(price),
      taxRate: taxExempt ? 0 : (num(taxRate) || db!.settings.taxRate),
      reorder: svc ? 0 : num(reorder),
      warrantyMonths: num(warrantyMonths),
      barcodes: svc ? [] : barcodes,
      trackInventory: track,
      trackBatches: svc ? false : trackBatches,
      batches: svc || !trackBatches ? [] : batchList,
      trackSerials: svc ? false : trackSerials,
      serials: svc || !trackSerials ? [] : serialList,
      priceChangeAllowed, defaultQty: num(defaultQty) || 1,
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
      db!.warehouses.forEach((w) => { stock[w.id] = svc ? 0 : num(opening[w.id]); });
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
    if (!r.canceled && r.assets?.[0]?.uri) setPhoto(keepPhoto(r.assets[0].uri, 'item'));
  }

  /** Takes one with the camera. */
  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Camera', 'Allow camera access to take a picture.'); return; }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.6, allowsEditing: true, aspect: [4, 3] });
    if (!r.canceled && r.assets?.[0]?.uri) setPhoto(keepPhoto(r.assets[0].uri, 'item'));
  }

  /* ================= tab bodies — reference itemTabBody(), 9217 ================= */

  const basics = (
    <>
      <View style={{ height: 10 }} />
      {/* the outlined type pills — reference sheet, top of Edit Item */}
      <TypeChips
        value={kind}
        options={[
          { v: 'product' as ProductKind, l: 'Simple', i: 'box' as IconName },
          { v: 'service' as ProductKind, l: 'Service', i: 'tools' as IconName },
        ]}
        onChange={setKind}
        style={{ marginBottom: 16 }}
      />

      {/* the tinted highlight card — reference sheet, "This product has variations" */}
      {!svc ? (
        <HighlightToggle
          title="This item is tracked by batch"
          sub="Each delivery keeps its own lot number and expiry date"
          on={trackBatches}
          onChange={setTrackBatches}
        />
      ) : null}

      {/* the media zone — a real photo, or a picked glyph */}
      {photo ? (
        <View style={{ marginBottom: 16 }}>
          <Image
            source={{ uri: photo }}
            style={{ width: '100%', height: 190, borderRadius: radius.md, backgroundColor: colors.sunk }}
            resizeMode="cover"
          />
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
            <View style={{ flex: 1 }}>
              <Button label="Replace" icon={<Icon name="tag" size={16} color={colors.ink} />} onPress={pickPhoto} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Remove" variant="dngr" icon={<Icon name="trash" size={16} color={colors.danger} />} onPress={() => setPhoto('')} />
            </View>
          </View>
        </View>
      ) : (
        <>
          <DropZone label="Tap to add product image" onPress={pickPhoto}>
            <Text style={{ fontSize: 40 }}>🖼️</Text>
          </DropZone>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: -6, marginBottom: 16 }}>
            <View style={{ flex: 1 }}>
              <Button size="sm" label="Take a photo" icon={<Icon name="phone" size={15} color={colors.ink} />} onPress={takePhoto} />
            </View>
            <View style={{ flex: 1 }}>
              <Button size="sm" label={'Use a glyph  ' + (image || '📦')} onPress={() => setSheet('emoji')} />
            </View>
          </View>
        </>
      )}

      <Field icon="tag" label="Name" value={name} onChangeText={setName} placeholder={svc ? 'Delivery within town' : 'Cement 50kg bag'} />
      <Field icon="doc" label="Item code" value={sku} onChangeText={setSku} placeholder={svc ? 'SRV-DEL' : 'CEM-050'} />

      <SelectField
        icon="tag"
        label="Category"
        value={category}
        options={cats.map((c) => ({ v: c, l: c }))}
        onChange={setCategory}
        placeholder="Select category"
      />
      <View style={{ marginTop: -4, marginBottom: 6 }}>
        <Button size="sm" label="New category" icon={<Icon name="plus" size={15} color={colors.ink} />} onPress={() => setSheet('category')} />
      </View>

      {svc ? null : (
        <>
          <SectionCap style={{ marginTop: 16 }}>Barcodes</SectionCap>
          <Card style={{ marginBottom: 8 }}>
            {barcodes.length ? barcodes.map((b, i) => (
              <View key={b} style={{
                flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 14,
                borderBottomWidth: i === barcodes.length - 1 ? 0 : 1, borderBottomColor: colors.line,
              }}>
                <Text style={{ flex: 1, fontFamily: fonts.mono, fontSize: 13, letterSpacing: 0.6, color: colors.ink }}>{b}</Text>
                <Pressable hitSlop={8} onPress={() => setBarcodes(barcodes.filter((x) => x !== b))}>
                  <Icon name="x" size={15} color={colors.faint} />
                </Pressable>
              </View>
            )) : (
              <View style={{ paddingVertical: 16, paddingHorizontal: 14 }}>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, textAlign: 'center' }}>
                  No barcode yet. Scan one, type it, or let the app make one.
                </Text>
              </View>
            )}
          </Card>
          <Grid cols={3}>
            <Button size="sm" label="Scan" icon={<Icon name="search" size={14} color={colors.ink} />} onPress={() => setSheet('barcode')} />
            <Button size="sm" label="Type it" onPress={() => { setTypedCode(''); setSheet('barcode'); }} />
            <Button size="sm" label="Generate" onPress={() => addBarcode(makeBarcode())} />
          </Grid>
        </>
      )}

      <View style={{ height: 14 }} />
      <SelectField label="Sold by" value={unit} options={units.map((u) => ({ v: u, l: u }))} onChange={setUnit} />
      <Button size="sm" label="+ New unit" onPress={() => setSheet('unit')} />
    </>
  );

  const pricing = (
    <>
      {showCost ? (
        <>
          <View style={{ height: 14 }} />
          <SectionCap>Pricing</SectionCap>
          <Grid cols={2} gap={12}>
            <Field icon="money" label={svc ? 'What it costs you' : 'Cost price'} value={cost} onChangeText={setCost} numeric decimal placeholder="0" />
            <Field icon="coins" label="Sale price" value={price} onChangeText={setPrice} numeric decimal placeholder="0" />
          </Grid>
        </>
      ) : (
        <Field icon="coins" label="Sale price" value={price} onChangeText={setPrice} numeric placeholder="0" />
      )}

      {showCost ? (
        <>
          <SectionCap style={{ marginTop: 12 }}>Set the price from a markup</SectionCap>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 12 }}>
            {[10, 15, 20, 25, 30, 50, 100].map((m) => (
              <ActionChip key={m} label={m + '%'} onPress={() => applyMarkup(m)} />
            ))}
          </View>
          <MarginCard cost={num(cost)} price={num(price)} />
        </>
      ) : null}

      {db.settings.taxEnabled === false ? (
        <InfoBanner
          tone="neutral"
          icon="bank"
          text={'Tax is switched off for the whole shop, so nothing is charged on this item. Turn it on under Settings \u2192 Selling \u2192 Tax.'}
        />
      ) : (
        <>
          <HighlightToggle
            tone="warn"
            title={'This item is ' + (db.settings.taxName || 'VAT') + ' exempt'}
            sub={'No ' + (db.settings.taxName || 'VAT') + ' is charged on it, whatever the shop rate is'}
            on={taxExempt}
            onChange={setTaxExempt}
          />
          {!taxExempt ? (
            <Field
              icon="pie"
              label={(db.settings.taxName || 'VAT') + ' %'}
              value={taxRate}
              onChangeText={setTaxRate}
              numeric
              decimal
            />
          ) : null}
        </>
      )}

      <View style={{ height: 9 }} />
      <SectionCap>Second unit &amp; price</SectionCap>
      <FieldNote>Sell the same item two ways — a carton and a piece, a sack and a kilo.</FieldNote>
      <Grid cols={2}>
        <SelectField
          label="Second unit"
          value={secondaryUnit}
          options={[{ v: '', l: '— none —' }].concat(units.map((u) => ({ v: u, l: u })))}
          onChange={setSecondaryUnit}
        />
        <Field label={'How many in one ' + (unit || 'unit')} value={conversionRate} onChangeText={setConversionRate} numeric placeholder="Months, if any" />
      </Grid>
      {secondaryUnit && num(conversionRate) > 0 ? (
        <>
          <Field
            label={'Price for one ' + secondaryUnit}
            value={secondaryPrice}
            onChangeText={setSecondaryPrice}
            numeric
            placeholder={String(Math.round(num(price) / num(conversionRate)))}
          />
          <View style={{ backgroundColor: colors.accentSoft, borderRadius: radius.md, padding: 12, marginBottom: 12 }}>
            <Cap style={{ color: colors.accent }}>Works out as</Cap>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.accent, marginTop: 3 }}>
              1 {unit} = {num(conversionRate)} {secondaryUnit} · {money(num(price))} vs{' '}
              {money(num(secondaryPrice) || Math.round(num(price) / num(conversionRate)))} each
            </Text>
          </View>
        </>
      ) : null}
      <ToggleRow label="Staff may change the price at the till" on={priceChangeAllowed} onChange={setPriceChangeAllowed} />
    </>
  );

  /** Reference the service Delivery tab injected by the wrapper at 16893. */
  const delivery = (
    <>
      <SectionCap>How it is priced</SectionCap>
      <ChipRow
        value={rateType}
        options={SERVICE_RATE.map((r) => ({ v: r[0], l: r[1] }))}
        onChange={setRateType}
        style={{ marginBottom: 10 }}
      />
      <Card style={{ padding: 12, marginBottom: 12 }}>
        <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, lineHeight: 17, color: colors.faint }}>
          {(SERVICE_RATE.find((r) => r[0] === rateType) || SERVICE_RATE[0])[2]}
        </Text>
      </Card>
      <Field icon="clock" label="How long it usually takes" value={duration} onChangeText={setDuration} placeholder={rateType === 'hour' ? '2 hours' : 'Half a day'} />
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
      <View style={{ height: 14 }} />
      <Grid cols={2} gap={12}>
        <Field icon="money" label="Cost to deliver" value={cost} onChangeText={setCost} numeric decimal />
        <Field icon="shield" label="Warranty (months)" value={warrantyMonths} onChangeText={setWarrantyMonths} numeric />
      </Grid>
      <FieldNote>
        A service has no shelf, so there is nothing to count — but it still has a cost, and it can still carry a guarantee.
      </FieldNote>
    </>
  );

  const stock = (
    <>
      <ToggleRow label="Keep count of this item" on={trackInventory} onChange={setTrackInventory} />
      {!trackInventory ? (
        <FieldNote>Off means you sell it without counting — handy for things bought fresh each morning.</FieldNote>
      ) : (
        <>
          {!existing ? (
            <>
              <SectionCap style={{ marginTop: 10 }}>Opening quantity</SectionCap>
              <Card style={{ marginBottom: 6 }}>
                {db.warehouses.map((w, i) => (
                  <View key={w.id} style={{
                    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 14,
                    borderBottomWidth: i === db.warehouses.length - 1 ? 0 : 1, borderBottomColor: colors.line,
                  }}>
                    <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink }}>{w.name}</Text>
                    <Field
                      value={opening[w.id] || '0'}
                      onChangeText={(v) => setOpening({ ...opening, [w.id]: v })}
                      numeric compact
                      style={{ width: 96, marginBottom: 0 }}
                    />
                  </View>
                ))}
              </Card>
              <FieldNote>Posted as opening stock against owner equity, dated today. {totalOpening ? '(' + totalOpening + ' ' + unit + ' in all)' : ''}</FieldNote>
            </>
          ) : (
            <Card style={{ marginTop: 10, marginBottom: 12 }}>
              {db.warehouses.map((w, i) => (
                <View key={w.id} style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 14,
                  borderBottomWidth: i === db.warehouses.length - 1 ? 0 : 1, borderBottomColor: colors.line,
                }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink }}>{w.name}</Text>
                    <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 1 }}>on hand now</Text>
                  </View>
                  <Text style={{ fontFamily: fonts.monoSemi, fontSize: 13.5, color: colors.ink }}>
                    {(existing.stock || {})[w.id] || 0} {unit}
                  </Text>
                </View>
              ))}
            </Card>
          )}

          <View style={{ height: 14 }} />
          <SectionCap>Stock rules</SectionCap>
          <Grid cols={2} gap={12}>
            <Field icon="alert" label="Reorder at" value={reorder} onChangeText={setReorder} numeric />
            <Field icon="shield" label="Warranty (months)" value={warrantyMonths} onChangeText={setWarrantyMonths} numeric />
          </Grid>

          {/* the wrapper's second-unit block — reference 16924 */}
          <View style={{ height: 6 }} />
          {db.settings.useSecondaryUnit ? (
            <>
              <SectionCap>Second unit</SectionCap>
              <Grid cols={2} gap={12}>
                <Field icon="swap" label="Also sold as" value={secondaryUnit} onChangeText={setSecondaryUnit} placeholder={unit === 'PC' ? 'box' : 'carton'} />
                <Field label="One holds" value={conversionRate} onChangeText={setConversionRate} numeric placeholder="12" />
              </Grid>
              {secondaryUnit && num(conversionRate) > 0 ? (
                <Card style={{ padding: 12, marginBottom: 12 }}>
                  <KV label={'1 ' + secondaryUnit} value={num(conversionRate) + ' ' + unit} last={!num(price)} />
                  {num(price) ? <KV label={'Price per ' + secondaryUnit} value={money(num(price) * num(conversionRate))} last /> : null}
                </Card>
              ) : (
                <FieldNote>Sell in cartons but count in pieces — stock stays in the base unit.</FieldNote>
              )}
            </>
          ) : (
            <Card style={{ padding: 12, marginBottom: 12 }}>
              <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, lineHeight: 17, color: colors.faint }}>
                A second unit is switched off. Turn it on under Settings → Stock if you buy in cartons and sell in pieces.
              </Text>
            </Card>
          )}

          <Card style={{ paddingHorizontal: 13 }}>
            <ToggleRow label="Track batches and expiry" on={trackBatches} onChange={setTrackBatches} bare />
            {trackBatches ? (
              <View style={{ marginTop: 14 }}>
                <BatchEditor
                  batches={batchList}
                  onChange={setBatchList}
                  unit={unit || 'pcs'}
                  suggestNo={() => (sku || 'B').toUpperCase().slice(0, 4) + '-' + String(batchList.length + 1).padStart(3, '0')}
                />
              </View>
            ) : null}
            <View style={{ height: 1, backgroundColor: colors.line }} />
            <ToggleRow label="Track serial numbers or IMEIs" on={trackSerials} onChange={setTrackSerials} bare />
            {trackSerials ? (
              <View style={{ marginTop: 14 }}>
                <SerialEditor
                  serials={serialList}
                  onChange={setSerialList}
                  expected={existing ? Object.values(existing.stock || {}).reduce((a, b) => a + (b || 0), 0) : undefined}
                />
              </View>
            ) : null}
          </Card>
        </>
      )}
    </>
  );

  const more = (
    <>
      <SectionCap>Colour tag</SectionCap>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {ITEM_COLOR.map((c) => <Swatch key={c || 'none'} color={c} on={color === c} onPress={() => setColor(c)} />)}
      </View>
      <Field icon="cart" label="Default quantity on a bill" value={defaultQty} onChangeText={setDefaultQty} numeric />
      <Field icon="doc" label="Note for staff" value={note} onChangeText={setNote} multiline placeholder="Anything they should know when selling it" />

      <View style={{ height: 6 }} />
      <SectionCap>Where it posts in the books</SectionCap>
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
      <ToggleRow label="Active — offer it for sale" on={active} onChange={setActive} />
    </>
  );

  const body = tab === 'basics' ? basics
    : tab === 'pricing' ? pricing
      : tab === 'stock' ? (svc ? delivery : stock)
        : more;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TopTabs
        value={tab}
        onChange={(v) => setTab(v as any)}
        options={[
          { v: 'basics', l: 'Basics', i: 'doc' },
          { v: 'pricing', l: 'Pricing', i: 'coins' },
          { v: 'stock', l: svc ? 'Delivery' : 'Stock', i: 'box' },
          { v: 'more', l: 'More', i: 'dots' },
        ]}
      />

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        {body}
        {existing ? (
          <View style={{ marginTop: 16 }}>
            <Button variant="dngr" label="Remove this item" onPress={remove} />
          </View>
        ) : null}
      </ScrollView>

      <Foot>
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

      {/* SHEETS.pickEmoji — reference 9378 */}
      <Sheet visible={sheet === 'emoji'} title="Pick a picture" icon="tag" onClose={() => setSheet(null)}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {ITEM_EMOJI.map((e) => (
            <Pressable
              key={e}
              onPress={() => { setImage(e); setSheet(null); }}
              style={{
                width: 52, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
                backgroundColor: e === image ? colors.accentSoft : colors.sunk,
                borderWidth: 1, borderColor: e === image ? colors.accent : 'transparent',
              }}
            >
              <Text style={{ fontSize: 24 }}>{e}</Text>
            </Pressable>
          ))}
        </View>
        <View style={{ height: 12 }} />
        <Button size="sm" label="Use no picture" onPress={() => { setImage(''); setSheet(null); }} />
      </Sheet>

      {/* SHEETS.newUnit — reference 9424 */}
      <Sheet
        visible={sheet === 'unit'}
        title="New unit"
        icon="swap"
        onClose={() => setSheet(null)}
        footer={<Button variant="pri" label="Add unit" onPress={() => {
          const v = newUnit.trim().toUpperCase();
          if (!v) return;
          addUnit(v); setUnit(v); setNewUnit(''); setSheet(null);
        }} />}
      >
        <Field label="Short name" value={newUnit} onChangeText={setNewUnit} placeholder="CTN" />
        <FieldNote>Keep it short — it prints on the receipt beside every quantity.</FieldNote>
        <Cap style={{ marginBottom: 8 }}>Already set up</Cap>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {units.map((u) => <Pill key={u} label={u} />)}
        </View>
      </Sheet>

      {/* SHEETS.newCategory — reference 9431 */}
      <Sheet
        visible={sheet === 'category'}
        title="New category"
        icon="tag"
        onClose={() => setSheet(null)}
        footer={<Button variant="pri" label="Add category" onPress={() => {
          const v = newCat.trim();
          if (!v) return;
          addCategory(v); setCategory(v); setNewCat(''); setSheet(null);
        }} />}
      >
        <Field label="Name" value={newCat} onChangeText={setNewCat} placeholder="Hardware" />
        <Cap style={{ marginBottom: 8 }}>Already set up</Cap>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {cats.map((c) => <Pill key={c} label={c} />)}
        </View>
      </Sheet>

      {/* SHEETS.scanBarcode / typeBarcode — reference 9392-9410 */}
      <Sheet visible={sheet === 'barcode'} title="Add a barcode" icon="box" onClose={() => setSheet(null)}>
        <ScanBox />
        <Button label="Open the camera" icon={<Icon name="search" size={15} color={colors.ink} />} onPress={() => setScanOpen(true)} />
        <View style={{ height: 12 }} />
        <Field label="Or enter it by hand" value={typedCode} onChangeText={setTypedCode} placeholder="6201234567890" numeric />
        <Button variant="pri" label="Add this barcode" onPress={() => { addBarcode(typedCode); setTypedCode(''); setSheet(null); }} />
        <View style={{ height: 9 }} />
        <Button size="sm" label="Generate one instead" onPress={() => { addBarcode(makeBarcode()); setSheet(null); }} />
      </Sheet>

      <BarcodeScannerModal
        visible={scanOpen}
        onClose={() => setScanOpen(false)}
        onScan={(code) => { setScanOpen(false); setSheet(null); addBarcode(code); }}
      />
    </View>
  );
}

/** Units & categories — reference SCREENS.unitsCats, line 9440. */
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
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink }}>{u}</Text>
                    <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>{n} item{n === 1 ? '' : 's'}</Text>
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
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink }}>{c}</Text>
                    <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>{items.length} item{items.length === 1 ? '' : 's'}</Text>
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
