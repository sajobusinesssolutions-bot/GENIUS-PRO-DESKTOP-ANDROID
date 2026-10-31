/**
 * Batches & expiry.
 *
 *   Batches — one small card per item: its batches, each with the day it was
 *             bought, the day it expires, the days left and what is held; the
 *             card's head says how much has expired or is about to.
 *   Expiry  — an ageing analysis: expired, then 0–30, 31–60, 61–90, 91–180 and
 *             over 180 days, and no date, each with its lots, quantity and value.
 *             A band opens the lots in it, most urgent first.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Search, TopTabs } from '../components/ui';
import { Icon } from '../components/icons';
import { useGo } from '../nav/navigate';
import { batchRows, ExpiryState } from '../data/batches';
import { MON, tsMs } from '../data/helpers';
import type { Product, ProductBatch } from '../data/types';

type Tab = 'batches' | 'expiry';
type Row = { product: Product; batch: ProductBatch; state: ExpiryState; days: number | null; value: number; bought: string | null };

/* the ageing bands, oldest trouble first */
const BANDS: Array<{ k: string; l: string; test: (d: number | null) => boolean }> = [
  { k: 'expired', l: 'Expired', test: (d) => d !== null && d < 0 },
  { k: '0-30', l: '0–30 days', test: (d) => d !== null && d >= 0 && d <= 30 },
  { k: '31-60', l: '31–60 days', test: (d) => d !== null && d > 30 && d <= 60 },
  { k: '61-90', l: '61–90 days', test: (d) => d !== null && d > 60 && d <= 90 },
  { k: '91-180', l: '91–180 days', test: (d) => d !== null && d > 90 && d <= 180 },
  { k: '180+', l: 'Over 180 days', test: (d) => d !== null && d > 180 },
  { k: 'none', l: 'No expiry date', test: (d) => d === null },
];

const day = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(tsMs(iso));
  if (Number.isNaN(d.getTime())) return '—';
  return (d.getDate() < 10 ? '0' : '') + d.getDate() + ' ' + MON[d.getMonth()] + ' ' + String(d.getFullYear()).slice(2);
};
const plainQty = (n: number) => String(Math.round(n * 100) / 100);

