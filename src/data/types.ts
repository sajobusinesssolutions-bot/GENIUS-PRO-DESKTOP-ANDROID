/**
 * A role id. The three built-ins are still named so existing code reads well,
 * but a shop may create its own — reference A.newRole at 7671.
 */
export type Role = 'owner' | 'manager' | 'cashier' | (string & {});
export type PayMethod = 'cash' | 'momo' | 'bank' | 'credit';

export interface PaymentAllocation {
  method: PayMethod;
  amount: number;
}

/** Reference builtinRoles() / DB.roles at 7596. */
export interface RoleDef {
  id: string; name: string; description: string;
  perms: Record<string, boolean>;
  builtin: boolean;
}

export interface Warehouse {
  id: string; name: string;
  /** A disabled branch keeps its history but cannot be sold from. */
  active?: boolean;
  address?: string; phone?: string;
  openedAt?: string;
  /**
   * The prefix on this branch's document numbers — 'STALL' gives STALL-00012.
   * Branches are run as separate businesses and their paperwork needs to be
   * told apart. The running number behind it stays firm-wide, so no two bills
   * anywhere can ever carry the same number.
   */
  prefix?: string;
  /** Who runs it. Staff are shared across branches; this is the name on the door. */
  managerId?: string;
  /** VAT can be charged at one branch and not another. */
  taxEnabled?: boolean;
}

export interface ProductBatch { no: string; expiry: string; qty: number; }

/** Reference the item form's `kind` segment, line 9221. */
export type ProductKind = 'product' | 'service';
/** Reference SERVICE_RATE, used by the service tab at 16897. */
export type ServiceRate = 'fixed' | 'hour' | 'day' | 'unit';

export interface Product {
  id: string; sku: string; name: string; unit: string; category: string;
  cost: number; price: number; taxRate: number;
  stock: Record<string, number>; reorder: number; warrantyMonths: number;
  bom?: { productId: string; qty: number }[] | null;
  active: boolean; emoji?: string;
  trackBatches?: boolean; batches?: ProductBatch[];
  trackSerials?: boolean; serials?: string[];

  // --- the full item editor, reference SCREENS.itemEdit (9192) + wrapper (16886) ---
  kind?: ProductKind;
  barcodes?: string[];
  /** A second unit and how many of it fit in one base unit. */
  secondaryUnit?: string; conversionRate?: number; secondaryPrice?: number;
  trackInventory?: boolean;
  /** Excluded from tax even when tax is switched on for the shop. */
  taxExempt?: boolean;
  priceChangeAllowed?: boolean;
  defaultQty?: number;
  note?: string;
  /** Colour tag from ITEM_COLOR and the picked picture from ITEM_EMOJI. */
  color?: string; image?: string;
  /** A real photograph, stored as a local file uri. */
  photo?: string;
  salesAccount?: string; cogsAccount?: string;
  // service-only
  rateType?: ServiceRate; duration?: string; staffId?: string;
  bookable?: boolean; materials?: boolean;
}

export interface Party {
  id: string; name: string; type: 'customer' | 'supplier'; phone: string;
  openingBalance: number; creditLimit: number; points: number; active: boolean;
  address?: string; email?: string; gstin?: string;
}

export interface User { id: string; name: string; role: Role; pin: string; active: boolean; }

export interface Account {
  id: string; name: string; type: 'cash' | 'bank' | 'wallet'; opening: number;
  /** The branch that owns this drawer or account. Absent means every branch. */
  branch?: string;
}

export interface SaleLine {
  productId: string; name: string; sku: string; unit: string;
  qty: number; price: number; cost: number; taxRate: number;
  batchNo?: string; serialNo?: string;
  /** List price before the line discount; `price` always holds the net price charged. */
  listPrice?: number; discountPct?: number;
}

