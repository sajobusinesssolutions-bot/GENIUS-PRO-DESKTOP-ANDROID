import React from 'react';
import { View, Text, FlatList, Pressable, TextInput, Alert } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Empty, Button, Cap, DocCard, Badge, StatGrid, SectionLabel, StickyBar } from '../components/ui';
import { Icon } from '../components/icons';
import { expiryState } from '../data/batches';
import { useWho } from '../components/WhoSheet';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'StockTakes'>;

export default function StockTakesScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { db, startStockTake } = useAppData();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={[...(db?.stockTakes || [])].reverse()}
        keyExtractor={(s) => s.id}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        ListEmptyComponent={<Empty title="No stock-takes" subtitle="Count a warehouse and post variances" />}
        renderItem={({ item }) => {
          const wh = db?.warehouses.find((w) => w.id === item.warehouse)?.name || item.warehouse;
          return (
            <DocCard
              icon="check"
              tone={item.status === 'posted' ? 'good' : 'warn'}
              title={wh}
              subtitle={item.lines.length + ' product' + (item.lines.length === 1 ? '' : 's') + ' counted'}
              date={new Date(item.ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
              badges={<Badge label={item.status} tone={item.status === 'posted' ? 'good' : 'warn'} />}
              onPress={() => navigation.navigate('StockTakeDetail', { stockTakeId: item.id })}
            />
          );
        }}
      />
      <View style={{ padding: 16, gap: 8 }}>
        <Cap>Start a new count</Cap>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {(db?.warehouses || []).map((w) => (
            <Button key={w.id} label={'Count: ' + w.name} onPress={() => {
              const st = startStockTake(w.id);
              navigation.navigate('StockTakeDetail', { stockTakeId: st.id });
            }} />
          ))}
        </View>
      </View>
    </View>
  );
}

export function StockTakeDetailScreen({ route }: NativeStackScreenProps<RootStackParamList, 'StockTakeDetail'>) {
  const { colors } = useTheme();
  const { db, money, setStockTakeCount, setStockTakeBatchCount, postStockTake } = useAppData();
  const st = db?.stockTakes.find((s) => s.id === route.params.stockTakeId);
  const [openLine, setOpenLine] = React.useState<string | null>(null);
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

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {who.sheet}
      <FlatList
        data={st.lines}
        keyExtractor={(l) => l.productId}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: open ? 180 : 130 }}
        ListHeaderComponent={
          <View style={{ paddingTop: 14, marginBottom: 14 }}>
            <StatGrid
              items={[
                { icon: 'check', label: 'Counted', value: done + ' / ' + st.lines.length, tone: done === st.lines.length ? 'good' : 'warn' },
                { icon: variance === 0 ? 'check' : 'alert', label: 'Net variance', value: (variance > 0 ? '+' : '') + variance, tone: variance === 0 ? 'good' : variance > 0 ? 'warn' : 'danger' },
              ]}
            />
            <View style={{ height: 16 }} />
            <SectionLabel right={<Badge label={open ? 'Open' : 'Posted'} tone={open ? 'warn' : 'good'} />}>
              Count sheet
            </SectionLabel>
          </View>
        }
        renderItem={({ item }) => {
          const v = item.counted == null ? null : item.counted - item.expected;
          const batched = !!(item.batches && item.batches.length);
          const expanded = openLine === item.productId;
          return (
            <View
              style={{
                backgroundColor: colors.surface, borderRadius: 16, padding: 14, marginBottom: 10,
                shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, elevation: 2,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{item.name}</Text>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                    Expected {item.expected}{batched ? ' · ' + item.batches!.length + ' batches' : ''}
                  </Text>
                </View>

                {batched ? (
                  <Pressable
                    onPress={() => setOpenLine(expanded ? null : item.productId)}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 7,
                      paddingHorizontal: 13, paddingVertical: 12, borderRadius: 12,
                      borderWidth: 1.4, borderColor: expanded ? colors.accent : colors.line,
                      backgroundColor: expanded ? colors.accentSoft : colors.surface,
                    }}
                  >
                    <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: expanded ? colors.accent : colors.ink }}>
                      {item.counted == null ? 'Count' : String(item.counted)}
                    </Text>
                    <Icon name={expanded ? 'up' : 'down'} size={16} color={expanded ? colors.accent : colors.faint} />
                  </Pressable>
                ) : (
                  <TextInput
                    editable={open}
                    keyboardType="numeric"
                    defaultValue={item.counted != null ? String(item.counted) : ''}
                    placeholder="count"
                    placeholderTextColor={colors.faint}
                    onEndEditing={(e) => setStockTakeCount(st.id, item.productId, parseFloat(e.nativeEvent.text) || 0)}
                    style={{ width: 88, height: 48, borderRadius: 13, borderWidth: 1.4, borderColor: colors.line, paddingHorizontal: 10, color: colors.ink, backgroundColor: colors.sunk, fontFamily: fonts.monoSemi, fontSize: 16, textAlign: 'center' }}
                  />
                )}

                {v != null ? (
                  <Text style={{ width: 48, textAlign: 'right', fontFamily: fonts.uiBold, fontSize: 14, color: v === 0 ? colors.faint : v > 0 ? colors.good : colors.danger }}>
                    {v > 0 ? '+' : ''}{v}
                  </Text>
                ) : <View style={{ width: 48 }} />}
              </View>

              {batched && expanded ? (
                <View style={{ marginTop: 14, gap: 10 }}>
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 11, letterSpacing: 0.7, color: colors.faint, textTransform: 'uppercase' }}>
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
                          backgroundColor: colors.sunk, borderRadius: 13, padding: 12,
                          borderLeftWidth: 4,
                          borderLeftColor: state === 'expired' || state === 'critical' ? colors.danger : state === 'soon' ? colors.warn : colors.good,
                        }}
                      >
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink }}>{b.no}</Text>
                          <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 2 }}>
                            Expected {b.expected}
                            {b.expiry ? ' · exp ' + new Date(b.expiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : ''}
                          </Text>
                        </View>
                        <TextInput
                          editable={open}
                          keyboardType="numeric"
                          defaultValue={b.counted != null ? String(b.counted) : ''}
                          placeholder="0"
                          placeholderTextColor={colors.faint}
                          onEndEditing={(e) => setStockTakeBatchCount(st.id, item.productId, b.no, parseFloat(e.nativeEvent.text) || 0)}
                          style={{ width: 76, height: 44, borderRadius: 12, borderWidth: 1.4, borderColor: colors.line, paddingHorizontal: 8, color: colors.ink, backgroundColor: colors.surface, fontFamily: fonts.monoSemi, fontSize: 15, textAlign: 'center' }}
                        />
                        {bv != null ? (
                          <Text style={{ width: 38, textAlign: 'right', fontFamily: fonts.uiBold, fontSize: 13, color: bv === 0 ? colors.faint : bv > 0 ? colors.good : colors.danger }}>
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
            <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>
              {done} of {st.lines.length} counted
            </Text>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>
              {short} short · {over} over
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>Net variance</Text>
            <Text style={{ fontFamily: fonts.uiExtra, fontSize: 21, color: variance === 0 ? colors.good : variance > 0 ? colors.warn : colors.danger }}>
              {variance > 0 ? '+' : ''}{variance}
            </Text>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: varValue === 0 ? colors.faint : varValue > 0 ? colors.warn : colors.danger, marginTop: 2 }}>
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
