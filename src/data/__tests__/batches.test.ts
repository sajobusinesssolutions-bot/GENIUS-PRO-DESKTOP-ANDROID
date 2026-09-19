import { allocateFifo, liveBatches, expiryState, daysToExpiry, batchTotal } from '../batches';
import type { Product, ProductBatch } from '../types';

function iso(daysFromNow: number) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

function product(batches: ProductBatch[]): Product {
  return {
    id: 'p1', sku: 'SKU', name: 'Item', unit: 'pcs', category: 'General',
    cost: 10, price: 20, taxRate: 0, stock: { w1: batchTotal({ batches } as Product) },
    reorder: 0, warrantyMonths: 0, active: true,
    trackBatches: true, batches,
  } as Product;
}

describe('batch expiry', () => {
  it('reads a missing expiry as undated rather than expired', () => {
    expect(expiryState({ expiry: '' })).toBe('none');
    expect(daysToExpiry({ expiry: '' })).toBeNull();
  });

  it('grades a batch by how close its date is', () => {
    expect(expiryState({ expiry: iso(-1) })).toBe('expired');
    expect(expiryState({ expiry: iso(3) })).toBe('critical');
    expect(expiryState({ expiry: iso(40) })).toBe('soon');
    expect(expiryState({ expiry: iso(400) })).toBe('ok');
  });

  it('honours a custom warning window', () => {
    expect(expiryState({ expiry: iso(40) }, 20)).toBe('ok');
    expect(expiryState({ expiry: iso(40) }, 60)).toBe('soon');
  });
});

describe('liveBatches', () => {
  it('drops empty batches and sorts the soonest expiry first', () => {
    const p = product([
      { no: 'C', expiry: iso(90), qty: 5 },
      { no: 'A', expiry: iso(10), qty: 3 },
      { no: 'GONE', expiry: iso(1), qty: 0 },
      { no: 'B', expiry: iso(30), qty: 7 },
    ]);
    expect(liveBatches(p).map((b) => b.no)).toEqual(['A', 'B', 'C']);
  });

  it('puts undated batches last', () => {
    const p = product([
      { no: 'NODATE', expiry: '', qty: 4 },
      { no: 'DATED', expiry: iso(200), qty: 4 },
    ]);
    expect(liveBatches(p).map((b) => b.no)).toEqual(['DATED', 'NODATE']);
  });
});

describe('allocateFifo', () => {
  it('draws entirely from the soonest batch when it covers the order', () => {
    const p = product([
      { no: 'A', expiry: iso(10), qty: 10 },
      { no: 'B', expiry: iso(50), qty: 10 },
    ]);
    const { picks, shortfall } = allocateFifo(p, 4);
    expect(shortfall).toBe(0);
    expect(picks).toEqual([{ no: 'A', qty: 4, expiry: iso(10) }]);
  });

  it('spills into the next batch once the first runs out', () => {
    const p = product([
      { no: 'A', expiry: iso(10), qty: 3 },
      { no: 'B', expiry: iso(50), qty: 10 },
    ]);
    const { picks, shortfall } = allocateFifo(p, 8);
    expect(shortfall).toBe(0);
    expect(picks.map((x) => [x.no, x.qty])).toEqual([['A', 3], ['B', 5]]);
  });

  it('reports what it cannot cover instead of over-drawing', () => {
    const p = product([{ no: 'A', expiry: iso(10), qty: 2 }]);
    const { picks, shortfall } = allocateFifo(p, 5);
    expect(picks.map((x) => x.qty)).toEqual([2]);
    expect(shortfall).toBe(3);
  });

  it('never allocates from an empty or missing batch list', () => {
    expect(allocateFifo(product([]), 3)).toEqual({ picks: [], shortfall: 3 });
    expect(allocateFifo(null, 3)).toEqual({ picks: [], shortfall: 3 });
  });

  it('treats a zero or negative order as nothing to draw', () => {
    const p = product([{ no: 'A', expiry: iso(10), qty: 5 }]);
    expect(allocateFifo(p, 0)).toEqual({ picks: [], shortfall: 0 });
    expect(allocateFifo(p, -2)).toEqual({ picks: [], shortfall: 0 });
  });

  it('prefers an expiring batch over a fresher one holding more', () => {
    const p = product([
      { no: 'FRESH', expiry: iso(300), qty: 100 },
      { no: 'DYING', expiry: iso(2), qty: 1 },
    ]);
    expect(allocateFifo(p, 2).picks[0].no).toBe('DYING');
  });
});