export interface Sale {
  id: string; no: string; ts: string; partyId: string | null; userId: string;
  till: string; warehouse: string; lines: SaleLine[];
  discount: number; redeemed: number; gross: number; tax: number; total: number; cogs: number;
  additionalCharges?: number; terms?: string;
  method: PayMethod; paid: number; paidAtSale: number; due: number;
  /** Split tender: multiple payment methods in one sale. If present, overrides method. */
  methods?: PaymentAllocation[];
  status: 'complete' | 'void'; voidedAt?: string; voidReason?: string;
  synced: boolean; fiscal: string; fdn: string | null;
  /** Set when a bill is corrected by void-and-repost — reference editSaleSave, line 17635. */
  ref?: string; note?: string; editedFrom?: string; editedAt?: string;
}

export interface PurchaseLine {
  productId: string; qty: number; cost: number;
  /** Lot this delivery arrives as, for batch-tracked items. */
  batchNo?: string; expiry?: string;
}
export interface Purchase {
  id: string; no: string; ts: string; partyId: string; lines: PurchaseLine[];
  total: number; method: PayMethod; paid: number; due: number;
  userId?: string;
  /** The branch the goods came into and whose money paid for them. */
  branch?: string;
  status: 'complete' | 'void'; voidedAt?: string; voidReason?: string;
  ref?: string; note?: string; editedFrom?: string; editedAt?: string;
}

export interface Payment {
  id: string; ts: string; partyId: string; amount: number;
  direction: 'in' | 'out'; accountId: string; note: string; method: string;
  editedAt?: string;
  /** Who recorded it — the basis of the staff performance figures. */
  userId?: string;
  /** The branch whose account took or paid the money. */
  branch?: string;
}

export interface Entry {
  id: string; ts: string; direction: 'in' | 'out' | 'transfer'; accountId: string; toId?: string;
  category: string; amount: number; note: string;
  userId?: string;
  /** The branch whose money moved. */
  branch?: string;
  /**
   * An expense the customer settled on the shop's behalf — fuel to carry the
   * goods, say. It comes off what they owe on that bill rather than out of the
   * drawer, so the money never moves through an account.
   */
  offsetSaleId?: string;
}

export interface JournalLine { acc: string; dr?: number; cr?: number; }
export interface JournalEntry {
  id: string; ts: string; memo: string; ref: string; lines: JournalLine[]; balanced: boolean;
  /**
   * Which branch's books this belongs to. A branch is run as a separate
   * business — its own stock, its own drawer, its own profit — so every
   * posting is stamped and the finance screens read one branch at a time.
   * Absent on entries written before branches kept their own books; the
   * migration stamps those with the first branch.
   */
  branch?: string;
}

export interface Movement {
  id: string; ts: string; productId: string; wh: string; qty: number; type: string; ref: string;
  batchNo?: string;
  /** Who caused the movement, so stock changes can be attributed. */
  userId?: string;
}

export interface Shift {
  id: string; userId: string; till: string; openedAt: string; closedAt: string | null;
  /** The branch whose drawer was opened. */
  branch?: string;
  openingFloat: number; countedCash: number | null;
  /** What the drawer should have held at close — reference shiftVar(), 7294. */
  expected?: number | null;
  /** counted − expected, stamped at close so past shifts read back the same. */
  variance?: number | null;
  note?: string;
}

export interface Warranty { id: string; saleId: string; saleNo: string; productId: string; partyId: string | null; soldAt: string; months: number; status: 'active' | 'claim' | 'resolved' | 'expired'; }
export interface Claim { id: string; warrantyId: string; openedAt: string; fault: string; status: 'open' | 'resolved'; resolution: string; }

// --- Instalment plans ---
// Reference `instalSchedule` (11683) and the plan record built at 11751.
export interface InstalmentDue { due: string; amount: number; paidAt: string | null }
export interface InstalmentPlan {
  id: string; no: string; saleId: string; partyId: string | null;
  total: number; down: number; every: number;
  schedule: InstalmentDue[];
  note: string; createdAt: string;
}

// --- Printing — reference ensurePrinting() at 19496 ---
export type PrinterKind = 'bluetooth' | 'usb' | 'wifi' | 'server' | 'pdf';
export type Paper = '58mm' | '80mm' | 'A4';

export interface Printer {
  id: string; name: string; kind: PrinterKind; width: Paper;
  address: string; port: number; dflt: boolean; online: boolean; note: string;
}

