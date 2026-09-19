/**
 * WHAT EACH SCREEN REQUIRES.
 *
 * Most screens used to check nothing, so a restricted member of staff could
 * reach them simply by navigating — from a quick action, a notification, a
 * link on another screen. Checking in each screen is how that happened: every
 * new screen was one more place to forget. So the rule for every screen lives
 * here, in one table, and is enforced where screens are mounted.
 *
 * Screens that write also check again when they write (see AppDataContext);
 * this table decides whether the screen opens at all.
 *
 * `null` means anyone signed in may open it. The owner passes every check.
 */
export type RouteRule = string | null | ((params: any) => string | null);

export const ROUTE_PERMS: Record<string, RouteRule> = {
  // getting in, and the shell
  AuthGate: null, SignIn: null, CreateAccount: null, GoogleSignIn: null, Welcome: null,
  Onboarding: null, PinLock: null, Main: null, MenuGroup: null, Notifications: null,
  About: null, Install: null, Update: null, Versions: null, LicenceStop: null,

  // selling
  NewSale: 'sales.create',
  Receipt: 'sales.view',
  Sales: 'sales.view',
  SaleDetail: 'sales.view',
  EditSale: 'sales.edit',
  Estimates: 'sales.view',
  EstimateNew: 'sales.create',
  Challans: 'sales.view',
  ChallanNew: 'sales.create',
  CreditNotes: 'sales.view',
  CreditNoteNew: 'sales.refund',
  Offers: 'sales.edit',
  OfferNew: 'sales.edit',
  Recurring: 'sales.view',
  RecurringNew: 'sales.create',
  Instalments: 'finance.view',
  PlanDetail: 'finance.view',
  PlanNew: 'finance.create',
  Warranties: 'sales.view',

  // buying
  Purchases: 'purchases.view',
  PurchaseDetail: 'purchases.view',
  PurchaseNew: 'purchases.create',
  EditPurchase: 'purchases.edit',
  PurchaseOrders: 'purchases.view',
  PurchaseOrderNew: 'purchases.create',

  // people
  Parties: 'customers.view',
  PartyDetail: (p) => (p && p.partyId ? 'customers.view' : 'customers.create'),
  PartyEdit: 'customers.edit',
  PartyLedger: 'customers.view',
  Loyalty: 'customers.manage',
  UsersRoles: 'profiles.manage',
  StaffReport: 'profiles.view',

  // stock
  ItemDetail: 'inventory.view',
  // opened with an item to edit it, without one to add a new one
  ProductDetail: (p) => (p && p.productId ? 'inventory.view' : 'inventory.create'),
  StockAdjust: 'inventory.stock_adjustment',
  StockTransfer: 'inventory.transfer',
  StockTakes: 'inventory.stock_take',
  StockTakeDetail: 'inventory.stock_take',
  Batches: 'inventory.view',
  BatchMovement: 'inventory.view',
  Production: 'inventory.create',
  UnitsCategories: 'inventory.edit',
  PriceList: 'inventory.edit',
  NamesEditor: 'inventory.edit',
  ActivateItems: 'inventory.edit',
  PriceTags: 'inventory.view_selling_price',
  BulkChange: 'inventory.edit',
  BulkPreview: 'inventory.edit',

  // money and the books
  Money: 'finance.view',
  AccountDetail: 'finance.view',
  PaymentNew: 'finance.create',
  PaymentDetail: 'finance.view',
  EntryNew: 'expenses.create',
  Transfer: 'finance.create',
  Shift: (p) => (p && p.close ? 'shifts.close' : 'shifts.open'),
  Accounting: 'reports.money',
  AccountingHub: 'finance.view',
  ChartOfAccounts: 'finance.manage_accounts',
  LedgerDetail: 'finance.view',
  JournalEntry: 'finance.manage_accounts',
  Journals: 'finance.view',
  TrialBalance: 'finance.view',
  Tax: 'finance.view',

  // reports
  Reports: 'reports.view',
  ReportDetail: 'reports.view',

  // branches and the business
  Branches: 'branches.manage',
  NewBranch: 'branches.manage',
  BranchAnalysis: 'branches.manage',
  Settings: 'settings.view',
  Business: 'settings.view',
  Printing: 'settings.manage',
  DataTools: 'settings.manage',
  Firms: 'settings.manage',
  AuditLog: 'settings.view',
  Plans: 'settings.view',
  Licence: 'settings.view',
  Sync: 'settings.view',
  Online: 'settings.manage',

  // the server decides this one, not the role
  Developer: null,
};

/** The permission a screen needs, given how it was opened. */
export function permFor(route: string, params?: unknown): string | null {
  const rule = ROUTE_PERMS[route];
  if (rule === undefined) return null;
  return typeof rule === 'function' ? rule(params) : rule;
}

/** Plain words for a refusal, so the person knows what to ask for. */
const WORDS: Record<string, string> = {
  sales: 'sales', purchases: 'buying', inventory: 'stock', finance: 'money', customers: 'customers and suppliers',
  expenses: 'expenses', shifts: 'the till', reports: 'reports', branches: 'branches', settings: 'settings',
  profiles: 'staff and roles', dashboard: 'the dashboard', exports: 'exports',
};

/** Actions whose words do not follow "cannot <act> <group>". */
const PHRASES: Record<string, string> = {
  'inventory.stock_adjustment': 'adjust stock',
  'inventory.stock_take': 'count stock',
  'inventory.transfer': 'move stock between branches',
  'inventory.view_selling_price': 'see selling prices',
  'inventory.view_cost_price': 'see cost prices',
  'finance.manage_accounts': 'post to the books directly',
  'sales.refund': 'take returns',
  'sales.void': 'void a bill',
  'sales.discount': 'give discounts',
  'sales.price_edit': 'change prices at the till',
  'sales.view_all': "see other staff's bills",
  'shifts.open': 'open a shift',
  'shifts.close': 'close a shift',
  'reports.money': 'see money reports',
  'branches.manage': 'manage branches',
  'customers.manage': 'manage loyalty',
  'profiles.manage': 'manage staff and roles',
  'profiles.view': 'see staff performance',
};

export function refusalFor(perm: string): string {
  if (PHRASES[perm]) {
    return 'Your role cannot ' + PHRASES[perm] + '. Ask the owner to allow it under Settings, Staff & roles.';
  }
  const [group, act] = perm.split('.');
  const what = (act || '').replace(/_/g, ' ');
  return 'Your role cannot ' + (what === 'view' ? 'see' : what) + ' ' + (WORDS[group] || group)
    + '. Ask the owner to allow it under Settings, Staff & roles.';
}
