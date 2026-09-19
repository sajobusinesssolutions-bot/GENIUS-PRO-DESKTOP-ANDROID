/**
 * Default records for the subsystems added after the first port:
 * printing (reference ensureExtras 5454 + ensurePrinting 19496), the
 * subscription (18716), the licence (21763), cloud sync (20213) and
 * updates (23027). Shared by seed() and by storage.migrate() so an older
 * local book gains them on the way in.
 */
import type {
  PrinterSettings, Printer, PrintServer, PrintTemplate, DocKind,
  Subscription, Licence, SyncCfg, UpdateCfg,
  Settings, NumberingKey, ServiceRate,
} from './types';
import type { IconName } from '../components/icons';
import { iso } from './uid';

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/* ---------------- printing ---------------- */

export const PRINTER_KINDS: { v: Printer['kind']; l: string; n: string }[] = [
  { v: 'bluetooth', l: 'Bluetooth', n: 'Paired to this phone' },
  { v: 'usb', l: 'USB / OTG', n: 'Plugged into this device' },
  { v: 'wifi', l: 'Wi-Fi / network', n: 'Its own address on the shop network' },
  { v: 'server', l: 'On the print server', n: 'The server sends it the job' },
  { v: 'pdf', l: 'Save as PDF', n: 'No hardware — writes a file' },
];

export function kindLabel(k: Printer['kind']): string {
  return PRINTER_KINDS.find((x) => x.v === k)?.l || k;
}

export const CODE_KINDS: [PrintTemplate['code'], string][] = [
  ['none', 'Nothing'],
  ['barcode', 'Barcode at the bottom'],
  ['qr', 'QR code at the bottom'],
  ['both', 'Both, side by side'],
];

export const CODE_DATA: [PrintTemplate['codeData'], string][] = [
  ['no', 'The document number'],
  ['total', 'Number and amount'],
  ['verify', 'A link to verify it'],
  ['party', 'Customer and number'],
  ['custom', 'Something you type'],
];

export const DOC_KINDS_TPL: [DocKind, string][] = [
  ['receipt', 'Sale receipt'], ['invoice', 'Invoice'], ['estimate', 'Quotation'],
  ['challan', 'Delivery note'], ['recurring', 'Recurring bill'], ['instal', 'Instalment plan'],
  ['ret', 'Return note'], ['purchase', 'Purchase / supplier bill'],
];

/** The mark on every printed thing. Not a setting — reference line 19212. */
export const POWERED_BY = 'Powered by SALJO TECH';

export function defaultPrinterSettings(): PrinterSettings {
  return {
    device: 'POS-80 (Bluetooth)', width: '80mm', copies: 1,
    autoPrint: true, openDrawer: true, showLogo: true,
    header: '', footer: 'Goods once sold are not returnable\nThank you',
  };
}

export function defaultPrinters(pr: PrinterSettings): Printer[] {
  return [
    { id: 'prn_1', name: pr.device || 'POS-80 (Bluetooth)', kind: 'bluetooth', width: pr.width || '80mm', address: '', port: 9100, dflt: true, online: true, note: 'Front till' },
    { id: 'prn_2', name: 'Epson TM-T20 (counter)', kind: 'wifi', width: '80mm', address: '192.168.1.44', port: 9100, dflt: false, online: true, note: 'Behind the counter' },
    { id: 'prn_3', name: 'Save as PDF', kind: 'pdf', width: 'A4', address: '', port: 0, dflt: false, online: true, note: 'For emailing' },
  ];
}

export function defaultPrintServer(): PrintServer {
  return {
    on: false, name: 'Shop print server', host: '192.168.1.10', port: 6631,
    path: '/print', key: '', secure: false, timeout: 8, queue: 'retry',
    lastSeen: '', status: 'unknown',
  };
}

