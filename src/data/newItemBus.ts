/**
 * An item made on the full item screen for a bill that is still open: the bill
 * hears about it and takes it as its next line, so "Add New Item" on a bill
 * opens the whole item form and still lands the item on the bill.
 */
import type { Product } from './types';

const listeners = new Set<(p: Product) => void>();
export function onItemCreatedForBill(fn: (p: Product) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function itemCreatedForBill(p: Product) { listeners.forEach((fn) => fn(p)); }
