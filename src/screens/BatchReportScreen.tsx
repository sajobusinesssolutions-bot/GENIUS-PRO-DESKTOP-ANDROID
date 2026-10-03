/**
 * Batch and expiry reporting.
 *
 * Two views over the same rows: "Batches" reads as a stock ledger by lot, and
 * "Expiry" is the action list — what is already dead, what dies this week, and
 * what to shift next. Both carry the money at risk, because that is the number
 * that decides whether you discount it or write it off.
 */
import React, { useMemo, useState } from 'react';
import { ListPage, DocRow, StatusChips, SummaryTiles } from '../components/DocList';
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

  const tabs = (
    <TopTabs
      value={tab}
      onChange={(v) => { setTab(v); setFilter('all'); }}
      options={[
        { v: 'batches', l: 'Batches', i: 'box' },
        { v: 'expiry', l: 'Expiry', i: 'clock' },
      ]}
    />
  );
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {tabs}
      <ListPage
        top={(
          <>
            <StatusChips value={filter} onChange={setFilter} options={filters} />
            <SummaryTiles tiles={tab === 'expiry'
              ? [
                { label: 'Expired value', value: money(deadValue), tone: deadValue ? colors.danger : undefined },
                { label: 'At risk value', value: money(riskValue), tone: riskValue ? colors.warn : undefined },
              ]
              : [
                { label: 'Stock value', value: money(totalValue) },
                { label: 'At risk', value: String(atRisk.length) + ' lot' + (atRisk.length === 1 ? '' : 's'), tone: atRisk.length ? colors.warn : undefined },
              ]} />
          </>
        )}
        search={{ value: q, onChange: setQ, placeholder: 'Search item, code or batch no.' }}
        data={visible}
        keyExtractor={(r) => r.product.id}
        empty={tab === 'expiry'
          ? { title: 'Nothing near expiry', text: 'Every tracked lot is still well inside its date.' }
          : { text: 'No batches yet. Turn on batch tracking for an item, then add its batches in the item editor.' }}
        add={{ label: 'Trace a batch', onPress: () => go('BatchMovement') }}
        renderItem={({ item }) => {
          const tone = toneOf(item.state);
          const top = item.batches[0];
          const edge = tone === 'danger' ? colors.danger : tone === 'warn' ? colors.warn : undefined;
          return (
            <DocRow
              title={item.product.name}
              pill={{ label: STATE_LABEL[item.state], tone: tone as any }}
              amount={item.qty + ' ' + item.product.unit}
              refText={item.batches.length + ' lot' + (item.batches.length === 1 ? '' : 's') + ' · ' + item.product.sku}
              sideText={top.batch.expiry
                ? 'Expires ' + new Date(top.batch.expiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
                : 'No expiry recorded'}
              lines={[
                { label: 'Value', value: money(item.value) },
                ...(item.days !== null ? [{ label: item.days < 0 ? 'Past its date by' : 'Days left', value: String(Math.abs(item.days)), tone: edge }] : []),
              ]}
              onPress={() => go('ItemDetail', { productId: item.product.id })}
            />
          );
        }}
      />
    </View>
  );
}
