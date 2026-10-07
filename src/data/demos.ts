/**
 * DEMO BUSINESSES — one for each edition, to try before setting up.
 *
 * A prospect taps "Try a demo" and is in a working shop, restaurant or
 * pharmacy with its menu, stock and a little history, under the owner PIN
 * 0000. Demo books are marked as such: they are never adopted as anybody's
 * real books on sign-in, and starting a real business replaces them.
 */
import type { DB, Product, Party } from './types';
import { seed, emptyBook } from './seed';
import { uid, iso } from './uid';
import { hashPin } from './pinHash';
import { applyEditionRoles, ensureRoles } from './perms';
import { starterModifiers, GROUP_COLORS } from './restaurant';
import { PHARMACY_UNITS, PHARMACY_CLASSES, Edition } from './editions';

export const DEMO_PIN = '0000';

const day = 864e5;
const prod = (o: Partial<Product> & { name: string; price: number }): Product => ({
  id: uid('prd'), sku: o.name.slice(0, 6).toUpperCase().replace(/\s+/g, ''), unit: 'PC', category: 'Other', cost: 0,
  taxRate: 0, stock: {}, reorder: 0, warrantyMonths: 0, bom: null, active: true, batches: [], barcodes: [], ...o,
} as Product);
const party = (name: string, type: 'customer' | 'supplier', phone: string): Party => ({ id: uid('pty'), name, type, phone, openingBalance: 0, creditLimit: 0, points: 0, active: true });

/** The owner of a demo, with the demo PIN, and a cashier and a sales person to try the roles. */
function demoStaff(d: DB, names: [string, string, string]) {
  d.users = [
    { id: uid('usr'), name: names[0], role: 'owner', pin: hashPin(DEMO_PIN), active: true },
    { id: uid('usr'), name: names[1], role: 'cashier', pin: hashPin('1111'), active: true },
    { id: uid('usr'), name: names[2], role: 'sales', pin: hashPin('2222'), active: true },
  ];
  d.session = { ...d.session, userId: d.users[0].id, role: 'owner' };
}