export default function BatchReportScreen() {
  const { colors } = useTheme();
  const { db, money } = useAppData();
  const go = useGo();
  const [tab, setTab] = useState<Tab>('batches');
  const [band, setBand] = useState<string>('');
  const [q, setQ] = useState('');

  /* when each batch first came in: its purchase, or its opening stock */
  const boughtOn = useMemo(() => {
    const m = new Map<string, string>();
    (db?.movements || []).forEach((mv: any) => {
      if (!mv.batchNo || !(mv.qty > 0) || mv.type === 'void') return;
      const k = mv.productId + '|' + mv.batchNo;
      const had = m.get(k);
      if (!had || mv.ts < had) m.set(k, mv.ts);
    });
    return m;
  }, [db?.movements]);

  const rows: Row[] = useMemo(() => (db ? batchRows(db, 90).map((r) => ({ ...r, bought: boughtOn.get(r.product.id + '|' + r.batch.no) || null })) : []), [db, boughtOn]);

  const tone = (d: number | null) => (d === null ? colors.faint : d < 0 ? colors.danger : d <= 30 ? colors.danger : d <= 90 ? colors.warn : colors.good);
  const left = (d: number | null) => (d === null ? 'no date' : d < 0 ? 'expired ' + -d + ' d ago' : d === 0 ? 'expires today' : d + ' days left');

  const needle = q.trim().toLowerCase();
  const match = (r: Row) => !needle || r.product.name.toLowerCase().includes(needle) || r.product.sku.toLowerCase().includes(needle)
    || (r.product.genericName || '').toLowerCase().includes(needle) || r.batch.no.toLowerCase().includes(needle);

  /* Batches: by item */
  const items = useMemo(() => {
    const by = new Map<string, { product: Product; lots: Row[]; qty: number; value: number; expiredQty: number; soonQty: number }>();
    rows.filter(match).forEach((r) => {
      const x = by.get(r.product.id) || { product: r.product, lots: [], qty: 0, value: 0, expiredQty: 0, soonQty: 0 };
      x.lots.push(r); x.qty += r.batch.qty; x.value += r.value;
      if (r.days !== null && r.days < 0) x.expiredQty += r.batch.qty;
      else if (r.days !== null && r.days <= 90) x.soonQty += r.batch.qty;
      by.set(r.product.id, x);
    });
    const list = [...by.values()];
    list.forEach((x) => x.lots.sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9)));
    // items with expired or expiring stock first, then by name
    return list.sort((a, b) => (b.expiredQty > 0 ? 1 : 0) - (a.expiredQty > 0 ? 1 : 0) || (b.soonQty > 0 ? 1 : 0) - (a.soonQty > 0 ? 1 : 0) || a.product.name.localeCompare(b.product.name));
  }, [rows, needle]);

  /* Expiry: the ageing bands */
  const aging = useMemo(() => BANDS.map((b) => {
    const lots = rows.filter((r) => b.test(r.days));
    return { ...b, lots: lots.length, qty: lots.reduce((s, r) => s + r.batch.qty, 0), value: lots.reduce((s, r) => s + r.value, 0) };
  }), [rows]);
  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  const lots = useMemo(() => {
    const b = BANDS.find((x) => x.k === band);
    return rows.filter((r) => (b ? b.test(r.days) : r.days !== null && r.days <= 90)).filter(match)
      .sort((a, c) => (a.days ?? 1e9) - (c.days ?? 1e9));
  }, [rows, band, needle]);

  if (!db) return null;

  const card = { marginHorizontal: 16, marginBottom: 6, borderRadius: 4, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, paddingHorizontal: 12, paddingVertical: 9 } as const;

  const head = (
    <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, gap: 8 }}>
      <Search value={q} onChange={setQ} placeholder="Search item, generic name or batch no." />
      {tab === 'expiry' ? (
        <View style={{ borderRadius: 4, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', paddingHorizontal: 10, paddingVertical: 6, backgroundColor: colors.sunk }}>
            {['Ageing', 'Lots', 'Qty', 'Value'].map((h, i) => (
              <Text key={h} style={{ flex: i === 0 ? 1.6 : 1, textAlign: i === 0 ? 'left' : 'right', fontFamily: fonts.uiSemi, fontSize: 10.5, letterSpacing: 0.4, color: colors.faint }}>{h.toUpperCase()}</Text>
            ))}
          </View>
          {aging.map((a) => {
            const on = band === a.k;
            const c = a.k === 'expired' || a.k === '0-30' ? colors.danger : a.k === '31-60' || a.k === '61-90' ? colors.warn : a.k === 'none' ? colors.faint : colors.good;
            return (
              <Pressable key={a.k} onPress={() => setBand(on ? '' : a.k)} style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 7, borderTopWidth: 1, borderTopColor: colors.line,
                backgroundColor: on ? colors.accentSoft : pressed ? colors.sunk : 'transparent',
              })}>
                <View style={{ flex: 1.6, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c }} />
                  <Text style={{ fontFamily: on ? fonts.uiSemi : fonts.ui, fontSize: 12, color: colors.ink }}>{a.l}</Text>
                </View>
                <Text style={{ flex: 1, textAlign: 'right', fontFamily: fonts.ui, fontSize: 12, color: colors.soft }}>{a.lots}</Text>
                <Text style={{ flex: 1, textAlign: 'right', fontFamily: fonts.ui, fontSize: 12, color: colors.soft }}>{plainQty(a.qty)}</Text>
                <Text numberOfLines={1} style={{ flex: 1, textAlign: 'right', fontFamily: fonts.uiSemi, fontSize: 12, color: a.value && (a.k === 'expired' || a.k === '0-30') ? colors.danger : colors.ink }}>{money(a.value)}</Text>
              </Pressable>
            );
          })}
          {/* how the value splits, as one bar */}
          <View style={{ flexDirection: 'row', height: 6, margin: 10, borderRadius: 3, overflow: 'hidden', backgroundColor: colors.sunk }}>
            {aging.map((a) => (a.value > 0 && totalValue > 0 ? (
              <View key={a.k} style={{ flex: a.value / totalValue, backgroundColor: a.k === 'expired' || a.k === '0-30' ? colors.danger : a.k === '31-60' || a.k === '61-90' ? colors.warn : a.k === 'none' ? colors.lineHard : colors.good }} />
            ) : null))}
          </View>
        </View>
      ) : null}
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 10.5, letterSpacing: 0.5, color: colors.faint, marginTop: 2 }}>
        {tab === 'batches'
          ? items.length + ' ITEM' + (items.length === 1 ? '' : 'S') + ' · ' + rows.length + ' BATCHES · ' + money(totalValue).toUpperCase()
          : (band ? (BANDS.find((b) => b.k === band)?.l || '').toUpperCase() : 'EXPIRED AND DUE IN 90 DAYS') + ' · ' + lots.length + ' LOT' + (lots.length === 1 ? '' : 'S')}
      </Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TopTabs value={tab} onChange={(v) => { setTab(v); setBand(''); }} options={[{ v: 'batches', l: 'Batches', i: 'box' }, { v: 'expiry', l: 'Expiry', i: 'clock' }]} />
      {tab === 'batches' ? (
        <FlatList
          data={items}
          keyExtractor={(x) => x.product.id}
          ListHeaderComponent={head}
          contentContainerStyle={{ paddingBottom: 96 }}
          initialNumToRender={12}
          windowSize={7}
          ListEmptyComponent={<Text style={{ textAlign: 'center', padding: 32, fontFamily: fonts.ui, fontSize: 13, color: colors.faint }}>{q ? 'Nothing matches that search.' : 'No batches yet. Turn on batch tracking for an item and add its batches when buying.'}</Text>}
          renderItem={({ item }) => (
            <Pressable onPress={() => go('ItemDetail', { productId: item.product.id })} style={({ pressed }) => [card, pressed ? { backgroundColor: colors.sunk } : null]}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink }}>{item.product.name}</Text>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>{plainQty(item.qty)} <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>{item.product.unit}</Text></Text>
              </View>
              <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 1 }}>
                {item.lots.length + ' batch' + (item.lots.length === 1 ? '' : 'es') + ' · ' + money(item.value)}
                {item.expiredQty ? <Text style={{ color: colors.danger, fontFamily: fonts.uiSemi }}>{' · ' + plainQty(item.expiredQty) + ' expired'}</Text> : null}
                {item.soonQty ? <Text style={{ color: colors.warn, fontFamily: fonts.uiSemi }}>{' · ' + plainQty(item.soonQty) + ' to expire'}</Text> : null}
              </Text>
              <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 6 }} />
              {item.lots.map((r) => (
                <View key={r.batch.no} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 3 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: colors.ink }}>
                      {r.batch.no}<Text style={{ fontFamily: fonts.ui, color: tone(r.days) }}>{'  ' + left(r.days)}</Text>
                    </Text>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 10.5, color: colors.faint }}>
                      {'bought ' + day(r.bought) + ' · expires ' + day(r.batch.expiry)}
                    </Text>
                  </View>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: tone(r.days) }}>{plainQty(r.batch.qty)}</Text>
                </View>
              ))}
            </Pressable>
          )}
        />
      ) : (
        <FlatList
          data={lots}
          keyExtractor={(r) => r.product.id + '|' + r.batch.no}
          ListHeaderComponent={head}
          contentContainerStyle={{ paddingBottom: 96 }}
          initialNumToRender={14}
          windowSize={7}
          ListEmptyComponent={<Text style={{ textAlign: 'center', padding: 32, fontFamily: fonts.ui, fontSize: 13, color: colors.faint }}>Nothing in this band.</Text>}
          renderItem={({ item: r }) => (
            <Pressable onPress={() => go('BatchMovement', { batchNo: r.batch.no })} style={({ pressed }) => [card, { flexDirection: 'row', alignItems: 'center', gap: 10 }, pressed ? { backgroundColor: colors.sunk } : null]}>
              <View style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: tone(r.days) }} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>{r.product.name}</Text>
                <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 1 }}>
                  {'Batch ' + r.batch.no + ' · bought ' + day(r.bought) + ' · expires ' + day(r.batch.expiry)}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: tone(r.days) }}>{left(r.days)}</Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>{plainQty(r.batch.qty) + ' ' + r.product.unit + ' · ' + money(r.value)}</Text>
              </View>
            </Pressable>
          )}
        />
      )}
      <Pressable onPress={() => go('BatchMovement')} style={({ pressed }) => ({
        position: 'absolute', right: 16, bottom: 24, height: 48, paddingHorizontal: 16, borderRadius: 4, flexDirection: 'row', alignItems: 'center', gap: 8,
        backgroundColor: colors.accent, opacity: pressed ? 0.85 : 1, elevation: 4,
      })}>
        <Icon name="search" size={17} color={colors.accentInk} />
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.accentInk }}>Trace a batch</Text>
      </Pressable>
    </View>
  );
}
