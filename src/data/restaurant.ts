/**
 * RESTAURANT MODE.
 *
 * A business set up as a restaurant or bar takes orders, not sales: the
 * counter shows the menu, an order is built up on a ticket, the ticket is
 * saved (and goes to the kitchen) and charged when the table pays — the way
 * Loyverse and most restaurant tills work. Features a kitchen has no use for
 * (quotations, delivery notes, instalments, IMEIs…) are hidden from the menu.
 *
 * Kept free of React so it can be used from data code and tests alike.
 */
import type { DB, KitchenSettings, MenuGroup, ModifierGroup, OrderType, Printer, Product, SaleLine, SaleModifier } from './types';

export const GROUP_COLORS = ['#E8F0FE', '#E6F4EA', '#FEF7E0', '#FCE8E6', '#F3E8FD', '#E0F7FA', '#FFF0E0', '#ECEFF1'];
export const DISH_TAGS = ['Vegetarian', 'Vegan', 'Spicy', 'Halal', 'Gluten free', 'New', 'Popular'];
export const ORDER_TYPES: { v: OrderType; l: string }[] = [
  { v: 'dine', l: 'Dine in' }, { v: 'takeaway', l: 'Takeaway' }, { v: 'delivery', l: 'Delivery' },
];
export const orderTypeWord = (t?: OrderType) => ORDER_TYPES.find((x) => x.v === t)?.l || '';

/** Where dishes are made. A restaurant starts with a kitchen and a bar. */
export function stationsOf(d: Pick<DB, 'settings'> | null | undefined): string[] {
  const s = d?.settings?.stations;
  return s && s.length ? s : ['Kitchen', 'Bar'];
}

/**
 * The menu's sections in their order. Categories that dishes use but that have
 * no section yet are added at the end, so nothing on the menu is ever hidden.
 */
export function menuSections(d: DB | null | undefined): MenuGroup[] {
  if (!d) return [];
  const set = [...(d.menuGroups || [])].sort((a, b) => a.sort - b.sort);
  const known = new Set(set.map((g) => g.name));
  const extra = [...new Set(d.products.filter((p) => p.active !== false).map((p) => p.category || 'Other'))]
    .filter((c) => !known.has(c)).sort();
  return [...set, ...extra.map((name, i) => ({ id: 'cat:' + name, name, color: GROUP_COLORS[(set.length + i) % GROUP_COLORS.length], sort: set.length + i }))];
}

/** The station a dish is made at: its own, else its section's, else the first. */
export function stationOf(d: DB | null | undefined, p: Product | null | undefined): string {
  if (!d) return 'Kitchen';
  if (p?.station) return p.station;
  const g = (d.menuGroups || []).find((x) => x.name === p?.category);
  return g?.station || stationsOf(d)[0];
}

/** Whether a kitchen printer takes this station's orders. A printer with no stations ticked takes them all. */
export function printsStation(p: Printer, station: string): boolean {
  return !p.stations || !p.stations.length || p.stations.includes(station);
}

/** The kitchen ticket's layout, with the defaults filled in. */
export function kitchenOf(d: Pick<DB, 'printer'> | null | undefined): KitchenSettings {
  return {
    title: 'KITCHEN ORDER', bigText: true, showTable: true, showServer: true, showTime: true, showNotes: true, copies: 1, footer: '',
    ...(d?.printer?.kitchen || {}),
  };
}

export function isRestaurant(d: Pick<DB, 'firm'> | null | undefined): boolean {
  return d?.firm?.businessType === 'restaurant';
}

/** The words the till uses: "Order" and "Ticket" in a restaurant, "Sale" and "Cart" elsewhere. */
export function words(d: Pick<DB, 'firm'> | null | undefined) {
  const r = isRestaurant(d);
  return {
    sale: r ? 'Order' : 'Sale',
    sales: r ? 'Orders' : 'Sales',
    newSale: r ? 'New order' : 'New sale',
    cart: r ? 'Ticket' : 'Cart',
  };
}

/** Menu rows a restaurant does not need. */
export const RESTAURANT_HIDDEN = new Set([
  'ItemsTab', 'Estimates', 'Challans', 'Recurring', 'Instalments', 'Warranties', 'Batches', 'PriceTags', 'StockTakes',
]);

/** The modifier groups offered for an item, in the order they were set on it. */
export function groupsFor(d: DB | null | undefined, p: Product | null | undefined): ModifierGroup[] {
  if (!d || !p?.modifierGroups?.length) return [];
  const all = d.modifierGroups || [];
  return p.modifierGroups.map((id) => all.find((g) => g.id === id)).filter((g): g is ModifierGroup => !!g);
}

/** "Large, Extra cheese, No onions" */
export function modifierText(mods?: SaleModifier[]): string {
  return (mods || []).map((m) => m.name).join(', ');
}

/** Two lines are the same order when the item, its choices and its note all match. */
export function sameOrderLine(a: SaleLine, b: SaleLine): boolean {
  return a.productId === b.productId && a.price === b.price && (a.note || '') === (b.note || '')
    && modifierText(a.modifiers) === modifierText(b.modifiers);
}

/** A couple of groups a new restaurant starts with, to show how modifiers work. */
export function starterModifiers(): ModifierGroup[] {
  return [
    {
      id: 'mod_size', name: 'Size', required: true, multi: false,
      options: [{ id: 'mo_small', name: 'Small', price: 0 }, { id: 'mo_regular', name: 'Regular', price: 0 }, { id: 'mo_large', name: 'Large', price: 2000 }],
    },
    {
      id: 'mod_extras', name: 'Extras', required: false, multi: true,
      options: [{ id: 'mo_cheese', name: 'Extra cheese', price: 1500 }, { id: 'mo_egg', name: 'Add egg', price: 1000 }, { id: 'mo_noonion', name: 'No onions', price: 0 }],
    },
  ];
}
