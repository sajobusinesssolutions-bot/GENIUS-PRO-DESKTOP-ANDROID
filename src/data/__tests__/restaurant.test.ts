import { isRestaurant, words, sameOrderLine, modifierText, groupsFor, kitchenOf, RESTAURANT_HIDDEN, menuSections, stationOf, printsStation, stationsOf } from '../restaurant';
import { escposKitchen } from '../escpos';

const line = (over: any = {}) => ({ productId: 'p1', name: 'Burger', sku: 'B', unit: 'PC', qty: 1, price: 10000, cost: 0, taxRate: 0, ...over });

describe('restaurant mode', () => {
  it('is on only for a restaurant business, and speaks of orders and tickets', () => {
    expect(isRestaurant({ firm: { businessType: 'restaurant' } } as any)).toBe(true);
    expect(isRestaurant({ firm: { businessType: 'retail' } } as any)).toBe(false);
    expect(words({ firm: { businessType: 'restaurant' } } as any)).toMatchObject({ sale: 'Order', cart: 'Ticket', newSale: 'New order' });
    expect(words({ firm: { businessType: 'retail' } } as any)).toMatchObject({ sale: 'Sale', cart: 'Cart' });
  });

  it('hides what a kitchen does not need', () => {
    ['Estimates', 'Challans', 'Instalments', 'Warranties'].forEach((r) => expect(RESTAURANT_HIDDEN.has(r)).toBe(true));
  });

  it('merges a dish only with the same choices and note', () => {
    const large = [{ group: 'Size', name: 'Large', price: 2000 }];
    expect(sameOrderLine(line(), line({ qty: 3 }))).toBe(true);
    expect(sameOrderLine(line({ modifiers: large }), line())).toBe(false);
    expect(sameOrderLine(line({ note: 'no salt' }), line())).toBe(false);
    expect(modifierText([...large, { group: 'Extras', name: 'Cheese', price: 0 }])).toBe('Large, Cheese');
  });

  it('offers an item its modifier groups in order, skipping deleted ones', () => {
    const d: any = { modifierGroups: [{ id: 'a', name: 'Size' }, { id: 'b', name: 'Extras' }] };
    expect(groupsFor(d, { modifierGroups: ['b', 'gone', 'a'] } as any).map((g) => g.name)).toEqual(['Extras', 'Size']);
  });

  it('fills in the kitchen ticket defaults', () => {
    expect(kitchenOf(null)).toMatchObject({ title: 'KITCHEN ORDER', copies: 1, showNotes: true });
    expect(kitchenOf({ printer: { kitchen: { title: 'BAR' } } } as any).title).toBe('BAR');
  });

  it('prints the table, choices and notes on the kitchen ticket, and no prices', () => {
    const bytes = escposKitchen({
      kind: 'Kitchen Order', no: 'T001', ts: new Date().toISOString(), firmName: 'Cafe', table: 'Table 4', servedBy: 'Sarah',
      lines: [{ name: 'Burger', qty: 2, price: 10000, mods: ['Large'], note: 'well done' }], subtotal: 0, total: 0,
    }, '80mm', kitchenOf({ printer: { kitchen: { title: 'GRILL', showServer: false } } } as any));
    const text = Array.from(bytes).map((b) => String.fromCharCode(b)).join('');
    expect(text).toContain('GRILL');
    expect(text).toContain('Table 4');
    expect(text).toContain('2 x Burger');
    expect(text).toContain('+ Large');
    expect(text).toContain('* well done');
    expect(text).not.toContain('Sarah');
    expect(text).not.toContain('10,000');
  });

  it('lists sections in their order, then categories dishes use that have no section yet', () => {
    const d: any = {
      menuGroups: [{ id: 'b', name: 'Mains', color: '#1', sort: 1 }, { id: 'a', name: 'Starters', color: '#2', sort: 0 }],
      products: [{ category: 'Mains' }, { category: 'Desserts' }, { category: 'Drinks', active: false }],
    };
    expect(menuSections(d).map((x) => x.name)).toEqual(['Starters', 'Mains', 'Desserts']);
  });

  it('sends a dish to its own station, else to its section station, else the first', () => {
    const d: any = { settings: {}, menuGroups: [{ id: 'g', name: 'Drinks', station: 'Bar', sort: 0, color: '' }] };
    expect(stationsOf(d)).toEqual(['Kitchen', 'Bar']);
    expect(stationOf(d, { station: 'Grill', category: 'Drinks' } as any)).toBe('Grill');
    expect(stationOf(d, { category: 'Drinks' } as any)).toBe('Bar');
    expect(stationOf(d, { category: 'Mains' } as any)).toBe('Kitchen');
    expect(printsStation({ stations: ['Bar'] } as any, 'Kitchen')).toBe(false);
    expect(printsStation({ stations: [] } as any, 'Kitchen')).toBe(true);
  });
});

