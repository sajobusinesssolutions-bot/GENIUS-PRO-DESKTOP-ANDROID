/**
 * Trace a batch.
 *
 * One search, by batch number, item, generic name or code, lists the lots
 * that match. A lot opens its analysis: what came in and went out, how much of
 * it has sold and how fast, whether it clears before it expires at that pace,
 * who it was sold to, and every movement with the balance carried down — the
 * report a recall runs on.
 */
import { tsMs, MON } from '../data/helpers';
import React, { useMemo, useState } from 'react';
import { View, Text, FlatList } from 'react-native';
import { Pressable } from '../components/Press';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useOlderRows, withOlder } from '../data/useOnDisk';
import type { Movement, Product, ProductBatch } from '../data/types';
import { Search, FilterChips, InfoBanner } from '../components/ui';
import { Icon } from '../components/icons';
import { daysToExpiry } from '../data/batches';

const day = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(tsMs(iso));
  if (Number.isNaN(d.getTime())) return '—';
  return (d.getDate() < 10 ? '0' : '') + d.getDate() + ' ' + MON[d.getMonth()] + ' ' + String(d.getFullYear()).slice(2);
};
const n2 = (n: number) => String(Math.round(n * 100) / 100);
const WORD: Record<string, string> = { sale: 'Sold', purchase: 'Bought', adjust: 'Adjusted', transfer: 'Transferred', void: 'Reversed', production: 'Produced', opening: 'Opening', stocktake: 'Counted', return: 'Returned', batch_settle: 'Batch settled' };