function restaurant(): DB {
  const d = emptyBook({ firmName: 'Savanna Grill (demo)' });
  d.firm = { ...d.firm, businessType: 'restaurant', phone: '0700 000 000', address: 'Kampala Road' };
  d.firms = [d.firm];
  demoStaff(d, ['Grace (owner)', 'Peter (cashier)', 'Amina (waiter)']);
  d.settings = { ...d.settings, askCustomer: false, defaultMethod: 'cash', serviceChargePct: 10, kitchenDisplay: true, stations: ['Kitchen', 'Bar'], tables: Array.from({ length: 10 }, (_, i) => 'Table ' + (i + 1)) };

  d.modifierGroups = starterModifiers();
  const [size, extras] = d.modifierGroups;
  const sections = [['Starters', 'Kitchen'], ['Mains', 'Kitchen'], ['Drinks', 'Bar'], ['Desserts', 'Kitchen']] as const;
  d.menuGroups = sections.map(([name, station], i) => ({ id: uid('mgp'), name, color: GROUP_COLORS[i], sort: i, station }));
  d.categories = [...sections.map(([n]) => n), 'Ingredients'];

  const wh = 'w1';
  const ing = (name: string, unit: string, cost: number, stock: number) => prod({ name, unit, cost, price: 0, category: 'Ingredients', ingredient: true, trackInventory: true, stock: { [wh]: stock }, reorder: Math.round(stock / 5) });
  const chicken = ing('Chicken', 'KG', 18000, 25);
  const beef = ing('Beef', 'KG', 22000, 20);
  const bun = ing('Burger bun', 'PC', 800, 120);
  const potato = ing('Potatoes', 'KG', 2500, 60);
  const rice = ing('Rice', 'KG', 4500, 40);
  const passion = ing('Passion fruit', 'KG', 6000, 10);

  const dish = (name: string, section: string, price: number, extra: Partial<Product> = {}) => prod({ name, category: section, price, trackInventory: false, ...extra });
  d.products = [
    chicken, beef, bun, potato, rice, passion,
    dish('Chicken wings', 'Starters', 15000, { recipe: [{ productId: chicken.id, qty: 0.3 }], tags: ['Spicy'], modifierGroups: [extras.id] }),
    dish('Vegetable samosas', 'Starters', 8000, { tags: ['Vegetarian'] }),
    dish('Beef burger', 'Mains', 28000, { recipe: [{ productId: beef.id, qty: 0.2 }, { productId: bun.id, qty: 1 }, { productId: potato.id, qty: 0.25 }], tags: ['Popular'], modifierGroups: [size.id, extras.id] }),
    dish('Grilled chicken', 'Mains', 32000, { recipe: [{ productId: chicken.id, qty: 0.5 }, { productId: potato.id, qty: 0.25 }], modifierGroups: [extras.id] }),
    dish('Pilau rice', 'Mains', 18000, { recipe: [{ productId: rice.id, qty: 0.25 }, { productId: beef.id, qty: 0.1 }] }),
    dish('Passion juice', 'Drinks', 6000, { recipe: [{ productId: passion.id, qty: 0.15 }], modifierGroups: [size.id] }),
    dish('Soda', 'Drinks', 3000),
    dish('Coffee', 'Drinks', 7000, { modifierGroups: [size.id] }),
    dish('Chocolate cake', 'Desserts', 12000, { tags: ['New'] }),
  ];
  d.menus = [
    { id: uid('mnu'), name: 'Food menu', sections: ['Starters', 'Mains', 'Desserts'] },
    { id: uid('mnu'), name: 'Bar menu', sections: ['Drinks'] },
  ];

  // two tables already eating
  const line = (p: Product, qty: number) => ({ productId: p.id, name: p.name, sku: p.sku, unit: p.unit, qty, price: p.price, cost: 0, taxRate: 0 });
  const burger = d.products.find((p) => p.name === 'Beef burger')!;
  const juice = d.products.find((p) => p.name === 'Passion juice')!;
  const wings = d.products.find((p) => p.name === 'Chicken wings')!;
  const now = Date.now();
  d.tickets = [
    { id: uid('tkt'), no: 'T001', name: 'Table 3', ts: iso(new Date(now - 25 * 60000)), updatedAt: iso(new Date(now - 20 * 60000)), lines: [line(burger, 2), line(juice, 2)], sent: [2, 2], status: 'open', userId: d.users[2].id, orderType: 'dine' },
    { id: uid('tkt'), no: 'T002', name: 'Table 7', ts: iso(new Date(now - 8 * 60000)), updatedAt: iso(new Date(now - 8 * 60000)), lines: [line(wings, 1)], sent: [1], status: 'open', userId: d.users[2].id, orderType: 'dine' },
  ];
  d.kitchenOrders = [
    { id: uid('kot'), ticketId: d.tickets[0].id, no: 'T001', table: 'Table 3', orderType: 'dine', by: 'Amina (waiter)', sentAt: d.tickets[0].ts, changedAt: d.tickets[0].ts, status: 'cooking', lines: [{ name: 'Beef burger', qty: 2, mods: ['Large'], station: 'Kitchen' }, { name: 'Passion juice', qty: 2, station: 'Bar' }] },
    { id: uid('kot'), ticketId: d.tickets[1].id, no: 'T002', table: 'Table 7', orderType: 'dine', by: 'Amina (waiter)', sentAt: d.tickets[1].ts, changedAt: d.tickets[1].ts, status: 'new', lines: [{ name: 'Chicken wings', qty: 1, note: 'Extra spicy', station: 'Kitchen' }] },
  ];
  d.parties = [party('Walk-in regular — Sam', 'customer', '0772 111 222'), party('Fresh Farms Ltd', 'supplier', '0752 333 444')];
  return d;
}