describe('day close freeze', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { inClosedDay, guardOpenDay } = require('../logic');
  const d: any = { settings: { closedThrough: '2026-10-06T22:00:00.000Z' } };
  it('freezes everything up to the close, and nothing after it', () => {
    expect(inClosedDay(d, '2026-10-06T21:59:00.000Z')).toBe(true);
    expect(inClosedDay(d, '2026-10-06T22:01:00.000Z')).toBe(false);
    expect(inClosedDay({ settings: {} }, '2026-10-06T21:59:00.000Z')).toBe(false);
    expect(() => guardOpenDay(d, '2026-10-06T10:00:00.000Z')).toThrow(/day is closed/i);
    expect(() => guardOpenDay(d, '2026-10-07T10:00:00.000Z')).not.toThrow();
  });
});

describe('editions and licences', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { licensedEdition, editionOfType, editionLockReason, vocab } = require('../editions');
  it('gives a new account the Retail edition, and a granted licence its own', () => {
    expect(licensedEdition(null, null)).toBe('retail');
    expect(licensedEdition({ plan: 'trial', edition: 'retail' }, null)).toBe('retail');
    expect(licensedEdition({ plan: 'pro', edition: 'pharmacy' }, null)).toBe('pharmacy');
    expect(licensedEdition({ plan: null, edition: 'pharmacy' }, { edition: 'restaurant' })).toBe('restaurant');
    expect(editionOfType('hardware')).toBe('retail');
    expect(editionLockReason('retail', 'restaurant')).toMatch(/trial is for the Retail edition/);
  });
  it('speaks each trade', () => {
    expect(vocab({ firm: { businessType: 'pharmacy' } }).items).toBe('Drugs');
    expect(vocab({ firm: { businessType: 'pharmacy' } }).customer).toBe('Customer');
    expect(vocab({ firm: { businessType: 'restaurant' } }).item).toBe('Dish');
    expect(vocab({ firm: { businessType: 'retail' } }).items).toBe('Items');
  });
});

describe('business limits', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { businessAllowance } = require('../editions');
  it('counts businesses the server has not seen', () => {
    // one on the server, these books never synced, and a second firm inside them
    const d = { onboarded: true, firms: [{}, {}], sync: {} };
    expect(businessAllowance({ maxBusinesses: 5, owned: 1, plan: 'pro' }, d)).toEqual({ max: 5, used: 3, left: 2 });
    expect(businessAllowance({ maxBusinesses: 1, owned: 0, plan: 'starter' }, { onboarded: true, sync: {} }).left).toBe(0);
    // a developer-raised limit wins over the plan's number
    expect(businessAllowance({ maxBusinesses: 8, owned: 2, plan: 'starter' }, null).left).toBe(6);
    // with no word from the server, the licence on the phone decides
    expect(businessAllowance(null, { licence: { licence: { plan: 'pro' } } }).max).toBe(3);
  });
});

describe('an expired plan', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { planRefusal } = require('../recordGate');
  it('refuses new work however the licence reported it', () => {
    const d: any = {
      licence: { key: 'k', status: 'expired', checkedAt: new Date().toISOString(), licence: { plan: 'pro', expiresAt: '2020-01-01T00:00:00.000Z' } },
      settings: {},
    };
    expect(planRefusal(d)).not.toBeNull();
  });
});

describe('order type on the kitchen ticket', () => {
  const ticket = (orderType?: any) => Array.from(escposKitchen({
    kind: 'Kitchen Order', no: 'T1', ts: new Date().toISOString(), firmName: 'Cafe', table: 'Table 4', orderType,
    lines: [{ name: 'Burger', qty: 1, price: 0 }], subtotal: 0, total: 0,
  }, '80mm', kitchenOf(null))).map((b) => String.fromCharCode(b)).join('');
  it('prints each type in its own style', () => {
    const take = ticket('takeaway');
    const del = ticket('delivery');
    expect(take).toContain('TAKEAWAY');
    expect(take).toContain('\x1dB\x01'); // white on black
    expect(del).toContain('DELIVERY');
    expect(del).toContain('\x1b-\x02'); // underlined
    expect(ticket('dine')).toContain('DINE IN');
    expect(ticket()).not.toMatch(/DINE IN|TAKEAWAY|DELIVERY/);
  });
});
