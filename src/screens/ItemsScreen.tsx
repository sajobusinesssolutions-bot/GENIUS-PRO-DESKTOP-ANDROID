/**
 * ITEMS — the live definition. `SCREENS.items` at reference line 5675 is replaced
 * at line 13154 by `SCREENS.stock.body` (aliased back with `SCREENS.items = SCREENS.stock`
 * at 13209), which adds the period bar, the units-moved stats and the "Moved" filter.
 * The right-hand side is `SCREENS.items.right` at 17146: "+" plus a bulk-changes button.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { canFor } from '../data/perms';
import {
  EmptyState, Button, Search, FilterChips, StatGrid, SectionLabel, Badge, ListRow, InfoBanner, FAB,
} from '../components/ui';
import { AppBar, IconBtn } from '../components/AppBar';
import { Sheet } from '../components/Sheet';
import { Icon } from '../components/icons';
import { useGo } from '../nav/navigate';
import { listRange, LIST_PERIODS, inRange } from '../data/helpers';
import { BULK_ACTIONS, sharePriceTags } from './BulkScreens';

export default function ItemsScreen() {
  const { colors } = useTheme();
  const go = useGo();
  const { db, money, stockOf } = useAppData();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [period, setPeriod] = useState('month');
  const [bulk, setBulk] = useState(false);

  const role = db?.session.role;
  const allowed = canFor(role, 'items');

  const d = useMemo(() => {
    if (!db) return null;
    const R = listRange(period);
    const movedBy: Record<string, { in: number; out: number }> = {};
    let inQ = 0, outQ = 0;
    (db.movements || []).forEach((m) => {
      if (!inRange(m.ts, R.from, R.to)) return;
      const e = movedBy[m.productId] || (movedBy[m.productId] = { in: 0, out: 0 });
      if (m.qty > 0) { e.in += m.qty; inQ += m.qty; } else { e.out += -m.qty; outQ += -m.qty; }
    });
    const value = db.products.reduce((s, x) => s + stockOf(x) * x.price, 0);
    const cost = db.products.reduce((s, x) => s + stockOf(x) * x.cost, 0);
    const active = db.products.filter((x) => x.active);
    const low = active.filter((x) => stockOf(x) <= x.reorder).length;
    const term = q.toLowerCase();
    const list = active.filter((x) => {
      if (filter === 'low' && stockOf(x) > x.reorder) return false;
      if (filter === 'out' && stockOf(x) > 0) return false;
      if (filter === 'asm' && !(x.bom && x.bom.length)) return false;
      if (filter === 'moved' && !movedBy[x.id]) return false;
      if (term && (x.name + ' ' + x.sku).toLowerCase().indexOf(term) < 0) return false;
      return true;
    });
    const chips: [string, string][] = [
      ['all', 'All ' + active.length], ['moved', 'Moved'], ['low', 'Low ' + low],
      ['out', 'Out'], ['asm', 'Assemblies'],
    ];
    return { R, movedBy, inQ, outQ, value, cost, list, chips };
  }, [db, q, filter, period]);

  const right = (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {/*
        The plus has moved to a floating button: adding an item is the most
        common thing on this screen and the top-right corner is the hardest
        place on a phone to reach one-handed. What is left is the overflow,
        sized so it can actually be hit — 20px of icon in a small tap target
        was a miss as often as a hit.
      */}
      <IconBtn name="dots" size={26} color={colors.soft} onPress={() => setBulk(true)} />
    </View>
  );

  if (!db || !d) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  if (!allowed) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <AppBar title="Items" right={right} />
        <EmptyState icon="box" title="Not available" subtitle="Your role does not include stock." />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AppBar title="Items" right={right} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
        <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 }}>
          <Search value={q} onChange={setQ} placeholder="Search by name, code or category" />
        </View>

        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
          <FilterChips value={filter} onChange={setFilter} options={d.chips.map(([v, l]) => ({ v, l }))} />
        </View>

        <View style={{ paddingHorizontal: 16, paddingBottom: 14 }}>
          <StatGrid
            items={[
              { icon: 'coins', label: 'Stock value (sale)', value: money(d.value), tone: 'good' },
              { icon: 'money', label: 'At cost', value: money(d.cost), tone: 'accent' },
              { icon: 'down', label: 'Units in · ' + d.R.label, value: String(Math.round(d.inQ)), tone: 'good' },
              { icon: 'up', label: 'Units out', value: String(Math.round(d.outQ)), tone: 'danger' },
            ]}
          />
        </View>

        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
          <SectionLabel>Period</SectionLabel>
          <FilterChips value={period} onChange={setPeriod} options={LIST_PERIODS.map(([v, l]) => ({ v, l }))} tone="neutral" />
        </View>

        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
          <SectionLabel>Stock tools</SectionLabel>
          <View style={{ flexDirection: 'row', gap: 9 }}>
            {([
              { label: 'Adjust', icon: 'swap', route: 'StockAdjust' },
              { label: 'Transfer', icon: 'arrow', route: 'StockTransfer' },
              { label: 'Stock take', icon: 'check', route: 'StockTakes' },
              { label: 'Batches', icon: 'calendar', route: 'Batches' },
            ] as const).map((tile) => (
              <Pressable
                key={tile.label}
                onPress={() => go(tile.route as any, undefined as any)}
                style={{
                  flex: 1, backgroundColor: colors.surface, borderRadius: 14,
                  paddingVertical: 13, alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 76,
                  shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2,
                }}
              >
                <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={tile.icon} size={18} color={colors.accent} />
                </View>
                <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 11.5, color: colors.ink, textAlign: 'center' }}>{tile.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={{ paddingHorizontal: 16 }}>
          <SectionLabel right={<Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{d.list.length} shown</Text>}>
            Items
          </SectionLabel>
        </View>

        {d.list.length ? d.list.map((x) => {
          const st = stockOf(x);
          const out = st <= 0, low = st <= x.reorder;
          const mv = d.movedBy[x.id];
          return (
            <Pressable
              key={x.id}
              onPress={() => go('ItemDetail', { productId: x.id })}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14,
                backgroundColor: colors.surface, borderRadius: 16,
                marginHorizontal: 16, marginBottom: 10, minHeight: 68,
                shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2,
              }}
            >
              <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: out ? colors.dangerSoft : colors.goodSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="box" size={21} color={out ? colors.danger : colors.good} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{x.name}</Text>
                <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 3 }}>
                  {x.sku} · {mv ? `+${Math.round(mv.in)} / −${Math.round(mv.out)} this period` : 'no movement'}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 5 }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.good }}>{money(x.price)}</Text>
                {out ? <Badge label="Out of stock" tone="danger" />
                  : low ? <Badge label={'Low · ' + st + ' ' + x.unit} tone="warn" />
                    : <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{st} {x.unit}</Text>}
              </View>
            </Pressable>
          );
        }) : (
          <EmptyState
            icon="box"
            title="Nothing here"
            subtitle="Change the period or the filter, or add a product."
            action={<Button size="sm" variant="pri" label="Add item" onPress={() => go('ProductDetail', {})} />}
          />
        )}
      </ScrollView>

      <Sheet
        visible={bulk}
        title="Bulk changes"
        subtitle={db.products.filter((p) => p.active).length + ' active items'}
        icon="tools"
        onClose={() => setBulk(false)}
      >
        <InfoBanner tone="accent" text="Change many items in one go. Every bulk change is previewed before it happens." />
        <View style={{ height: 14 }} />
        <ListRow
          card
          icon="coins"
          tone="accent"
          title="Price list"
          subtitle="Edit cost and sell across items and services"
          onPress={() => { setBulk(false); setTimeout(() => go('PriceList'), 120); }}
        />
        <ListRow
          card
          icon="pencil"
          tone="accent"
          title="Names & descriptions"
          subtitle="Rename in bulk, or find and replace"
          onPress={() => { setBulk(false); setTimeout(() => go('NamesEditor'), 120); }}
        />
        <ListRow
          card
          icon="check"
          tone="good"
          title="On sale / off sale"
          subtitle="Take a group off the till, or bring it back"
          onPress={() => { setBulk(false); setTimeout(() => go('ActivateItems'), 120); }}
        />
        <ListRow
          card
          icon="tag"
          tone="warn"
          title="Price tags"
          subtitle="Choose items, design the tag, then print"
          onPress={() => { setBulk(false); setTimeout(() => go('PriceTags'), 120); }}
        />
        {BULK_ACTIONS.filter((a) => a.kind === 'bulkTags').map((a) => (
          <ListRow
            key={a.kind}
            card
            icon={a.icon}
            title={a.title}
            subtitle={a.sub}
            onPress={() => { setBulk(false); setTimeout(() => go('BulkChange', { kind: a.kind }), 120); }}
          />
        ))}
      </Sheet>

      {canFor(role, 'inventory.create') ? (
        <FAB label="Add item" icon="plus" tone="accent" onPress={() => go('ProductDetail', {})} />
      ) : null}
    </View>
  );
}
