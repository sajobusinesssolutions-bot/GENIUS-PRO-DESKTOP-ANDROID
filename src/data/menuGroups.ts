/**
 * MENU_GROUPS — what the Menu tab offers, grouped by the job being done.
 *
 * The menu had grown seven groups and forty-two rows, several of which were the
 * same place reached twice. What was merged, and why:
 *
 *   · "Cloud sync" and "Online mode" both read `sync.on` and both described
 *     themselves as the cloud holding the books — one entry now.
 *   · "About & versions", "Install on this phone" and "Updates" were three rows
 *     about this one build — now "App & updates".
 *   · "Licence" and "Plan & billing" were both about paying for the app.
 *   · Chart of accounts, New journal entry, Trial balance and All postings were
 *     listed here *and* on the Accounting hub, which is the screen that exists
 *     to list them. The hub is the single entry now.
 *   · "Buy" held two rows of its own. Buying is how stock arrives, so it sits
 *     with Stock rather than carrying a near-empty card of its own.
 *   · "Staff performance" was filed under Business while "Reports" sat under
 *     Books, so the same question was answered in two places.
 *   · "Compare branches" was listed here as well as on the branch panel. It
 *     puts every branch's money side by side, which is the owner's business
 *     and nobody else's, so it is reachable only from the owner-gated branch
 *     screen now rather than from a report anyone with reports can open.
 *
 * Cash register and Day close are deliberately kept as separate rows: they open
 * the same screen in different states and were asked for as separate buttons.
 *
 * Reference: lines 6513-6563 for the group/item shape, reorganised rather than
 * ported group for group.
 */
import type { IconName } from '../components/icons';
import type { PermKey } from './perms';
import type { DB, RecurringInvoice, Shift } from './types';
import { plural } from './helpers';
import { licState as licStateOf, isPro as isProOf, subState } from './logic';
import { LIC_WORDS, PLANS, BUILD, SCHEMA_VERSION } from './defaults';
import { REPORTS } from './reports';

/** How many reports the catalogue offers — reference REPORTS, line 3359. */
export const REPORT_COUNT = REPORTS.length;

export type MenuCtx = {
  db: DB;
  dueRecurring: () => RecurringInvoice[];
  activeShift: () => Shift | undefined;
};

export type MenuItem = {
  route: string;
  params?: Record<string, unknown>;
  i: IconName;
  n: string;
  b: (c: MenuCtx) => string;
  perm?: PermKey;
  /** Extra words that should match this row in the menu search. */
  alt?: string;
};

export type MenuGroupDef = {
  id: string;
  n: string;
  i: IconName;
  tone: 'accent' | 'warnc' | 'rail' | 'good' | 'danger' | 'soft';
  perm: PermKey | null;
  b: (c: MenuCtx) => string;
  items: MenuItem[];
  /**
   * Opens this screen directly instead of a list. For a card whose list would
   * have held one row that matters — Reports opened a list whose first row
   * was "All reports", one tap for nothing.
   */
  open?: string;
};

const liveSales = (d: DB) => d.sales.filter((s) => s.status !== 'void');