export interface PrintServer {
  on: boolean; name: string; host: string; port: number; path: string; key: string;
  secure: boolean; timeout: number; queue: 'retry' | 'local' | 'drop';
  lastSeen: string; status: 'ok' | 'bad' | 'unknown';
}

export type CodeKind = 'none' | 'barcode' | 'qr' | 'both';
export type CodeData = 'no' | 'total' | 'verify' | 'party' | 'custom';

export interface PrintTemplate {
  id: string; name: string; paper: Paper; kind: 'thermal' | 'page';
  showLogo: boolean; showTax: boolean; showServed: boolean; showParty: boolean; showSaved: boolean;
  code: CodeKind; codeData: CodeData; codeCaption: boolean;
  density: 'normal' | 'tight'; head: string; foot: string; copies: number;
}

/** `DB.printer` — reference ensureExtras() at 5454. */
export interface PrinterSettings {
  device: string; width: Paper; copies: number;
  autoPrint: boolean; openDrawer: boolean; showLogo: boolean;
  header: string; footer: string;
}

export type DocKind = 'receipt' | 'invoice' | 'estimate' | 'challan' | 'recurring' | 'instal' | 'ret' | 'purchase';

// --- Subscription — reference PLANS / subscription() at 18679-18729 ---
export type PlanId = 'starter' | 'pro';
export type PlanTerm = 'month' | 'quarter' | 'year';
export interface Subscription {
  plan: PlanId; term: PlanTerm; status: 'trial' | 'active' | 'expired';
  startedAt: string; renewsAt: string; trialUntil: string;
  history: { ts: string; what: string }[]; email: string; account: string;
}

// --- Licence — reference licence() at 21763 ---
export type LicStatus =
  | 'none' | 'active' | 'trial' | 'stale' | 'blocked' | 'expired'
  | 'revoked' | 'unknown' | 'invalid' | 'unbound' | 'toomany';
export interface LicenceRecord {
  no: string; plan: string; planName: string; term: string;
  expiresAt: string; daysLeft: number | null; devices: number;
  limits: { devices: number }; features: string[];
  owner?: { name: string };
}
export interface Licence {
  key: string; server: string; status: LicStatus; checkedAt: string;
  licence: LicenceRecord | null; reason: string; offlineSince: string;
}

// --- Cloud sync — reference syncCfg() at 20213 ---
export type SyncFreq = 'live' | 'hour' | 'day' | 'manual';
export type ConflictRule = 'server' | 'device' | 'ask';
export interface SyncDevice { id: string; name: string; kind: 'phone' | 'laptop'; last: string; me: boolean }
export interface SyncPending { id: string; type: string; ref: string; note: string; ts: string; by: string }
export interface SyncLogEntry { id: string; ts: string; how: string; up: number; down: number; by: string; ok: boolean; note: string }
export interface SyncCfg {
  on: boolean; freq: SyncFreq; wifiOnly: boolean; conflict: ConflictRule;
  scope: 'all' | 'one'; pending: SyncPending[]; log: SyncLogEntry[];
  devices: SyncDevice[]; lastAt: string;
  /** "Online mode" (reference SCREENS.online, 22755) shares this switch. */
  strict: boolean; lastPush: string; lastPull: string; cursor: number;
  /** The tenant on the server, found once and then remembered. */
  businessId?: string;
  /** This phone's seat on the account. */
  deviceId?: string;
  /** Per-device counter, so operations keep their causal order across restarts. */
  lamport?: number;
  /** How many operations the server holds for this business. */
  serverOps?: number;
}

// --- Updates — reference updCfg() at 23027 ---
export interface UpdateCfg { on: boolean; feed: string; lastCheck: string; skip: string }

// --- Version stamps — reference touch() / revisionsFor() at 20773 ---
export interface RevisionChange { f: string; from: unknown; to: unknown }
export interface Revision {
  id: string; rec: string; coll: string; v: number; ts: string;
  by: string; dev: string; why: string; changed: RevisionChange[]; no: string;
}

export interface Plan { id: string; name: string; price: number; period: 'month' | 'year'; features: string[]; highlight?: boolean; }

export type Costing = 'average' | 'last';
export type BelowCost = 'allow' | 'warn' | 'block';

