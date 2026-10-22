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
import { ListPage, StatusChips, SummaryTiles, SortBar } from '../components/DocList';

type ItemSort = 'az' | 'za' | 'qtyLow' | 'qtyHigh' | 'priceHigh' | 'priceLow';
const ITEM_SORTS: { v: ItemSort; l: string }[] = [
  { v: 'az', l: 'Name A–Z' }, { v: 'za', l: 'Name Z–A' },
  { v: 'qtyLow', l: 'Quantity, lowest first' }, { v: 'qtyHigh', l: 'Quantity, highest first' },
  { v: 'priceHigh', l: 'Price, highest first' }, { v: 'priceLow', l: 'Price, lowest first' },
];
import type { Product } from '../data/types';
import { AppBar, IconBtn } from '../components/AppBar';
import { Sheet } from '../components/Sheet';
import { Icon } from '../components/icons';
import { useGo } from '../nav/navigate';
import { vocab } from '../data/editions';
import { BULK_ACTIONS } from './BulkScreens';

export default function ItemsScreen() {
  const { colors } = useTheme();
  const go = useGo();
  const { db, money, stockOf } = useAppData();
  const V = vocab(db);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [sheet, setSheet] = useState(false);
  const [sort, setSort] = useState<ItemSort>('az');

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
      // a drug is also found by its generic name
      if (term && (x.name + ' ' + x.sku + ' ' + x.category + ' ' + x.unit + ' ' + (x.genericName || '')).toLowerCase().indexOf(term) < 0) return false;
      return true;
    });
    const byName = (a: Product, b: Product) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    list.sort((a, b) => sort === 'az' ? byName(a, b)
      : sort === 'za' ? byName(b, a)
        : sort === 'qtyLow' ? (stockOf(a) - stockOf(b)) || byName(a, b)
          : sort === 'qtyHigh' ? (stockOf(b) - stockOf(a)) || byName(a, b)
            : sort === 'priceHigh' ? (b.price - a.price) || byName(a, b)
              : (a.price - b.price) || byName(a, b));
    const chips = [
      { v: 'all', l: 'All ' + active.length },
      { v: 'products', l: V.items + ' ' + goods.length },
      { v: 'services', l: 'Services ' + (active.length - goods.length) },
      { v: 'low', l: 'Low ' + low },
      { v: 'out', l: 'Out ' + out },
    ];
    return { value, cost, list, chips, low };
  }, [db, q, filter, sort]);

  const right = <IconBtn name="dots" size={26} color={colors.soft} onPress={() => setSheet(true)} />;

  if (!db || !d) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  if (!allowed) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <AppBar brand title={V.items} right={right} />
        <EmptyState icon="box" title="Not available" subtitle="Your role does not include stock." />
      </View>
    );
  }

  const open = (route: string, params?: any) => { setSheet(false); setTimeout(() => go(route as any, params), 120); };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AppBar brand title={V.items} right={right} />
      <ListPage
        top={(
          <>
            <StatusChips value={filter} onChange={setFilter} options={d.chips} />
            <SortBar value={sort} onChange={setSort} options={ITEM_SORTS} />
            <SummaryTiles tiles={[
              { label: 'Stock at sale', value: money(d.value) },
              { label: 'Stock at cost', value: money(d.cost) },
            ]} />
            {filter === 'all' && d.low > 0 ? (
              <Pressable
                onPress={() => setFilter('low')}
                style={{
                  marginHorizontal: 16, marginBottom: 12, backgroundColor: colors.warnSoft, borderRadius: 4,
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
        search={{ value: q, onChange: setQ, placeholder: V.searchItems }}
        data={d.list}
        keyExtractor={(x) => x.id}
        empty={{ text: q || filter !== 'all' ? 'Nothing matches. Change the filter, or add an item or service.' : 'No items yet. Add your first with Add item.' }}
        add={canFor(role, 'inventory.create') ? { label: V.addItem, color: FAB_COLORS.addItem, onPress: () => go('ProductDetail', {}) } : undefined}
        renderItem={({ item: x }) => (
          <ItemCard product={x} stock={stockOf(x)} money={money} onPress={() => go('ItemDetail', { productId: x.id })} />
        )}
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
        <ListRow card icon="arrow" tone="good" title="Send to another business" subtitle="Stock to and from your other businesses — count in what arrives" onPress={() => open('BranchTransfers')} />
        <ListRow card icon="check" tone="good" title="Stock take" subtitle="Count the shelf against the books" onPress={() => open('StockTakes')} />
        <ListRow card icon="calendar" tone="accent" title="Batches" subtitle="Expiry and lot tracking" onPress={() => open('Batches')} />
        <View style={{ height: 10 }} />
        <ListRow card icon="tag" tone="accent" title="Units & categories" subtitle="Manage, create and remove item lists" onPress={() => open('UnitsCategories')} />
        <ListRow card icon="coins" tone="accent" title="Price lists" subtitle={'Wholesale, customer groups and promotions — each with its own prices'} onPress={() => open('PriceLists')} />
        <ListRow card icon="pencil" tone="accent" title="Bulk price editor" subtitle={'Change cost and selling price across many ' + V.items.toLowerCase() + ' at once'} onPress={() => open('PriceList')} />
        <ListRow card icon="check" tone="good" title="On sale / off sale" subtitle="Take a group off the till, or bring it back" onPress={() => open('ActivateItems')} />
        <ListRow card icon="tag" tone="warn" title="Price tags" subtitle="Choose items, design the tag, then print" onPress={() => open('PriceTags')} />
        {BULK_ACTIONS.filter((a) => a.kind === 'bulkTags').map((a) => (
          <ListRow key={a.kind} card icon={a.icon} title={a.title} subtitle={a.sub} onPress={() => open('BulkChange', { kind: a.kind })} />
        ))}
      </Sheet>
    </View>
  );
}

/**
 * One item: its name, and the stock in colour with what that means in words
 * (in stock, low stock, out of stock); under a rule, what it sells for, what
 * it costs, and how it is counted.
 */
function ItemCard({ product: x, stock, money, onPress }: {
  product: Product; stock: number; money: (n: number) => string; onPress: () => void;
}) {
  const { colors } = useTheme();
  const svc = x.kind === 'service';
  const out = !svc && stock <= 0;
  const low = !svc && !out && stock <= x.reorder;
  const tone = svc ? colors.accent : out ? colors.danger : low ? colors.warn : colors.good;
  const status = svc ? 'SERVICE' : out ? 'OUT OF STOCK' : low ? 'LOW STOCK' : 'IN STOCK';
  const tracks = [x.trackSerials ? 'IMEI' : '', x.trackBatches ? 'Batches' : ''].filter(Boolean).join(' · ') || (svc ? 'Time' : 'Quantity');
  const qty = Math.round(stock * 100) / 100;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        marginHorizontal: 16, marginBottom: 10, borderRadius: 4, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 14,
        backgroundColor: pressed ? colors.sunk : colors.surface, borderWidth: 1, borderColor: colors.line,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text numberOfLines={2} style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 16, color: colors.ink }}>{x.name}</Text>
        <View style={{ alignItems: 'flex-end' }}>
          {svc ? null : (
            <Text style={{ fontFamily: fonts.uiExtra, fontSize: 19, color: tone }}>
              {qty}
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: tone }}> {x.unit.toUpperCase()}</Text>
            </Text>
          )}
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 11, letterSpacing: 0.6, color: tone, marginTop: svc ? 0 : 2 }}>{status}</Text>
        </View>
      </View>

      <View style={{ height: 1, backgroundColor: colors.line, marginTop: 14, marginBottom: 12 }} />

      <View style={{ flexDirection: 'row' }}>
        <ItemFigure label="Price" value={money(x.price)} strong />
        <ItemFigure label="Cost" value={svc && !x.cost ? '—' : money(x.cost)} />
        <ItemFigure label="Tracks" value={tracks} />
      </View>
    </Pressable>
  );
}

function ItemFigure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
      <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{label}</Text>
      <Text numberOfLines={1} style={{ fontFamily: strong ? fonts.uiBold : fonts.ui, fontSize: 14.5, color: colors.ink, marginTop: 4 }}>{value}</Text>
    </View>
  );
}
