/**
 * EDITIONS — one app, three kinds of business.
 *
 * Genius Pro comes as a Retail, a Restaurant and a Pharmacy edition. The
 * edition follows the business type chosen at onboarding, and decides three
 * things:
 *
 *   · the words the app uses (an item is a Drug in a pharmacy, a Dish in a
 *     restaurant; a supplier is a Distributor at a pharmacy);
 *   · what the till looks like (orders and tickets for a restaurant);
 *   · the price list and what each plan includes, here and in the developer
 *     console, where a licence is granted for one edition.
 *
 * Kept free of React so data code, screens and tests can all read it.
 */
import type { DB } from './types';

export type Edition = 'retail' | 'restaurant' | 'pharmacy';

export function editionOf(d: Pick<DB, 'firm'> | null | undefined): Edition {
  const t = d?.firm?.businessType;
  return t === 'restaurant' ? 'restaurant' : t === 'pharmacy' ? 'pharmacy' : 'retail';
}

export interface EditionPlan {
  name: string;
  blurb: string;
  prices: { month: number; quarter: number; year: number };
  has: string[];
}

export interface EditionDef {
  id: Edition;
  name: string;
  /** One line under the name. */
  tagline: string;
  /** What this edition is, for the plan screen and the developer console. */
  about: string;
  /** What it does that the others do not. */
  special: string[];
  icon: 'cart' | 'food' | 'shield';
  plans: { starter: EditionPlan; pro: EditionPlan };
}

export const EDITIONS: Record<Edition, EditionDef> = {
  retail: {
    id: 'retail', name: 'Retail', icon: 'cart',
    tagline: 'Shops, supermarkets, hardware, electronics and wholesale',
    about: 'A till and books for any shop that sells goods over the counter: barcodes, stock, customers on credit, suppliers and every report.',
    special: ['Barcode scanning and price tags', 'Stock, reorder and stock takes', 'Serials, IMEI and warranties', 'Quotations, delivery notes and instalments'],
    plans: {
      starter: {
        name: 'Retail Starter', blurb: 'One shop, one device, works with no network at all.',
        prices: { month: 35000, quarter: 95000, year: 340000 },
        has: ['Till, invoices and receipts', 'Stock and low-stock alerts', 'Customers and suppliers', 'Quotations and delivery notes', 'Cash, bank and mobile money', 'Every report'],
      },
      pro: {
        name: 'Retail Pro', blurb: 'Every feature, as many shops as you run, synced to the cloud.',
        prices: { month: 95000, quarter: 260000, year: 940000 },
        has: ['Everything in Retail Starter', 'As many shops and branches as you need', 'Serial, IMEI and warranty tracking', 'Batches and expiry', 'Recurring sales and instalments', 'Cloud sync and off-device backup'],
      },
    },
  },
  restaurant: {
    id: 'restaurant', name: 'Restaurant', icon: 'food',
    tagline: 'Restaurants, bars, cafés, take-aways and lounges',
    about: 'Orders on tickets, a menu with sections, photos and modifiers, kitchen and bar printing, open tables, service charge and restaurant reports.',
    special: ['Orders and open tickets by table', 'Menus, sections, photos and modifiers', 'Kitchen and bar printers by station', 'Dine in, takeaway and delivery', 'Menu mix, busy hours and waiter reports'],
    plans: {
      starter: {
        name: 'Restaurant Starter', blurb: 'One restaurant, one till, with kitchen printing.',
        prices: { month: 45000, quarter: 120000, year: 430000 },
        has: ['Order screen and open tickets', 'Menu, sections and modifiers', 'One kitchen printer', 'Day close with open-ticket check', 'Restaurant reports'],
      },
      pro: {
        name: 'Restaurant Pro', blurb: 'Every waiter on their own phone, every station printing.',
        prices: { month: 120000, quarter: 330000, year: 1200000 },
        has: ['Everything in Restaurant Starter', 'Tickets shared across every phone', 'Kitchen, bar and grill stations', 'Several menus, staff kept to their menu', 'Several branches', 'Cloud sync and off-device backup'],
      },
    },
  },
  pharmacy: {
    id: 'pharmacy', name: 'Pharmacy', icon: 'shield',
    tagline: 'Pharmacies, drug shops and clinics',
    about: 'Drugs by generic and brand name, strength and dosage form, batches with expiry first-out, prescription-only warnings, customers and expiry reports.',
    special: ['Drugs with generic name, strength and form', 'Batches and expiry, first to expire sold first', 'Prescription-only warning at the counter', 'Customers and their balances', 'Expiry and batch reports'],
    plans: {
      starter: {
        name: 'Pharmacy Starter', blurb: 'One pharmacy, one counter, batches and expiry included.',
        prices: { month: 45000, quarter: 120000, year: 430000 },
        has: ['Drugs, batches and expiry', 'Prescription-only warnings', 'Customers and distributors', 'Expiry and low-stock alerts', 'Every report'],
      },
      pro: {
        name: 'Pharmacy Pro', blurb: 'Every counter and branch, synced, with expiry control across all of them.',
        prices: { month: 120000, quarter: 330000, year: 1200000 },
        has: ['Everything in Pharmacy Starter', 'Several branches and counters', 'Stock moved between branches', 'Repeat prescriptions and instalments', 'Audit log and approvals', 'Cloud sync and off-device backup'],
      },
    },
  },
};

export const EDITION_LIST: Edition[] = ['retail', 'restaurant', 'pharmacy'];

/** The edition a business type belongs to. Older types (hardware, salon…) are Retail. */
export function editionOfType(t: string | null | undefined): Edition {
  return t === 'restaurant' ? 'restaurant' : t === 'pharmacy' ? 'pharmacy' : 'retail';
}