export function defaultTemplates(): PrintTemplate[] {
  return [
    {
      id: 'tpl_receipt', name: 'Thermal receipt', paper: '80mm', kind: 'thermal',
      showLogo: true, showTax: true, showServed: true, showParty: true, showSaved: true,
      code: 'barcode', codeData: 'no', codeCaption: true, density: 'normal',
      head: '', foot: 'Goods once sold are not returnable\nThank you', copies: 1,
    },
    {
      id: 'tpl_a4', name: 'A4 document', paper: 'A4', kind: 'page',
      showLogo: true, showTax: true, showServed: true, showParty: true, showSaved: false,
      code: 'qr', codeData: 'verify', codeCaption: true, density: 'normal',
      head: '', foot: 'Payment is due within the agreed terms.', copies: 1,
    },
    {
      id: 'tpl_small', name: '58mm compact', paper: '58mm', kind: 'thermal',
      showLogo: true, showTax: false, showServed: false, showParty: false, showSaved: true,
      code: 'none', codeData: 'no', codeCaption: false, density: 'tight',
      head: '', foot: 'Thank you', copies: 1,
    },
  ];
}

export function defaultTemplateFor(): Record<DocKind, string> {
  return {
    receipt: 'tpl_receipt', invoice: 'tpl_a4', estimate: 'tpl_a4', challan: 'tpl_a4',
    recurring: 'tpl_a4', instal: 'tpl_a4', ret: 'tpl_receipt', purchase: 'tpl_a4',
  };
}

/* ---------------- subscription ---------------- */

export type PlanDef = {
  id: 'starter' | 'pro'; name: string; tone: 'good' | 'accent'; blurb: string;
  prices: { month: number; quarter: number; year: number };
  limits: { businesses: number; devices: number; users: number };
  has: string[]; hasnt: string[];
};

export const PLANS: Record<'starter' | 'pro', PlanDef> = {
  starter: {
    id: 'starter', name: 'Starter', tone: 'good',
    blurb: 'One shop, one device, works with no network at all.',
    prices: { month: 35000, quarter: 95000, year: 340000 },
    limits: { businesses: 1, devices: 1, users: 3 },
    has: ['Till and invoicing', 'Stock and low-stock alerts', 'Customers and suppliers',
      'Quotations and delivery notes', 'Cash, bank and mobile money', 'Every report',
      'Backup to this device'],
    hasnt: ['recurring', 'instal', 'batches', 'serials', 'reminders', 'multiFirm', 'sync', 'secondaryUnit'],
  },
  pro: {
    id: 'pro', name: 'Pro', tone: 'accent',
    blurb: 'Every feature, as many shops as you run, synced to the cloud.',
    prices: { month: 95000, quarter: 260000, year: 940000 },
    limits: { businesses: 99, devices: 99, users: 99 },
    has: ['Everything in Starter', 'As many businesses as you need', 'Branch panel across all of them',
      'Recurring bills and instalment plans', 'Batches, expiry and FIFO', 'Serial and IMEI tracking',
      'WhatsApp and SMS reminders', 'Second unit of measure', 'Cloud sync and off-device backup',
      'Audit log and approvals'],
    hasnt: [],
  },
};

export const PLAN_TERMS: [Subscription['term'], string, string][] = [
  ['month', 'Monthly', 'billed every month'],
  ['quarter', 'Every 3 months', 'save about 10%'],
  ['year', 'Yearly', 'save about 20%'],
];

export const PRO_FEATURES: Record<string, string> = {
  recurring: 'Recurring bills', instal: 'Instalment plans', batches: 'Batches and expiry',
  serials: 'Serial and IMEI tracking', reminders: 'Payment reminders',
  multiFirm: 'More than one business', sync: 'Cloud sync', secondaryUnit: 'A second unit',
  audit: 'Audit log and approvals',
};

export function defaultSubscription(): Subscription {
  const now = new Date();
  return {
    plan: 'starter', term: 'month', status: 'trial',
    startedAt: iso(now), renewsAt: iso(addDays(now, 14)), trialUntil: iso(addDays(now, 14)),
    history: [], email: '', account: '',
  };
}

/* ---------------- licence ---------------- */

/** Days a till may run unchecked — reference LIC_GRACE at 21608. */
export const LIC_GRACE = 7;
export const LIC_SERVER_DEFAULT = 'https://licences.saljo.tech';

