/**
 * The item as the shop sees it: what it costs, what it sells for, what is on
 * the shelf, which batches are near expiry, and every movement that got it
 * there. Editing the item itself happens on ProductDetail, reached by the
 * pencil in the header.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { Pressable } from '../components/Press';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useOlderRows, withOlder } from '../data/useOnDisk';
import type { Movement } from '../data/types';
import { useToast } from '../components/Toast';
import {
  Panel, Badge, DetailRow, StatGrid, SectionLabel, InfoBanner, ActionGrid, StickyBar,
  FilterChips, EmptyBlock, Button, Field,
} from '../components/ui';
import { Icon, IconName } from '../components/icons';
import { IconBtn } from '../components/AppBar';
import Sheet from '../components/Sheet';
import { useWho } from '../components/WhoSheet';
import { liveBatches, expiryState, daysToExpiry, batchTotal } from '../data/batches';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'ItemDetail'>;

const MOVE_ICON: Record<string, IconName> = {
  sale: 'cart', purchase: 'box', adjust: 'swap', transfer: 'arrow',
  void: 'alert', production: 'factory', opening: 'plus', stocktake: 'check',
};

function moveTone(type: string, qty: number) {
  if (type === 'void') return 'warn' as const;
  return qty >= 0 ? ('good' as const) : ('danger' as const);
}

export default function ItemDetailScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const { db, money, stockOf, adjustStock, can } = useAppData();
  const { success, error } = useToast();
  const who = useWho('Who counted this?');

  const id = route.params.productId;
  const p = db?.products.find((x) => x.id === id);

  const [filter, setFilter] = useState<'all' | 'in' | 'out'>('all');
  const [showAll, setShowAll] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  /** Empty means the whole warehouse; otherwise the batch being corrected. */
  const [adjustBatch, setAdjustBatch] = useState('');

  useEffect(() => {
    navigation.setOptions({
      title: p?.name || 'Item',
      headerRight: () => (
        <IconBtn name="dots" size={22} color={colors.soft} onPress={() => Alert.alert(p?.name || 'Item', undefined, [
          { text: 'Edit item', onPress: () => navigation.navigate('ProductDetail', { productId: id }) },
          { text: 'Adjust stock', onPress: () => openAdjust() },
          { text: 'Cancel', style: 'cancel' },
        ])} />
      ),
    });
  }, [navigation, p?.name, id, colors]);

  /* with only recent trade in memory, the item's older movements come from disk */
  const older = useOlderRows<Movement>(db, 'movements', id);
  const allMoves = useMemo(() => withOlder(db?.movements || [], older), [db, older]);
  /* a movement opens the document it came from: the sale, the purchase, the stock take, the transfer */
  const openMove = (m: Movement) => {
    const sale = db?.sales.find((x) => x.no === m.ref || x.id === m.ref);
    const purchase = db?.purchases.find((x) => x.no === m.ref || x.id === m.ref);
    if ((m.type === 'sale' || m.type === 'void' || m.type === 'return') && sale) return navigation.navigate('SaleDetail', { saleId: sale.id });
    if (m.type === 'purchase' && purchase) return navigation.navigate('PurchaseDetail', { purchaseId: purchase.id });
    if (m.type === 'return' && (db?.creditNotes || []).some((c) => c.no === m.ref)) return navigation.navigate('CreditNotes');
    if (m.type === 'stocktake') { const st = (db?.stockTakes || []).find((x) => x.id === m.ref || (x as any).no === m.ref); if (st) return navigation.navigate('StockTakeDetail', { stockTakeId: st.id }); }
    if (m.type === 'transfer') return navigation.navigate(String(m.ref || '').startsWith('trf-') || String(m.ref || '').startsWith('ph-') ? 'BranchTransfers' : 'StockTransfer');
    if (sale) return navigation.navigate('SaleDetail', { saleId: sale.id });
    if (purchase) return navigation.navigate('PurchaseDetail', { purchaseId: purchase.id });
    Alert.alert(m.type.charAt(0).toUpperCase() + m.type.slice(1), (m.ref ? m.ref + ' · ' : '') + (m.qty > 0 ? '+' : '−') + Math.abs(m.qty) + ' on ' + new Date(m.ts).toLocaleString('en-GB')
      + (m.type === 'adjust' ? '\nA stock adjustment — it has no document of its own.' : ''));
  };
  const moves = useMemo(() => {
    const rows = allMoves.filter((m) => m.productId === id);
    rows.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
    if (filter === 'in') return rows.filter((m) => m.qty > 0);
    if (filter === 'out') return rows.filter((m) => m.qty < 0);
    return rows;
  }, [allMoves, id, filter]);

  const totals = useMemo(() => {
    const rows = allMoves.filter((m) => m.productId === id);
    return {
      in: rows.filter((m) => m.qty > 0).reduce((s, m) => s + m.qty, 0),
      out: rows.filter((m) => m.qty < 0).reduce((s, m) => s - m.qty, 0),
    };
  }, [allMoves, id]);

  if (!db || !p) return null;

  const stock = stockOf(p);
  const batches = liveBatches(p);
  const mismatch = p.trackBatches ? Math.abs(batchTotal(p) - stock) > 0.001 : false;
  const low = stock <= p.reorder;

  function openAdjust() {
    if (!can('inventory.stock_adjustment')) { error('Your role cannot adjust stock.'); return; }
    const first = p!.trackBatches ? liveBatches(p!)[0] : undefined;
    setAdjustBatch(first ? first.no : '');
    setCounted(String(first ? first.qty : stockOf(p!)));
    setNote('');
    setAdjustOpen(true);
  }

  /** What the count is being compared against — a batch, or the warehouse. */
  function baseFor(batchNo: string) {
    if (!batchNo) return stockOf(p!);
    return (p!.batches || []).find((b) => b.no === batchNo)?.qty ?? 0;
  }

  function chooseBatch(no: string) {
    setAdjustBatch(no);
    setCounted(String(baseFor(no)));
  }

  function saveAdjust() {
    const n = Number(String(counted).replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(n)) { error('Enter the counted quantity.'); return; }
    setAdjustOpen(false);
    who.ask((server) => {
      adjustStock(
        p!.id,
        db!.session.warehouse,
        n,
        (note.trim() || 'Counted on the item page') + ' — ' + server.userName,
        adjustBatch || undefined,
        server.userId,
      );
      success(
        (adjustBatch ? 'Batch ' + adjustBatch + ' set to ' + n : 'Stock set to ' + n + ' ' + p!.unit)
        + ' by ' + server.userName,
      );
    });
  }

  const countedNum = Number(String(counted).replace(/[^0-9.-]/g, ''));
  const adjustBase = adjustOpen ? baseFor(adjustBatch) : stock;
  const delta = Number.isFinite(countedNum) ? countedNum - adjustBase : 0;

  const stockTone = stock <= 0 ? colors.danger : low ? colors.warn : colors.good;
  const card = { backgroundColor: colors.surface, borderRadius: 4, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' as const };
  const head = (title: string, right?: string) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 22, marginBottom: 8, paddingHorizontal: 4 }}>
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.soft }}>{title}</Text>
      {right ? <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint }}>{right}</Text> : null}
    </View>
  );
  const cell = (label: string, value: string, tone?: string, big?: boolean, right?: boolean, bottom?: boolean) => (
    <View style={{
      flex: 1, padding: 14,
      borderLeftWidth: right ? 1 : 0, borderLeftColor: colors.line,
      borderTopWidth: bottom ? 1 : 0, borderTopColor: colors.line,
    }}>
      {big ? null : <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginBottom: 3 }}>{label}</Text>}
      <Text numberOfLines={1} style={{ fontFamily: big ? fonts.uiExtra : fonts.uiBold, fontSize: big ? 22 : 15.5, color: tone || colors.ink }}>{value}</Text>
      {big ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>{label}</Text> : null}
    </View>
  );
  const biggest = Math.max(1, ...batches.map((b) => b.qty));
  const shown = showAll ? moves : moves.slice(0, 5);
  const allCount = allMoves.filter((m) => m.productId === id).length;
  const inCount = allMoves.filter((m) => m.productId === id && m.qty > 0).length;
  const outCount = allCount - inCount;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 130 }}>
        {/* the item */}
        <View style={{ ...card, padding: 16 }}>
          <Text numberOfLines={2} style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink, letterSpacing: -0.3 }}>{p.name}</Text>
          <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 4 }}>
            {[p.sku, p.category, p.trackBatches ? 'Batch tracked' : '', p.trackSerials ? 'IMEI tracked' : '', !p.active ? 'Not for sale' : ''].filter(Boolean).join(' · ')}
          </Text>
        </View>

        {/* stock and its value, then the two prices */}
        <View style={{ ...card, marginTop: 12 }}>
          <View style={{ flexDirection: 'row' }}>
            {cell(stock <= 0 ? 'Out of stock' : low ? 'Low stock' : 'In stock', Math.round(stock * 100) / 100 + ' ' + p.unit.toUpperCase(), stockTone, true)}
            {cell('Stock value at cost', money(stock * p.cost), undefined, true, true)}
          </View>
          <View style={{ flexDirection: 'row' }}>
            {cell('Sell price', money(p.price), undefined, false, false, true)}
            {cell('Cost price', money(p.cost), undefined, false, true, true)}
          </View>
        </View>

        {mismatch ? (
          <View style={{ marginTop: 12 }}>
            <InfoBanner tone="warn" text={'Batch quantities add up to ' + batchTotal(p) + ' but the warehouse says ' + stock + '. Adjust the stock or correct a batch.'} />
          </View>
        ) : null}

        {/* batches, each with how much of the largest it holds */}
        {p.trackBatches ? (
          <>
            {head('Batches', batches.length + ' live')}
            <View style={card}>
              {batches.length ? batches.map((b, i) => {
                const st = expiryState(b);
                const d = daysToExpiry(b);
                const bar = st === 'expired' || st === 'critical' ? colors.danger : st === 'soon' ? colors.warn : colors.good;
                return (
                  <View key={b.no} style={{ padding: 14, borderBottomWidth: i === batches.length - 1 ? 0 : 1, borderBottomColor: colors.line }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 14.5, color: colors.ink }}>{b.no}</Text>
                        <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 2 }}>
                          {b.expiry
                            ? 'Expires ' + new Date(b.expiry).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                              + (d !== null ? (d < 0 ? ' · expired' : ' · ' + d + 'd left') : '')
                            : 'No expiry set'}
                        </Text>
                      </View>
                      <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>
                        {b.qty} <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint }}>{p.unit.toUpperCase()}</Text>
                      </Text>
                    </View>
                    <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.sunk, marginTop: 8, width: '55%', overflow: 'hidden' }}>
                      <View style={{ width: `${Math.max(4, (b.qty / biggest) * 100)}%`, height: 4, backgroundColor: bar }} />
                    </View>
                  </View>
                );
              }) : (
                <EmptyBlock icon="box" title="No batch in stock" hint="Batches arrive when you receive a purchase." />
              )}
            </View>
          </>
        ) : null}

        {/* every movement, newest first */}
        {head('Stock transactions', allCount + ' entries')}
        <View style={{ flexDirection: 'row', backgroundColor: colors.sunk, borderRadius: 4, padding: 3, marginBottom: 10 }}>
          {([['all', 'All', allCount], ['in', 'In', inCount], ['out', 'Out', outCount]] as const).map(([v, l, n]) => {
            const on = filter === v;
            return (
              <Pressable
                key={v}
                onPress={() => { setFilter(v); setShowAll(false); }}
                style={{ flex: 1, paddingVertical: 8, borderRadius: 4, alignItems: 'center', backgroundColor: on ? colors.surface : 'transparent', borderWidth: on ? 1 : 0, borderColor: colors.line }}
              >
                <Text style={{ fontFamily: on ? fonts.uiBold : fonts.uiSemi, fontSize: 13.5, color: on ? colors.ink : colors.soft }}>
                  {l} <Text style={{ fontFamily: fonts.ui, color: colors.faint }}>{n}</Text>
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={card}>
          {shown.length ? shown.map((m, i) => {
            const tone = moveTone(m.type, m.qty);
            const fg = tone === 'good' ? colors.good : tone === 'warn' ? colors.warn : colors.danger;
            const bg = tone === 'good' ? colors.goodSoft : tone === 'warn' ? colors.warnSoft : colors.dangerSoft;
            return (
              <Pressable key={m.id} onPress={() => openMove(m)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderBottomWidth: i === shown.length - 1 && !(moves.length > 5) ? 0 : 1, borderBottomColor: colors.line }}>
                <View style={{ width: 36, height: 36, borderRadius: 4, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={MOVE_ICON[m.type] || 'swap'} size={17} color={fg} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 14.5, color: colors.ink }}>
                    {m.type.charAt(0).toUpperCase() + m.type.slice(1)}{m.ref ? <Text style={{ fontFamily: fonts.mono, color: colors.soft }}>{'  ' + m.ref}</Text> : null}
                  </Text>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 2 }}>
                    {new Date(m.ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
                    {m.batchNo ? ' · batch ' + m.batchNo : ''}
                  </Text>
                </View>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: fg }}>{m.qty > 0 ? '+' : '−'}{Math.abs(m.qty)}</Text>
                <Icon name="chev" size={15} color={colors.faint} />
              </Pressable>
            );
          }) : (
            <EmptyBlock icon="clock" title="No movement yet" hint="Sales, purchases and adjustments will show here." />
          )}
          {moves.length > 5 ? (
            <Pressable onPress={() => setShowAll((s) => !s)} style={{ paddingVertical: 13, alignItems: 'center' }}>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.accent }}>
                {showAll ? 'Show fewer' : 'View all ' + moves.length + ' entries'}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>

      <StickyBar>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable
            onPress={openAdjust}
            style={{ flex: 1, height: 50, borderRadius: 4, borderWidth: 1.4, borderColor: colors.lineHard, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            <Icon name="swap" size={17} color={colors.ink} />
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>Adjust stock</Text>
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate('ProductDetail', { productId: id })}
            style={{ flex: 1, height: 50, borderRadius: 4, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            <Icon name="pencil" size={16} color={colors.accentInk} />
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.accentInk }}>Edit item</Text>
          </Pressable>
        </View>
      </StickyBar>

      {who.sheet}

      <Sheet
        visible={adjustOpen}
        title="Adjust stock"
        subtitle={p.name}
        icon="swap"
        iconTone="warn"
        onClose={() => setAdjustOpen(false)}
        footer={<Button label="Save count" variant="pri" onPress={saveAdjust} />}
      >
        <InfoBanner
          tone="accent"
          text="Enter what you actually counted on the shelf. The difference is posted as a stock adjustment, so the books stay tied out."
        />

        {p.trackBatches && batches.length ? (
          <>
            <View style={{ height: 18 }} />
            <SectionLabel>Which did you count?</SectionLabel>
            {batches.map((b) => {
              const on = adjustBatch === b.no;
              const st = expiryState(b);
              return (
                <Pressable
                  key={b.no}
                  onPress={() => chooseBatch(b.no)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 10,
                    borderRadius: radius.md, borderWidth: 1.4,
                    borderColor: on ? colors.accent : colors.line,
                    backgroundColor: on ? colors.accentSoft : colors.surface,
                    borderLeftWidth: 5,
                    borderLeftColor: st === 'expired' || st === 'critical' ? colors.danger : st === 'soon' ? colors.warn : colors.good,
                    paddingHorizontal: 14, paddingVertical: 13,
                  }}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>Batch {b.no}</Text>
                    <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>
                      {b.qty} on hand
                      {b.expiry ? ' · exp ' + new Date(b.expiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : ''}
                    </Text>
                  </View>
                  {on ? <Icon name="check" size={19} color={colors.accent} /> : null}
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => chooseBatch('')}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 16,
                borderRadius: radius.md, borderWidth: 1.4,
                borderColor: !adjustBatch ? colors.accent : colors.line,
                backgroundColor: !adjustBatch ? colors.accentSoft : colors.surface,
                paddingHorizontal: 14, paddingVertical: 13,
              }}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>The whole shelf</Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>
                  Corrects the warehouse total without touching a batch
                </Text>
              </View>
              {!adjustBatch ? <Icon name="check" size={19} color={colors.accent} /> : null}
            </Pressable>
          </>
        ) : (
          <View style={{ height: 16 }} />
        )}

        <Field
          icon="box"
          label={'Counted (' + p.unit + ')'}
          value={counted}
          onChangeText={setCounted}
          numeric
          decimal
        />
        <Field icon="doc" label="Reason" value={note} onChangeText={setNote} placeholder="Breakage, recount, theft…" />

        <Panel>
          <DetailRow
            label={adjustBatch ? 'Batch ' + adjustBatch + ' should hold' : 'System says'}
            value={adjustBase + ' ' + p.unit}
          />
          <DetailRow label="You counted" value={(Number.isFinite(countedNum) ? countedNum : 0) + ' ' + p.unit} />
          <DetailRow
            label={delta === 0 ? 'No difference' : delta > 0 ? 'Found extra' : 'Missing'}
            value={(delta > 0 ? '+' : '') + delta + ' ' + p.unit}
            bold
            tone={delta === 0 ? colors.good : delta > 0 ? colors.warn : colors.danger}
            last
          />
        </Panel>

        {adjustBatch && delta !== 0 ? (
          <View style={{ marginTop: 14 }}>
            <InfoBanner
              tone="neutral"
              icon="bulb"
              text={'Batch ' + adjustBatch + ' and the warehouse total both move by ' + (delta > 0 ? '+' : '') + delta + ', so the two readings stay in step.'}
            />
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}