/** Reference SCREENS.settings (6712) and every wrapper that adds a group to it. */
export interface Settings {
  // money & language
  currency: string; currencyName: string; symbolBefore: boolean; decimals: 0 | 2;
  dateFormat: string; firstDay: 'Mon' | 'Sun'; language: string; timezone: string;
  // tax
  taxName: string; taxRate: number; pricesIncludeTax: boolean; withholding: boolean;
  efris: boolean;
  // selling & the till
  defaultMethod: 'cash' | 'momo' | 'bank'; roundTo: 0 | 50 | 100 | 500;
  maxDiscountPct: number; quickItems: number;
  requireShift: boolean; askCustomer: boolean; allowPriceEdit: boolean;
  blockNegativeStock: boolean; belowCost: BelowCost;
  // stock
  defaultWarehouse: string; costing: Costing;
  lowStockAlerts: boolean; allowNegativeStock: boolean; trackBatches: boolean;
  /** Master switch — off means no tax is charged or shown anywhere. */
  taxEnabled: boolean;
  /** Ask who is recording each posting, so every record carries a name. */
  askWhoOnSave: boolean;
  /** Make that person confirm with their PIN. */
  requirePinOnSave: boolean;
  useSecondaryUnit: boolean;
  // alerts
  notifyLowStock: boolean; notifyOverdue: boolean;
  notifyShiftClose: boolean; notifyDailySummary: boolean;
  // security
  lockOnOpen: boolean; autoLockMins: number; hideCostFromCashier: boolean;
  requirePinToEdit: boolean; requirePinToDelete: boolean; editWindowDays: number;
  // appearance
  theme: 'auto' | 'light' | 'dark';
  // ui
  favReports?: string[];
}

/** Reference DB.numbering / numLabel(), line 6817. */
export type NumberingKey =
  | 'sale' | 'estimate' | 'challan' | 'credit' | 'purchase' | 'po' | 'stocktake' | 'journal';
export interface LoyaltyRules { enabled: boolean; earnPer: number; pointValue: number; redeemMin: number; }
export interface Session { userId: string; role: Role; online: boolean; till: string; warehouse: string; }
export interface Firm {
  id: string; name: string; tin: string; address: string; phone: string;
  businessType?: string;
  email?: string;
  /** A second number — most shops here have one for calls and one for money. */
  phone2?: string;
  /** A line under the shop name on a receipt: what the business does. */
  description?: string;
  /**
   * A local file URI for the shop's logo, printed at the top of every receipt
   * and invoice. Copied into permanent storage when chosen, because the
   * picker hands back a cache path the system is free to delete.
   */
  logo?: string;
  /** Printed above the signature line on an invoice. Same storage rule. */
  signature?: string;
  /** Words printed at the bottom of every document — terms, thanks, a slogan. */
  footer?: string;
}

// --- Estimates / quotations ---
export interface Estimate {
  id: string; no: string; ts: string; partyId: string | null; lines: SaleLine[];
  discount: number; total: number; status: 'open' | 'converted' | 'void';
  convertedSaleId?: string | null;
}

// --- Delivery challans ---
export interface ChallanLine { productId: string; name: string; qty: number; unit: string; }
export interface Challan {
  id: string; no: string; ts: string; saleId: string | null; partyId: string | null;
  lines: ChallanLine[]; status: 'dispatched' | 'delivered';
}

// --- Credit notes / returns ---
export interface CreditNoteLine { productId: string; name: string; qty: number; price: number; cost: number; taxRate: number; }
export interface CreditNote {
  id: string; no: string; ts: string; saleId: string | null; partyId: string | null;
  lines: CreditNoteLine[]; total: number; reason: string;
  /** How the customer was made good: cash back, or credited to the account. */
  refund?: 'cash' | 'bank' | 'momo' | 'account';
  /** A restocking or handling charge withheld from the refund. */
  charges?: number;
  userId?: string;
}

// --- Offers / promos ---
export interface Offer {
  id: string; name: string; kind: 'percent' | 'fixed'; value: number;
  scope: 'product' | 'category' | 'all'; target: string | null;
  from: string; to: string; active: boolean;
}

