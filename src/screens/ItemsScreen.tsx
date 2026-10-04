/**
 * ITEMS — list first (design 1b).
 * Filter chips, two value tiles, a restock nudge only when needed, search, then the cards —
 * the same list layout as Sales, Purchases and the rest.
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
import { FAB_COLORS } from '../components/ui';
import React, { useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { Pressable } from '../components/Press';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { canFor } from '../data/perms';
import { EmptyState, ListRow } from '../components/ui';
import { ListPage, DocRow, StatusChips, SummaryTiles } from '../components/DocList';
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
        <AppBar brand title="Items" right={right} />
        <EmptyState icon="box" title="Not available" subtitle="Your role does not include stock." />
      </View>
    );
  }

  const open = (route: string, params?: any) => { setSheet(false); setTimeout(() => go(route as any, params), 120); };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AppBar brand title="Items" right={right} />
      <ListPage
        top={(
          <>
            <StatusChips value={filter} onChange={setFilter} options={d.chips} />
            <SummaryTiles tiles={[
              { label: 'Stock at sale', value: money(d.value) },
              { label: 'Stock at cost', value: money(d.cost) },
            ]} />
            {filter === 'all' && d.low > 0 ? (
              <Pressable
                onPress={() => setFilter('low')}
                style={{
                  marginHorizontal: 16, marginBottom: 12, backgroundColor: colors.warnSoft, borderRadius: 13,
                  paddingVertical: 11, paddingHorizontal: 14, flexDirection: 'row', justifyContent: 'space-between',
                }}
              >
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.warn }}>
                  {d.low} {d.low === 1 ? 'item' : 'items'} at or below reorder level
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.warn }}>Restock</Text>
                  <Icon name="chev" size={14} color={colors.warn} />
                </View>
              </Pressable>
            ) : null}
          </>
        )}
        search={{ value: q, onChange: setQ, placeholder: 'Search name, code or category' }}
        data={d.list}
        keyExtractor={(x) => x.id}
        empty={{ text: q || filter !== 'all' ? 'Nothing matches. Change the filter, or add an item or service.' : 'No items yet. Add your first with Add item.' }}
        add={canFor(role, 'inventory.create') ? { label: 'Add item', color: FAB_COLORS.addItem, onPress: () => go('ProductDetail', {}) } : undefined}
        renderItem={({ item: x }) => {
          const st = stockOf(x);
          const svc = x.kind === 'service';
          const out = !svc && st <= 0, low = !svc && st <= x.reorder;
          // the stock, said in words and in colour: fine, running low, gone — or a service, which has none
          const tone = svc ? 'accent' : out ? 'danger' : low ? 'warn' : 'good';
          const tracks = [x.trackSerials ? 'IMEI' : '', x.trackBatches ? 'Batches' : '', x.secondaryUnit ? 'Also by ' + x.secondaryUnit : '']
            .filter(Boolean).join(' · ');
          return (
            <DocRow
              title={x.name}
              pill={{ label: svc ? 'Service' : out ? 'Out' : low ? 'Low' : 'In stock', tone }}
              amount={money(x.price) + ' / ' + x.unit}
              refText={svc ? 'Service' : st + ' ' + x.unit + ' in stock'}
              sideText={[svc ? '' : x.category, x.sku].filter(Boolean).join(' · ') || undefined}
              lines={[
                ...(!svc && x.cost ? [{ label: 'Cost', value: money(x.cost) }] : []),
                ...(tracks ? [{ label: 'Tracks', value: tracks }] : []),
              ]}
              onPress={() => go('ItemDetail', { productId: x.id })}
            />
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
    </View>
  );
}