function pharmacy(): DB {
  const d = emptyBook({ firmName: 'CarePlus Pharmacy (demo)' });
  d.firm = { ...d.firm, businessType: 'pharmacy', phone: '0700 000 000', address: 'Jinja Road' };
  d.firms = [d.firm];
  demoStaff(d, ['Dr. Ruth (owner)', 'John (cashier)', 'Esther (counter)']);
  d.settings = { ...d.settings, trackBatches: true, lowStockAlerts: true, blockNegativeStock: true, allowNegativeStock: false, askCustomer: false };
  d.units = [...new Set([...d.units, ...PHARMACY_UNITS])];
  d.categories = [...PHARMACY_CLASSES];

  const wh = 'w1';
  const now = Date.now();
  const lot = (no: string, qty: number, daysToExpiry: number) => ({ no, qty, expiry: iso(new Date(now + daysToExpiry * day)).slice(0, 10) });
  const drug = (name: string, generic: string, strength: string, form: string, cls: string, cost: number, price: number, lots: ReturnType<typeof lot>[], extra: Partial<Product> = {}) => prod({
    name, genericName: generic, strength, dosageForm: form, category: cls, unit: form === 'Syrup' ? 'Bottle' : 'Strip',
    cost, price, trackBatches: true, trackInventory: true, batches: lots, reorder: 10,
    stock: { [wh]: lots.reduce((n, b) => n + b.qty, 0) }, ...extra,
  });
  d.products = [
    drug('Panadol', 'Paracetamol', '500 mg', 'Tablet', 'Analgesics', 1500, 2500, [lot('PN-2301', 40, 400), lot('PN-2210', 12, 20)]),
    drug('Brufen', 'Ibuprofen', '400 mg', 'Tablet', 'Analgesics', 2000, 3500, [lot('BR-118', 30, 300)]),
    drug('Amoxil', 'Amoxicillin', '500 mg', 'Capsule', 'Antibiotics', 4000, 7000, [lot('AX-501', 25, 250)], { rxOnly: true }),
    drug('Cipro', 'Ciprofloxacin', '500 mg', 'Tablet', 'Antibiotics', 5000, 9000, [lot('CP-77', 6, 180)], { rxOnly: true }),
    drug('Coartem', 'Artemether/Lumefantrine', '20/120 mg', 'Tablet', 'Antimalarials', 9000, 15000, [lot('CO-9', 18, 120), lot('CO-3', 4, -15)]),
    drug('Amlodipine', 'Amlodipine', '5 mg', 'Tablet', 'Antihypertensives', 2500, 4500, [lot('AM-40', 50, 500)], { rxOnly: true }),
    drug('Metformin', 'Metformin', '500 mg', 'Tablet', 'Antidiabetics', 2000, 3500, [lot('MF-12', 35, 365)], { rxOnly: true }),
    drug('Vitamin C', 'Ascorbic acid', '500 mg', 'Tablet', 'Vitamins & supplements', 1500, 3000, [lot('VC-6', 60, 600)]),
    drug('Benylin', 'Diphenhydramine', '100 ml', 'Syrup', 'Cough & cold', 8000, 13000, [lot('BN-31', 8, 45)]),
  ];
  d.parties = [
    party('Mary Nakato', 'customer', '0772 555 101'), party('St. Luke Clinic', 'customer', '0414 222 333'),
    party('Quality Chemicals', 'supplier', '0414 444 555'), party('Surgipharm Uganda', 'supplier', '0414 666 777'),
  ];
  return d;
}

/** A demo of an edition, ready to open with the owner PIN 0000. */
export function demoBook(edition: Edition): DB {
  let d: DB;
  if (edition === 'restaurant') d = restaurant();
  else if (edition === 'pharmacy') d = pharmacy();
  else {
    d = seed();
    d.firm = { ...d.firm, businessType: 'retail' };
    d.firms = d.firms.map((f) => (f.id === d.firm.id ? d.firm : f));
    // the retail demo's owner opens with the demo PIN too
    const owner = d.users.find((u) => u.role === 'owner');
    if (owner) owner.pin = hashPin(DEMO_PIN);
  }
  applyEditionRoles(ensureRoles(d), edition);
  d.onboarded = true;
  d.demo = true;
  d.ownerEmail = undefined;
  d.sync = { ...d.sync, on: false };
  return d;
}
