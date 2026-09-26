/**
 * ITEMS — list first (design 1b).
 * One summary line, one filter row, a restock nudge only when needed, then the list.
 * Stock tools (Adjust, Transfer, Stock take, Batches) moved into the ⋯ sheet.
 *
 * The list itself is a FlatList rather than the ScrollView + .map() this design
 * was drafted with: a big catalog rendered that way keeps every row mounted
 * regardless of scroll position (this screen hit exactly that bug before, see
 * git history). Each row is its own rounded card with a small gap, the same
 * pattern PartiesScreen already uses — not one shared "grouped" container,
 * which a FlatList can't wrap its rows in anyway without every row but the
 * first ending up with no shadow under it.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable } from 'react-native';
import { useTheme, fonts, shadow } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { canFor } from '../data/perms';
import { EmptyState, Button, Search, FilterChips, ListRow, FAB } from '../components/ui';
import { AppBar, IconBtn } from '../components/AppBar';
import { Sheet } from '../components/Sheet';
import { Icon } from '../components/icons';
import { useGo } from '../nav/navigate';
import { BULK_ACTIONS } from './BulkScreens';

export default function ItemsScreen() {
  const { colors } = useTheme();
  const go = useGo();
  const { db, money, stockOf } = useAppData();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [sheet, setSheet] = useState(false);

  const role = db?.session.role;
  const allowed = canFor(role, 'items');

  const d = useMemo(() => {
    if (!db) return null;
    const value = db.products.reduce((s, x) => s + stockOf(x) * x.price, 0);
    const cost = db.products.reduce((s, x) => s + stockOf(x) * x.cost, 0);
    const active = db.products.filter((x) => x.active);
    const goods = active.filter((x) => x.kind !== 'service');
    const low = goods.filter((x) => stockOf(x) <= x.reorder).length;
    const out = goods.filter((x) => stockOf(x) <= 0).length;
    const term = q.toLowerCase();
    const list = active.filter((x) => {
      const svc = x.kind === 'service';
      if (filter === 'products' && svc) return false;
      if (filter === 'services' && !svc) return false;
      if (filter === 'low' && (svc || stockOf(x) > x.reorder)) return false;
      if (filter === 'out' && (svc || stockOf(x) > 0)) return false;
      if (term && (x.name + ' ' + x.sku + ' ' + x.category + ' ' + x.unit).toLowerCase().indexOf(term) < 0) return false;
      return true;
    });
    const chips = [
      { v: 'all', l: 'All ' + active.length },
      { v: 'products', l: 'Products ' + goods.length },
      { v: 'services', l: 'Services ' + (active.length - goods.length) },
      { v: 'low', l: 'Low ' + low },
      { v: 'out', l: 'Out ' + out },
    ];
    return { value, cost, list, chips, low };
  }, [db, q, filter]);

  const right = <IconBtn name="dots" size={26} color={colors.soft} onPress={() => setSheet(true)} />;

  if (!db || !d) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  if (!allowed) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <AppBar title="Items" right={right} />
        <EmptyState icon="box" title="Not available" subtitle="Your role does not include stock." />
      </View>
    );
  }

  const open = (route: string, params?: any) => { setSheet(false); setTimeout(() => go(route as any, params), 120); };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AppBar title="Items" right={right} />
      <FlatList
        data={d.list}
        keyExtractor={(x) => x.id}
        contentContainerStyle={{ paddingBottom: 96 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <Text style={{ paddingHorizontal: 16, paddingTop: 4, fontFamily: fonts.ui, fontSize: 12.5, color: colors.soft }}>
              {money(d.value)} in stock at sale · {money(d.cost)} at cost
            </Text>

            <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 }}>
              <Search value={q} onChange={setQ} placeholder="Search name, code or category" />
            </View>

            <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
              <FilterChips value={filter} onChange={setFilter} options={d.chips} />
            </View>

            {filter === 'all' && d.low > 0 ? (
              <Pressable
                onPress={() => setFilter('low')}
                style={{
                  marginHorizontal: 16, marginBottom: 12, backgroundColor: colors.warnSoft, borderRadius: 13,
                  paddingVertical: 11, paddingHorizontal: 14, flexDirection: 'row', justifyContent: 'space-between',
                }}
              >
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.warn }}>
                  {d.low} {d.low === 1 ? 'item' : 'items'} at or below reorder level
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.warn }}>Restock</Text>
                  <Icon name="chev" size={14} color={colors.warn} />
                </View>
              </Pressable>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="box"
            title="Nothing matches"
            subtitle="Change the filter, or add an item or service."
            action={<Button size="sm" variant="pri" label="Add item" onPress={() => go('ProductDetail', {})} />}
          />
        }
        renderItem={({ item: x }) => {
          const st = stockOf(x);
          const svc = x.kind === 'service';
          const out = !svc && st <= 0, low = !svc && st <= x.reorder;
          const fg = svc ? colors.accent : out ? colors.danger : low ? colors.warn : colors.ink;
          const pill = svc ? colors.accentSoft : out ? colors.dangerSoft : low ? colors.warnSoft : colors.sunk;
          const tileBg = svc ? colors.accentSoft : out ? colors.dangerSoft : colors.goodSoft;
          const tileFg = svc ? colors.accent : out ? colors.danger : colors.good;
          return (
            <Pressable
              onPress={() => go('ItemDetail', { productId: x.id })}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14,
                minHeight: 64, marginHorizontal: 16, marginBottom: 7, borderRadius: 16,
                backgroundColor: colors.surface, ...shadow.card,
              }}
            >
              <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: tileBg, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={svc ? 'tools' : 'box'} size={18} color={tileFg} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink }}>{x.name}</Text>
                <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 2 }}>
                  {money(x.price)} · {svc ? 'Service' : x.category}
                </Text>
              </View>
              <View style={{ paddingVertical: 5, paddingHorizontal: 9, borderRadius: 999, backgroundColor: pill }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 12, color: fg }}>
                  {svc ? 'Service' : out ? 'Out' : st + ' left'}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />

      <Sheet
        visible={sheet}
        title="Item actions"
        subtitle={db.products.filter((p) => p.active).length + ' active items'}
        icon="tools"
        onClose={() => setSheet(false)}
      >
        <ListRow card icon="swap" tone="accent" title="Adjust stock" subtitle="Correct counts, record damage or loss" onPress={() => open('StockAdjust')} />
        <ListRow card icon="arrow" tone="accent" title="Transfer" subtitle="Move stock between branches" onPress={() => open('StockTransfer')} />
        <ListRow card icon="check" tone="good" title="Stock take" subtitle="Count the shelf against the books" onPress={() => open('StockTakes')} />
        <ListRow card icon="calendar" tone="accent" title="Batches" subtitle="Expiry and lot tracking" onPress={() => open('Batches')} />
        <View style={{ height: 10 }} />
        <ListRow card icon="tag" tone="accent" title="Units & categories" subtitle="Manage, create and remove item lists" onPress={() => open('UnitsCategories')} />
        <ListRow card icon="coins" tone="accent" title="Price list" subtitle="Edit cost and sell across items and services" onPress={() => open('PriceList')} />
        <ListRow card icon="check" tone="good" title="On sale / off sale" subtitle="Take a group off the till, or bring it back" onPress={() => open('ActivateItems')} />
        <ListRow card icon="tag" tone="warn" title="Price tags" subtitle="Choose items, design the tag, then print" onPress={() => open('PriceTags')} />
        {BULK_ACTIONS.filter((a) => a.kind === 'bulkTags').map((a) => (
          <ListRow key={a.kind} card icon={a.icon} title={a.title} subtitle={a.sub} onPress={() => open('BulkChange', { kind: a.kind })} />
        ))}
      </Sheet>

      {canFor(role, 'inventory.create') ? (
        <FAB label="Add item" icon="plus" tone="accent" onPress={() => go('ProductDetail', {})} />
      ) : null}
    </View>
  );
}
