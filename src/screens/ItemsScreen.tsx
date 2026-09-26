/**
 * ITEMS — the live definition. `SCREENS.items` at reference line 5675 is replaced
 * at line 13154 by `SCREENS.stock.body` (aliased back with `SCREENS.items = SCREENS.stock`
 * at 13209), which adds the period bar, the units-moved stats and the "Moved" filter.
 * The right-hand side is `SCREENS.items.right` at 17146: "+" plus a bulk-changes button.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable } from 'react-native';
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
import { BULK_ACTIONS, sharePriceTags } from './BulkScreens';

export default function ItemsScreen() {
  const { colors } = useTheme();
  const go = useGo();
  const { db, money, stockOf } = useAppData();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [category, setCategory] = useState('all');
  const [unit, setUnit] = useState('all');
  const [bulk, setBulk] = useState(false);

  const role = db?.session.role;
  const allowed = canFor(role, 'items');

  const d = useMemo(() => {
    if (!db) return null;
    const value = db.products.reduce((s, x) => s + stockOf(x) * x.price, 0);
    const cost = db.products.reduce((s, x) => s + stockOf(x) * x.cost, 0);
    const active = db.products.filter((x) => x.active);
    const low = active.filter((x) => stockOf(x) <= x.reorder).length;
    const term = q.toLowerCase();
    const categories = Array.from(new Set(active.map((x) => x.category).filter(Boolean))).sort();
    const units = Array.from(new Set(active.map((x) => x.unit).filter(Boolean))).sort();
    const list = active.filter((x) => {
      if (filter === 'products' && x.kind === 'service') return false;
      if (filter === 'services' && x.kind !== 'service') return false;
      if (filter === 'low' && (x.kind === 'service' || stockOf(x) > x.reorder)) return false;
      if (filter === 'out' && (x.kind === 'service' || stockOf(x) > 0)) return false;
      if (category !== 'all' && x.category !== category) return false;
      if (unit !== 'all' && x.unit !== unit) return false;
      if (term && (x.name + ' ' + x.sku + ' ' + x.category + ' ' + x.unit).toLowerCase().indexOf(term) < 0) return false;
      return true;
    });
    const chips: [string, string][] = [
      ['all', 'All ' + active.length], ['products', 'Products ' + active.filter((x) => x.kind !== 'service').length],
      ['services', 'Services ' + active.filter((x) => x.kind === 'service').length], ['low', 'Low ' + low], ['out', 'Out'],
    ];
    return { categories, units, value, cost, list, chips };
  }, [db, q, filter, category, unit]);

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
      <FlatList
        data={d.list}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ paddingBottom: 16 }}
        keyboardShouldPersistTaps="handled"
        // a big catalog scrolled fine as a ScrollView + .map() until it didn't:
        // nothing off-screen was ever unmounted, so every row's views stayed
        // alive at once. FlatList only keeps what is near the viewport mounted.
        ListHeaderComponent={
          <View>
            <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12 }}>
              <Search value={q} onChange={setQ} placeholder="Search by name, code or category" />
            </View>

            <View style={{ paddingHorizontal: 16, paddingBottom: 14 }}>
              <StatGrid
                items={[
                  { icon: 'coins', label: 'Stock value (sale)', value: money(d.value), tone: 'good' },
                  { icon: 'money', label: 'At cost', value: money(d.cost), tone: 'accent' },
                  { icon: 'box', label: 'Categories', value: String(d.categories.length), tone: 'good' },
                  { icon: 'tag', label: 'Units used', value: String(d.units.length), tone: 'accent' },
                ]}
              />
            </View>

            <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
              <SectionLabel right={<Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{category !== 'all' ? 'Category: ' + category : unit !== 'all' ? 'Unit: ' + unit : 'Quick filters'}</Text>}>
                Filters
              </SectionLabel>
              <FilterChips value={filter} onChange={setFilter} options={d.chips.map(([v, l]) => ({ v, l }))} />
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
                Items & services
              </SectionLabel>
            </View>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="box"
            title="Nothing here"
            subtitle="Change the filters, or add an item or service."
            action={<Button size="sm" variant="pri" label="Add item" onPress={() => go('ProductDetail', {})} />}
          />
        }
        renderItem={({ item: x }) => {
          const st = stockOf(x);
          const out = st <= 0, low = st <= x.reorder;
          const service = x.kind === 'service';
          return (
            <Pressable
              onPress={() => go('ItemDetail', { productId: x.id })}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12,
                backgroundColor: colors.surface, borderRadius: 16,
                marginHorizontal: 16, marginBottom: 7, minHeight: 64,
                shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2,
              }}
            >
              <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: service ? colors.accentSoft : out ? colors.dangerSoft : colors.goodSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={service ? 'tools' : 'box'} size={17} color={service ? colors.accent : out ? colors.danger : colors.good} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>{x.name}</Text>
                <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 10.5, color: colors.faint, marginTop: 2 }}>
                  {x.sku}{service ? ' · Service' : ' · ' + x.category}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ alignItems: 'flex-end', minWidth: 58 }}>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 9.5, color: colors.faint }}>SELL</Text>
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: colors.good }}>{money(x.price)}</Text>
                </View>
                {!service ? <View style={{ alignItems: 'flex-end', minWidth: 48 }}>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 9.5, color: colors.faint }}>STOCK</Text>
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: out ? colors.danger : low ? colors.warn : colors.ink }}>{st}</Text>
                </View> : <Badge label="Service" tone="accent" />}
              </View>
            </Pressable>
          );
        }}
      />

      <Sheet
        visible={bulk}
        title="Item actions"
        subtitle={db.products.filter((p) => p.active).length + ' active items'}
        icon="tools"
        onClose={() => setBulk(false)}
      >
        <InfoBanner tone="accent" text="Keep the list clean and focus on the stock work that matters." />
        <View style={{ height: 14 }} />
        <ListRow
          card
          icon="plus"
          tone="good"
          title="New item"
          subtitle="Create a product or service"
          onPress={() => { setBulk(false); setTimeout(() => go('ProductDetail', {}), 120); }}
        />
        <ListRow
          card
          icon="tag"
          tone="accent"
          title="Units & categories"
          subtitle="Manage, create and remove item lists"
          onPress={() => { setBulk(false); setTimeout(() => go('UnitsCategories'), 120); }}
        />
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
