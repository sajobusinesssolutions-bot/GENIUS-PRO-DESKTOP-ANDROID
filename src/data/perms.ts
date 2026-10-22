/**
 * Roles & permissions — the real matrix.
 *
 * Reference: `PERM_MATRIX` / `allPermKeys()` / `LEGACY_PERM` / `builtinRoles()` /
 * `ensureRoles()` / `can()` / `permCount()` at lines 7539-7612 of the prototype,
 * driving `SCREENS.roles` (7613) and `SCREENS.roleEdit` (7677).
 *
 * A permission is `group.action` — per-action granularity, not a single on/off
 * per module. Roles are records in `DB.roles`, so a shop can create its own.
 */
import type { RoleDef, DB } from './types';
import type { IconName } from '../components/icons';

export interface PermGroup {
  k: string; n: string; i: IconName; acts: [string, string][];
  /** Shown only for these kinds of business. Absent means every kind. */
  editions?: Array<'retail' | 'restaurant' | 'pharmacy'>;
}

/** Reference PERM_MATRIX, line 7543. */
export const PERM_MATRIX: PermGroup[] = [
  { k: 'sales', n: 'Sales', i: 'doc', acts: [
    ['view', 'View'], ['create', 'Create'], ['edit', 'Edit'], ['delete', 'Delete'], ['refund', 'Refund'],
    ['void', 'Void a sale'], ['discount', 'Give discounts'], ['price_edit', 'Change prices at the till'],
    ['view_all', "See other staff's sales"], ['view_totals', 'See total sales'], ['view_balances', 'See balance due'],
    ['offers', 'Set up offers'], ['recurring', 'Recurring bills'],
    ['edit_offline', 'Edit offline'], ['delete_offline', 'Delete offline'], ['toggle_offline', 'Toggle offline'],
  ] },
  // a restaurant's own switches: who may charge, cancel, see every table, sell any menu
  { k: 'restaurant', n: 'Restaurant', i: 'food', editions: ['restaurant'], acts: [
    ['charge', 'Charge and close tickets'], ['cancel', 'Cancel tickets'],
    ['all_tickets', "See and change other waiters' tickets"], ['switch_menu', 'Sell from any menu'],
    ['print_bill', 'Print the bill'], ['menu', 'Edit the menu and modifiers'], ['kitchen', 'Use the kitchen display'],
  ] },
  { k: 'quotes', n: 'Quotations', i: 'doc', acts: [
    ['view', 'View'], ['create', 'Create and edit'], ['convert', 'Convert to a sale'], ['delete', 'Delete'],
  ] },
  { k: 'challans', n: 'Delivery notes', i: 'doc', acts: [
    ['view', 'View'], ['create', 'Create'], ['deliver', 'Mark delivered'],
  ] },
  { k: 'inventory', n: 'Inventory', i: 'box', acts: [
    ['view', 'View'], ['create', 'Create'], ['edit', 'Edit'], ['delete', 'Delete'],
    ['stock_adjustment', 'Stock adjustment'], ['transfer', 'Move stock between branches'],
    ['stock_take', 'Count stock'], ['view_cost_price', 'View cost price'],
    ['view_profit', 'View profit'], ['view_selling_price', 'View selling price'],
    ['batches', 'Batches and expiry'], ['production', 'Production'], ['bulk_edit', 'Bulk changes and price list'],
    ['price_tags', 'Print price tags'],
  ] },
  { k: 'purchases', n: 'Purchases', i: 'box', acts: [
    ['view', 'View'], ['create', 'Create'], ['edit', 'Edit'], ['delete', 'Delete'], ['receive', 'Receive stock'],
    ['orders', 'Purchase orders'],
  ] },
  { k: 'finance', n: 'Finance', i: 'card', acts: [
    ['view', 'View'], ['create', 'Create'], ['edit', 'Edit'], ['delete', 'Delete'], ['transfer', 'Move money between accounts'],
    ['reconcile', 'Reconcile the bank'], ['instalments', 'Instalment plans'], ['manage_accounts', 'Manage accounts'],
  ] },
  // Customers are never deleted (a party with history is kept, so its ledger
  // stays whole), expenses are corrected by a new entry rather than edited, and
  // there is no task list — so none of those are offered as switches that do nothing.
  { k: 'customers', n: 'Customers', i: 'user', acts: [
    ['view', 'View'], ['create', 'Create'], ['edit', 'Edit'], ['manage', 'Manage'],
  ] },
  { k: 'expenses', n: 'Expenses', i: 'arrow', acts: [
    ['view', 'View'], ['create', 'Create'],
  ] },
  { k: 'shifts', n: 'Till & shifts', i: 'till', acts: [
    ['open', 'Open a shift'], ['close', 'Close a shift'], ['view_all', "See other staff's shifts"],
    ['expected', 'See what the drawer should hold'],
  ] },
  { k: 'reports', n: 'Reports', i: 'chart', acts: [['view', 'View'], ['money', 'See money reports']] },
  { k: 'branches', n: 'Branches', i: 'home', acts: [['view', 'View'], ['manage', 'Open and manage']] },
  { k: 'exports', n: 'Exports (PDF & CSV)', i: 'print', acts: [['download', 'Download']] },
  { k: 'profiles', n: 'Profiles', i: 'user', acts: [['view', 'View'], ['manage', 'Manage']] },
  { k: 'settings', n: 'Settings', i: 'cog', acts: [
    ['view', 'View'], ['manage', 'Manage'], ['printing', 'Printers and layouts'], ['backup', 'Backup, restore and import'],
    ['sync', 'Cloud sync'], ['audit', 'Audit log'], ['deleted', 'Deleted transactions and restore'],
  ] },
  { k: 'dashboard', n: 'Home', i: 'home', acts: [
    ['view', 'View'], ['view_total_sales', 'View total sales'], ['view_gross_profit', 'View gross profit'],
    ['view_total_expenses', 'View total expenses'], ['view_inventory_value', 'View inventory value'],
    ['view_sales_types', 'View sales types'], ['view_avg_price', 'View average price'],
    ['view_total_amount', 'View total amount'],
  ] },
];

