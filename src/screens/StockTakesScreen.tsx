import React from 'react';
import { ListPage, DocRow, StatusChips, SummaryTiles } from '../components/DocList';
import { View, Text, FlatList, TextInput, Alert } from 'react-native';
import { Pressable } from '../components/Press';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Empty, Button, Cap, DocCard, Badge, StatGrid, SectionLabel, StickyBar, Search } from '../components/ui';
import { Field } from '../components/form';
import { Icon } from '../components/icons';
import { expiryState } from '../data/batches';
import { useWho } from '../components/WhoSheet';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'StockTakes'>;

export default function StockTakesScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { db, startStockTake } = useAppData();
  const [filter, setFilter] = React.useState<'all' | 'open' | 'posted'>('all');
  const all = [...(db?.stockTakes || [])].reverse();
  const list = all.filter((t) => filter === 'all' || t.status === filter);
  const whName = (id: string) => db?.warehouses.find((w) => w.id === id)?.name || id;
  const start = (id: string) => { const st = startStockTake(id); navigation.navigate('StockTakeDetail', { stockTakeId: st.id }); };
  const startCount = () => {
    const whs = (db?.warehouses || []).filter((w) => w.active !== false);
    if (whs.length <= 1) { if (whs[0]) start(whs[0].id); return; }
    Alert.alert('Count which branch?', undefined, [
      ...whs.map((w) => ({ text: w.name, onPress: () => start(w.id) })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };
  return (
    <ListPage
      top={(
        <>
          <StatusChips value={filter} onChange={setFilter} options={[{ v: 'all', l: 'All' }, { v: 'open', l: 'Open' }, { v: 'posted', l: 'Posted' }]} />
          <SummaryTiles tiles={[
            { label: 'In progress', value: String(all.filter((t) => t.status === 'open').length), tone: colors.warn },
            { label: 'Posted', value: String(all.filter((t) => t.status === 'posted').length) },
          ]} />
        </>
      )}
      data={list}
      keyExtractor={(t) => t.id}
      empty={{ text: 'No counts yet. Count a shelf against the books with Start a count.' }}
      add={{ label: 'Start a count', onPress: startCount }}
      renderItem={({ item: t }) => {
        const counted = t.lines.filter((l) => l.counted != null);
        const short = counted.filter((l) => (l.counted as number) < l.expected).length;
        const over = counted.filter((l) => (l.counted as number) > l.expected).length;
        return (
          <DocRow
            title={whName(t.warehouse)}
            pill={t.status === 'posted' ? { label: 'Posted', tone: 'good' } : { label: 'Open', tone: 'warn' }}
            amount={counted.length + ' of ' + t.lines.length + ' counted'}
            refText="Stock count"
            ts={t.ts}
            lines={[{ label: 'Short', value: String(short), tone: short ? colors.danger : undefined }, { label: 'Over', value: String(over) }]}
            onPress={() => navigation.navigate('StockTakeDetail', { stockTakeId: t.id })}
            action={t.status === 'open' ? { label: 'Continue', onPress: () => navigation.navigate('StockTakeDetail', { stockTakeId: t.id }) } : undefined}
          />
        );
      }}
    />
  );
}

export function StockTakeDetailScreen({ route }: NativeStackScreenProps<RootStackParamList, 'StockTakeDetail'>) {
  const { colors } = useTheme();
  const { db, money, setStockTakeCount, setStockTakeBatchCount, postStockTake } = useAppData();
  const st = db?.stockTakes.find((s) => s.id === route.params.stockTakeId);
  const [openLine, setOpenLine] = React.useState<string | null>(null);
  /* find the item on the shelf in front of you, and see what is still to count */
  const [q, setQ] = React.useState('');
  const [show, setShow] = React.useState<'all' | 'todo' | 'short' | 'over'>('all');
  const who = useWho('Who is posting this count?');
  if (!st) return <Empty title="Not found" />;

  const open = st.status === 'open';
  const done = st.lines.filter((l) => l.counted != null).length;
  const variance = st.lines.reduce((sum, l) => sum + (l.counted == null ? 0 : l.counted - l.expected), 0);
  const short = st.lines.filter((l) => l.counted != null && l.counted < l.expected).length;
  const over = st.lines.filter((l) => l.counted != null && l.counted > l.expected).length;
  // What the difference is worth, so the write-off is visible before posting.
  const varValue = st.lines.reduce((sum, l) => {
    if (l.counted == null) return sum;
    const cost = db?.products.find((p) => p.id === l.productId)?.cost || 0;
    return sum + (l.counted - l.expected) * cost;
  }, 0);

  const needle = q.trim().toLowerCase();
  const prodOf = (id: string) => db?.products.find((p) => p.id === id);
  const lines = st.lines.filter((l) => {
    if (show === 'todo' && l.counted != null) return false;
    if (show === 'short' && !(l.counted != null && l.counted < l.expected)) return false;
    if (show === 'over' && !(l.counted != null && l.counted > l.expected)) return false;
    if (!needle) return true;
    const p = prodOf(l.productId);
    return (l.name + ' ' + (p?.sku || '') + ' ' + (p?.genericName || '') + ' ' + (p?.barcodes || []).join(' ') + ' ' + (l.batches || []).map((b) => b.no).join(' ')).toLowerCase().includes(needle);
  });

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {who.sheet}
      <FlatList
        data={lines}
        keyExtractor={(l) => l.productId}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: open ? 180 : 130 }}
        ListHeaderComponent={
          <View style={{ paddingTop: 10, marginBottom: 8, gap: 8 }}>
            <Search value={q} onChange={setQ} placeholder="Find an item: name, code, barcode or batch" />
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {([['all', 'All ' + st.lines.length], ['todo', 'To count ' + (st.lines.length - done)], ['short', 'Short ' + short], ['over', 'Over ' + over]] as const).map(([k, l]) => (
                <Pressable key={k} onPress={() => setShow(k)} style={{
                  flex: 1, alignItems: 'center', paddingVertical: 5, borderRadius: 999, borderWidth: 1.2,
                  borderColor: show === k ? colors.accent : colors.line, backgroundColor: show === k ? colors.accentSoft : colors.surface,
                }}>
                  <Text numberOfLines={1} style={{ fontFamily: show === k ? fonts.uiSemi : fonts.ui, fontSize: 12, color: show === k ? colors.accent : colors.ink }}>{l}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 10.5, letterSpacing: 0.5, color: colors.faint }}>
              {(open ? 'OPEN' : 'POSTED') + ' · ' + lines.length + ' SHOWN'}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const v = item.counted == null ? null : item.counted - item.expected;
          const batched = !!(item.batches && item.batches.length);
          const expanded = openLine === item.productId;
          return (
            <View
              style={{
                backgroundColor: colors.surface, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 6,
                borderWidth: 1, borderColor: colors.line,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink }}>{item.name}</Text>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 1 }}>
                    Expected {item.expected}{batched ? ' · ' + item.batches!.length + ' batches' : ''}
                  </Text>
                </View>

                {batched ? (
                  <Pressable
                    onPress={() => setOpenLine(expanded ? null : item.productId)}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 7,
                      paddingHorizontal: 10, paddingVertical: 8, borderRadius: 4,
                      borderWidth: 1.4, borderColor: expanded ? colors.accent : colors.line,
                      backgroundColor: expanded ? colors.accentSoft : colors.surface,
                    }}
                  >
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: expanded ? colors.accent : colors.ink }}>
                      {item.counted == null ? 'Count' : String(item.counted)}
                    </Text>
                    <Icon name={expanded ? 'up' : 'down'} size={16} color={expanded ? colors.accent : colors.faint} />
                  </Pressable>
                ) : (
                  <CountBox width={88} readOnly={!open} start={item.counted} onDone={(n) => setStockTakeCount(st.id, item.productId, n)} />
                )}

                {v != null ? (
                  <Text style={{ width: 44, textAlign: 'right', fontFamily: fonts.uiSemi, fontSize: 12.5, color: v === 0 ? colors.faint : v > 0 ? colors.good : colors.danger }}>
                    {v > 0 ? '+' : ''}{v}
                  </Text>
                ) : <View style={{ width: 44 }} />}
              </View>

              {batched && expanded ? (
                <View style={{ marginTop: 8, gap: 6 }}>
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, letterSpacing: 0.7, color: colors.faint, textTransform: 'uppercase' }}>
                    Count each batch
                  </Text>
                  {item.batches!.map((b) => {
                    const state = expiryState(b);
                    const bv = b.counted == null ? null : b.counted - b.expected;
                    return (
                      <View
                        key={b.no}
                        style={{
                          flexDirection: 'row', alignItems: 'center', gap: 11,
                          backgroundColor: colors.sunk, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 7,
                          borderLeftWidth: 4,
                          borderLeftColor: state === 'expired' || state === 'critical' ? colors.danger : state === 'soon' ? colors.warn : colors.good,
                        }}
                      >
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.ink }}>{b.no}</Text>
                          <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 1 }}>
                            Expected {b.expected}
                            {b.expiry ? ' · exp ' + new Date(b.expiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : ''}
                          </Text>
                        </View>
                        <CountBox width={92} readOnly={!open} start={b.counted} onDone={(n) => setStockTakeBatchCount(st.id, item.productId, b.no, n)} />
                        {bv != null ? (
                          <Text style={{ width: 38, textAlign: 'right', fontFamily: fonts.uiBold, fontSize: 12.5, color: bv === 0 ? colors.faint : bv > 0 ? colors.good : colors.danger }}>
                            {bv > 0 ? '+' : ''}{bv}
                          </Text>
                        ) : <View style={{ width: 38 }} />}
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>
          );
        }}
      />
      {/* the running variance, always visible while counting */}
      <StickyBar>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: open ? 12 : 0 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
              {done} of {st.lines.length} counted
            </Text>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>
              {short} short · {over} over
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>Net variance</Text>
            <Text style={{ fontFamily: fonts.uiExtra, fontSize: 18, color: variance === 0 ? colors.good : variance > 0 ? colors.warn : colors.danger }}>
              {variance > 0 ? '+' : ''}{variance}
            </Text>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: varValue === 0 ? colors.faint : varValue > 0 ? colors.warn : colors.danger, marginTop: 2 }}>
              {varValue > 0 ? '+' : ''}{money(varValue)}
            </Text>
          </View>
        </View>
        {open ? (
          <Button
            label="Post variances"
            variant="pri"
            icon={<Icon name="check" size={17} color={colors.accentInk} />}
            onPress={() => Alert.alert('Post stock-take', 'This adjusts stock and posts a journal entry for the counted variance. Continue?', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Post', onPress: () => who.ask((server) => postStockTake(st.id, server.userId)) },
            ])}
          />
        ) : null}
      </StickyBar>
    </View>
  );
}

/** A count box that saves when the counter moves on, not on every key. */
function CountBox({ start, onDone, readOnly, width }: {
  start: number | null | undefined; onDone: (n: number) => void; readOnly?: boolean; width: number;
}) {
  const [v, setV] = React.useState(start != null ? String(start) : '');
  return (
    <Field
      compact
      numeric
      decimal
      label="Count"
      value={v}
      onChangeText={setV}
      readOnly={readOnly}
      onBlur={() => onDone(parseFloat(v) || 0)}
      style={{ width, marginBottom: 0 }}
    />
  );
}
