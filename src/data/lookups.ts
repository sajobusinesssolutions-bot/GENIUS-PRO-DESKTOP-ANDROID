/**
 * lookups.ts — the book's lists indexed once, not searched again for every row.
 *
 * Reports used to find a sale, a party or an item by walking the whole list
 * for every line they wrote (`db.sales.find(...)` inside a loop over sales),
 * and to work out each customer's balance by walking every sale, payment and
 * return once per customer. On a pharmacy's book (thousands of customers and
 * sales) that is millions of steps: the customer balance list took 2 s and
 * the voucher summary 4.6 s on a PC, several times that on a phone.
 *
 * Each index here is built once and kept while the book has the same number
 * of records in each list and the same number of journal entries (every
 * edit, delete or payment posts to the journal, so it moves that count too —
 * the same rule allPartyBalances uses). Built afresh the moment anything
 * changes; never a stale answer.
 */
import type { DB } from './types';

interface Kept { key: string; v: unknown }
const kept = new WeakMap<object, Map<string, Kept>>();

/** The counts that change whenever the book changes. */
export function bookKey(d: DB): string {
  const a = d as unknown as Record<string, unknown[] | undefined>;
  return [d.sales, d.purchases, d.payments, d.parties, d.products, a.creditNotes, d.journal, a.entries, a.movements]
    .map((x) => (Array.isArray(x) ? x.length : 0)).join(':');
}

/** One index of the book, made once per state of the book. */
function memo<T>(d: DB, tag: string, build: () => T): T {
  // kept against the sales list itself, so a shallow copy of the book shares it
  const owner = (d.sales || d) as object;
  let m = kept.get(owner);
  if (!m) { m = new Map(); kept.set(owner, m); }
  const key = bookKey(d);
  const had = m.get(tag);
  if (had && had.key === key) return had.v as T;
  const v = build();
  m.set(tag, { key, v });
  return v;
}

/**
 * A lookup by one field that always gives the record as it is now: it keeps
 * where each record sits and reads it from the list at that moment, so a
 * record replaced in place (an item renamed, a party edited) is found as it
 * now stands. If the list was reordered, it falls back to a plain search.
 */
interface Lookup<T> { get(k: string): T | undefined; has(k: string): boolean }
const byField = <T extends Record<string, any>>(list: T[] | undefined, f: string): Lookup<T> => {
  const arr = list || [];
  const at = new Map<string, number>();
  arr.forEach((x, i) => { const k = x && x[f]; if (k != null && !at.has(String(k))) at.set(String(k), i); });
  const get = (k: string): T | undefined => {
    const i = at.get(k);
    if (i === undefined) return undefined;
    const x = arr[i];
    if (x && String(x[f]) === k) return x;
    return arr.find((y) => y && String(y[f]) === k);
  };
  return { get, has: (k: string) => get(k) !== undefined };
};

export const salesById = (d: DB) => memo(d, 'sales.id', () => byField(d.sales, 'id'));
export const salesByNo = (d: DB) => memo(d, 'sales.no', () => byField(d.sales, 'no'));
export const purchasesByNo = (d: DB) => memo(d, 'purchases.no', () => byField(d.purchases, 'no'));
export const creditNotesByNo = (d: DB) => memo(d, 'cn.no', () => byField(d.creditNotes || [], 'no'));
export const partiesById = (d: DB) => memo(d, 'parties.id', () => byField(d.parties, 'id'));
export const productsById = (d: DB) => memo(d, 'products.id', () => byField(d.products, 'id'));

export const saleById = (d: DB, id: string | null | undefined) => (id ? salesById(d).get(id) : undefined);
export const partyById = (d: DB, id: string | null | undefined) => (id ? partiesById(d).get(id) : undefined);
export const productById = (d: DB, id: string | null | undefined) => (id ? productsById(d).get(id) : undefined);

export interface PartyDocs {
  sales: DB['sales'];
  purchases: DB['purchases'];
  payments: DB['payments'];
  creditNotes: NonNullable<DB['creditNotes']>;
}
/** Every party's own sales, purchases, payments and returns, in the book's order. */
export function docsByParty(d: DB): Map<string, PartyDocs> {
  return memo(d, 'docs.party', () => {
    const out = new Map<string, PartyDocs>();
    const of = (id: string | null | undefined) => {
      if (!id) return null;
      let e = out.get(id);
      if (!e) { e = { sales: [], purchases: [], payments: [], creditNotes: [] }; out.set(id, e); }
      return e;
    };
    d.sales.forEach((s) => { const e = of(s.partyId); if (e) e.sales.push(s); });
    d.purchases.forEach((x) => { const e = of(x.partyId); if (e) e.purchases.push(x); });
    d.payments.forEach((x) => { const e = of(x.partyId); if (e) e.payments.push(x); });
    (d.creditNotes || []).forEach((c) => { const e = of(c.partyId); if (e) e.creditNotes.push(c); });
    return out;
  });
}
const NONE: PartyDocs = { sales: [], purchases: [], payments: [], creditNotes: [] };
export const docsOf = (d: DB, partyId: string): PartyDocs => docsByParty(d).get(partyId) || NONE;

/** Each item's stock movements, oldest first. */
export function movesByProduct(d: DB): Map<string, DB['movements']> {
  return memo(d, 'moves.product', () => {
    const out = new Map<string, DB['movements']>();
    (d.movements || []).forEach((m) => { let l = out.get(m.productId); if (!l) { l = []; out.set(m.productId, l); } l.push(m); });
    out.forEach((l) => l.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()));
    return out;
  });
}
export const movesOf = (d: DB, productId: string): DB['movements'] => movesByProduct(d).get(productId) || [];

/** Expenses set against a sale (an expense the customer settled), by the sale they were set against. */
export function entriesBySale(d: DB): Map<string, NonNullable<DB['entries']>> {
  return memo(d, 'entries.sale', () => {
    const out = new Map<string, NonNullable<DB['entries']>>();
    (d.entries || []).forEach((e) => { if (!e.offsetSaleId) return; let l = out.get(e.offsetSaleId); if (!l) { l = []; out.set(e.offsetSaleId, l); } l.push(e); });
    return out;
  });
}

/** Expenses a customer settled towards a bill, by the customer they belong to (who settled it, even if the bill moved since). */
export function entriesByParty(d: DB): Map<string, NonNullable<DB['entries']>> {
  return memo(d, 'entries.party', () => {
    const out = new Map<string, NonNullable<DB['entries']>>();
    const sales = salesById(d);
    (d.entries || []).forEach((e) => {
      if (!e.offsetSaleId) return;
      const s = sales.get(e.offsetSaleId);
      const pid = e.offsetPartyId || (s && s.partyId);
      if (!pid) return;
      let l = out.get(pid); if (!l) { l = []; out.set(pid, l); } l.push(e);
    });
    return out;
  });
}
