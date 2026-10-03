/**
 * Batch traceability.
 *
 * Pick an item, pick one of its lots, and read every movement that lot has ever
 * made — received, sold, counted, returned — with a running balance. This is the
 * report a recall runs on: it answers "where did this batch go" and "does the
 * paperwork add up to what is on the shelf".
 */
import React, { useMemo, useState } from 'react';
import { View, Text, FlatList } from 'react-native';
import { Pressable } from '../components/Press';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import {
  Panel, Badge, StatGrid, SectionLabel, EmptyBlock, Search, InfoBanner, SelectField, FilterChips,
} from '../components/ui';
import { Icon, IconName } from '../components/icons';
import { expiryState, daysToExpiry } from '../data/batches';

const MOVE_ICON: Record<string, IconName> = {
  sale: 'cart', purchase: 'box', adjust: 'swap', transfer: 'arrow',
  void: 'alert', production: 'factory', opening: 'plus', stocktake: 'check',
};

export default function BatchMovementScreen() {
  const { colors } = useTheme();
  const { db, money } = useAppData();

  const [q, setQ] = useState('');
  const [productId, setProductId] = useState<string>('');
  const [batchNo, setBatchNo] = useState<string>('');
  const [dir, setDir] = useState<'all' | 'in' | 'out'>('all');

  const tracked = useMemo(
    () => (db?.products || []).filter((p) => p.trackBatches && (p.batches || []).length),
    [db],
  );

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return tracked.slice(0, 12);
    return tracked.filter((p) =>
      p.name.toLowerCase().includes(needle) || p.sku.toLowerCase().includes(needle)).slice(0, 12);
  }, [tracked, q]);

  const product = productId ? tracked.find((p) => p.id === productId) : undefined;
  const batches = product?.batches || [];
  const batch = batchNo ? batches.find((b) => b.no === batchNo) : undefined;

  /** Movements for this lot, oldest first, with the balance carried down. */
  const rows = useMemo(() => {
    if (!db || !product || !batch) return [];
    const ms = db.movements
      .filter((m) => m.productId === product.id && m.batchNo === batch.no)
      .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    let run = 0;
    const out = ms.map((m) => { run += m.qty; return { ...m, balance: run }; });
    return out.reverse();
  }, [db, product, batch]);

  const shown = dir === 'all' ? rows : rows.filter((r) => (dir === 'in' ? r.qty > 0 : r.qty < 0));

  const totals = useMemo(() => ({
    in: rows.filter((r) => r.qty > 0).reduce((s, r) => s + r.qty, 0),
    out: rows.filter((r) => r.qty < 0).reduce((s, r) => s - r.qty, 0),
  }), [rows]);

  /** The ledger should end where the batch says it is. */
  const ledgerEnd = rows.length ? rows[0].balance : 0;
  const drift = batch ? ledgerEnd - batch.qty : 0;

  if (!db) return null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={batch ? shown : []}
        keyExtractor={(m) => m.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 }}
        ListHeaderComponent={
          <View style={{ paddingTop: 14, marginBottom: 14 }}>
            <SectionLabel>Choose the item</SectionLabel>
            <Search value={q} onChange={setQ} placeholder="Search a batch-tracked item" />
            <View style={{ height: 12 }} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>
              {matches.map((p) => {
                const on = p.id === productId;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => { setProductId(p.id); setBatchNo(''); }}
                    style={{
                      paddingVertical: 10, paddingHorizontal: 15, borderRadius: radius.pill,
                      borderWidth: 1.4, borderColor: on ? colors.accent : colors.line,
                      backgroundColor: on ? colors.accentSoft : colors.surface,
                    }}
                  >
                    <Text style={{ fontFamily: on ? fonts.uiBold : fonts.uiSemi, fontSize: 12.5, color: on ? colors.accent : colors.ink }}>
                      {p.name}
                    </Text>
                  </Pressable>
                );
              })}
              {!tracked.length ? (
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
                  No item is batch tracked yet.
                </Text>
              ) : null}
            </View>

            {product ? (
              <>
                <View style={{ height: 20 }} />
                <SectionLabel right={<Badge label={batches.length + ' lots'} tone="neutral" />}>
                  Choose the batch
                </SectionLabel>
                <SelectField
                  icon="box"
                  label="Batch / lot"
                  value={batchNo}
                  options={batches.map((b) => ({
                    v: b.no,
                    l: b.no + ' · ' + b.qty + ' on hand' + (b.expiry ? ' · exp ' + new Date(b.expiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : ''),
                  }))}
                  onChange={setBatchNo}
                  placeholder="Pick a lot to trace"
                />
              </>
            ) : null}

            {product && batch ? (
              <>
                <StatGrid
                  items={[
                    { icon: 'down', label: 'Received', value: String(totals.in), tone: 'good' },
                    { icon: 'up', label: 'Issued', value: String(totals.out), tone: 'danger' },
                    { icon: 'box', label: 'On hand', value: batch.qty + ' ' + product.unit, tone: batch.qty > 0 ? 'good' : 'neutral' },
                    { icon: 'coins', label: 'Value', value: money(batch.qty * product.cost), tone: 'accent' },
                  ]}
                />

                <View style={{ height: 14 }} />
                <Panel>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                    <View style={{
                      width: 44, height: 44, borderRadius: 14,
                      backgroundColor: expiryState(batch) === 'expired' || expiryState(batch) === 'critical'
                        ? colors.dangerSoft : expiryState(batch) === 'soon' ? colors.warnSoft : colors.goodSoft,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Icon name="calendar" size={21} color={
                        expiryState(batch) === 'expired' || expiryState(batch) === 'critical'
                          ? colors.danger : expiryState(batch) === 'soon' ? colors.warn : colors.good
                      } />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>Batch {batch.no}</Text>
                      <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                        {batch.expiry
                          ? new Date(batch.expiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                            + (daysToExpiry(batch) !== null
                              ? (daysToExpiry(batch)! < 0 ? ' · expired' : ' · ' + daysToExpiry(batch) + 'd left')
                              : '')
                          : 'No expiry recorded'}
                      </Text>
                    </View>
                  </View>
                </Panel>

                {drift !== 0 ? (
                  <View style={{ marginTop: 14 }}>
                    <InfoBanner
                      tone="danger"
                      text={'The movements add up to ' + ledgerEnd + ' but the batch holds ' + batch.qty
                        + '. A movement was recorded without its lot, or the batch was edited by hand.'}
                    />
                  </View>
                ) : null}

                <View style={{ height: 20 }} />
                <SectionLabel right={<Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{shown.length} entries</Text>}>
                  Movement history
                </SectionLabel>
                <View style={{ marginBottom: 12 }}>
                  <FilterChips
                    value={dir}
                    onChange={setDir}
                    options={[
                      { v: 'all', l: 'All' },
                      { v: 'in', l: 'In · ' + totals.in },
                      { v: 'out', l: 'Out · ' + totals.out },
                    ]}
                  />
                </View>
              </>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <Panel>
            <EmptyBlock
              icon={product ? 'clock' : 'box'}
              title={!product ? 'Pick an item' : !batch ? 'Pick a batch' : 'This lot has never moved'}
              hint={!product
                ? 'Only items with batch tracking switched on can be traced.'
                : !batch
                  ? 'Choose one of its lots to see where the stock went.'
                  : 'It was opened but nothing has been received against it yet.'}
            />
          </Panel>
        }
        renderItem={({ item }) => {
          const good = item.qty >= 0;
          const fg = item.type === 'void' ? colors.warn : good ? colors.good : colors.danger;
          const bg = item.type === 'void' ? colors.warnSoft : good ? colors.goodSoft : colors.dangerSoft;
          return (
            <View
              style={{
                backgroundColor: colors.surface, borderRadius: 16, paddingHorizontal: 15, paddingVertical: 13,
                marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12,
                shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2,
              }}
            >
              <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={MOVE_ICON[item.type] || 'swap'} size={19} color={fg} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>
                  {item.type.charAt(0).toUpperCase() + item.type.slice(1)}{item.ref ? ' · ' + item.ref : ''}
                </Text>
                <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                  {new Date(item.ts).toLocaleString()}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 3 }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: fg }}>
                  {item.qty > 0 ? '+' : '−'}{Math.abs(item.qty)}
                </Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>bal {item.balance}</Text>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}