let _allKeys: string[] | null = null;
/** Reference allPermKeys(), line 7585. */
export function allPermKeys(): string[] {
  if (!_allKeys) {
    const out: string[] = [];
    PERM_MATRIX.forEach((g) => g.acts.forEach((a) => out.push(g.k + '.' + a[0])));
    _allKeys = out;
  }
  return _allKeys;
}

export function groupOf(k: string): PermGroup | undefined {
  return PERM_MATRIX.find((g) => g.k === k.split('.')[0]);
}

/** Reference LEGACY_PERM, line 7590. The coarse keys the rest of the port still passes. */
export const LEGACY_PERM: Record<string, string> = {
  sell: 'sales.create', sales: 'sales.view', discount: 'sales.edit',
  parties: 'customers.view', items: 'inventory.view', purchases: 'purchases.view',
  money: 'finance.view', reports: 'reports.view', accounting: 'finance.manage_accounts',
  users: 'profiles.manage', settings: 'settings.manage',
};

export type PermKey =
  | 'sell' | 'sales' | 'discount' | 'parties' | 'items' | 'purchases'
  | 'money' | 'reports' | 'accounting' | 'users' | 'settings';

/** Kept for menuGroups / quick, which label the coarse keys. */
export const PERMS: { k: PermKey; l: string }[] = [
  { k: 'sell', l: 'Use the till and take payments' },
  { k: 'sales', l: 'See sales' },
  { k: 'discount', l: 'Give discounts and void sales' },
  { k: 'parties', l: 'Customers and suppliers' },
  { k: 'items', l: 'Products and stock levels' },
  { k: 'purchases', l: 'Purchases and orders' },
  { k: 'money', l: 'Cash, bank and expenses' },
  { k: 'reports', l: 'Reports' },
  { k: 'accounting', l: 'Accounting and ledgers' },
  { k: 'users', l: 'Staff and roles' },
  { k: 'settings', l: 'Settings and printing' },
];

export type PermSet = Record<string, boolean>;

function setOf(list: string[] | true): PermSet {
  const o: PermSet = {};
  const on = list === true ? null : new Set(list);
  allPermKeys().forEach((k) => { o[k] = on === null || on.has(k); });
  return o;
}