// --- Stock-takes ---
export interface StockTakeBatchCount { no: string; expiry: string; expected: number; counted: number | null; }
export interface StockTakeLine {
  productId: string; name: string; expected: number; counted: number | null;
  /** Present when the product is batch tracked; `counted` is their sum. */
  batches?: StockTakeBatchCount[];
}
export interface StockTake {
  id: string; ts: string; warehouse: string; lines: StockTakeLine[];
  status: 'open' | 'posted'; postedAt?: string | null;
  /** Who started the count, and who posted its variances. */
  userId?: string; postedBy?: string;
}

// --- Purchase orders ---
export interface POLine { productId: string; name: string; qty: number; cost: number; }
export interface PurchaseOrder {
  id: string; no: string; ts: string; partyId: string; lines: POLine[];
  status: 'open' | 'received'; receivedPurchaseId?: string | null;
}

// --- Production runs (BOM assembly) ---
export interface ProductionRun {
  id: string; ts: string; productId: string; qty: number; warehouse: string;
  componentCost: number; finishedValue: number;
}

// --- Recurring invoices ---
export interface RecurringInvoice {
  id: string; partyId: string; lines: SaleLine[]; discount: number;
  frequency: 'weekly' | 'monthly'; nextDue: string; lastRun: string | null; active: boolean;
}

// --- Audit log ---
export interface AuditLogEntry { id: string; ts: string; userId: string; userName: string; action: string; details: string; }

// --- Offline sync queue ---
export interface QueueItem { id: string; ts: string; kind: string; ref: string; }

export interface DB {
  v: 1;
  firm: Firm;
  firms: Firm[];
  activeFirmId: string;
  settings: Settings;
  /** Reference DB.roles — the editable permission matrix, 7596. */
  roles: RoleDef[];
  /** Reference DB.numbering, used by the "Document numbers" group at 6817. */
  numbering: Record<NumberingKey, string>;
  /** Reference DB.units / DB.categories, offered by the item editor at 9249. */
  units: string[];
  categories: string[];
  loyaltyRules: LoyaltyRules;
  warehouses: Warehouse[];
  products: Product[];
  parties: Party[];
  users: User[];
  accounts: Account[];
  sales: Sale[];
  purchases: Purchase[];
  payments: Payment[];
  entries: Entry[];
  journal: JournalEntry[];
  movements: Movement[];
  /** The chart of accounts — see ./coa. */
  coa?: import('./coa').Ledger[];
  shifts: Shift[];
  warranties: Warranty[];
  claims: Claim[];
  plans: Plan[];
  estimates: Estimate[];
  challans: Challan[];
  creditNotes: CreditNote[];
  offers: Offer[];
  stockTakes: StockTake[];
  purchaseOrders: PurchaseOrder[];
  productionRuns: ProductionRun[];
  recurringInvoices: RecurringInvoice[];
  auditLog: AuditLogEntry[];
  queue: QueueItem[];
  session: Session;
  counters: { sale: number; purchase: number; estimate: number; challan: number; creditNote: number; po: number; plan: number };
  onboarded: boolean;
  /**
   * The owner account these books belong to.
   *
   * Signing out and signing in as somebody else on the same phone must not
   * hand the second person the first one's stock, customers and takings, so
   * the books say whose they are and are replaced when that stops matching.
   */
  ownerEmail?: string;
  /** True for the demo shop the app ships with, so it is never mistaken for real books. */
  demo?: boolean;

  // --- Instalments (reference DB.plans; renamed so it does not collide with
  //     the subscription price list this port already keeps in `plans`) ---
  instalmentPlans: InstalmentPlan[];

  // --- Printing ---
  printer: PrinterSettings;
  printers: Printer[];
  printServer: PrintServer;
  templates: PrintTemplate[];
  templateFor: Record<DocKind, string>;

  // --- Licence / subscription / sync / updates / versions ---
  subscription: Subscription;
  licence: Licence;
  sync: SyncCfg;
  update: UpdateCfg;
  numberSafe: { mode: 'auto' | 'tag' | 'plain' };
  revisions: Revision[];
}