export default function BatchMovementScreen({ route }: { route?: { params?: { batchNo?: string } } }) {
  const { colors } = useTheme();
  const { db, money, party } = useAppData();
  const [q, setQ] = useState(route?.params?.batchNo || '');
  const [pick, setPick] = useState<{ productId: string; batchNo: string } | null>(null);
  const [dir, setDir] = useState<'all' | 'in' | 'out'>('all');

  /* every lot of every batch-tracked item, held or not */
  const lots = useMemo(() => {
    const out: Array<{ product: Product; batch: ProductBatch }> = [];
    (db?.products || []).forEach((p) => { if (p.trackBatches) (p.batches || []).forEach((b) => out.push({ product: p, batch: b })); });
    return out;
  }, [db?.products]);

  const needle = q.trim().toLowerCase();
  const found = useMemo(() => {
    const list = !needle ? lots.filter((l) => l.batch.qty > 0) : lots.filter((l) => l.batch.no.toLowerCase().includes(needle)
      || l.product.name.toLowerCase().includes(needle) || l.product.sku.toLowerCase().includes(needle)
      || (l.product.genericName || '').toLowerCase().includes(needle));
    // an exact batch number first, then soonest to expire
    return list.sort((a, b) => Number(b.batch.no.toLowerCase() === needle) - Number(a.batch.no.toLowerCase() === needle)
      || (daysToExpiry(a.batch) ?? 1e9) - (daysToExpiry(b.batch) ?? 1e9)).slice(0, 60);
  }, [lots, needle]);

  const sel = pick ? lots.find((l) => l.product.id === pick.productId && l.batch.no === pick.batchNo) : undefined;
  const product = sel?.product;
  const batch = sel?.batch;
  const older = useOlderRows<Movement>(db, 'movements', product?.id);

  /** The lot's movements, oldest first, with the balance carried down. */
  const rows = useMemo(() => {
    if (!db || !product || !batch) return [];
    const ms = withOlder(db.movements, older).filter((m) => m.productId === product.id && m.batchNo === batch.no)
      .sort((a, b) => tsMs(a.ts) - tsMs(b.ts));
    let run = 0;
    return ms.map((m) => { run += m.qty; return { ...m, balance: run }; }).reverse();
  }, [db, older, product, batch]);

  /* the analysis */
  const a = useMemo(() => {
    if (!db || !product || !batch) return null;
    const asc = [...rows].reverse();
    const inQ = asc.filter((r) => r.qty > 0 && r.type !== 'void').reduce((s, r) => s + r.qty, 0);
    const sold = asc.filter((r) => r.type === 'sale').reduce((s, r) => s - r.qty, 0);
    const back = asc.filter((r) => r.type === 'void' || r.type === 'return').reduce((s, r) => s + r.qty, 0);
    const other = asc.filter((r) => r.qty < 0 && r.type !== 'sale').reduce((s, r) => s - r.qty, 0);
    const first = asc.find((r) => r.qty > 0)?.ts;
    const shelfDays = first ? Math.max(1, Math.round((Date.now() - tsMs(first)) / 864e5)) : 0;
    const netSold = Math.max(0, sold - back);
    const perDay = shelfDays ? netSold / shelfDays : 0;
    const left = daysToExpiry(batch);
    const clearDays = perDay > 0 ? batch.qty / perDay : null;
    const atExpiry = left !== null && left >= 0 && perDay > 0 ? Math.max(0, batch.qty - perDay * left) : left !== null && left >= 0 ? batch.qty : null;
    const through = inQ > 0 ? Math.min(100, Math.round((netSold / inQ) * 100)) : 0;
    // who it went to
    const by = new Map<string, number>();
    db.sales.forEach((s) => {
      if (s.status === 'void' || s.deletedAt) return;
      s.lines.forEach((l: any) => { if (l.productId === product.id && l.batchNo === batch.no) by.set(s.partyId || '', (by.get(s.partyId || '') || 0) + (l.qty || 0) * (l.unitFactor || 1)); });
    });
    const buyers = [...by.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5);
    return { inQ, sold: netSold, other, first, shelfDays, perDay, left, clearDays, atExpiry, through, buyers, customers: by.size };
  }, [db, product, batch, rows]);

  const shown = dir === 'all' ? rows : rows.filter((r) => (dir === 'in' ? r.qty > 0 : r.qty < 0));
  const drift = batch && rows.length ? rows[0].balance - batch.qty : 0;
  if (!db) return null;

  const card = { borderRadius: 4, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface } as const;
  const leftTone = (d: number | null) => (d === null ? colors.faint : d < 0 || d <= 30 ? colors.danger : d <= 90 ? colors.warn : colors.good);
  const leftWord = (d: number | null) => (d === null ? 'no expiry date' : d < 0 ? 'expired ' + -d + ' days ago' : d + ' days left');

  const stat = (label: string, value: string, tone?: string) => (
    <View style={{ flex: 1, paddingVertical: 7, paddingHorizontal: 9 }}>
      <Text style={{ fontFamily: fonts.ui, fontSize: 10.5, color: colors.faint }}>{label}</Text>
      <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: tone || colors.ink, marginTop: 1 }}>{value}</Text>
    </View>
  );

  /* choosing a lot */
  if (!sel) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <FlatList
          data={found}
          keyExtractor={(l) => l.product.id + '|' + l.batch.no}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          ListHeaderComponent={(
            <View style={{ paddingTop: 10, paddingBottom: 8 }}>
              <Search value={q} onChange={setQ} placeholder="Batch number, item or generic name" />
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 10.5, letterSpacing: 0.5, color: colors.faint, marginTop: 10 }}>
                {needle ? found.length + ' LOT' + (found.length === 1 ? '' : 'S') + ' MATCH' : 'LOTS IN STOCK, SOONEST TO EXPIRE FIRST'}
              </Text>
            </View>
          )}
          ListEmptyComponent={<Text style={{ textAlign: 'center', padding: 32, fontFamily: fonts.ui, fontSize: 13, color: colors.faint }}>{lots.length ? 'No batch matches that.' : 'No item is batch tracked yet.'}</Text>}
          renderItem={({ item: l }) => {
            const d = daysToExpiry(l.batch);
            return (
              <Pressable onPress={() => { setPick({ productId: l.product.id, batchNo: l.batch.no }); setDir('all'); }} style={[card, { marginBottom: 6, paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>{l.batch.no}<Text style={{ fontFamily: fonts.ui, color: colors.faint }}>{'  ' + l.product.name}</Text></Text>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 1 }}>{'expires ' + day(l.batch.expiry)}<Text style={{ color: leftTone(d) }}>{' · ' + leftWord(d)}</Text></Text>
                </View>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.ink }}>{n2(l.batch.qty)} <Text style={{ fontFamily: fonts.ui, fontSize: 10.5, color: colors.faint }}>{l.product.unit}</Text></Text>
                <Icon name="chev" size={15} color={colors.faint} />
              </Pressable>
            );
          }}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={shown}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        initialNumToRender={20}
        ListHeaderComponent={a && product && batch ? (
          <View style={{ paddingTop: 10, gap: 8, marginBottom: 8 }}>
            <Pressable onPress={() => setPick(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingVertical: 2 }}>
              <Icon name="back" size={15} color={colors.accent} />
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.accent }}>Another batch</Text>
            </Pressable>

            {/* the lot */}
            <View style={[card, { paddingHorizontal: 12, paddingVertical: 10 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>Batch {batch.no}</Text>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: leftTone(a.left) }}>{leftWord(a.left)}</Text>
              </View>
              <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.soft, marginTop: 1 }}>{product.name}{product.genericName ? ' · ' + product.genericName : ''}</Text>
              <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 1 }}>{'bought ' + day(a.first) + ' · expires ' + day(batch.expiry) + ' · ' + a.shelfDays + ' days on the shelf'}</Text>
            </View>

            {/* what came and went */}
            <View style={[card, { flexDirection: 'row' }]}>
              {stat('Received', n2(a.inQ))}
              {stat('Sold', n2(a.sold), colors.accent)}
              {stat('Other out', n2(a.other))}
              {stat('On hand', n2(batch.qty), batch.qty > 0 ? colors.good : colors.faint)}
            </View>

            {/* how it is selling, and whether it clears in time */}
            <View style={[card, { paddingHorizontal: 12, paddingVertical: 9, gap: 6 }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint }}>Sold through</Text>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11.5, color: colors.ink }}>{a.through}% · {n2(a.perDay)} a day</Text>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.sunk, overflow: 'hidden' }}>
                <View style={{ width: `${a.through}%` as `${number}%`, height: 6, backgroundColor: colors.accent }} />
              </View>
              <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.soft }}>
                {batch.qty <= 0 ? 'Sold out.'
                  : a.left !== null && a.left < 0 ? n2(batch.qty) + ' ' + product.unit + ' expired on the shelf — worth ' + money(batch.qty * product.cost) + '.'
                    : a.clearDays === null ? 'Nothing sold yet' + (a.left !== null ? ': all ' + n2(batch.qty) + ' would still be here at expiry.' : '.')
                      : a.left === null ? 'At this pace it clears in about ' + Math.ceil(a.clearDays) + ' days.'
                        : a.clearDays <= a.left ? 'At this pace it clears in about ' + Math.ceil(a.clearDays) + ' days, before it expires.'
                          : 'At this pace about ' + n2(a.atExpiry || 0) + ' ' + product.unit + ' will be left when it expires (' + money((a.atExpiry || 0) * product.cost) + ') — consider a discount or a return.'}
              </Text>
            </View>

            {/* who it went to */}
            {a.buyers.length ? (
              <View style={[card, { paddingHorizontal: 12, paddingVertical: 8 }]}>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 10.5, letterSpacing: 0.5, color: colors.faint, marginBottom: 4 }}>SOLD TO · {a.customers} CUSTOMER{a.customers === 1 ? '' : 'S'}</Text>
                {a.buyers.map(([pid, qty]) => (
                  <View key={pid || 'walkin'} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
                    <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.ui, fontSize: 12, color: colors.ink }}>{pid ? party(pid)?.name || 'Customer' : 'Walk-in'}</Text>
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: colors.ink }}>{n2(qty)}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {drift ? <InfoBanner tone="danger" text={'The movements add up to ' + n2(rows[0].balance) + ' but the batch holds ' + n2(batch.qty) + ': a movement was saved without its batch, or the batch was edited by hand.'} /> : null}

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 10.5, letterSpacing: 0.5, color: colors.faint }}>MOVEMENTS · {shown.length}</Text>
            </View>
            <FilterChips value={dir} onChange={setDir} options={[{ v: 'all', l: 'All' }, { v: 'in', l: 'In' }, { v: 'out', l: 'Out' }]} />
          </View>
        ) : null}
        ListEmptyComponent={<Text style={{ textAlign: 'center', padding: 24, fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>This lot has not moved yet.</Text>}
        renderItem={({ item }) => {
          const fg = item.type === 'void' ? colors.warn : item.qty >= 0 ? colors.good : colors.danger;
          return (
            <View style={[card, { marginBottom: 5, paddingHorizontal: 12, paddingVertical: 7, flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.ink }}>{(WORD[item.type] || item.type) + (item.ref ? ' · ' + item.ref : '')}</Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 10.5, color: colors.faint }}>{day(item.ts)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: fg }}>{(item.qty > 0 ? '+' : '−') + n2(Math.abs(item.qty))}</Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 10.5, color: colors.faint }}>bal {n2(item.balance)}</Text>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}