/** Reference builtinRoles(), line 7596. */
export function builtinRoles(): RoleDef[] {
  const manager = allPermKeys().filter((k) => k !== 'profiles.manage' && k !== 'settings.manage');
  const cashier = [
    'sales.view', 'sales.create', 'sales.discount',
    'shifts.open', 'shifts.close',
    'inventory.view', 'inventory.view_selling_price',
    'customers.view', 'customers.create', 'customers.edit',
    'dashboard.view', 'dashboard.view_total_sales', 'dashboard.view_total_amount',
  ];
  return [
    { id: 'owner', name: 'Owner', description: 'Full control of everything in this business.', perms: setOf(true), builtin: true },
    { id: 'manager', name: 'Manager', description: 'Runs the shop day to day, but cannot change staff or settings.', perms: setOf(manager), builtin: true },
    { id: 'cashier', name: 'Cashier', description: 'Sells at the till and looks up stock. No cost prices, no money.', perms: setOf(cashier), builtin: true },
    { id: 'sales', name: ROLE_WORDS.retail.sales[0], description: ROLE_WORDS.retail.sales[1], perms: setOf(EDITION_ROLES.retail.sales), builtin: true },
  ];
}

/* ------------------------------------------------------------------
   The Cashier and Sales roles of each kind of business.
   Chosen when the business type is set, so a restaurant's cashier can
   charge tickets and its waiter cannot, a pharmacy's sees batches, and
   so on. The owner always has everything.
   ------------------------------------------------------------------ */
type Ed = 'retail' | 'restaurant' | 'pharmacy';
const BASE_CASHIER = [
  'sales.view', 'sales.create', 'sales.discount', 'shifts.open', 'shifts.close',
  'inventory.view', 'inventory.view_selling_price', 'customers.view', 'customers.create', 'customers.edit',
  'dashboard.view', 'dashboard.view_total_sales', 'dashboard.view_total_amount',
];
export const EDITION_ROLES: Record<Ed, { cashier: string[]; sales: string[] }> = {
  retail: {
    cashier: BASE_CASHIER,
    sales: [
      'sales.view', 'sales.create', 'sales.discount', 'quotes.view', 'quotes.create', 'quotes.convert',
      'challans.view', 'challans.create', 'inventory.view', 'inventory.view_selling_price',
      'customers.view', 'customers.create', 'customers.edit', 'dashboard.view', 'dashboard.view_total_sales',
    ],
  },
  restaurant: {
    // the cashier takes the money: charges and closes tickets, sees every table, opens and closes the till
    cashier: [
      'sales.view', 'sales.create', 'sales.discount', 'sales.refund', 'sales.view_all', 'shifts.open', 'shifts.close',
      'restaurant.charge', 'restaurant.all_tickets', 'restaurant.print_bill', 'restaurant.switch_menu', 'restaurant.kitchen',
      'inventory.view', 'inventory.view_selling_price', 'customers.view', 'customers.create',
      'dashboard.view', 'dashboard.view_total_sales', 'dashboard.view_total_amount',
    ],
    // the waiter takes orders and prints the bill, but does not take payment or cancel
    sales: [
      'sales.view', 'sales.create', 'restaurant.print_bill',
      'inventory.view', 'inventory.view_selling_price', 'customers.view', 'customers.create', 'dashboard.view',
    ],
  },
  pharmacy: {
    cashier: [...BASE_CASHIER, 'sales.refund', 'inventory.batches'],
    // the counter assistant serves customers and checks batches and expiry
    sales: [
      'sales.view', 'sales.create', 'sales.discount', 'quotes.view', 'quotes.create',
      'inventory.view', 'inventory.view_selling_price', 'inventory.batches',
      'customers.view', 'customers.create', 'customers.edit', 'dashboard.view',
    ],
  },
};
export const ROLE_WORDS: Record<Ed, { cashier: [string, string]; sales: [string, string] }> = {
  retail: {
    cashier: ['Cashier', 'Sells at the till and looks up stock. No cost prices, no money.'],
    sales: ['Sales', 'Sells, writes quotations and delivery notes, and looks after customers. No till, no money.'],
  },
  restaurant: {
    cashier: ['Cashier', 'Charges and closes tickets, sees every table, opens and closes the till.'],
    sales: ['Waiter (sales)', 'Takes orders and sends them to the kitchen, prints the bill. Does not take payment or cancel.'],
  },
  pharmacy: {
    cashier: ['Cashier', 'Sells at the counter, takes returns, sees batches. No cost prices, no money.'],
    sales: ['Sales (counter)', 'Serves customers, checks batches and expiry, writes quotations. No till, no money.'],
  },
};

/**
 * Sets the Cashier and Sales roles for a kind of business: their names,
 * what they do, and their switches. Adds the Sales role if the books predate it.
 */
