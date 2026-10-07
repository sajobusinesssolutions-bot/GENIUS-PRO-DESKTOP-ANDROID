/**
 * QUICK actions — reference lines 5462-5529.
 * Five groups with tones: Sell (accent), Money (good), Stock (warnc),
 * People (rail), Day (danger). The prototype's "Send to EFRIS" action is
 * deliberately omitted from this port.
 *
 * Each action carries the destination route it opens in the app.
 *
 * This is the one list most people reach for, so anything the app can create
 * belongs in it. It had fallen behind the app itself — journal entries, price
 * tags, the bulk editors and several others existed as screens with no way in
 * from here.
 */
import type { IconName } from '../components/icons';
import type { PermKey } from './perms';
import type { Edition } from './editions';

export type QuickTone = 'accent' | 'good' | 'warnc' | 'rail' | 'danger';

export type QuickAction = {
  n: string;
  i: IconName;
  route: string;
  params?: Record<string, unknown>;
  perm?: PermKey;
};

export type QuickGroup = {
  g: string;
  i: IconName;
  tone: QuickTone;
  perm: PermKey;
  items: QuickAction[];
};

export const QUICK: QuickGroup[] = [
  {
    g: 'Sell', i: 'till', tone: 'accent', perm: 'sell', items: [
      { n: 'New sale', i: 'till', route: 'NewSale' },
      { n: 'Quotation', i: 'doc', route: 'EstimateNew' },
      { n: 'Delivery note', i: 'box', route: 'ChallanNew' },
      { n: 'Return goods', i: 'swap', route: 'CreditNoteNew' },
      { n: 'Recurring sale', i: 'calendar', route: 'RecurringNew' },
      { n: 'Instalment plan', i: 'coins', route: 'PlanNew' },
      { n: 'New offer', i: 'tag', route: 'OfferNew' },
      { n: 'Price tags', i: 'tag', route: 'PriceTags' },
    ],
  },
  {
    g: 'Money', i: 'card', tone: 'good', perm: 'money', items: [
      { n: 'Money received', i: 'card', route: 'PaymentNew', params: { direction: 'in' } },
      { n: 'Money paid out', i: 'card', route: 'PaymentNew', params: { direction: 'out' } },
      { n: 'Record income', i: 'arrow', route: 'EntryNew', params: { direction: 'in' } },
      { n: 'Record expense', i: 'arrow', route: 'EntryNew', params: { direction: 'out' } },
      { n: 'Move money', i: 'swap', route: 'Transfer' },
      { n: 'Drawer cash', i: 'card', route: 'Shift' },
      { n: 'Journal entry', i: 'pencil', route: 'JournalEntry', perm: 'accounting' },
      { n: 'Cash & bank', i: 'bank', route: 'Money' },
      { n: 'Day close', i: 'lock', route: 'Shift', params: { close: true }, perm: 'sell' },
    ],
  },
  {
    g: 'Stock', i: 'box', tone: 'warnc', perm: 'items', items: [
      { n: 'Add product', i: 'plus', route: 'ProductDetail' },
      { n: 'Adjust stock', i: 'box', route: 'StockAdjust' },
      { n: 'Move between stores', i: 'swap', route: 'StockTransfer' },
      { n: 'Batches & expiry', i: 'calendar', route: 'Batches' },
      { n: 'Start a stock take', i: 'check', route: 'StockTakes' },
      { n: 'New purchase', i: 'box', route: 'PurchaseNew' },
      { n: 'Purchases', i: 'doc', route: 'Purchases' },
      { n: 'Make stock', i: 'factory', route: 'Production' },
      { n: 'Price lists', i: 'coins', route: 'PriceLists' },
      { n: 'Names & descriptions', i: 'pencil', route: 'NamesEditor' },
      { n: 'On sale / off sale', i: 'check', route: 'ActivateItems' },
      { n: 'Units & categories', i: 'tag', route: 'UnitsCategories' },
    ],
  },
  {
    g: 'People', i: 'user', tone: 'rail', perm: 'parties', items: [
      { n: 'Add customer', i: 'user', route: 'PartyDetail', params: { type: 'customer' } },
      { n: 'Add supplier', i: 'user', route: 'PartyDetail', params: { type: 'supplier' } },
      { n: 'Add staff', i: 'user', route: 'UsersRoles', perm: 'users' },
      { n: 'Switch user', i: 'swap', route: 'PinLock' },
      { n: 'Loyalty rules', i: 'gift', route: 'Loyalty' },
      { n: 'Warranty claim', i: 'shield', route: 'Warranties' },
    ],
  },
  {
    g: 'Day', i: 'clock', tone: 'danger', perm: 'sell', items: [
      { n: 'Open shift', i: 'clock', route: 'Shift', params: { open: true } },
      { n: 'Close shift', i: 'check', route: 'Shift', params: { close: true } },
      { n: 'Z report', i: 'receipt', route: 'Reports', params: { id: 'day-close' } },
      { n: 'X report', i: 'receipt', route: 'Reports', params: { id: 'x-report' } },
      { n: 'Backup now', i: 'cloud', route: 'DataTools', params: { backup: true } },
      { n: 'Reports', i: 'chart', route: 'Reports', perm: 'reports' },
      { n: 'Branches', i: 'home', route: 'Branches', perm: 'settings' },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* By edition                                                          */
/* ------------------------------------------------------------------ */

const MONEY = QUICK.find((g) => g.g === 'Money')!;

/** A restaurant's quick add: orders and the menu first, the kitchen close by. */
const RESTAURANT_QUICK: QuickGroup[] = [
  {
    g: 'Orders', i: 'food', tone: 'accent', perm: 'sell', items: [
      { n: 'New order', i: 'food', route: 'Order' },
      { n: 'Open tickets', i: 'receipt', route: 'Order' },
      { n: 'Orders today', i: 'doc', route: 'Sales' },
      { n: 'Refund an order', i: 'swap', route: 'CreditNoteNew' },
      { n: 'New offer', i: 'tag', route: 'OfferNew' },
    ],
  },
  {
    g: 'Menu', i: 'menu', tone: 'warnc', perm: 'items', items: [
      { n: 'Add dish', i: 'plus', route: 'MenuEditor' },
      { n: 'Menu & modifiers', i: 'food', route: 'MenuEditor' },
      { n: 'Kitchen display', i: 'food', route: 'KitchenDisplay' },
      { n: 'Kitchen printing', i: 'print', route: 'PrintingKitchen', perm: 'settings' },
      { n: 'Buy ingredients', i: 'cart', route: 'PurchaseNew' },
      { n: 'Adjust stock', i: 'box', route: 'StockAdjust' },
      { n: 'Make stock (recipes)', i: 'factory', route: 'Production' },
    ],
  },
  MONEY,
  {
    g: 'People', i: 'user', tone: 'rail', perm: 'parties', items: [
      { n: 'Add customer', i: 'user', route: 'PartyDetail', params: { type: 'customer' } },
      { n: 'Add supplier', i: 'user', route: 'PartyDetail', params: { type: 'supplier' } },
      { n: 'Add waiter or staff', i: 'user', route: 'UsersRoles', perm: 'users' },
      { n: 'Switch user', i: 'swap', route: 'PinLock' },
      { n: 'Loyalty rules', i: 'gift', route: 'Loyalty' },
    ],
  },
  {
    g: 'Day', i: 'clock', tone: 'danger', perm: 'sell', items: [
      { n: 'Open shift', i: 'clock', route: 'Shift', params: { open: true } },
      { n: 'Day close', i: 'lock', route: 'Shift', params: { close: true } },
      { n: 'Menu mix', i: 'chart', route: 'Reports', params: { id: 'rest-menu-mix' }, perm: 'reports' },
      { n: 'Busy hours', i: 'clock', route: 'Reports', params: { id: 'rest-hours' }, perm: 'reports' },
      { n: 'Z report', i: 'receipt', route: 'Reports', params: { id: 'day-close' } },
      { n: 'Backup now', i: 'cloud', route: 'DataTools', params: { backup: true } },
    ],
  },
];

/** A pharmacy's quick add: the counter, drugs by batch and expiry, customers. */
const PHARMACY_QUICK: QuickGroup[] = [
  {
    g: 'Counter', i: 'till', tone: 'accent', perm: 'sell', items: [
      { n: 'New sale', i: 'till', route: 'NewSale' },
      { n: 'Return drugs', i: 'swap', route: 'CreditNoteNew' },
      { n: 'Repeat prescription', i: 'calendar', route: 'RecurringNew' },
      { n: 'Instalment plan', i: 'coins', route: 'PlanNew' },
      { n: 'Quotation', i: 'doc', route: 'EstimateNew' },
    ],
  },
  {
    g: 'Drugs', i: 'shield', tone: 'warnc', perm: 'items', items: [
      { n: 'Add drug', i: 'plus', route: 'ProductDetail' },
      { n: 'Receive drugs', i: 'cart', route: 'PurchaseNew' },
      { n: 'Batches & expiry dates', i: 'calendar', route: 'Batches' },
      { n: 'Expiring soon', i: 'alert', route: 'Reports', params: { id: 'expiry' }, perm: 'reports' },
      { n: 'Adjust stock', i: 'box', route: 'StockAdjust' },
      { n: 'Count stock', i: 'check', route: 'StockTakes' },
      { n: 'Move between branches', i: 'swap', route: 'StockTransfer' },
      { n: 'Price lists', i: 'coins', route: 'PriceLists' },
      { n: 'Dosage forms & drug classes', i: 'tag', route: 'UnitsCategories' },
    ],
  },
  MONEY,
  {
    g: 'People', i: 'user', tone: 'rail', perm: 'parties', items: [
      { n: 'Add customer', i: 'user', route: 'PartyDetail', params: { type: 'customer' } },
      { n: 'Add distributor', i: 'user', route: 'PartyDetail', params: { type: 'supplier' } },
      { n: 'Add staff', i: 'user', route: 'UsersRoles', perm: 'users' },
      { n: 'Switch user', i: 'swap', route: 'PinLock' },
    ],
  },
  {
    g: 'Day', i: 'clock', tone: 'danger', perm: 'sell', items: [
      { n: 'Open shift', i: 'clock', route: 'Shift', params: { open: true } },
      { n: 'Day close', i: 'lock', route: 'Shift', params: { close: true } },
      { n: 'Z report', i: 'receipt', route: 'Reports', params: { id: 'day-close' } },
      { n: 'Reports', i: 'chart', route: 'Reports', perm: 'reports' },
      { n: 'Backup now', i: 'cloud', route: 'DataTools', params: { backup: true } },
    ],
  },
];

/** A shop's quick add, without the rows for the other trades. */
const RETAIL_QUICK: QuickGroup[] = QUICK;

export function quickFor(edition: Edition): QuickGroup[] {
  return edition === 'restaurant' ? RESTAURANT_QUICK : edition === 'pharmacy' ? PHARMACY_QUICK : RETAIL_QUICK;
}

/** What each trade does all day, shown first in quick add. */
export const COMMON_FOR: Record<Edition, string[]> = {
  retail: ['New sale', 'Money received', 'Record expense', 'Add product', 'New purchase', 'Add customer'],
  restaurant: ['New order', 'Open tickets', 'Add dish', 'Record expense', 'Day close', 'Buy ingredients'],
  pharmacy: ['New sale', 'Add drug', 'Receive drugs', 'Expiring soon', 'Add customer', 'Money received'],
};
