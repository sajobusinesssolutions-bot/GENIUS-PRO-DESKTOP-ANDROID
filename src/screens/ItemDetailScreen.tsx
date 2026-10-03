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
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  /** Empty means the whole warehouse; otherwise the batch being corrected. */
  const [adjustBatch, setAdjustBatch] = useState('');

  useEffect(() => {
    navigation.setOptions({
      title: p?.name || 'Item',
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <IconBtn name="swap" size={20} color={colors.warn} onPress={() => openAdjust()} />
          <IconBtn name="pencil" size={20} color={colors.accent} onPress={() => navigation.navigate('ProductDetail', { productId: id })} />
        </View>
      ),
    });
  }, [navigation, p?.name, id, colors]);

  const moves = useMemo(() => {
    const rows = (db?.movements || []).filter((m) => m.productId === id);
    rows.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
    if (filter === 'in') return rows.filter((m) => m.qty > 0);
    if (filter === 'out') return rows.filter((m) => m.qty < 0);
    return rows;
  }, [db, id, filter]);

  const totals = useMemo(() => {
    const rows = (db?.movements || []).filter((m) => m.productId === id);
    return {
      in: rows.filter((m) => m.qty > 0).reduce((s, m) => s + m.qty, 0),
      out: rows.filter((m) => m.qty < 0).reduce((s, m) => s - m.qty, 0),
    };
  }, [db, id]);

  if (!db || !p) return null;

  const stock = stockOf(p);
  const batches = liveBatches(p);
  const mismatch = p.trackBatches ? Math.abs(batchTotal(p) - stock) > 0.001 : false;
  const low = stock <= p.reorder;

  function openAdjust() {
    if (!can('stock.adjust')) { error('Your role cannot adjust stock.'); return; }
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

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 160 }}>
        {/* head */}
        <Panel>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
            <View style={{
              width: 56, height: 56, borderRadius: 18,
              backgroundColor: stock <= 0 ? colors.dangerSoft : low ? colors.warnSoft : colors.goodSoft,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ fontSize: 26 }}>{p.emoji || '📦'}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={2} style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink, letterSpacing: -0.3 }}>{p.name}</Text>
              <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 4 }}>
                {p.sku}{p.category ? ' · ' + p.category : ''}
              </Text>
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            <Badge
              label={stock <= 0 ? 'Out of stock' : low ? 'Low stock' : stock + ' ' + p.unit + ' on hand'}
              tone={stock <= 0 ? 'danger' : low ? 'warn' : 'good'}
            />
            {p.trackBatches ? <Badge label="Batch tracked" tone="accent" /> : null}
            {!p.active ? <Badge label="Not for sale" tone="neutral" /> : null}
          </View>
        </Panel>

        <View style={{ height: 16 }} />
        <StatGrid
          items={[
            { icon: 'coins', label: 'Sell price', value: money(p.price), tone: 'good' },
            { icon: 'money', label: 'Cost price', value: money(p.cost), tone: 'accent' },
            { icon: 'box', label: 'On hand', value: stock + ' ' + p.unit, tone: stock <= 0 ? 'danger' : low ? 'warn' : 'good' },
            { icon: 'chart', label: 'Stock value', value: money(stock * p.cost), tone: 'warn' },
          ]}
        />

        {mismatch ? (
          <View style={{ marginTop: 16 }}>
            <InfoBanner
              tone="warn"
              text={'Batch quantities add up to ' + batchTotal(p) + ' but the warehouse says ' + stock + '. Adjust the stock or correct a batch.'}
            />
          </View>
        ) : null}

        {/* batches */}
        {p.trackBatches ? (
          <>
            <View style={{ height: 20 }} />
            <SectionLabel right={<Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{batches.length} live</Text>}>
              Batches
            </SectionLabel>
            <Panel flush>
              {batches.length ? batches.map((b, i) => {
                const st = expiryState(b);
                const d = daysToExpiry(b);
                return (
                  <View
                    key={b.no}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 12,
                      paddingHorizontal: 15, paddingVertical: 13,
                      borderLeftWidth: 4,
                      borderLeftColor: st === 'expired' || st === 'critical' ? colors.danger : st === 'soon' ? colors.warn : colors.good,
                      borderBottomWidth: i === batches.length - 1 ? 0 : 1, borderBottomColor: colors.line,
                    }}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>Batch {b.no}</Text>
                      <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                        {b.expiry
                          ? new Date(b.expiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                            + (d !== null ? (d < 0 ? ' · expired' : ' · ' + d + 'd left') : '')
                          : 'No expiry set'}
                      </Text>
                    </View>
                    <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{b.qty}</Text>
                  </View>
                );
              }) : (
                <EmptyBlock icon="box" title="No batch in stock" hint="Batches arrive when you receive a purchase." />
              )}
            </Panel>
          </>
        ) : null}

        {/* stock transactions */}
        <View style={{ height: 20 }} />
        <SectionLabel right={<Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{moves.length} entries</Text>}>
          Stock transactions
        </SectionLabel>
        <View style={{ marginBottom: 12 }}>
          <FilterChips
            value={filter}
            onChange={setFilter}
            options={[
              { v: 'all', l: 'All' },
              { v: 'in', l: 'In · ' + totals.in },
              { v: 'out', l: 'Out · ' + totals.out },
            ]}
          />
        </View>
        <Panel flush>
          {moves.length ? moves.slice(0, 80).map((m, i) => {
            const tone = moveTone(m.type, m.qty);
            const fg = tone === 'good' ? colors.good : tone === 'warn' ? colors.warn : colors.danger;
            const bg = tone === 'good' ? colors.goodSoft : tone === 'warn' ? colors.warnSoft : colors.dangerSoft;
            return (
              <View
                key={m.id}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  paddingHorizontal: 15, paddingVertical: 13, minHeight: 64,
                  borderBottomWidth: i === Math.min(moves.length, 80) - 1 ? 0 : 1, borderBottomColor: colors.line,
                }}
              >
                <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={MOVE_ICON[m.type] || 'swap'} size={19} color={fg} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>
                    {m.type.charAt(0).toUpperCase() + m.type.slice(1)}{m.ref ? ' · ' + m.ref : ''}
                  </Text>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                    {new Date(m.ts).toLocaleString()}{m.batchNo ? ' · batch ' + m.batchNo : ''}
                  </Text>
                </View>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: fg }}>
                  {m.qty > 0 ? '+' : '−'}{Math.abs(m.qty)}
                </Text>
              </View>
            );
          }) : (
            <EmptyBlock icon="clock" title="No movement yet" hint="Sales, purchases and adjustments will show here." />
          )}
        </Panel>
        {moves.length > 80 ? (
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, textAlign: 'center', marginTop: 10 }}>
            Showing the 80 most recent of {moves.length}.
          </Text>
        ) : null}
      </ScrollView>

      <StickyBar>
        <ActionGrid
          actions={[
            { label: 'Adjust stock', icon: 'swap', tone: 'warn', onPress: openAdjust },
            { label: 'Edit item', icon: 'pencil', tone: 'accent', filled: true, onPress: () => navigation.navigate('ProductDetail', { productId: id }) },
          ]}
        />
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