export const LIC_WORDS: Record<string, [string, string]> = {
  none: ['No licence on this till', 'Type the key the author sent you.'],
  active: ['Licensed', 'Everything is switched on.'],
  trial: ['On trial', 'Full Pro until the trial runs out.'],
  stale: ['Not checked in a while', 'This till has not reached the server for ' + LIC_GRACE + ' days. Connect it once to carry on.'],
  blocked: ['This licence has been blocked', 'The author switched it off.'],
  expired: ['This licence has run out', 'Renew it to carry on selling.'],
  revoked: ['This licence was withdrawn', ''],
  unknown: ['That key is not on record', ''],
  invalid: ['That is not one of our keys', ''],
  unbound: ['This device is not on the licence', 'Ask the author to make room, or release an old device.'],
  toomany: ['The licence is full', 'Every device it covers is already in use.'],
};

export function defaultLicence(): Licence {
  return { key: '', server: '', status: 'none', checkedAt: '', licence: null, reason: '', offlineSince: '' };
}

/* ---------------- cloud sync ---------------- */

export const SYNC_FREQ: [SyncCfg['freq'], string, string][] = [
  ['live', 'As it happens', 'every change goes up straight away'],
  ['hour', 'Every hour', 'gentler on data'],
  ['day', 'Once a day', 'for a shop on a bundle'],
  ['manual', 'Only when I tap sync', 'nothing goes up on its own'],
];

export const CONFLICT_RULES: [SyncCfg['conflict'], string][] = [
  ['server', 'The cloud copy wins'],
  ['device', 'This device wins'],
  ['ask', 'Ask me each time'],
];

export function defaultSync(till = 'Till 1'): SyncCfg {
  return {
    on: false, freq: 'live', wifiOnly: false, conflict: 'server', scope: 'all',
    pending: [], log: [],
    devices: [{ id: 'dev_this', name: till + ' · this phone', kind: 'phone', last: iso(new Date()), me: true }],
    lastAt: '', strict: false, lastPush: '', lastPull: '', cursor: 0,
  };
}

/* ---------------- updates ---------------- */

export const UPDATE_FEED_DEFAULT =
  'https://sajobusinesssolutions-bot.github.io/GeniusPOS/updates/latest.json';
/** Ask again after six hours — reference UPDATE_EVERY at 23023. */
export const UPDATE_EVERY = 6 * 3600 * 1000;

export function defaultUpdate(): UpdateCfg {
  return { on: true, feed: UPDATE_FEED_DEFAULT, lastCheck: '', skip: '' };
}

/* ---------------- what changed ---------------- */

/** The running build of the app shell — reference BUILD, last set to '4.3'. */
export const BUILD = '4.3';
export const SCHEMA_VERSION = 6;

export const CHANGELOG: [string, string][] = [
  ['4.3', 'Checks for new builds and installs them on your say-so'],
  ['4.2', 'Online mode — the cloud holds the books, every till agrees'],
  ['4.0', 'Signed licences, clock-rollback defence, usage-capped grace'],
  ['3.9', 'Licences checked against the author’s server'],
  ['3.8', 'Installs to the home screen, opens with no browser and works offline'],
  ['3.7', 'Restore an earlier version of a record'],
  ['3.6', 'Version control — record revisions, device-safe numbering, conflict resolution'],
  ['3.5', 'Receipts & payments list; payment detail and assemblies given a way in'],
  ['3.4', 'Cloud sync — change queue and linked devices (no server yet)'],
  ['3.3', 'Printing — printers with a default, templates with barcode and QR, print server'],
  ['3.2', 'Audit trail with PIN approval, purchase redesign, Starter and Pro, Google sign-in'],
  ['3.1', 'Batches with expiry and FIFO, serial and IMEI tracking, bulk item tools'],
  ['3.0', 'Inline customers, item search, negative-stock and below-cost guards, tax module'],
  ['2.3', 'Storage segmented so a save writes only what changed'],
  ['2.2', 'Period selectors, management merged with the branch panel, reminders, auto backup'],
  ['2.1', 'Reports and printing for documents, per-business access, period selection'],
  ['2.0', 'Onboarding, separate books per business, professional document layouts'],
  ['1.9', 'Branch panel with group performance, light mode'],
];

/* ---------------- settings, numbering, units & categories ---------------- */