export function applyEditionRoles(roles: RoleDef[], edition: Ed): RoleDef[] {
  (['cashier', 'sales'] as const).forEach((id) => {
    const [name, description] = ROLE_WORDS[edition][id];
    const perms = setOf(EDITION_ROLES[edition][id]);
    const r = roles.find((x) => x.id === id);
    if (r) { r.name = name; r.description = description; r.perms = perms; }
    else roles.push({ id, name, description, perms, builtin: true });
  });
  return roles;
}

/**
 * Switches added after a role was set up start from the switch that used to
 * cover them, so a role keeps exactly the access it had: a role that could
 * create sales can still write quotations, one that could not, still cannot.
 */
const INHERITS: Record<string, string> = {
  'sales.offers': 'sales.edit', 'sales.recurring': 'sales.create',
  'shifts.expected': 'reports.money',
  'sales.view_totals': 'dashboard.view_total_sales', 'sales.view_balances': 'sales.view_all',
  'quotes.view': 'sales.view', 'quotes.create': 'sales.create', 'quotes.convert': 'sales.create', 'quotes.delete': 'sales.create',
  'challans.view': 'sales.view', 'challans.create': 'sales.create', 'challans.deliver': 'sales.create',
  'inventory.batches': 'inventory.view', 'inventory.production': 'inventory.create', 'inventory.bulk_edit': 'inventory.edit',
  'inventory.price_tags': 'inventory.view_selling_price',
  'purchases.orders': 'purchases.create',
  'finance.delete': 'finance.edit', 'finance.transfer': 'finance.create', 'finance.reconcile': 'finance.view',
  'finance.instalments': 'finance.create',
  'settings.printing': 'settings.manage', 'settings.backup': 'settings.manage', 'settings.sync': 'settings.view',
  'settings.audit': 'settings.view', 'settings.deleted': 'settings.manage',
  'restaurant.charge': 'sales.create', 'restaurant.cancel': 'sales.void', 'restaurant.all_tickets': 'sales.view_all',
  'restaurant.switch_menu': 'sales.create', 'restaurant.print_bill': 'sales.create', 'restaurant.menu': 'inventory.edit', 'restaurant.kitchen': 'sales.view',
};

/**
 * Reference ensureRoles(), line 7611 — fills in any key added since the book was
 * written, and upgrades a book whose `roles` was the old coarse on/off map.
 */
export function ensureRoles(d: { roles?: unknown }): RoleDef[] {
  const anyD = d as { roles?: unknown };
  if (!Array.isArray(anyD.roles)) {
    const old = anyD.roles as Record<string, Record<string, boolean>> | undefined;
    const fresh = builtinRoles();
    if (old && typeof old === 'object') {
      fresh.forEach((r) => {
        const prev = old[r.id];
        if (!prev || r.id === 'owner') return;
        Object.keys(LEGACY_PERM).forEach((lk) => { if (prev[lk] === false) r.perms[LEGACY_PERM[lk]] = false; });
      });
    }
    anyD.roles = fresh;
  }
  const roles = anyD.roles as RoleDef[];
  let builtins: RoleDef[] | null = null;
  roles.forEach((r) => {
    if (!r.perms) r.perms = {};
    let builtin: RoleDef | undefined;
    let looked = false;
    allPermKeys().forEach((k) => {
      if (r.perms[k] !== undefined) return;
      if (!looked) { builtins = builtins || builtinRoles(); builtin = builtins.find((b) => b.id === r.id); looked = true; }
      const from = INHERITS[k];
      r.perms[k] = from && r.perms[from] !== undefined ? !!r.perms[from] : builtin ? !!builtin.perms[k] : false;
    });
    // Once: take editing and deleting raised bills away from the built-in
    // cashier, which had them. An owner who wants a cashier to edit can say so.
    if (r.id === 'cashier' && !(r as any).permsReviewed) {
      r.perms['sales.edit'] = false;
      r.perms['sales.delete'] = false;
      (r as any).permsReviewed = true;
    }
  });
  // books from before the Sales role get one, for their own kind of business
  if (!roles.some((r) => r.id === 'sales')) {
    const t = (d as { firm?: { businessType?: string } }).firm?.businessType;
    const e: Ed = t === 'restaurant' ? 'restaurant' : t === 'pharmacy' ? 'pharmacy' : 'retail';
    roles.push({ id: 'sales', name: ROLE_WORDS[e].sales[0], description: ROLE_WORDS[e].sales[1], perms: setOf(EDITION_ROLES[e].sales), builtin: true });
  }
  // the owner can never be stripped — reference `if(r.id==='owner') return true` in can()
  const owner = roles.find((r) => r.id === 'owner');
  if (owner) allPermKeys().forEach((k) => { if (owner.perms[k] !== true) owner.perms[k] = true; });
  return roles;
}