/**
 * The edition this account may set up and open. The automatic trial every new
 * account gets is Retail; a Restaurant or Pharmacy licence, trial or paid, is
 * granted by Genius Pro in the developer console.
 */
export function licensedEdition(server: { edition?: string; plan?: string | null } | null | undefined, onPhone: { edition?: string } | null | undefined): Edition {
  const e = (server?.plan ? server.edition : undefined) || onPhone?.edition || 'retail';
  return editionOfType(e);
}

/**
 * How many businesses the account may run, and how many it already does.
 *
 * The server only knows businesses that have synced. A business kept on this
 * phone with sync off, and extra businesses inside these books ("more than
 * one business"), never reach it — which is how the limit was slipped past.
 * So they are counted here too.
 */
export function businessAllowance(
  server: { maxBusinesses?: number; owned?: number; plan?: string | null } | null | undefined,
  d: { onboarded?: boolean; firms?: unknown[]; sync?: { businessId?: string }; licence?: { licence?: { maxBusinesses?: number; plan?: string } | null } | null } | null | undefined,
): { max: number; used: number; left: number } {
  const plan = server?.plan || d?.licence?.licence?.plan || 'trial';
  const max = server?.maxBusinesses || d?.licence?.licence?.maxBusinesses || (plan === 'pro' || plan === 'lifetime' ? 5 : 1);
  const onServer = server?.owned || 0;
  // these books, if they are a business the server has not been told about
  const local = d?.onboarded && !d.sync?.businessId ? 1 : 0;
  // further businesses kept inside these same books
  const extra = Math.max(0, (d?.firms?.length || 0) - 1);
  const used = onServer + local + extra;
  return { max, used, left: Math.max(0, max - used) };
}

export function businessLimitWords(a: { max: number; used: number }): string {
  return 'Your plan allows ' + a.max + ' business' + (a.max === 1 ? '' : 'es') + ' and ' + a.used + (a.used === 1 ? ' is' : ' are')
    + ' in use. Starter allows one and Pro up to five. Ask Genius Pro to raise the limit, or deactivate a business you no longer use.';
}

/** Why another edition cannot be chosen, in words. */
export function editionLockReason(allowed: Edition, wanted: Edition): string {
  if (allowed === 'retail') {
    return 'The free trial is for the Retail edition. A ' + EDITIONS[wanted].name + ' trial or licence is given by Genius Pro — contact us to get one.';
  }
  return 'Your licence is for the ' + EDITIONS[allowed].name + ' edition, so only a ' + EDITIONS[allowed].name.toLowerCase() + ' business can be set up or opened on it.';
}

/**
 * The words the app uses, by edition. Screens ask for "the word for an item"
 * instead of writing "Item", so a pharmacy reads Drug and a restaurant Dish.
 */
export interface Vocab {
  item: string; items: string; itemName: string; itemCode: string; category: string; categories: string;
  unit: string; description: string; descriptionHint: string; product: string;
  customer: string; customers: string; supplier: string; suppliers: string;
  openingStock: string; reorderAt: string; addItem: string; searchItems: string;
  /** An example name, shown in an empty name box. */
  example: string;
}

const RETAIL: Vocab = {
  item: 'Item', items: 'Items', itemName: 'Name', itemCode: 'Item code', category: 'Category', categories: 'Categories',
  unit: 'Unit', description: 'Description', descriptionHint: 'Condition, specifications, colour, size…', product: 'Product',
  customer: 'Customer', customers: 'Customers', supplier: 'Supplier', suppliers: 'Suppliers',
  openingStock: 'Opening stock', reorderAt: 'Reorder at', addItem: 'Add item', searchItems: 'Search name, code or category',
  example: 'e.g. Sugar 1 kg',
};

export const VOCAB: Record<Edition, Vocab> = {
  retail: RETAIL,
  restaurant: {
    ...RETAIL,
    item: 'Dish', items: 'Menu', itemName: 'Dish name', itemCode: 'Menu code', category: 'Section', categories: 'Sections',
    unit: 'Serving', description: 'Description', descriptionHint: 'Grilled chicken, lettuce, house sauce', product: 'Dish',
    openingStock: 'Opening stock', reorderAt: 'Reorder at', addItem: 'Add dish', searchItems: 'Search the menu',
    example: 'e.g. Chicken burger',
  },
  pharmacy: {
    ...RETAIL,
    item: 'Drug', items: 'Drugs', itemName: 'Drug name (brand)', itemCode: 'Drug code', category: 'Drug class', categories: 'Drug classes',
    unit: 'Dosage form / pack', description: 'Directions & notes', descriptionHint: 'Take 1 tablet three times a day after meals', product: 'Drug',
    supplier: 'Distributor', suppliers: 'Distributors',
    openingStock: 'Opening stock (units)', reorderAt: 'Reorder level', addItem: 'Add drug', searchItems: 'Search drug, generic name or code',
    example: 'e.g. Panadol 500 mg',
  },
};

export function vocab(d: Pick<DB, 'firm'> | null | undefined): Vocab {
  return VOCAB[editionOf(d)];
}

/** A pharmacy's starting lists. */
export const PHARMACY_UNITS = ['Tablet', 'Capsule', 'Strip', 'Bottle', 'Box', 'Vial', 'Ampoule', 'Tube', 'Sachet', 'Syrup'];
export const PHARMACY_CLASSES = ['Analgesics', 'Antibiotics', 'Antimalarials', 'Antihypertensives', 'Antidiabetics', 'Vitamins & supplements', 'Cough & cold', 'Skin care', 'Medical supplies'];
export const DOSAGE_FORMS = ['Tablet', 'Capsule', 'Syrup', 'Suspension', 'Injection', 'Cream', 'Ointment', 'Drops', 'Inhaler', 'Powder', 'Other'];
