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

export interface PermGroup { k: string; n: string; i: IconName; acts: [string, string][] }

/** Reference PERM_MATRIX, line 7543. */
export const PERM_MATRIX: PermGroup[] = [
  { k: 'sales', n: 'Sales', i: 'doc', acts: [
    ['view', 'View'], ['create', 'Create'], ['edit', 'Edit'], ['delete', 'Delete'], ['refund', 'Refund'],
    ['void', 'Void a sale'], ['discount', 'Give discounts'], ['price_edit', 'Change prices at the till'],
    ['view_all', "See other staff's sales"],
    ['edit_offline', 'Edit offline'], ['delete_offline', 'Delete offline'], ['toggle_offline', 'Toggle offline'],
  ] },
  { k: 'inventory', n: 'Inventory', i: 'box', acts: [
    ['view', 'View'], ['create', 'Create'], ['edit', 'Edit'], ['delete', 'Delete'],
    ['stock_adjustment', 'Stock adjustment'], ['transfer', 'Move stock between branches'],
    ['stock_take', 'Count stock'], ['view_cost_price', 'View cost price'],
    ['view_profit', 'View profit'], ['view_selling_price', 'View selling price'],
  ] },
  { k: 'purchases', n: 'Purchases', i: 'box', acts: [
    ['view', 'View'], ['create', 'Create'], ['edit', 'Edit'], ['delete', 'Delete'], ['receive', 'Receive stock'],
  ] },
  { k: 'finance', n: 'Finance', i: 'card', acts: [
    ['view', 'View'], ['create', 'Create'], ['edit', 'Edit'], ['manage_accounts', 'Manage accounts'],
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
  ] },
  { k: 'reports', n: 'Reports', i: 'chart', acts: [['view', 'View'], ['money', 'See money reports']] },
  { k: 'branches', n: 'Branches', i: 'home', acts: [['view', 'View'], ['manage', 'Open and manage']] },
  { k: 'exports', n: 'Exports (PDF & CSV)', i: 'print', acts: [['download', 'Download']] },
  { k: 'profiles', n: 'Profiles', i: 'user', acts: [['view', 'View'], ['manage', 'Manage']] },
  { k: 'settings', n: 'Settings', i: 'cog', acts: [['view', 'View'], ['manage', 'Manage']] },
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
  allPermKeys().forEach((k) => { o[k] = list === true || list.indexOf(k) > -1; });
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
  ];
}

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
  roles.forEach((r) => {
    if (!r.perms) r.perms = {};
    const builtin = builtinRoles().find((b) => b.id === r.id);
    allPermKeys().forEach((k) => {
      if (r.perms[k] === undefined) r.perms[k] = builtin ? !!builtin.perms[k] : false;
    });
    // Once: take editing and deleting raised bills away from the built-in
    // cashier, which had them. An owner who wants a cashier to edit can say so.
    if (r.id === 'cashier' && !(r as any).permsReviewed) {
      r.perms['sales.edit'] = false;
      r.perms['sales.delete'] = false;
      (r as any).permsReviewed = true;
    }
  });
  // the owner can never be stripped — reference `if(r.id==='owner') return true` in can()
  const owner = roles.find((r) => r.id === 'owner');
  if (owner) allPermKeys().forEach((k) => { owner.perms[k] = true; });
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