export function roleById(roles: RoleDef[], id: string | undefined): RoleDef | undefined {
  return roles.find((r) => r.id === id) || roles[0];
}

/** Reference permCount(), line 7609. */
export function permCount(r: RoleDef): number {
  return allPermKeys().filter((k) => r.perms[k]).length;
}

export function permPct(r: RoleDef): number {
  return Math.round(permCount(r) / allPermKeys().length * 100);
}

/**
 * Reference can(), line 7607. Accepts either a fine key (`inventory.view_cost_price`)
 * or one of the coarse legacy keys the rest of the port passes.
 */
export function canWith(roles: RoleDef[], roleId: string | undefined, k: string | null | undefined): boolean {
  if (!k) return true;
  const key = LEGACY_PERM[k] || k;
  const r = roleById(roles, roleId);
  if (!r) return false;
  if (r.id === 'owner') return true;
  if (r.perms[key] !== undefined) return !!r.perms[key];
  const mod = key.split('.')[0];
  return !!r.perms[mod + '.view'];
}

/**
 * A role's name for display. A role made in Staff & roles has an id like
 * "r_lq3x9k"; showing the id (capitalised) put that under people's names.
 */
export function roleName(d: { roles?: unknown } | null | undefined, roleId: string | undefined): string {
  if (!roleId) return 'Staff';
  const r = d ? roleById(ensureRoles(d), roleId) : undefined;
  return r?.name || roleId.charAt(0).toUpperCase() + roleId.slice(1);
}

/** How many active people sit on a role — reference the roles list at 7660. */
export function usersOnRole(users: { role: string; active: boolean }[], roleId: string): number {
  return users.filter((u) => u.role === roleId && u.active).length;
}

/**
 * Guards the last way back in. Reference has no equivalent — this is the
 * "don't lock yourself out" rule the app adds on top.
 */
export function ownersLeftWithout(
  users: { id: string; role: string; active: boolean }[],
  roles: RoleDef[],
  change: { userId: string; role?: string; active?: boolean },
): number {
  return users.filter((u) => {
    const role = u.id === change.userId && change.role !== undefined ? change.role : u.role;
    const active = u.id === change.userId && change.active !== undefined ? change.active : u.active;
    return active && canWith(roles, role, 'profiles.manage') && canWith(roles, role, 'settings.manage');
  }).length;
}

/* ------------------------------------------------------------------
   The registry the screens' `canFor(role, key)` call sites read.
   AppDataContext keeps it in step with DB.roles on every commit, so
   every existing gate now answers from the live, editable matrix.
   ------------------------------------------------------------------ */

let REGISTRY: RoleDef[] = builtinRoles();

export function setRoleRegistry(roles: RoleDef[] | undefined) {
  if (Array.isArray(roles) && roles.length) REGISTRY = roles;
}

export function roleRegistry(): RoleDef[] { return REGISTRY; }

/** The gate every screen already calls. Unchanged signature, real matrix behind it. */
export function canFor(role: string | undefined, k: string | null | undefined): boolean {
  return canWith(REGISTRY, role, k);
}

/** Convenience gates the reference defines at 7796. */
/**
 * Settings → "Hide cost prices from cashiers". Kept here, beside the role
 * registry, because showCostFor is asked from all over the app without a book
 * in hand. Turning the switch off lets a cashier see cost; turning it on leaves
 * the role's own permission in charge.
 */
let COST_HIDDEN = true;
export function setCostHidden(v: boolean) { COST_HIDDEN = v; }

export function showCostFor(role: string | undefined): boolean {
  if (!COST_HIDDEN && role === 'cashier') return true;
  return canFor(role, 'inventory.view_cost_price');
}
export function showProfitFor(role: string | undefined): boolean { return canFor(role, 'inventory.view_profit'); }

/** Kept so anything still importing it compiles; now derived from the matrix. */
export function defaultRoles(): Record<string, PermSet> {
  const out: Record<string, PermSet> = {};
  builtinRoles().forEach((r) => { out[r.id] = r.perms; });
  return out;
}

export function ensureRolesOn(d: DB): RoleDef[] {
  const roles = ensureRoles(d as unknown as { roles?: unknown });
  d.roles = roles;
  return roles;
}
