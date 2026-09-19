/**
 * Price tags.
 *
 * Pick what to print, then build the tag itself: every part can be switched off
 * and the two that matter — the price and the barcode — can be sized. What you
 * see in the preview is exactly what the sheet prints, because both are drawn
 * from the same settings.
 */
import React, { useMemo, useState } from 'react';
import { code128b, code128Html } from '../data/code128';
import { useCan, Denied } from '../components/Gate';
import { View, Text, FlatList, Pressable, ScrollView, Alert } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useToast } from '../components/Toast';
import {
  Panel, Badge, SectionLabel, EmptyBlock, Search, InfoBanner, Button, StickyBar,
  TopTabs, Sw, SelectField,
} from '../components/ui';
import { Icon } from '../components/icons';
import type { Product, Paper, Printer } from '../data/types';
import { defaultPrinter, paperOf } from '../data/printSetup';
import { pageSize } from '../data/docPrint';
import { Platform } from 'react-native';

type Size = 'small' | 'medium' | 'large';

interface TagStyle {
  shopName: boolean;
  name: boolean;
  sku: boolean;
  category: boolean;
  price: boolean;
  barcode: boolean;
  unit: boolean;
  priceSize: Size;
  barcodeSize: Size;
  perRow: 2 | 3 | 4;
}

const PRICE_PT: Record<Size, number> = { small: 15, medium: 21, large: 29 };
const BAR_H: Record<Size, number> = { small: 26, medium: 40, large: 56 };

function esc(s: unknown) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * A real Code 128 B barcode. Two modules to a narrow bar, which is about the
 * finest most thermal and inkjet printers hold, and the code is printed
 * underneath so it can still be keyed in if a scanner is having a bad day.
 */
function barsFor(code: string, height: number, module = 2): string {
  return code128Html(code, height, module);
}

/** The code on the tag: the item's own barcode when it has one, else its SKU. */
export function tagCode(p: Product): string {
  return (p.barcodes || []).find((x) => x && x.trim()) || p.sku;
}

/**
 * The print sheet. On a roll (58mm or 80mm label or receipt printer) each tag
 * is its own label, full width, one after another. On A4 the tags are laid out
 * in a grid to be cut apart. Each item is repeated as many times as asked.
 */
export function tagHtml(items: Array<{ p: Product; n: number }>, style: TagStyle, shop: string, money: (n: number) => string, paper: Paper) {
  const roll = paper !== 'A4';
  const narrow = paper === '58mm';
  const w = roll ? 100 : style.perRow === 2 ? 48 : style.perRow === 3 ? 31.5 : 23.5;
  const scale = roll ? (narrow ? 1 : 1.15) : style.perRow === 4 ? 0.85 : 1;
  const one = (p: Product) => `
    <div class="tag" style="width:${w}%">
      ${style.shopName ? `<div class="shop">${esc(shop)}</div>` : ''}
      ${style.name ? `<div class="name">${esc(p.name)}</div>` : ''}
      ${style.category && p.category ? `<div class="meta">${esc(p.category)}</div>` : ''}
      ${style.price ? `<div class="price" style="font-size:${Math.round(PRICE_PT[style.priceSize] * scale)}px">${esc(money(p.price))}${style.unit ? `<span class="per"> / ${esc(p.unit)}</span>` : ''}</div>` : ''}
      ${style.barcode ? `<div class="bars">${barsFor(tagCode(p), Math.round(BAR_H[style.barcodeSize] * scale), narrow ? 1 : 2)}</div>` : ''}
      ${style.sku ? `<div class="sku">${esc(tagCode(p))}</div>` : ''}
    </div>`;
  const cells = items.flatMap(({ p, n }) => Array.from({ length: Math.max(1, n) }, () => one(p))).join('');

  return `<!doctype html><html><head><meta charset="utf-8"/>
<style>
  @page { ${roll ? `size: ${narrow ? 58 : 80}mm auto; margin: 1.5mm;` : 'size: A4; margin: 8mm;'} }
  body { font-family: -apple-system, Roboto, Helvetica, Arial, sans-serif; margin: 0; color: #000; }
  svg { display: inline-block; max-width: 100%; }
  .sheet { display: flex; flex-wrap: wrap; gap: ${roll ? 0 : 8}px; }
  .tag { border: ${roll ? '0' : '1px dashed #999'}; border-radius: 6px; padding: ${roll ? '3mm 1mm' : '8px 6px'}; text-align: center;
         box-sizing: border-box; page-break-inside: avoid; ${roll ? 'page-break-after: always; border-bottom: 1px dashed #000;' : ''} }
  .tag:last-child { page-break-after: auto; }
  .shop { font-size: ${narrow ? 8 : 9}px; color: #333; text-transform: uppercase; letter-spacing: .5px; }
  .name { font-size: ${roll ? (narrow ? 12 : 14) : 11}px; font-weight: 700; margin-top: 2px; line-height: 1.25; }
  .meta { font-size: 8px; color: #444; margin-top: 1px; }
  .price { font-weight: 800; margin-top: 5px; letter-spacing: -.4px; }
  .per { font-size: 9px; font-weight: 500; color: #333; }
  .bars { margin-top: 5px; line-height: 0; }
  .sku { font-family: monospace; font-size: ${roll ? 10 : 8}px; color: #111; margin-top: 3px; }
</style></head><body><div class="sheet">${cells}</div></body></html>`;
}

