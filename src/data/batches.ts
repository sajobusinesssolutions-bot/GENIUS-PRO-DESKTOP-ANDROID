/**
 * Batch and expiry helpers.
 *
 * A batch-tracked product holds its quantity twice: once in `stock[warehouse]`
 * for the warehouse total, and once per batch in `batches[]`. These helpers keep
 * the two readings reconciled and decide which batch a sale should draw from.
 */
import type { Product, ProductBatch, DB } from './types';

export type ExpiryState = 'expired' | 'critical' | 'soon' | 'ok' | 'none';

/** Days until the batch expires; null when the batch carries no expiry date. */
export function daysToExpiry(batch: Pick<ProductBatch, 'expiry'>, now = Date.now()): number | null {
  if (!batch.expiry) return null;
  const t = new Date(batch.expiry).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((t - now) / 86400000);
}

/**
 * How urgent a batch is. `critical` is inside a week, `soon` inside the shop's
 * warning window — 90 days unless a different one is given.
 */
export function expiryState(batch: Pick<ProductBatch, 'expiry'>, warnDays = 90, now = Date.now()): ExpiryState {
  const d = daysToExpiry(batch, now);
  if (d === null) return 'none';
  if (d < 0) return 'expired';
  if (d <= 7) return 'critical';
  if (d <= warnDays) return 'soon';
  return 'ok';
}

/** Batches holding stock, soonest expiry first. Undated batches sort last. */
export function liveBatches(p: Product | undefined | null): ProductBatch[] {
  return [...(p?.batches || [])]
    .filter((b) => b.qty > 0)
    .sort((a, b) => {
      if (!a.expiry && !b.expiry) return a.no.localeCompare(b.no);
      if (!a.expiry) return 1;
      if (!b.expiry) return -1;
      return new Date(a.expiry).getTime() - new Date(b.expiry).getTime();
    });
}

export interface BatchPick { no: string; qty: number; expiry: string }

/**
 * FIFO allocation: draw `qty` from the batches that expire soonest, so stock
 * leaves the shelf in the order it will go bad. Returns the picks it could
 * satisfy plus whatever it could not cover.
 */
export function allocateFifo(p: Product | undefined | null, qty: number): { picks: BatchPick[]; shortfall: number } {
  const picks: BatchPick[] = [];
  let left = Math.max(0, qty);
  for (const b of liveBatches(p)) {
    if (left <= 0) break;
    const take = Math.min(b.qty, left);
    if (take > 0) {
      picks.push({ no: b.no, qty: take, expiry: b.expiry });
      left -= take;
    }
  }
  return { picks, shortfall: left };
}

/** Total held across every batch — should agree with the warehouse total. */
export function batchTotal(p: Product | undefined | null): number {
  return (p?.batches || []).reduce((s, b) => s + b.qty, 0);
}

/**
 * Batch rows across the whole catalogue, for the batch and expiry reports.
 * Only batch-tracked products with stock on hand are included.
 */
export function batchRows(db: DB, warnDays = 90, now = Date.now()) {
  const out: Array<{
    product: Product; batch: ProductBatch; state: ExpiryState;
    days: number | null; value: number;
  }> = [];
  db.products.forEach((p) => {
    if (!p.trackBatches) return;
    (p.batches || []).forEach((b) => {
      if (b.qty <= 0) return;
      out.push({
        product: p,
        batch: b,
        state: expiryState(b, warnDays, now),
        days: daysToExpiry(b, now),
        value: b.qty * p.cost,
      });
    });
  });
  return out;
}

const ORDER: Record<ExpiryState, number> = { expired: 0, critical: 1, soon: 2, ok: 3, none: 4 };

/** Most urgent first — expired, then critical, then soon. */
export function byUrgency<T extends { state: ExpiryState; days: number | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const o = ORDER[a.state] - ORDER[b.state];
    if (o !== 0) return o;
    if (a.days === null) return 1;
    if (b.days === null) return -1;
    return a.days - b.days;
  });
}
