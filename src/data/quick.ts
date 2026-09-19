/**
 * QUICK actions — reference lines 5462-5529.
 * Five groups with tones: Sell (accent), Money (good), Stock (warnc),
 * People (rail), Day (danger). The prototype's "Send to EFRIS" action is
 * deliberately omitted from this port.
 *
 * Each action carries the destination route it opens in the app.
 */
import type { IconName } from '../components/icons';
import type { PermKey } from './perms';

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
      { n: 'Recurring bill', i: 'calendar', route: 'RecurringNew' },
      { n: 'Instalment plan', i: 'coins', route: 'PlanNew' },
      { n: 'New offer', i: 'tag', route: 'OfferNew' },
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
    ],
  },
  {
    g: 'Stock', i: 'box', tone: 'warnc', perm: 'items', items: [
      { n: 'Add product', i: 'plus', route: 'ProductDetail' },
      { n: 'Adjust stock', i: 'box', route: 'StockAdjust' },
      { n: 'Move between stores', i: 'swap', route: 'StockTransfer' },
      { n: 'Batches & expiry', i: 'calendar', route: 'Batches' },
      { n: 'Start a stock take', i: 'check', route: 'StockTakes' },
      { n: 'Receive a purchase', i: 'box', route: 'PurchaseNew' },
      { n: 'Purchase order', i: 'doc', route: 'PurchaseOrderNew' },
      { n: 'Make stock', i: 'factory', route: 'Production' },
    ],
  },
  {
    g: 'People', i: 'user', tone: 'rail', perm: 'parties', items: [
      { n: 'Add customer', i: 'user', route: 'PartyDetail', params: { type: 'customer' } },
      { n: 'Add supplier', i: 'user', route: 'PartyDetail', params: { type: 'supplier' } },
      { n: 'Add staff', i: 'user', route: 'UsersRoles', perm: 'users' },
      { n: 'Switch user', i: 'swap', route: 'PinLock' },
      { n: 'Loyalty rules', i: 'gift', route: 'Loyalty' },
    ],
  },
  {
    g: 'Day', i: 'clock', tone: 'danger', perm: 'sell', items: [
      { n: 'Open shift', i: 'clock', route: 'Shift', params: { open: true } },
      { n: 'Close shift', i: 'check', route: 'Shift', params: { close: true } },
      { n: 'Z report', i: 'receipt', route: 'Reports', params: { id: 'day-close' } },
      { n: 'X report', i: 'receipt', route: 'Reports', params: { id: 'x-report' } },
      { n: 'Backup now', i: 'cloud', route: 'DataTools', params: { backup: true } },
    ],
  },
];
