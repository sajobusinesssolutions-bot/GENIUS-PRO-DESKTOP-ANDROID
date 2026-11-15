/**
 * Batches & expiry.
 *
 *   Batches — one row per item: how much is held and in how many batches, with
 *             what has expired or is about to; opened, each batch with the day
 *             it expires, the days left and what it holds.
 *   Expiry  — an ageing analysis: expired, then 0–30, 31–60, 61–90, 91–180 and
 *             over 180 days, and no date, each with its lots, quantity and
 *             value. A band tapped lists the lots in it, most urgent first.
 *
 * Laid out as the other reports are: tabs and search under the bar, rows that
 * open in place, no colour, and the stock value on the bar at the foot.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, FlatList } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAppData } from '../data/AppDataContext';
import { IconBtn } from '../components/AppBar';
import { useGo } from '../nav/navigate';
import { batchRows, ExpiryState } from '../data/batches';
import { MON, tsMs } from '../data/helpers';
import type { Product, ProductBatch } from '../data/types';
import { ControlRow, TabChips, SearchBox, MetaLine, GroupHead, FactRow, TotalBar, NothingHere, amt, useReportPalette } from '../components/ReportList';

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
const left = (d: number | null) => (d === null ? 'no date' : d < 0 ? 'expired ' + -d + ' d ago' : d === 0 ? 'expires today' : d + ' days left');

type Item = { product: Product; lots: Row[]; qty: number; value: number; expiredQty: number; soonQty: number };
type ExpiryLine = { t: 'head'; label: string; right?: string } | { t: 'band'; k: string; l: string; lots: number; qty: number; value: number } | { t: 'lot'; r: Row } | { t: 'none' };

export default function BatchReportScreen() {
  const pal = useReportPalette();
  const nav = useNavigation<any>();
  const { db } = useAppData();
  const go = useGo();
  const [tab, setTab] = useState<Tab>('batches');
  const [band, setBand] = useState<string>('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  /* the bar: what the screen is, and Trace a batch (it was a button over the list) */
  useEffect(() => {
    nav.setOptions({
      subtitle: 'What each item holds, and what is about to expire',
      headerRight: () => <IconBtn name="search" size={22} color={pal.primary} onPress={() => go('BatchMovement')} />,
    });
  });   // eslint-disable-line react-hooks/exhaustive-deps

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

  const needle = q.trim().toLowerCase();
  const match = (r: Row) => !needle || r.product.name.toLowerCase().includes(needle) || r.product.sku.toLowerCase().includes(needle)
    || (r.product.genericName || '').toLowerCase().includes(needle) || r.batch.no.toLowerCase().includes(needle);

  /* Batches: by item */
  const items = useMemo(() => {
    const by = new Map<string, Item>();
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
  }, [rows, needle]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* Expiry: the ageing bands, then the lots of the band chosen */
  const aging = useMemo(() => BANDS.map((b) => {
    const lots = rows.filter((r) => b.test(r.days));
    return { k: b.k, l: b.l, lots: lots.length, qty: lots.reduce((s, r) => s + r.batch.qty, 0), value: lots.reduce((s, r) => s + r.value, 0) };
  }), [rows]);
  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  const lots = useMemo(() => {
    const b = BANDS.find((x) => x.k === band);
    return rows.filter((r) => (b ? b.test(r.days) : r.days !== null && r.days <= 90)).filter(match)
      .sort((a, c) => (a.days ?? 1e9) - (c.days ?? 1e9));
  }, [rows, band, needle]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!db) return null;

  const bandName = band ? BANDS.find((b) => b.k === band)?.l || '' : 'Expired and due in 90 days';
  const expiry: ExpiryLine[] = [
    { t: 'head', label: 'Ageing', right: 'tap a band for its lots' },
    ...aging.map((a) => ({ t: 'band' as const, ...a })),
    { t: 'head', label: bandName, right: lots.length + ' lot' + (lots.length === 1 ? '' : 's') },
    ...(lots.length ? lots.map((r) => ({ t: 'lot' as const, r })) : [{ t: 'none' as const }]),
  ];
  const flip = (k: string) => setOpen((o) => (o === k ? null : k));

  return (
    <View style={{ flex: 1, backgroundColor: pal.bg }}>
      <ControlRow below={<SearchBox value={q} onChange={setQ} placeholder="Search item, generic name or batch no." />}>
        <TabChips tabs={[{ id: 'batches', label: 'Batches' }, { id: 'expiry', label: 'Expiry' }]} value={tab} onPick={(v) => { setTab(v as Tab); setBand(''); setOpen(null); }} />
      </ControlRow>

      {tab === 'batches' ? (
        <FlatList
          data={items}
          keyExtractor={(x) => x.product.id}
          extraData={open}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={14}
          windowSize={7}
          ListHeaderComponent={<MetaLine left={items.length + ' item' + (items.length === 1 ? '' : 's') + ' · ' + rows.length + ' batch' + (rows.length === 1 ? '' : 'es')} />}
          ListFooterComponent={<View style={{ height: 16 }} />}
          ListEmptyComponent={q
            ? <NothingHere text={'No results for “' + q + '”'} clear="Clear search" onClear={() => setQ('')} />
            : <NothingHere text="No batches yet. Turn on batch tracking for an item and add its batches when buying." />}
          renderItem={({ item }) => (
            <FactRow
              title={item.product.name}
              sub={item.lots.length + ' batch' + (item.lots.length === 1 ? '' : 'es')
                + (item.expiredQty ? ' · ' + plainQty(item.expiredQty) + ' expired' : '')
                + (item.soonQty ? ' · ' + plainQty(item.soonQty) + ' to expire' : '')}
              value={plainQty(item.qty)} valueLabel={item.product.unit || 'In stock'}
              zero={!item.qty}
              open={open === item.product.id} onToggle={() => flip(item.product.id)}
              lines={[
                ...item.lots.map((r) => ({ label: 'Batch ' + r.batch.no, value: plainQty(r.batch.qty) + ' · ' + (r.batch.expiry ? 'expires ' + day(r.batch.expiry) + ' · ' : '') + left(r.days) })),
                { label: 'Value', value: amt(item.value), bold: true },
              ]}
              action="View item" onAction={() => go('ItemDetail', { productId: item.product.id })}
            />
          )}
        />
      ) : (
        <FlatList
          data={expiry}
          keyExtractor={(x, i) => (x.t === 'band' ? 'b' + x.k : x.t === 'lot' ? x.r.product.id + '|' + x.r.batch.no : x.t + i)}
          extraData={[open, band]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={16}
          windowSize={7}
          ListFooterComponent={<View style={{ height: 16 }} />}
          renderItem={({ item: x }) => {
            if (x.t === 'head') return <GroupHead label={x.label} right={x.right} />;
            if (x.t === 'none') return <NothingHere text={q ? 'No results for “' + q + '”' : 'Nothing in this band.'} clear={q ? 'Clear search' : undefined} onClear={q ? () => setQ('') : undefined} />;
            if (x.t === 'band') {
              return (
                <FactRow
                  title={x.l}
                  sub={x.lots + ' lot' + (x.lots === 1 ? '' : 's') + (x.qty ? ' · Qty ' + plainQty(x.qty) : '')}
                  value={amt(x.value)} valueLabel="Value"
                  zero={!x.lots}
                  open={band === x.k} onToggle={() => { setBand(band === x.k ? '' : x.k); setOpen(null); }}
                />
              );
            }
            const r = x.r, key = r.product.id + '|' + r.batch.no;
            return (
              <FactRow
                title={r.product.name}
                sub={'Batch ' + r.batch.no + (r.batch.expiry ? ' · expires ' + day(r.batch.expiry) : '')}
                value={left(r.days)} valueLabel={plainQty(r.batch.qty) + ' ' + (r.product.unit || '')}
                open={open === key} onToggle={() => flip(key)}
                lines={[
                  { label: 'Batch', value: r.batch.no },
                  { label: 'Bought', value: day(r.bought) },
                  { label: 'Expires', value: day(r.batch.expiry) },
                  { label: 'Days left', value: r.days === null ? '—' : String(r.days) },
                  { label: 'Quantity', value: plainQty(r.batch.qty) + ' ' + (r.product.unit || '') },
                  { label: 'Value', value: amt(r.value), bold: true },
                ]}
                action="Trace this batch" onAction={() => go('BatchMovement', { batchNo: r.batch.no })}
              />
            );
          }}
        />
      )}

      <TotalBar label="Stock value in batches" value={amt(totalValue)} others={[
        { label: 'Expired', value: amt(aging[0].value) },
        { label: 'Due in 30 days', value: amt(aging[1].value) },
      ]} />
    </View>
  );
}