export default function PriceTagScreen(p: any) {
  // checked before the body runs, so nothing inside it can post first
  const allowed = useCan('inventory.view_selling_price');
  if (!allowed) return <Denied title="Price tags are closed to you" hint="Tags print selling prices, so this needs permission to see them." />;
  return <PriceTagScreenBody  />;
}

function PriceTagScreenBody() {
  const { colors } = useTheme();
  const { db, money } = useAppData();
  const { success, error } = useToast();

  const [tab, setTab] = useState<'pick' | 'design'>('pick');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  // how many of each: a shelf of twelve tins wants twelve tags, not one
  const [copies, setCopies] = useState<Record<string, number>>({});
  const [printerId, setPrinterId] = useState<string>(defaultPrinter(db)?.id || '');
  const printer: Printer | undefined = (db?.printers || []).find((x) => x.id === printerId);
  const [paper, setPaper] = useState<Paper>(paperOf(defaultPrinter(db), 'A4'));
  const [style, setStyle] = useState<TagStyle>({
    shopName: true, name: true, sku: true, category: false,
    price: true, barcode: true, unit: false,
    priceSize: 'medium', barcodeSize: 'medium', perRow: 3,
  });

  const all = (db?.products || []).filter((p) => p.active);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter((p) => !needle || p.name.toLowerCase().includes(needle) || p.sku.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [all, q]);

  const chosen = all.filter((p) => picked[p.id]);
  const sample = chosen[0] || all[0];
  const countOf = (id: string) => Math.max(1, copies[id] || 1);
  const tagCount = chosen.reduce((n, p) => n + countOf(p.id), 0);
  // the preview draws the same widths the printer will, so nothing is a surprise
  const previewBars = useMemo(() => code128b(sample ? tagCode(sample) : ''), [sample]);

  const set = (patch: Partial<TagStyle>) => setStyle((s) => ({ ...s, ...patch }));

  async function print(share: boolean) {
    if (!chosen.length) { error('Choose at least one item.'); return; }
    const html = tagHtml(chosen.map((p) => ({ p, n: countOf(p.id) })), style, db?.firm.name || '', money, paper);
    const size = paper === 'A4' ? pageSize('A4') : pageSize(paper, tagCount * 4);
    try {
      if (share) {
        const { uri } = await Print.printToFileAsync({ html, ...size });
        if (!(await Sharing.isAvailableAsync())) { error('Sharing is not available here.'); return; }
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Price tags' });
      } else {
        await Print.printAsync({ html, ...size, ...(Platform.OS === 'ios' && printer?.url ? { printerUrl: printer.url } : null) });
      }
      success(tagCount + ' tag' + (tagCount === 1 ? '' : 's') + ' sent');
    } catch (e: any) {
      error(e?.message || 'That could not be printed.');
    }
  }

  if (!db) return null;

  /** One switchable part of the tag. */
  const toggle = (label: string, sub: string, key: keyof TagStyle) => (
    <Pressable
      key={key}
      onPress={() => set({ [key]: !style[key] } as Partial<TagStyle>)}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.line,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14.5, color: colors.ink }}>{label}</Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 2 }}>{sub}</Text>
      </View>
      <Sw on={!!style[key]} onPress={() => set({ [key]: !style[key] } as Partial<TagStyle>)} />
    </Pressable>
  );

  const sizeRow = (label: string, key: 'priceSize' | 'barcodeSize') => (
    <View style={{ marginTop: 14 }}>
      <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginBottom: 8 }}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 9 }}>
        {(['small', 'medium', 'large'] as Size[]).map((s) => {
          const on = style[key] === s;
          return (
            <Pressable
              key={s}
              onPress={() => set({ [key]: s } as Partial<TagStyle>)}
              style={{
                flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: radius.md,
                borderWidth: 1.4, borderColor: on ? colors.accent : colors.line,
                backgroundColor: on ? colors.accentSoft : colors.surface,
              }}
            >
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: on ? colors.accent : colors.soft }}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TopTabs
        value={tab}
        onChange={setTab}
        options={[
          { v: 'pick', l: 'Choose items', i: 'box' },
          { v: 'design', l: 'Design the tag', i: 'tag' },
        ]}
      />

      {tab === 'pick' ? (
        <FlatList
          data={rows}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 150, flexGrow: 1 }}
          ListHeaderComponent={
            <View style={{ paddingTop: 14, gap: 14, marginBottom: 14 }}>
              <Search value={q} onChange={setQ} placeholder="Search name or code" />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    size="sm"
                    label={chosen.length === rows.length && rows.length ? 'Clear all' : 'Select all shown'}
                    onPress={() => {
                      if (chosen.length === rows.length) { setPicked({}); return; }
                      const next: Record<string, boolean> = {};
                      rows.forEach((p) => { next[p.id] = true; });
                      setPicked(next);
                    }}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    size="sm"
                    label="Only low stock"
                    onPress={() => {
                      const next: Record<string, boolean> = {};
                      rows.filter((p) => (p.stock?.[db.session.warehouse] || 0) <= p.reorder).forEach((p) => { next[p.id] = true; });
                      setPicked(next);
                    }}
                  />
                </View>
              </View>
              {chosen.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>Copies of each chosen item:</Text>
                  {[1, 2, 5, 10, 20].map((n) => (
                    <Pressable
                      key={n}
                      onPress={() => { const next: Record<string, number> = {}; chosen.forEach((p) => { next[p.id] = n; }); setCopies(next); }}
                      style={{ paddingVertical: 6, paddingHorizontal: 11, borderRadius: radius.pill, borderWidth: 1.2, borderColor: colors.line, backgroundColor: colors.surface }}
                    >
                      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.soft }}>×{n}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              <SectionLabel right={<Badge label={chosen.length + ' chosen · ' + tagCount + ' tags'} tone={chosen.length ? 'accent' : 'neutral'} />}>
                {rows.length} items
              </SectionLabel>
            </View>
          }
          ListEmptyComponent={<Panel><EmptyBlock icon="box" title="Nothing matches" /></Panel>}
          renderItem={({ item: p }) => {
            const on = !!picked[p.id];
            return (
              <Pressable
                onPress={() => setPicked((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                style={{
                  backgroundColor: on ? colors.accentSoft : colors.surface,
                  borderRadius: 16, paddingHorizontal: 15, paddingVertical: 14, marginBottom: 10,
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  borderWidth: on ? 1.5 : 0, borderColor: colors.accent,
                  shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, elevation: 2,
                }}
              >
                <View style={{
                  width: 26, height: 26, borderRadius: 8, borderWidth: 1.8,
                  borderColor: on ? colors.accent : colors.lineHard,
                  backgroundColor: on ? colors.accent : 'transparent',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  {on ? <Icon name="check" size={16} color={colors.accentInk} /> : null}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{p.name}</Text>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 3 }}>
                    {money(p.price)} · {tagCode(p)}
                  </Text>
                </View>
                {on ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Pressable
                      hitSlop={6}
                      onPress={() => setCopies((c) => ({ ...c, [p.id]: Math.max(1, countOf(p.id) - 1) }))}
                      style={{ width: 32, height: 32, borderRadius: 10, borderWidth: 1.4, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface }}
                    >
                      <Text style={{ fontFamily: fonts.uiBold, fontSize: 17, color: colors.accent }}>−</Text>
                    </Pressable>
                    <Text style={{ minWidth: 30, textAlign: 'center', fontFamily: fonts.uiExtra, fontSize: 15, color: colors.ink }}>×{countOf(p.id)}</Text>
                    <Pressable
                      hitSlop={6}
                      onPress={() => setCopies((c) => ({ ...c, [p.id]: Math.min(500, countOf(p.id) + 1) }))}
                      onLongPress={() => setCopies((c) => ({ ...c, [p.id]: Math.min(500, countOf(p.id) + 10) }))}
                      style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}
                    >
                      <Text style={{ fontFamily: fonts.uiBold, fontSize: 17, color: colors.accentInk }}>+</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{money(p.price)}</Text>
                )}
              </Pressable>
            );
          }}
        />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 150 }}>
          <SectionLabel>Printer and paper</SectionLabel>
          <Panel>
            {(db.printers || []).length ? (
              <>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginBottom: 8 }}>Print on</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                  {db.printers.map((pr) => {
                    const on = pr.id === printerId;
                    return (
                      <Pressable
                        key={pr.id}
                        onPress={() => { setPrinterId(pr.id); setPaper(paperOf(pr, paper)); }}
                        style={{
                          paddingVertical: 9, paddingHorizontal: 13, borderRadius: radius.pill, borderWidth: 1.4,
                          borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accentSoft : colors.surface,
                        }}
                      >
                        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: on ? colors.accent : colors.soft }}>
                          {pr.name} · {paperOf(pr)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginBottom: 8 }}>Paper</Text>
            <View style={{ flexDirection: 'row', gap: 9 }}>
              {([['58mm', '58mm roll'], ['80mm', '80mm roll'], ['A4', 'A4 sheet']] as Array<[Paper, string]>).map(([v, l]) => {
                const on = paper === v;
                return (
                  <Pressable
                    key={v}
                    onPress={() => setPaper(v)}
                    style={{
                      flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: radius.md,
                      borderWidth: 1.4, borderColor: on ? colors.accent : colors.line,
                      backgroundColor: on ? colors.accentSoft : colors.surface,
                    }}
                  >
                    <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: on ? colors.accent : colors.soft }}>{l}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 10 }}>
              {paper === 'A4'
                ? 'Tags are laid out in a grid on the page, to cut apart.'
                : 'One tag per label, full width of the roll — for a POS or label printer.'}
              {Platform.OS === 'android' ? ' Android asks which printer in its print window.' : ''}
            </Text>
          </Panel>

          <View style={{ height: 20 }} />
          {/* live preview, drawn from the same settings the sheet prints */}
          <SectionLabel>Preview</SectionLabel>
          <Panel style={{ alignItems: 'center', paddingVertical: 24 }}>
            {sample ? (
              <View
                style={{
                  width: 200, borderRadius: 10, borderWidth: 1.4, borderColor: colors.lineHard,
                  borderStyle: 'dashed', paddingVertical: 14, paddingHorizontal: 12, alignItems: 'center',
                  backgroundColor: '#fff',
                }}
              >
                {style.shopName ? (
                  <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 9, letterSpacing: 0.5, color: '#777', textTransform: 'uppercase' }}>
                    {db.firm.name}
                  </Text>
                ) : null}
                {style.name ? (
                  <Text numberOfLines={2} style={{ fontFamily: fonts.uiBold, fontSize: 13, color: '#111', textAlign: 'center', marginTop: 3 }}>
                    {sample.name}
                  </Text>
                ) : null}
                {style.category && sample.category ? (
                  <Text style={{ fontFamily: fonts.ui, fontSize: 9.5, color: '#888', marginTop: 2 }}>{sample.category}</Text>
                ) : null}
                {style.price ? (
                  <Text style={{ fontFamily: fonts.uiExtra, fontSize: PRICE_PT[style.priceSize], color: '#111', marginTop: 6, letterSpacing: -0.5 }}>
                    {money(sample.price)}
                    {style.unit ? <Text style={{ fontFamily: fonts.ui, fontSize: 10, color: '#666' }}> / {sample.unit}</Text> : null}
                  </Text>
                ) : null}
                {style.barcode ? (
                  <View style={{ flexDirection: 'row', marginTop: 7, height: BAR_H[style.barcodeSize], alignItems: 'flex-end' }}>
                    {previewBars.length ? previewBars.map((w, i) => (
                      <View
                        key={i}
                        style={{ width: w * 1.4, height: BAR_H[style.barcodeSize], backgroundColor: i % 2 === 0 ? '#111' : '#fff' }}
                      />
                    )) : (
                      <Text style={{ fontFamily: fonts.ui, fontSize: 10.5, color: '#b00' }}>
                        This item code cannot be printed as a barcode
                      </Text>
                    )}
                  </View>
                ) : null}
                {style.sku ? (
                  <Text style={{ fontFamily: fonts.mono, fontSize: 9, color: '#555', marginTop: 4 }}>{tagCode(sample)}</Text>
                ) : null}
                {!style.name && !style.price && !style.barcode && !style.sku && !style.shopName ? (
                  <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: '#bbb' }}>Everything is switched off</Text>
                ) : null}
              </View>
            ) : (
              <EmptyBlock icon="tag" title="No item to preview" />
            )}
          </Panel>

          <View style={{ height: 20 }} />
          <SectionLabel>What the tag shows</SectionLabel>
          <Panel>
            {toggle('Shop name', 'Small line across the top', 'shopName')}
            {toggle('Item name', 'What it is', 'name')}
            {toggle('Category', 'Where it belongs', 'category')}
            {toggle('Price', 'The figure the customer reads', 'price')}
            {toggle('Per unit', 'Adds “/ pcs” after the price', 'unit')}
            {toggle('Barcode', 'For the scanner at the till', 'barcode')}
            {toggle('Item code', 'Printed under the bars', 'sku')}
          </Panel>

          <View style={{ height: 20 }} />
          <SectionLabel>Sizes</SectionLabel>
          <Panel>
            {sizeRow('Price size', 'priceSize')}
            {sizeRow('Barcode size', 'barcodeSize')}
            {paper === 'A4' ? <View style={{ height: 16 }} /> : null}
            {paper === 'A4' ? <SelectField
              icon="chart"
              label="Tags per row on the sheet"
              value={String(style.perRow)}
              options={[
                { v: '2', l: '2 — large tags' },
                { v: '3', l: '3 — standard' },
                { v: '4', l: '4 — small tags' },
              ]}
              onChange={(v) => set({ perRow: Number(v) as 2 | 3 | 4 })}
              style={{ marginBottom: 0 }}
            /> : null}
          </Panel>

          <View style={{ height: 16 }} />
          <InfoBanner
            tone="neutral"
            icon="bulb"
            text="The bars are a real Code 128 barcode of the item's barcode (or its code when it has none), so a tag scans at the till. The code is printed underneath as well, in case a label is smudged."
          />
        </ScrollView>
      )}

      <StickyBar>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
            {tagCount} tag{tagCount === 1 ? '' : 's'} · {paper === 'A4' ? 'A4' : paper + ' roll'}
          </Text>
          {tab === 'pick' && chosen.length ? (
            <Pressable onPress={() => setTab('design')}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: colors.accent }}>Design them →</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button
              label="Share PDF"
              disabled={!chosen.length}
              icon={<Icon name="swap" size={16} color={colors.ink} />}
              onPress={() => print(true)}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label="Print"
              variant="pri"
              disabled={!chosen.length}
              icon={<Icon name="print" size={16} color={colors.accentInk} />}
              onPress={() => print(false)}
            />
          </View>
        </View>
      </StickyBar>
    </View>
  );
}
