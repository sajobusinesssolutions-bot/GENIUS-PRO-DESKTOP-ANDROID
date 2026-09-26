/**
 * Batch and expiry reporting.
 *
 * Two views over the same rows: "Batches" reads as a stock ledger by lot, and
 * "Expiry" is the action list — what is already dead, what dies this week, and
 * what to shift next. Both carry the money at risk, because that is the number
 * that decides whether you discount it or write it off.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, Alert } from 'react-native';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import {
  Panel, Badge, StatGrid, SectionLabel, FilterChips, TopTabs, Search,
  EmptyBlock, InfoBanner, Button,
} from '../components/ui';
import { Icon } from '../components/icons';
import { useGo } from '../nav/navigate';
import { batchRows, byUrgency, ExpiryState } from '../data/batches';

type Tab = 'batches' | 'expiry';
type BatchFilter = 'all' | 'expired' | 'critical' | 'soon' | 'ok' | 'none';

const STATE_LABEL: Record<ExpiryState, string> = {
  expired: 'Expired', critical: 'This week', soon: 'Use soon', ok: 'Fresh', none: 'No date',
};

function toneOf(state: ExpiryState) {
  return state === 'expired' || state === 'critical' ? 'danger'
    : state === 'soon' ? 'warn'
      : state === 'none' ? 'neutral' : 'good';
}

export default function BatchReportScreen() {
  const { colors } = useTheme();
  const { db, money } = useAppData();
  const go = useGo();

  const [tab, setTab] = useState<Tab>('batches');
  const [filter, setFilter] = useState<BatchFilter>('all');
  const [q, setQ] = useState('');

  const warnDays = 90;
  const rows = useMemo(() => (db ? batchRows(db, warnDays) : []), [db]);
  const ORDER: Record<ExpiryState, number> = { expired: 0, critical: 1, soon: 2, ok: 3, none: 4 };

  const counts = useMemo(() => {
    const c: Record<ExpiryState, number> = { expired: 0, critical: 0, soon: 0, ok: 0, none: 0 };
    rows.forEach((r) => { c[r.state] += 1; });
    return c;
  }, [rows]);

  const atRisk = useMemo(
    () => rows.filter((r) => r.state === 'expired' || r.state === 'critical' || r.state === 'soon'),
    [rows],
  );
  const deadValue = rows.filter((r) => r.state === 'expired').reduce((s, r) => s + r.value, 0);
  const riskValue = atRisk.reduce((s, r) => s + r.value, 0);
  const totalValue = rows.reduce((s, r) => s + r.value, 0);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = rows;
    if (tab === 'expiry') list = list.filter((r) => r.state !== 'ok' && r.state !== 'none');
    if (filter !== 'all') list = list.filter((r) => r.state === filter);
    if (needle) {
      list = list.filter((r) =>
        r.product.name.toLowerCase().includes(needle)
        || r.product.sku.toLowerCase().includes(needle)
        || r.batch.no.toLowerCase().includes(needle));
    }
    const sorted = tab === 'expiry'
      ? byUrgency(list)
      : [...list].sort((a, b) => a.product.name.localeCompare(b.product.name) || a.batch.no.localeCompare(b.batch.no));

    const byProduct = new Map<string, { product: typeof sorted[number]['product']; batches: typeof sorted; qty: number; value: number; state: ExpiryState; days: number | null }>();
    sorted.forEach((r) => {
      const key = r.product.id;
      const existing = byProduct.get(key);
      if (existing) {
        existing.batches.push(r);
        existing.qty += r.batch.qty;
        existing.value += r.value;
        if (ORDER[existing.state] > ORDER[r.state]) existing.state = r.state;
        if (existing.days === null || (r.days !== null && (existing.days === null || r.days < existing.days))) existing.days = r.days;
      } else {
        byProduct.set(key, {
          product: r.product,
          batches: [r],
          qty: r.batch.qty,
          value: r.value,
          state: r.state,
          days: r.days,
        });
      }
    });

    return Array.from(byProduct.values()).sort((a, b) => {
      const x = ORDER[a.state] - ORDER[b.state];
      if (x !== 0) return x;
      return a.product.name.localeCompare(b.product.name);
    });
  }, [rows, tab, filter, q]);

  if (!db) return null;

  const filters: Array<{ v: BatchFilter; l: string }> = tab === 'expiry'
    ? [
      { v: 'all', l: 'All at risk' },
      { v: 'expired', l: 'Expired ' + counts.expired },
      { v: 'critical', l: 'This week ' + counts.critical },
      { v: 'soon', l: 'Soon ' + counts.soon },
    ]
    : [
      { v: 'all', l: 'All ' + rows.length },
      { v: 'ok', l: 'Fresh ' + counts.ok },
      { v: 'soon', l: 'Soon ' + counts.soon },
      { v: 'critical', l: 'This week ' + counts.critical },
      { v: 'expired', l: 'Expired ' + counts.expired },
      { v: 'none', l: 'No date ' + counts.none },
    ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TopTabs
        value={tab}
        onChange={(v) => { setTab(v); setFilter('all'); }}
        options={[
          { v: 'batches', l: 'Batches', i: 'box' },
          { v: 'expiry', l: 'Expiry', i: 'clock' },
        ]}
      />

      <FlatList
        data={visible}
        keyExtractor={(r) => r.product.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 }}
        ListHeaderComponent={
          <View style={{ paddingTop: 14, gap: 14, marginBottom: 14 }}>
            <StatGrid
              items={tab === 'expiry'
                ? [
                  { icon: 'alert', label: 'Expired value', value: money(deadValue), tone: deadValue ? 'danger' : 'good' },
                  { icon: 'clock', label: 'At risk value', value: money(riskValue), tone: riskValue ? 'warn' : 'good' },
                  { icon: 'box', label: 'Lots at risk', value: String(atRisk.length), tone: atRisk.length ? 'warn' : 'good' },
                  { icon: 'check', label: 'Expiring this week', value: String(counts.critical), tone: counts.critical ? 'danger' : 'good' },
                ]
                : [
                  { icon: 'box', label: 'Live batches', value: String(rows.length), tone: 'accent' },
                  { icon: 'coins', label: 'Stock value', value: money(totalValue), tone: 'good' },
                  { icon: 'clock', label: 'At risk', value: String(atRisk.length), tone: atRisk.length ? 'warn' : 'good' },
                  { icon: 'alert', label: 'Expired', value: String(counts.expired), tone: counts.expired ? 'danger' : 'good' },
                ]}
            />

            {tab === 'expiry' && counts.expired > 0 ? (
              <InfoBanner
                tone="danger"
                text={counts.expired + ' lot' + (counts.expired === 1 ? '' : 's') + ' worth ' + money(deadValue) + ' are already past their date and should come off the shelf.'}
              />
            ) : null}

            <Search value={q} onChange={setQ} placeholder="Search item, code or batch no." />
            <Button
              label="Trace one batch"
              icon={<Icon name="swap" size={16} color={colors.ink} />}
              onPress={() => go('BatchMovement')}
            />
            <FilterChips value={filter} onChange={setFilter} options={filters} />

            {visible.length ? (
              <SectionLabel right={<Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{visible.length} shown</Text>}>
                {tab === 'expiry' ? 'Most urgent first' : 'By item'}
              </SectionLabel>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <Panel>
            <EmptyBlock
              icon={tab === 'expiry' ? 'check' : 'box'}
              title={tab === 'expiry' ? 'Nothing is near expiry' : q || filter !== 'all' ? 'No batch matches' : 'No batches yet'}
              hint={tab === 'expiry'
                ? 'Every tracked lot is still well inside its date.'
                : 'Turn on batch tracking for an item, then add its batches on the item editor.'}
            />
          </Panel>
        }
        renderItem={({ item }) => {
          const tone = toneOf(item.state);
          const edge = tone === 'danger' ? colors.danger : tone === 'warn' ? colors.warn : tone === 'neutral' ? colors.lineHard : colors.good;
          const topBatch = item.batches[0];
          return (
            <Pressable
              onPress={() => go('ItemDetail', { productId: item.product.id })}
              style={{
                backgroundColor: colors.surface, borderRadius: 16,
                borderLeftWidth: 5, borderLeftColor: edge,
                paddingHorizontal: 15, paddingVertical: 14, marginBottom: 10,
                shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 15.5, color: colors.ink }}>
                    {item.product.name}
                  </Text>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                    {item.batches.length} lot{item.batches.length === 1 ? '' : 's'} · {item.product.sku}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 3 }}>
                  <Text style={{ fontFamily: fonts.uiExtra, fontSize: 17, color: colors.ink }}>
                    {item.qty} {item.product.unit}
                  </Text>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint }}>{money(item.value)}</Text>
                </View>
              </View>

              <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 12 }} />

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                <Badge label={STATE_LABEL[item.state]} tone={tone as any} />
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
                  {topBatch.batch.expiry
                    ? new Date(topBatch.batch.expiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                    : 'No expiry recorded'}
                </Text>
                <View style={{ flex: 1 }} />
                {item.days !== null ? (
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: edge }}>
                    {item.days < 0 ? Math.abs(item.days) + 'd over' : item.days + 'd left'}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        }}
        ListFooterComponent={
          visible.length ? (
            <View style={{ marginTop: 6 }}>
              <Button
                label="Copy this list"
                icon={<Icon name="doc" size={17} color={colors.ink} />}
                onPress={() => {
                  const text = visible
                    .map((r) => `${r.product.name} | ${r.batches.length} lot${r.batches.length === 1 ? '' : 's'} | ${r.qty} ${r.product.unit} | ${STATE_LABEL[r.state]}`)
                    .join('\n');
                  Alert.alert('Batch list', text.slice(0, 1500) + (text.length > 1500 ? '\n…' : ''));
                }}
              />
            </View>
          ) : null
        }
      />
    </View>
  );
}