export const MENU_GROUPS: MenuGroupDef[] = [
  {
    id: 'sell', n: 'Sell', i: 'till', tone: 'accent', perm: 'sales',
    b: (c) => plural(liveSales(c.db).length, 'bill'),
    items: [
      { route: 'Sales', i: 'doc', n: 'Sales', b: (c) => plural(liveSales(c.db).length, 'bill'), alt: 'invoices bills receipts' },
      { route: 'Estimates', i: 'doc', n: 'Quotations', b: (c) => (c.db.estimates || []).filter((e) => e.status === 'open').length + ' open', alt: 'quotes estimates proforma' },
      { route: 'Challans', i: 'box', n: 'Delivery notes', b: (c) => (c.db.challans || []).filter((x) => !x.saleId).length + ' still out', alt: 'challan dispatch' },
      { route: 'CreditNotes', i: 'swap', n: 'Returns', b: (c) => plural((c.db.creditNotes || []).length, 'credit note'), alt: 'credit note refund sale return' },
      { route: 'Offers', i: 'tag', n: 'Offers', b: (c) => (c.db.offers || []).filter((o) => o.active).length + ' live', alt: 'discount promotion' },
      {
        route: 'Recurring', i: 'calendar', n: 'Recurring bills',
        b: (c) => (c.dueRecurring().length ? plural(c.dueRecurring().length, 'bill') + ' due' : plural((c.db.recurringInvoices || []).length, 'schedule')),
        alt: 'subscription standing order',
      },
      { route: 'Instalments', i: 'calendar', n: 'Instalment plans', b: () => 'Pay-in-parts schedules', perm: 'money', alt: 'hire purchase layaway' },
    ],
  },
  {
    // Buying used to be a group of its own holding two rows. Stock arrives by
    // being bought, so the whole life of an item sits in one place.
    id: 'stock', n: 'Stock & buying', i: 'box', tone: 'good', perm: 'items',
    b: (c) => plural(c.db.products.filter((p) => p.active).length, 'item'),
    items: [
      { route: 'ItemsTab', i: 'box', n: 'Items', b: (c) => plural(c.db.products.filter((p) => p.active).length, 'product or service', 'products & services'), alt: 'products services catalogue' },
      // one direct way to buy: goods into stock and money out, in a single step
      { route: 'PurchaseNew', i: 'plus', n: 'New purchase', b: () => 'Record goods bought from a supplier', perm: 'purchases', alt: 'buy receive stock in supplier bill' },
      { route: 'Purchases', i: 'box', n: 'Purchases', b: (c) => plural(c.db.purchases.length, 'supplier bill'), perm: 'purchases', alt: 'supplier bills bought' },
      { route: 'StockTakes', i: 'check', n: 'Stock take', b: (c) => ((c.db.stockTakes || []).some((s) => s.status === 'open') ? 'A count is open' : 'All posted'), alt: 'count stocktake variance' },
      { route: 'Batches', i: 'calendar', n: 'Batches & expiry', b: () => 'Lots, expiry dates and what is left', alt: 'lot expiry shelf life' },
      { route: 'Production', i: 'factory', n: 'Production', b: (c) => plural(c.db.products.filter((p) => p.bom && p.bom.length).length, 'recipe'), alt: 'manufacture assemble bom' },
      { route: 'Warranties', i: 'shield', n: 'Warranty', b: (c) => plural(c.db.claims.filter((x) => x.status === 'open').length, 'open claim'), alt: 'guarantee claims' },
      { route: 'UnitsCategories', i: 'tag', n: 'Units & categories', b: (c) => plural(c.db.units.length, 'unit') + ' · ' + plural(c.db.categories.length, 'category', 'categories'), alt: 'measures groups' },
    ],
  },
  {
    id: 'people', n: 'People', i: 'user', tone: 'rail', perm: 'parties',
    b: (c) => plural(c.db.parties.filter((p) => p.active).length, 'party', 'parties'),
    items: [
      { route: 'Parties', i: 'user', n: 'Customers & suppliers', b: (c) => plural(c.db.parties.filter((p) => p.active).length, 'on file', 'on file'), alt: 'contacts debtors creditors' },
      { route: 'Loyalty', i: 'gift', n: 'Loyalty', b: (c) => (c.db.loyaltyRules.enabled ? 'On' : 'Off'), alt: 'points rewards' },
    ],
  },
  {
    // The drawer, the accounts behind it, and the books built on both.
    id: 'money', n: 'Money', i: 'card', tone: 'warnc', perm: 'money',
    b: (c) => (c.activeShift() ? 'A shift is open' : plural(c.db.accounts.length, 'account')),
    items: [
      { route: 'Shift', i: 'till', n: 'Cash register', b: (c) => (c.activeShift() ? 'Open — count and close' : 'Closed — open a shift'), perm: 'sell', alt: 'drawer shift float' },
      { route: 'Shift', i: 'lock', n: 'Day close', b: () => 'Count the drawer and reconcile', params: { close: true }, perm: 'sell', alt: 'z report end of day' },
      { route: 'EntryNew', i: 'down', n: 'Cash in', b: () => 'Money into the drawer', params: { direction: 'in' }, alt: 'income receipt' },
      { route: 'EntryNew', i: 'up', n: 'Cash out', b: () => 'Money out of the drawer', params: { direction: 'out' }, alt: 'expense spend' },
      { route: 'Money', i: 'card', n: 'Cash & bank', b: (c) => plural(c.db.accounts.length, 'account'), alt: 'accounts momo wallet balance' },
      { route: 'AccountingHub', i: 'pie', n: 'Accounting', b: (c) => plural((c.db.coa || []).filter((l) => l.active).length, 'ledger') + ' · journals, trial balance', perm: 'accounting', alt: 'ledgers chart of accounts journal entry trial balance postings double entry' },
      { route: 'Tax', i: 'receipt', n: 'Tax & URA', b: (c) => 'Rate ' + c.db.settings.taxRate + '%', perm: 'accounting', alt: 'vat ura returns' },
    ],
  },
  {
    // One place that answers "how is it going", instead of a reports catalogue
    // in one group and a staff report filed under Business.
    id: 'reports', n: 'Reports', i: 'chart', tone: 'danger', perm: 'reports',
    b: () => plural(REPORT_COUNT, 'report') + ' · sales, stock, money',
    open: 'Reports',
    items: [
      { route: 'Reports', i: 'chart', n: 'All reports', b: () => plural(REPORT_COUNT, 'report') + ' · sales, stock, money', alt: 'sales stock profit debtors batch movement' },
    ],
  },
  {
    id: 'admin', n: 'Settings', i: 'cog', tone: 'soft', perm: null,
    b: (c) => plural(c.db.warehouses.filter((w) => w.active !== false).length, 'branch', 'branches') + ' · settings',
    items: [
      { route: 'Branches', i: 'home', n: 'Branches', b: (c) => plural(c.db.warehouses.filter((w) => w.active !== false).length, 'open branch', 'open branches'), perm: 'settings', alt: 'stores shops outlets new branch' },
      // who did what — kept with staff and settings now that Reports opens straight onto the reports
      { route: 'StaffReport', i: 'chart', n: 'Staff performance', b: () => 'Who sold and who posted what', perm: 'settings', alt: 'accountability who sold' },
      {
        route: 'AuditLog', i: 'shield', n: 'Audit log', perm: 'settings', alt: 'history changes trail',
        b: (c) => {
          const n = c.db.auditLog.filter((a) => (Date.now() - new Date(a.ts).getTime()) / 864e5 <= 30).length;
          return n ? plural(n, 'change') + ' this month' : 'Nothing changed';
        },
      },
      { route: 'UsersRoles', i: 'user', n: 'Staff & roles', b: (c) => plural(c.db.users.filter((u) => u.active).length, 'person', 'people'), perm: 'users', alt: 'users permissions pins' },
      { route: 'Settings', i: 'cog', n: 'Settings', b: () => 'Business details, tax, till, numbering', perm: 'settings', alt: 'preferences currency numbering' },
      { route: 'Printing', i: 'print', n: 'Printing', b: (c) => (c.db.printers.find((p) => p.dflt) || c.db.printers[0])?.name || 'Receipt layout and copies', perm: 'settings', alt: 'printer receipt template' },
      { route: 'DataTools', i: 'swap', n: 'Data & backup', b: () => 'Back up, export, check health', perm: 'settings', alt: 'backup restore export import' },
      {
        // "Cloud sync" and "Online mode" were two rows for one switch.
        route: 'Sync', i: 'cloud', n: 'Cloud sync', perm: 'settings', alt: 'online backup upload devices',
        b: (c) => (c.db.sync.on ? 'On · ' + c.db.sync.freq : 'Kept on this phone'),
      },
    ],
  },
  {
    // Legal pages, the app and its plan, and every way to reach support —
    // opened as one screen; the rows below are what the menu search finds.
    id: 'help', n: 'Help & about', i: 'bulb', tone: 'soft', perm: null,
    b: () => 'Support, FAQs, plan, legal',
    open: 'Help',
    items: [
      { route: 'Faq', i: 'bulb', n: 'FAQs & help', b: () => 'Answers to common questions', alt: 'faq questions how to guide' },
      { route: 'Help', i: 'phone', n: 'WhatsApp support', b: () => 'Chat with support', alt: 'contact help whatsapp call' },
      { route: 'Help', i: 'mail', n: 'Email support', b: () => 'Write to support', alt: 'contact help email mail' },
      { route: 'Help', i: 'pencil', n: 'Feature request', b: () => 'Ask for something new', alt: 'suggestion idea feedback' },
      { route: 'Help', i: 'up', n: 'Share the app', b: () => 'Tell another shop', alt: 'invite recommend share' },
      {
        route: 'About', i: 'shield', n: 'App & updates', alt: 'version build update install about',
        b: (c) => 'Version ' + BUILD + ' · data v' + SCHEMA_VERSION + (c.db.update.lastCheck ? '' : ' · not checked'),
      },
      {
        route: 'Plans', i: 'money', n: 'Plan & licence', alt: 'billing subscription pro upgrade key',
        b: (c) => {
          const pro = isProOf(c.db);
          const st = licStateOf(c.db);
          const lic = st === 'active' ? 'licensed'
            : st === 'none' ? 'not licensed' : (LIC_WORDS[st] || LIC_WORDS.none)[0].toLowerCase();
          return (pro ? PLANS.pro.name : PLANS.starter.name) + ' · ' + lic;
        },
      },
      { route: 'Legal', params: { doc: 'privacy' }, i: 'shield', n: 'Privacy policy', b: () => 'What the app stores, and where', alt: 'privacy data gdpr legal' },
      { route: 'Legal', params: { doc: 'terms' }, i: 'doc', n: 'Terms and conditions', b: () => 'The rules for using Genius POS', alt: 'terms conditions agreement legal eula' },
    ],
  },
];

export function menuGroup(id: string): MenuGroupDef | undefined {
  return MENU_GROUPS.find((g) => g.id === id);
}

export interface MenuHit { group: MenuGroupDef; item: MenuItem }

/**
 * Every row in the menu, flattened, for the search field.
 *
 * Thirty-odd entries across six cards is more than anyone will hunt through
 * twice, and people reach for a name ("stock take", "vat") rather than the
 * group it was filed under. Matching on the row's own extra words means a
 * search for "vat" finds Tax and one for "expense" finds Cash out.
 */
export function searchMenu(q: string): MenuHit[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const hits: MenuHit[] = [];
  MENU_GROUPS.forEach((group) => {
    group.items.forEach((item) => {
      const hay = (item.n + ' ' + group.n + ' ' + (item.alt || '')).toLowerCase();
      if (hay.includes(needle)) hits.push({ group, item });
    });
  });
  return hits;
}
