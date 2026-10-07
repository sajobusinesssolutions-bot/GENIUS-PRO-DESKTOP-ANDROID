import { listPriceOf, priceFor, repriceLines, activeLists, listProducts, adjLabel } from '../priceLists';

const p = (o: any) => ({ id: 'a', name: 'Beans', sku: 'B', unit: 'PC', category: '', cost: 85000, price: 120000, taxRate: 0, stock: {}, reorder: 0, warrantyMonths: 0, active: true, ...o });
const list = (o: any) => ({ id: 'l1', name: 'Wholesale', currency: 'UGX', status: 'Active', adj: 12, prices: {}, createdAt: '', updatedAt: '', ...o });

describe('price lists', () => {
  it('prices an item at cost plus the margin, rounded to the hundred, unless a price was typed', () => {
    expect(listPriceOf(list({}) as any, p({}) as any)).toBe(95200);
    expect(listPriceOf(list({ prices: { a: 99000 } }) as any, p({}) as any)).toBe(99000);
    // an item with no cost keeps its own price rather than going to zero
    expect(listPriceOf(list({}) as any, p({ cost: 0 }) as any)).toBe(120000);
    expect(adjLabel(0)).toBe('At cost');
    expect(adjLabel(12)).toBe('+12% vs cost');
  });

  it('uses the item\'s own price when it is not on the list, or no list is chosen', () => {
    expect(priceFor(list({ productIds: ['other'] }) as any, p({}) as any)).toBe(120000);
    expect(priceFor(null, p({}) as any)).toBe(120000);
  });

  it('re-prices a bill for a new list and keeps each line\'s discount', () => {
    const lines = [{ productId: 'a', price: 120000, listPrice: 120000, discountPct: 10 }];
    const out = repriceLines(lines, list({}) as any, [p({}) as any]);
    expect(out[0].listPrice).toBe(95200);
    expect(out[0].price).toBe(85680);
  });

  it('offers only active lists, and knows which items a list holds', () => {
    const d: any = { priceLists: [list({}), list({ id: 'l2', status: 'Draft' })], products: [p({}), p({ id: 'b' }), p({ id: 'c', active: false })] };
    expect(activeLists(d).map((l: any) => l.id)).toEqual(['l1']);
    expect(listProducts(d, list({}) as any).map((x) => x.id)).toEqual(['a', 'b']);
    expect(listProducts(d, list({ productIds: ['b'] }) as any).map((x) => x.id)).toEqual(['b']);
  });
});
