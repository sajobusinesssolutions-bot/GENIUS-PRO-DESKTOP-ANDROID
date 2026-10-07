/**
 * PRICE LISTS.
 *
 * A price list is a named set of selling prices for some or all items —
 * "Wholesale tier A", "Cafés Kampala", "Holiday promo". Each sets a default
 * margin on cost ("+12% vs cost"), and any item can have its own price typed
 * over that. A list is a Draft while it is being worked on and Active once it
 * may be used; only Active lists are offered when raising a sale, quotation,
 * recurring sale or instalment plan.
 *
 * Choosing a list on a document prices every item on it from the list. Items
 * not on the list keep their normal selling price.
 */
import type { DB, PriceList, Product } from './types';

export const round100 = (n: number) => Math.round(n / 100) * 100;

/** "+12% vs cost", "At cost". */
export const adjLabel = (a: number) => (a === 0 ? 'At cost' : `${a > 0 ? '+' : ''}${a}% vs cost`);

/** The items on a list: those chosen for it, or every active item when it covers them all. */
export function listProducts(d: Pick<DB, 'products'> | null | undefined, l: PriceList): Product[] {
  const all = (d?.products || []).filter((p) => p.active !== false);
  if (!l.productIds) return all;
  const on = new Set(l.productIds);
  return all.filter((p) => on.has(p.id));
}

/**
 * What an item sells for on a list: the price typed for it, else its cost plus
 * the list's margin, rounded to the nearest hundred. An item with no cost
 * falls back to its own selling price, so a margin on nothing is never zero.
 */
export function listPriceOf(l: PriceList, p: Product): number {
  const typed = l.prices?.[p.id];
  if (typed !== undefined) return typed;
  if (!p.cost) return p.price;
  return round100(p.cost * (1 + l.adj / 100));
}

/** Whether an item is on the list. */
export function onList(l: PriceList, productId: string): boolean {
  return !l.productIds || l.productIds.includes(productId);
}

/** The price an item takes on a document: from the list when it is on it, else its own. */
export function priceFor(l: PriceList | null | undefined, p: Product): number {
  return l && onList(l, p.id) ? listPriceOf(l, p) : p.price;
}

/** Lists that may be used on a document. */
export function activeLists(d: Pick<DB, 'priceLists'> | null | undefined): PriceList[] {
  return (d?.priceLists || []).filter((l) => l.status === 'Active');
}

/** Re-prices the lines of a document for a newly chosen list, keeping each line's discount. */
export function repriceLines<T extends { productId: string; price: number; listPrice?: number; discountPct?: number; unitFactor?: number; modifiers?: { price: number }[] }>(
  lines: T[], l: PriceList | null | undefined, products: Product[],
): T[] {
  return lines.map((line) => {
    const p = products.find((x) => x.id === line.productId);
    if (!p) return line;
    const extras = (line.modifiers || []).reduce((n, m) => n + m.price, 0);
    const base = priceFor(l, p) * (line.unitFactor || 1) + extras;
    const disc = line.discountPct || 0;
    return { ...line, listPrice: base, price: Math.round(base * (1 - disc / 100) * 100) / 100 };
  });
}