/** Reference SCREENS.settings (6712) — every switch and row it offers. */
export function defaultSettings(): Settings {
  return {
    currency: 'Sh', currencyName: 'Ugandan shilling', symbolBefore: true, decimals: 0,
    dateFormat: 'd M yyyy', firstDay: 'Mon', language: 'English', timezone: 'Africa/Kampala',

    taxName: 'VAT', taxRate: 18, pricesIncludeTax: false, withholding: false, efris: false,

    defaultMethod: 'cash', roundTo: 0, maxDiscountPct: 10, quickItems: 6,
    requireShift: true, askCustomer: false, allowPriceEdit: false,
    blockNegativeStock: true, belowCost: 'warn',

    defaultWarehouse: 'w1', costing: 'average',
    lowStockAlerts: true, allowNegativeStock: false, trackBatches: false, taxEnabled: true,
    askWhoOnSave: true, requirePinOnSave: false,
    useSecondaryUnit: false,

    notifyLowStock: true, notifyOverdue: true,
    notifyShiftClose: true, notifyDailySummary: false,

    lockOnOpen: false, autoLockMins: 0, hideCostFromCashier: true,
    requirePinToEdit: false, requirePinToDelete: true, editWindowDays: 7,

    theme: 'auto',
  };
}

/** Reference numLabel(), line 6817. */
export const NUMBER_LABEL: Record<NumberingKey, string> = {
  sale: 'Sales bill', estimate: 'Quotation', challan: 'Delivery note', credit: 'Credit note',
  purchase: 'Purchase', po: 'Purchase order', stocktake: 'Stock take', journal: 'Journal entry',
};

export function defaultNumbering(): Record<NumberingKey, string> {
  return { sale: 'INV', estimate: 'EST', challan: 'DC', credit: 'CN', purchase: 'PUR', po: 'PO', stocktake: 'ST', journal: 'JV' };
}

/** Reference DB.units, offered by the item editor's "Sold by" select at 9249. */
export function defaultUnits(): string[] {
  return ['PC', 'BAG', 'BOX', 'CTN', 'KG', 'L', 'M', 'FT', 'TIN', 'HR', 'DAY', 'SET'];
}

export function defaultCategories(): string[] {
  return ['General', 'Building', 'Food', 'Furniture', 'Electrical', 'Services', 'Tools'];
}

/** Reference ITEM_COLOR — the "Colour tag" swatches on the More tab, 9330. */
export const ITEM_COLOR: string[] = ['', '#2563EB', '#0A7346', '#B4652A', '#C93A3A', '#7A3EA8', '#0F766E', '#8C5A08'];

/** Reference ITEM_EMOJI — what SHEETS.pickEmoji offers, 9378. */
export const ITEM_EMOJI: string[] = [
  '📦', '🧱', '🏗️', '🍚', '🪑', '🔩', '🎨', '🍬', '🌀', '💡', '🪵', '🔧',
  '🛠️', '👕', '📱', '🚚', '🧴', '🥤', '🧹', '⚡', '🔌', '🪛', '🧰', '🪣',
];

/** Reference SERVICE_RATE, used by the service Delivery tab at 16897. */
export const SERVICE_RATE: [ServiceRate, string, string][] = [
  ['fixed', 'One price', 'The same price every time, whatever the job takes.'],
  ['hour', 'By the hour', 'The till multiplies the hourly rate by the hours you enter.'],
  ['day', 'By the day', 'Priced per day on site.'],
  ['unit', 'Per unit', 'Priced per piece handled — per sheet cut, per bag carried.'],
];

/** Reference EXP_CATS / INC_CATS used by SHEETS.entry at 7213. */
export const EXP_CATS: { v: string; i: IconName }[] = [
  { v: 'Rent', i: 'home' }, { v: 'Transport', i: 'taxi' }, { v: 'Wages', i: 'user' },
  { v: 'Utilities', i: 'bulb' }, { v: 'Supplies', i: 'box' }, { v: 'Airtime & data', i: 'phone' },
  { v: 'Repairs', i: 'wrench' }, { v: 'Licences & fees', i: 'doc' }, { v: 'Bank charges', i: 'bank' },
  { v: 'Owner drawings', i: 'owner' }, { v: 'Other', i: 'dots' },
];

export const INC_CATS: { v: string; i: IconName }[] = [
  { v: 'Other income', i: 'coins' }, { v: 'Interest', i: 'bank' }, { v: 'Commission', i: 'card' },
  { v: 'Rent received', i: 'home' }, { v: 'Refund', i: 'swap' }, { v: 'Owner funds', i: 'owner' },
];
