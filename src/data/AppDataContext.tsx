import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { AppState } from 'react-native';
import {
  DB, Sale, SaleLine, Purchase, PurchaseLine, Payment, Entry, JournalLine, PayMethod, Product, Party,
  Estimate, Challan, ChallanLine, CreditNote, CreditNoteLine, Offer, StockTake, PurchaseOrder, POLine,
  ProductionRun, RecurringInvoice, AuditLogEntry, Firm, User,
  InstalmentPlan, Printer, PrintServer, PrintTemplate, PrinterSettings, DocKind,
  Subscription, Licence, SyncCfg, UpdateCfg, Revision, RoleDef, NumberingKey, Shift, BankStatementLine,
} from './types';
import { setCostHidden } from './perms';
import { ensureRoles, setRoleRegistry, canWith, builtinRoles, allPermKeys, permCount } from './perms';
import { seed, emptyBook } from './seed';
import { loadDB, saveDB, clearDB, scheduleSave, flushSave, migrate } from './storage';
import { defaultSync } from './defaults';
import { uid, iso } from './uid';
import * as logic from './logic';
import { activeBranchId, branchJournal } from './branch';
import { mayRecord, refusalMessage } from './recordGate';
import { Refusal } from './refusal';
import { refusalFor } from '../nav/routePerms';
import { licenceFromToken, verifyLicenceSignature } from './licenceKey';
import { hashPin, verifyPin } from './pinHash';
import { fetchLicence, normaliseLicenceResponse } from './authApi';
import type { StoredOp } from './syncProtocol';
import NetInfo from '@react-native-community/netinfo';
import { importStatementLines, matchStatementLine, summarizeReconciliation, completeReconciliation, StatementInput, ReconciliationSummary } from './reconciliation';

interface Ctx {
  db: DB | null;
  ready: boolean;
  cur: () => string;
  money: (n: number) => string;
  stockOf: (p: Product, wh?: string) => number;
  product: (id: string) => Product | undefined;
  party: (id: string) => Party | undefined;
  user: (id: string) => DB['users'][number] | undefined;
  account: (id: string) => DB['accounts'][number] | undefined;
  me: () => DB['users'][number] | undefined;
  partyBalance: (id: string) => number;
  accountBalance: (id: string, branch?: string | null) => number;
  login: (userId: string, pin: string) => boolean;
  logout: () => void;
  /** Replaces the books with an empty set, for a newly created account. */
  startFreshBook: (o?: { firmName?: string; ownerName?: string; ownerEmail?: string }) => void;
  /** Empties the books if they belong to a different owner than the one signing in. */
  claimBooksFor: (email: string) => boolean;
  /** Replaces the books on this phone with a business's books from the account. */
  adoptBook: (data: DB, o: { businessId: string; ownerEmail: string; snapshotVersion?: number }) => void;
  /** Replaces the local book with a validated backup selected on this phone. */
  restoreBackup: (data: DB) => void;
  commitSale: (o: { lines: SaleLine[]; partyId: string | null; method: PayMethod; discount: number; additionalCharges?: number; description?: string; terms?: string; redeem?: number; methods?: Array<{ method: PayMethod; amount: number }>; no?: string; ts?: string; received?: number; receivedVia?: 'cash' | 'momo' | 'bank'; momoNetwork?: 'mtn' | 'airtel'; momoRef?: string; userId?: string }) => Sale;
  voidSale: (saleId: string, reason?: string) => void;
  createPurchase: (partyId: string, lines: PurchaseLine[], method: PayMethod, userId?: string, no?: string, when?: string) => Purchase;
  recordPayment: (o: { partyId: string; amount: number; direction: 'in' | 'out'; accountId: string; note?: string; allocations?: Array<{ saleId: string; amount: number }>; userId?: string }) => Payment;
  recordEntry: (o: {
    direction: 'in' | 'out'; accountId: string; category: string; amount: number; note?: string;
    userId?: string;
    /** Charge it against a credit sale instead of an account. */
    offsetSaleId?: string;
  }) => Entry;
  updateProduct: (id: string, patch: Partial<Product>) => void;
  adjustStock: (productId: string, warehouse: string, count: number, note?: string, batchNo?: string, userId?: string) => void;
  transferStock: (productId: string, from: string, to: string, qty: number, note?: string) => void;
  addProduct: (p: Omit<Product, 'id'>) => Product;
  updateParty: (id: string, patch: Partial<Party>) => void;
  addParty: (p: Omit<Party, 'id'>) => Party;
  resetAll: () => Promise<void>;
  startFinancialYear: (when?: Date) => logic.FinancialYearStart;
  importBankStatement: (accountId: string, lines: StatementInput[]) => BankStatementLine[];
  matchBankStatementLine: (lineId: string, journalId: string) => BankStatementLine | null;
  bankReconciliationSummary: (accountId: string, from: string, to: string, closing: number) => ReconciliationSummary;
  completeBankReconciliation: (accountId: string, from: string, to: string, closing: number) => boolean;
  setOnboarded: (v: boolean) => void;
  setSetting: (patch: Partial<DB['settings']>) => void;
  setLoyalty: (patch: Partial<DB['loyaltyRules']>) => void;
  setWarehouse: (warehouseId: string) => void;
  lockAccountingPeriod: (reason?: string) => void;
  unlockAccountingPeriod: () => void;
  grantBusinessAccess: (userId: string, businessId: string, role?: 'owner' | 'manager' | 'staff') => void;
  revokeBusinessAccess: (userId: string, businessId: string) => void;
  updateFirm: (patch: Partial<Firm>) => void;
  updateUser: (id: string, patch: Partial<User>) => void;
  addUser: (u: Omit<User, 'id'>) => User;

  // Estimates
  createEstimate: (o: { partyId: string | null; lines: SaleLine[]; discount: number }) => Estimate;
  convertEstimate: (estimateId: string, method: PayMethod) => Sale | null;
  voidEstimate: (estimateId: string) => void;

  // Delivery challans
  createChallan: (o: { saleId: string | null; partyId: string | null; lines: ChallanLine[] }) => Challan;
  markChallanDelivered: (challanId: string) => void;

  // Credit notes / returns
  createCreditNote: (o: {
    saleId: string | null; partyId: string | null; lines: CreditNoteLine[]; reason: string;
    refund?: 'cash' | 'bank' | 'momo' | 'account'; charges?: number; userId?: string;
  }) => CreditNote;

  // Offers
  addOffer: (o: Omit<Offer, 'id'>) => Offer;
  updateOffer: (id: string, patch: Partial<Offer>) => void;
  removeOffer: (id: string) => void;
  activeOffers: () => Offer[];
  bestOfferFor: (p: Product) => Offer | null;

  // Stock-takes
  startStockTake: (warehouse: string) => StockTake;
  setStockTakeCount: (stockTakeId: string, productId: string, counted: number) => void;
  setStockTakeBatchCount: (stockTakeId: string, productId: string, batchNo: string, counted: number) => void;
  postStockTake: (stockTakeId: string, userId?: string) => void;

  // Purchase orders
  createPurchaseOrder: (o: { partyId: string; lines: POLine[] }) => PurchaseOrder;
  receivePurchaseOrder: (poId: string, method: PayMethod) => Purchase | null;

  // Production runs
  runProduction: (productId: string, qty: number) => ProductionRun | null;

  // Recurring invoices
  scheduleRecurring: (o: { partyId: string; lines: SaleLine[]; discount: number; frequency: 'weekly' | 'monthly' }) => RecurringInvoice;
  updateRecurring: (id: string, patch: Partial<RecurringInvoice>) => void;
  dueRecurring: () => RecurringInvoice[];
  runRecurring: (id: string) => Sale | null;

  // Shifts — reference SHEETS.openShift 7233 / closeShift 7262
  openShift: (openingFloat: number, till?: string) => void;
  closeShift: (shiftId: string, countedCash: number, note?: string) => void;
  activeShift: () => DB['shifts'][number] | undefined;
  shiftTotals: (s: Shift) => logic.ShiftTotals;
  lastClosedShift: () => Shift | undefined;

  // Roles & permissions — reference SCREENS.roles 7613 / roleEdit 7677
  roles: () => RoleDef[];
  role: (id: string | undefined) => RoleDef | undefined;
  can: (key: string | null | undefined) => boolean;
  saveRole: (r: { id?: string | null; name: string; description: string; perms: Record<string, boolean> }) => RoleDef | null;
  duplicateRole: (id: string) => RoleDef | null;
  removeRole: (id: string) => boolean;
  usersOn: (roleId: string) => DB['users'];
  canRemoveUser: (userId: string, patch: { role?: string; active?: boolean }) => boolean;

  // Document numbers, units & categories
  setDocNumbering: (patch: Partial<Record<NumberingKey, string>>) => void;
  addUnit: (u: string) => void;
  removeUnit: (u: string) => void;
  addCategory: (c: string) => void;
  removeCategory: (c: string) => void;

  // Multi-firm
  addFirm: (f: Omit<Firm, 'id'>) => Firm;
  switchFirm: (firmId: string) => void;

  // Branches
  addWarehouse: (w: { name: string; address?: string; phone?: string }) => void;
  /** Opens a branch as a business of its own — see logic.openBranch. */
  openBranch: (plan: import('./logic').BranchPlan) => import('./logic').BranchOpened;
  updateWarehouse: (id: string, patch: Partial<import('./types').Warehouse>) => void;
  removeWarehouse: (id: string) => { ok: boolean; why: string };

  // Chart of accounts & manual journals
  addLedger: (l: { code: string; name: string; type: import('./coa').LedgerType; note?: string }) => void;
  updateLedger: (id: string, patch: Partial<import('./coa').Ledger>) => void;
  postJournal: (o: { memo: string; ref?: string; ts?: string; lines: JournalLine[]; userId?: string }) => boolean;

  // Audit log
  logAudit: (action: string, details?: string) => void;

  // --- Editing and deleting posted documents ---
  canEditSale: (id: string) => { ok: boolean; why: string };
  canEditPurchase: (id: string) => { ok: boolean; why: string };
  canEditPayment: (id: string) => { ok: boolean; why: string };
  editSale: (saleId: string, o: { lines: SaleLine[]; partyId: string | null; discount: number; ref?: string; note?: string }, reason?: string) => Sale | null;
  deleteSale: (saleId: string, reason?: string) => boolean;
  editPurchase: (purchaseId: string, o: { partyId: string; lines: PurchaseLine[]; method: PayMethod; ref?: string; note?: string }, reason?: string) => Purchase | null;
  deletePurchase: (purchaseId: string, reason?: string) => boolean;
  editPayment: (payId: string, patch: { amount: number; accountId?: string; note?: string }) => Payment | null;
  deletePayment: (payId: string, reason?: string) => boolean;

  // Offline queue
  toggleOnline: () => void;

  // --- Instalment plans (reference SCREENS.instalments 11919 / planDetail 11869) ---
  createInstalmentPlan: (o: {
    lines: SaleLine[]; partyId: string; discount?: number; down?: number;
    count?: number; every?: number; startIn?: number; note?: string;
  }) => InstalmentPlan | null;
  payInstalment: (planId: string, index: number, accountId?: string) => boolean;

  // --- Printing (reference SCREENS.printer 19701) ---
  setPrinter: (patch: Partial<PrinterSettings>) => void;
  addPrinter: (p: Omit<Printer, 'id'>) => Printer;
  updatePrinter: (id: string, patch: Partial<Printer>) => void;
  removePrinter: (id: string) => void;
  makeDefaultPrinter: (id: string) => void;
  defaultPrinter: () => Printer | undefined;
  setPrintServer: (patch: Partial<PrintServer>) => void;
  updateTemplate: (id: string, patch: Partial<PrintTemplate>) => void;
  setTemplateFor: (kind: DocKind, templateId: string) => void;
  templateFor: (kind: DocKind) => PrintTemplate | undefined;

  // --- Bulk changes (reference SCREENS.bulkPreview 17285) ---
  applyBulkPlan: (plan: logic.BulkPlan) => number;

  // --- Licence / subscription / sync / updates / versions ---
  isPro: () => boolean;
  licState: () => ReturnType<typeof logic.licState>;
  licBlocks: () => boolean;
  /** Fetches the licence from the account server and stores what it says. */
  refreshLicence: (access: string, accountId?: string) => Promise<import('./types').LicStatus>;
  licFeature: (f: string) => boolean;
  deviceLimit: () => number;
  setSubscription: (patch: Partial<Subscription>) => void;
  setLicence: (patch: Partial<Licence>) => void;
  setSync: (patch: Partial<SyncCfg>) => void;
  /** Drops queue entries the server has confirmed it holds. */
  dropQueued: (ids: string[]) => void;
  applyRemoteOps: (ops: StoredOp[]) => number;
  setUpdateCfg: (patch: Partial<UpdateCfg>) => void;
  setNumbering: (mode: 'auto' | 'tag' | 'plain') => void;
  revisionsFor: (id: string) => Revision[];
}

const AppDataCtx = createContext<Ctx | null>(null);

const stockOfImpl = logic.stockOfImpl;
const saleTotals = logic.saleTotals;

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const [db, setDb] = useState<DB | null>(null);
  const [ready, setReady] = useState(false);
  const dbRef = useRef<DB | null>(null);

  useEffect(() => {
    (async () => {
      let d = await loadDB();
      if (!d) {
        d = seed();
        d.onboarded = false;
        await saveDB(d);
      }
      ensureRoles(d);
      setRoleRegistry(d.roles);
      setCostHidden(d.settings?.hideCostFromCashier !== false);
      dbRef.current = d;
      setDb(d);
      setReady(true);
    })();
  }, []);

  /**
   * What the network actually says, not what the book was last told.
   *
   * Kept in a ref as well as on the session because the guard runs inside a
   * commit, where reading React state would give whatever was rendered rather
   * than what is true now.
   */
  const onlineRef = useRef(true);
  const commitRef = useRef<((mut: (d: DB) => void) => void) | null>(null);

  useEffect(() => {
    const sub = NetInfo.addEventListener((state) => {
      const up = state.isConnected !== false && state.isInternetReachable !== false;
      if (up === onlineRef.current) return;
      onlineRef.current = up;
      const d = dbRef.current;
      if (!d || d.session.online === up) return;
      commitRef.current?.((db2) => { db2.session.online = up; });
    });
    NetInfo.fetch().then((state) => {
      onlineRef.current = state.isConnected !== false && state.isInternetReachable !== false;
    });
    return () => sub();
  }, []);

  const commit = useCallback((mut: (d: DB) => void) => {
    const d = dbRef.current;
    if (!d) return;
    mut(d);
    setRoleRegistry(d.roles);
    const next = { ...d };
    dbRef.current = next;
    setDb(next);
    // coalesced: a burst of commits becomes one write of the finished book
    scheduleSave(next);
  }, []);

  // A debounced write must not outlive the app. Anything outstanding is
  // written the moment the user leaves, so nothing is lost to a swipe away.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void flushSave();
    });
    return () => sub.remove();
  }, []);

  /**
   * Stops a transaction before it is written, and says why.
   *
   * Thrown rather than returned so that no caller can forget to check: every
   * screen that posts already shows a thrown message to the operator.
   */
  const requireRecordable = useCallback(() => {
    const d = dbRef.current;
    if (!d) return;
    const refusal = mayRecord(d, onlineRef.current);
    if (refusal) throw new Refusal(refusal.title, refusal.why);
  }, []);

  /**
   * Refuses an action the signed-in role does not allow.
   *
   * The screens are guarded too (RouteGuard), but a screen someone may open can
   * still hold a button they may not press — Void on a bill they can see — so
   * the action that writes asks again. The owner always passes.
   */
  const requirePerm = useCallback((key: string) => {
    const d = dbRef.current;
    if (!d) return;
    if (!canWith(d.roles, d.session.role, key)) throw new Refusal('Not allowed for your role', refusalFor(key));
  }, []);

  commitRef.current = commit;

  const { journal, move, audit, enqueue } = logic;

  const apiRef = useRef<Ctx | null>(null);

  const api = useMemo<Ctx>(() => ({
    db, ready,
    cur: () => dbRef.current?.settings.currency || 'Sh',
    // Settings → Currency: the symbol, whether it goes before or after, and decimals.
    money: (n: number) => {
      const st = dbRef.current?.settings;
      const places = Math.max(0, Math.min(3, Number(st?.decimals) || 0));
      const v = (n || 0).toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places });
      const sym = st?.currency || 'Sh';
      return st?.symbolBefore === false ? v + ' ' + sym : sym + ' ' + v;
    },
    stockOf: stockOfImpl,
    product: (id) => dbRef.current?.products.find((p) => p.id === id),
    party: (id) => dbRef.current?.parties.find((p) => p.id === id),
    user: (id) => dbRef.current?.users.find((u) => u.id === id),
    account: (id) => dbRef.current?.accounts.find((a) => a.id === id),
    me: () => dbRef.current?.users.find((u) => u.id === dbRef.current!.session.userId),
    partyBalance: (id) => { const d = dbRef.current; return d ? logic.partyBalance(d, id) : 0; },
    /**
     * What an account holds, in the branch being worked in.
     *
     * A branch runs as its own business, so the drawer figure on one branch's
     * dashboard must not include what another branch took. Passing a branch
     * explicitly — or null for every branch — is what the cross-branch
     * analysis uses.
     */
    accountBalance: (id, branch) => {
      const d = dbRef.current; if (!d) return 0;
      const want = branch === undefined ? activeBranchId(d) : branch;
      let b = 0;
      branchJournal(d, want).forEach((e) => e.lines.forEach((l) => {
        if (l.acc === id) b += (l.dr || 0) - (l.cr || 0);
      }));
      return b;
    },
    login: (userId, pin) => {
      const d = dbRef.current; if (!d) return false;
      const u = d.users.find((x) => x.id === userId);
      if (!u || !u.active || !verifyPin(pin, u.pin)) return false;
      commit((db2) => { db2.session.userId = u.id; db2.session.role = u.role; });
      return true;
    },
    logout: () => {},
    /**
     * Makes sure the books on this phone belong to whoever just signed in.
     *
     * Two people using one phone is ordinary in a shop. Without this, signing
     * out and signing in as somebody else would hand the second person the
     * first one's stock, customers and takings.
     *
     * Books with no owner recorded are adopted rather than destroyed: they were
     * made before this existed, and throwing away a real shop's trading to
     * enforce a new rule would be the worse mistake.
     */
    claimBooksFor: (email) => {
      const want = String(email || '').trim().toLowerCase();
      const d = dbRef.current;
      if (!d || !want) return false;
      // The demo shop the app opens on before anyone signs in is never adopted:
      // signing in on a fresh phone used to keep it as the real shop's books.
      // Books made before owners were recorded *are* adopted — they are real.
      const isDemo = d.demo === true || (!d.ownerEmail && d.firm?.name === 'Sample Traders');
      if (!d.ownerEmail && !isDemo) { commit((db2) => { db2.ownerEmail = want; }); return false; }
      if (d.ownerEmail === want) return false;
      const fresh = emptyBook({ ownerEmail: want });
      dbRef.current = fresh;
      setRoleRegistry(fresh.roles);
      setDb(fresh);
      scheduleSave(fresh);
      return true;
    },
    adoptBook: (data, o) => {
      // The copy came from another phone: its queue, its device and whoever was
      // at its till are that phone's, not this one's.
      const d = migrate(JSON.parse(JSON.stringify(data))) as DB;
      const till = dbRef.current?.session.till || d.session.till;
      d.ownerEmail = o.ownerEmail;
      d.demo = false;
      d.onboarded = true;
      d.sync = {
        ...defaultSync(till),
        on: true,
        businessId: o.businessId,
        snapshotVersion: Number(o.snapshotVersion ?? data.sync?.snapshotVersion ?? 0),
        lastPull: new Date().toISOString(),
      };
      d.session = { ...d.session, till, userId: '', role: 'cashier' as any };
      ensureRoles(d);
      dbRef.current = d;
      setRoleRegistry(d.roles);
      setDb(d);
      void flushSave();
      scheduleSave(d);
    },
    restoreBackup: (data) => {
      const restored = migrate(JSON.parse(JSON.stringify(data))) as DB;
      const till = dbRef.current?.session.till || restored.session.till;
      restored.session = { ...restored.session, till };
      restored.demo = false;
      ensureRoles(restored);
      dbRef.current = restored;
      setRoleRegistry(restored.roles);
      setDb(restored);
      void flushSave();
      scheduleSave(restored);
    },
    startFreshBook: (o) => {
      const fresh = emptyBook(o || {});
      dbRef.current = fresh;
      setRoleRegistry(fresh.roles);
      setDb(fresh);
      void flushSave();
      scheduleSave(fresh);
    },
    commitSale: (o) => {
      requireRecordable();
      const d0 = dbRef.current;
      // Settings → "A shift must be open to sell"
      if (d0 && d0.settings.requireShift && !d0.shifts.some((sh) => !sh.closedAt)) {
        throw new Error('No shift is open. Open one from the cash register before selling, or switch off "A shift must be open to sell" in Settings.');
      }
      let sale!: Sale;
      commit((d) => { sale = logic.commitSale(d, o); });
      return sale;
    },
    voidSale: (saleId, reason) => { requireRecordable(); requirePerm('sales.void'); commit((d) => logic.voidSale(d, saleId, reason)); },
    createPurchase: (partyId, lines, method, userId, no, when) => {
      requireRecordable();
      let pu!: Purchase;
      commit((d) => { pu = logic.createPurchase(d, partyId, lines, method, when ? new Date(when) : new Date(), userId, no); });
      return pu;
    },
    recordPayment: (o) => {
      requireRecordable(); requirePerm('finance.create');
      let pay!: Payment;
      commit((d) => { pay = logic.recordPayment(d, o); });
      return pay;
    },
    recordEntry: (o) => {
      requireRecordable(); requirePerm('expenses.create');
      let e!: Entry;
      commit((d) => {
        const when = new Date();
        const sale = o.offsetSaleId ? d.sales.find((x) => x.id === o.offsetSaleId) : undefined;
        // only a bill with a balance can absorb one, and only up to what is left
        const split = sale && o.direction === 'out'
          ? logic.splitExpenseOffset(sale.due, o.amount)
          : { offset: 0, rest: o.amount };
        const offset = split.offset;

        e = {
          id: uid('ent'), ts: iso(when), direction: o.direction, accountId: o.accountId,
          branch: activeBranchId(d),
          category: o.category, amount: o.amount, note: o.note || '',
          userId: o.userId || d.session.userId,
          ...(offset > 0 ? { offsetSaleId: sale!.id } : {}),
        };
        d.entries.push(e);

        const memo = o.category + (o.note ? ' — ' + o.note : '');

        if (offset > 0) {
          // the customer settled it, so the cost is ours but the debt is theirs less
          sale!.due -= offset;
          sale!.paid += offset;
          journal(d, when, memo + ' — against ' + sale!.no, sale!.no, [
            { acc: 'n_expense', dr: offset },
            { acc: 'n_ar', cr: offset },
          ]);
          // anything above the outstanding balance still leaves the drawer
          const rest = split.rest;
          if (rest > 0) {
            journal(d, when, memo, 'EXP', [{ acc: 'n_expense', dr: rest }, { acc: o.accountId, cr: rest }]);
          }
          audit(d, 'Expense offset', memo + ' — ' + Math.round(offset) + ' off ' + sale!.no);
        } else if (o.direction === 'out') {
          journal(d, when, memo, 'EXP', [{ acc: 'n_expense', dr: o.amount }, { acc: o.accountId, cr: o.amount }]);
        } else {
          journal(d, when, memo, 'INC', [{ acc: o.accountId, dr: o.amount }, { acc: 'n_income', cr: o.amount }]);
        }
      });
      return e;
    },
    updateProduct: (id, patch) => {
      requirePerm('inventory.edit');
      commit((d) => {
        const i = d.products.findIndex((p) => p.id === id);
        if (i >= 0) d.products[i] = { ...d.products[i], ...patch };
      });
    },
    adjustStock: (productId, warehouse, count, note, batchNo, userId) => {
      requireRecordable(); requirePerm('inventory.stock_adjustment');
      commit((d) => {
        logic.adjustStock(d, productId, warehouse, count, note || 'Stock adjustment', new Date(), batchNo, userId);
      });
    },
    transferStock: (productId, from, to, qty, note) => {
      requireRecordable(); requirePerm('inventory.transfer');
      commit((d) => {
        logic.transferStock(d, productId, from, to, qty, note || 'Stock transfer');
      });
    },
    addProduct: (p) => {
      requirePerm('inventory.create');
      let np!: Product;
      commit((d) => { np = { ...p, id: uid('prd') }; d.products.push(np); });
      return np;
    },
    updateParty: (id, patch) => commit((d) => {
      const i = d.parties.findIndex((p) => p.id === id);
      if (i >= 0) d.parties[i] = { ...d.parties[i], ...patch };
    }),
    addParty: (p) => {
      requirePerm(p.type === 'supplier' ? 'purchases.create' : 'customers.create');
      let np!: Party;
      commit((d) => { np = { ...p, id: uid('pty') }; d.parties.push(np); });
      return np;
    },
    resetAll: async () => {
      await clearDB();
      const fresh = seed();
      setRoleRegistry(fresh.roles);
      dbRef.current = fresh;
      setDb(fresh);
      await saveDB(fresh);
    },
    startFinancialYear: (when) => {
      let result!: logic.FinancialYearStart;
      commit((d) => { result = logic.startFinancialYear(d, when || new Date()); });
      return result;
    },
    importBankStatement: (accountId, lines) => {
      let result: BankStatementLine[] = [];
      commit((d) => { result = importStatementLines(d, accountId, lines); });
      return result;
    },
    matchBankStatementLine: (lineId, journalId) => {
      let result: BankStatementLine | null = null;
      commit((d) => { result = matchStatementLine(d, lineId, journalId); });
      return result;
    },
    bankReconciliationSummary: (accountId, from, to, closing) => {
      const d = dbRef.current;
      if (!d) return { statementClosing: closing, bookClosing: 0, difference: closing, matched: 0, unmatched: 0, ignored: 0 };
      return summarizeReconciliation(d, accountId, from, to, closing);
    },
    completeBankReconciliation: (accountId, from, to, closing) => {
      let result = false;
      commit((d) => {
        const done = completeReconciliation(d, accountId, from, to, closing, d.session.userId);
        result = !!done;
      });
      return result;
    },
    setOnboarded: (v) => commit((d) => { d.onboarded = v; }),
    setSetting: (patch) => commit((d) => { d.settings = { ...d.settings, ...patch }; }),
    setLoyalty: (patch) => commit((d) => { d.loyaltyRules = { ...d.loyaltyRules, ...patch }; }),
    setWarehouse: (warehouseId) => {
      const w = dbRef.current?.warehouses.find((x) => x.id === warehouseId);
      if (w && w.active === false) throw new Refusal(w.name + ' is disabled', 'A disabled branch cannot be opened by anyone until it is enabled again under Branches.');
      commit((d) => { d.session.warehouse = warehouseId; });
    },

    lockAccountingPeriod: (reason = 'Month-end close') => commit((d) => {
      d.settings.accountingLock = { from: new Date().toISOString(), reason, lockedAt: new Date().toISOString(), approvedBy: d.session.userId };
      audit(d, 'Accounting period locked', reason);
    }),
    unlockAccountingPeriod: () => commit((d) => {
      d.settings.accountingLock = null;
      audit(d, 'Accounting period reopened', 'The book was reopened for posting.');
    }),
    grantBusinessAccess: (userId, businessId, role = 'staff') => commit((d) => {
      const exists = d.businessAccess.find((g) => g.userId === userId && g.businessId === businessId);
      if (exists) { exists.role = role; exists.grantedAt = new Date().toISOString(); exists.grantedBy = d.session.userId; return; }
      d.businessAccess.push({ userId, businessId, role, grantedAt: new Date().toISOString(), grantedBy: d.session.userId });
      audit(d, 'Business access granted', 'User ' + (d.users.find((u) => u.id === userId)?.name || userId) + ' -> ' + businessId);
    }),
    revokeBusinessAccess: (userId, businessId) => commit((d) => {
      d.businessAccess = d.businessAccess.filter((g) => !(g.userId === userId && g.businessId === businessId));
      audit(d, 'Business access revoked', 'User ' + (d.users.find((u) => u.id === userId)?.name || userId) + ' removed from ' + businessId);
    }),
    updateFirm: (patch) => commit((d) => {
      d.firm = { ...d.firm, ...patch };
      const i = d.firms.findIndex((f) => f.id === d.firm.id);
      if (i >= 0) d.firms[i] = d.firm;
    }),
    updateUser: (id, patch) => commit((d) => {
      const i = d.users.findIndex((u) => u.id === id);
      if (i < 0) return;
      // a caller always hands over the PIN someone just typed, never a hash
      if (patch.pin !== undefined) patch = { ...patch, pin: hashPin(patch.pin) };
      // never let the last full administrator be demoted or switched off
      if (patch.role !== undefined || patch.active !== undefined) {
        const rs = ensureRoles(d);
        const left = d.users.filter((u) => {
          const role = u.id === id && patch.role !== undefined ? patch.role : u.role;
          const active = u.id === id && patch.active !== undefined ? patch.active : u.active;
          return active && canWith(rs, role, 'profiles.manage') && canWith(rs, role, 'settings.manage');
        });
        if (!left.length) return;
      }
      d.users[i] = { ...d.users[i], ...patch };
      if (d.session.userId === id && patch.role) d.session.role = d.users[i].role;
      audit(d, 'User/role updated', d.users[i].name);
    }),
    addUser: (u) => {
      let nu!: User;
      commit((d) => { nu = { ...u, id: uid('usr'), pin: hashPin(u.pin) }; d.users.push(nu); audit(d, 'User added', nu.name + ' (' + nu.role + ')'); });
      return nu;
    },

    // --- Estimates ---
    createEstimate: (o) => {
      let est!: Estimate;
      commit((d) => {
        d.counters.estimate += 1;
        const t = saleTotals(o.lines, o.discount, logic.pricesIncludeTax(d));
        est = { id: uid('est'), no: 'EST-' + String(100000 + d.counters.estimate).slice(1), ts: iso(new Date()), partyId: o.partyId, lines: o.lines, discount: t.discount, total: t.total, status: 'open', convertedSaleId: null };
        d.estimates.push(est);
        audit(d, 'Estimate created', est.no);
      });
      return est;
    },
    convertEstimate: (estimateId, method) => {
      const d = dbRef.current!;
      const est = d.estimates.find((e) => e.id === estimateId);
      if (!est || est.status !== 'open') return null;
      const sale = apiRef.current!.commitSale({ lines: est.lines, partyId: est.partyId, method, discount: est.discount });
      commit((d2) => {
        const e2 = d2.estimates.find((e) => e.id === estimateId);
        if (e2) { e2.status = 'converted'; e2.convertedSaleId = sale.id; }
        audit(d2, 'Estimate converted', est.no + ' -> ' + sale.no);
      });
      return sale;
    },
    voidEstimate: (estimateId) => commit((d) => {
      const e = d.estimates.find((x) => x.id === estimateId);
      if (e && e.status === 'open') { e.status = 'void'; audit(d, 'Estimate voided', e.no); }
    }),

    // --- Delivery challans ---
    createChallan: (o) => {
      let ch!: Challan;
      commit((d) => {
        d.counters.challan += 1;
        ch = { id: uid('chl'), no: 'DC-' + String(100000 + d.counters.challan).slice(1), ts: iso(new Date()), saleId: o.saleId, partyId: o.partyId, lines: o.lines, status: 'dispatched' };
        d.challans.push(ch);
        audit(d, 'Delivery challan created', ch.no);
      });
      return ch;
    },
    markChallanDelivered: (challanId) => commit((d) => {
      const c = d.challans.find((x) => x.id === challanId);
      if (c) { c.status = 'delivered'; audit(d, 'Challan delivered', c.no); }
    }),

    // --- Credit notes / returns ---
    createCreditNote: (o) => {
      requireRecordable(); requirePerm('sales.refund');
      let cn!: CreditNote;
      commit((d) => {
        d.counters.creditNote += 1;
        const when = new Date();
        const gross = o.lines.reduce((s, l) => s + l.qty * l.price, 0);
        const charges = Math.max(0, Math.min(Number(o.charges) || 0, gross));
        // the customer is made good for the goods less whatever is withheld
        const total = gross - charges;
        const refund = o.refund || (o.partyId ? 'account' : 'cash');
        cn = {
          id: uid('crn'), no: 'CN-' + String(100000 + d.counters.creditNote).slice(1), ts: iso(when),
          saleId: o.saleId, partyId: o.partyId, lines: o.lines, total, reason: o.reason,
          refund, charges, userId: o.userId || d.session.userId,
        };
        d.creditNotes.push(cn);
        const wh = d.session.warehouse || 'w1';
        o.lines.forEach((l) => move(d, l.productId, wh, l.qty, 'return', cn.no, when));
        const cost = o.lines.reduce((s, l) => s + l.qty * (l.cost || 0), 0);
        // sales are reversed by the full value of the goods; the charge is income kept
        const jl: JournalLine[] = [{ acc: 'n_sales', dr: gross }];
        if (charges > 0) jl.push({ acc: 'n_income', cr: charges });
        const back = refund === 'account' ? 'n_ar'
          : refund === 'bank' ? 'acc_bank'
            : refund === 'momo' ? 'acc_momo' : 'acc_cash';
        jl.push({ acc: back, cr: total });
        journal(d, when, 'Credit note ' + cn.no, cn.no, jl);
        if (cost > 0) journal(d, when, 'Return to stock ' + cn.no, cn.no, [{ acc: 'n_inventory', dr: cost }, { acc: 'n_cogs', cr: cost }]);
        if (o.partyId && !o.saleId) {
          // no linked sale due to reduce; adjust the party's opening balance instead so the ledger reflects the credit
          const pt = d.parties.find((p) => p.id === o.partyId);
          if (pt) pt.openingBalance -= total;
        } else if (o.saleId) {
          const s = d.sales.find((x) => x.id === o.saleId);
          if (s && s.due > 0) { const take = Math.min(s.due, total); s.due -= take; }
        }
        audit(
          d,
          'Credit note issued',
          cn.no + ' — ' + Math.round(total) + (charges ? ' (charge ' + Math.round(charges) + ')' : '')
            + ' by ' + (d.users.find((u) => u.id === cn.userId)?.name || 'unknown'),
        );
      });
      return cn;
    },

    // --- Offers ---
    addOffer: (o) => { let no!: Offer; commit((d) => { no = { ...o, id: uid('off') }; d.offers.push(no); audit(d, 'Offer created', no.name); }); return no; },
    updateOffer: (id, patch) => commit((d) => { const i = d.offers.findIndex((o) => o.id === id); if (i >= 0) d.offers[i] = { ...d.offers[i], ...patch }; }),
    removeOffer: (id) => commit((d) => { d.offers = d.offers.filter((o) => o.id !== id); }),
    activeOffers: () => {
      const d = dbRef.current; if (!d) return [];
      const now = Date.now();
      return d.offers.filter((o) => o.active && (!o.from || new Date(o.from).getTime() <= now) && (!o.to || new Date(o.to).getTime() >= now));
    },
    bestOfferFor: (p) => {
      const offs = apiRef.current!.activeOffers().filter((o: Offer) => o.scope === 'all' || (o.scope === 'product' && o.target === p.id) || (o.scope === 'category' && o.target === p.category));
      if (!offs.length) return null;
      const discFor = (o: Offer) => o.kind === 'percent' ? p.price * (o.value / 100) : o.value;
      return offs.sort((a: Offer, b: Offer) => discFor(b) - discFor(a))[0];
    },

    // --- Stock-takes ---
    startStockTake: (warehouse) => {
      let st!: StockTake;
      commit((d) => {
        const lines = d.products.filter((p) => p.active).map((p) => ({
          productId: p.id,
          name: p.name,
          expected: p.stock[warehouse] || 0,
          counted: null as number | null,
          ...(p.trackBatches && (p.batches || []).length
            ? {
              batches: (p.batches || []).map((b) => ({
                no: b.no, expiry: b.expiry, expected: b.qty, counted: null as number | null,
              })),
            }
            : {}),
        }));
        st = { id: uid('stk'), ts: iso(new Date()), warehouse, lines, status: 'open' };
        d.stockTakes.push(st);
        audit(d, 'Stock-take started', warehouse);
      });
      return st;
    },
    setStockTakeCount: (stockTakeId, productId, counted) => commit((d) => {
      const st = d.stockTakes.find((x) => x.id === stockTakeId);
      const line = st?.lines.find((l) => l.productId === productId);
      if (line) line.counted = counted;
    }),
    setStockTakeBatchCount: (stockTakeId, productId, batchNo, counted) => commit((d) => {
      const st = d.stockTakes.find((x) => x.id === stockTakeId);
      const line = st?.lines.find((l) => l.productId === productId);
      const batch = line?.batches?.find((b) => b.no === batchNo);
      if (!line || !batch) return;
      batch.counted = counted;
      // the line total is whatever the batches add up to once any of them is counted
      const seen = line.batches!.filter((b) => b.counted != null);
      line.counted = seen.length ? line.batches!.reduce((s, b) => s + (b.counted ?? 0), 0) : null;
    }),
    postStockTake: (stockTakeId, userId) => { requireRecordable(); requirePerm('inventory.stock_take'); commit((d) => logic.postStockTake(d, stockTakeId, new Date(), userId)); },

    // --- Purchase orders ---
    createPurchaseOrder: (o) => {
      let po!: PurchaseOrder;
      commit((d) => {
        d.counters.po += 1;
        po = { id: uid('po'), no: 'PO-' + String(100000 + d.counters.po).slice(1), ts: iso(new Date()), partyId: o.partyId, lines: o.lines, status: 'open', receivedPurchaseId: null };
        d.purchaseOrders.push(po);
        audit(d, 'Purchase order created', po.no);
      });
      return po;
    },
    receivePurchaseOrder: (poId, method) => {
      const d = dbRef.current!;
      const po = d.purchaseOrders.find((x) => x.id === poId);
      if (!po || po.status !== 'open') return null;
      const purchase = apiRef.current!.createPurchase(po.partyId, po.lines.map((l) => ({ productId: l.productId, qty: l.qty, cost: l.cost })), method);
      commit((d2) => {
        const p2 = d2.purchaseOrders.find((x) => x.id === poId);
        if (p2) { p2.status = 'received'; p2.receivedPurchaseId = purchase.id; }
        audit(d2, 'Purchase order received', po.no + ' -> ' + purchase.no);
      });
      return purchase;
    },

    // --- Production runs (BOM assembly) ---
    runProduction: (productId, qty) => {
      requireRecordable(); requirePerm('inventory.create');
      let run: ProductionRun | null = null;
      commit((d) => { run = logic.runProduction(d, productId, qty); });
      return run;
    },

    // --- Recurring invoices ---
    scheduleRecurring: (o) => {
      let ri!: RecurringInvoice;
      commit((d) => {
        const next = new Date();
        if (o.frequency === 'weekly') next.setDate(next.getDate() + 7); else next.setMonth(next.getMonth() + 1);
        ri = { id: uid('rec'), partyId: o.partyId, lines: o.lines, discount: o.discount, frequency: o.frequency, nextDue: iso(next), lastRun: null, active: true };
        d.recurringInvoices.push(ri);
        audit(d, 'Recurring invoice scheduled', o.frequency);
      });
      return ri;
    },
    updateRecurring: (id, patch) => commit((d) => {
      const i = d.recurringInvoices.findIndex((r) => r.id === id);
      if (i >= 0) d.recurringInvoices[i] = { ...d.recurringInvoices[i], ...patch };
    }),
    dueRecurring: () => {
      const d = dbRef.current; if (!d) return [];
      return logic.dueRecurring(d);
    },
    runRecurring: (id) => {
      let sale: Sale | null = null;
      commit((d) => { sale = logic.runRecurring(d, id); });
      return sale;
    },

    // --- Shifts ---
    openShift: (openingFloat, till) => commit((d) => { logic.openShiftFor(d, openingFloat, till); }),
    closeShift: (shiftId, countedCash, note) => {
      const d0 = dbRef.current;
      const sh = d0?.shifts.find((x) => x.id === shiftId);
      // your own shift needs "Close a shift"; somebody else's, "See every shift" as well
      requirePerm('shifts.close');
      if (sh && d0 && sh.userId !== d0.session.userId) requirePerm('shifts.view_all');
      commit((d) => { logic.closeShift(d, shiftId, countedCash, note || ''); });
    },
    activeShift: () => dbRef.current?.shifts.find((s) => !s.closedAt && s.userId === dbRef.current!.session.userId),
    shiftTotals: (s) => {
      const d = dbRef.current;
      if (!d) return { count: 0, total: 0, cash: 0, momo: 0, bank: 0, credit: 0, recv: 0, paidOut: 0, expected: s.openingFloat };
      return logic.shiftTotals(d, s);
    },
    lastClosedShift: () => { const d = dbRef.current; return d ? logic.lastClosedShift(d) : undefined; },

    // --- Roles & permissions ---
    roles: () => { const d = dbRef.current; return d ? ensureRoles(d) : builtinRoles(); },
    role: (id) => { const d = dbRef.current; if (!d) return undefined; const rs = ensureRoles(d); return rs.find((r) => r.id === id) || rs[0]; },
    can: (key) => {
      const d = dbRef.current;
      if (!d) return false;
      return canWith(ensureRoles(d), d.session.role, key);
    },
    saveRole: (r) => {
      let out: RoleDef | null = null;
      commit((d) => {
        const rs = ensureRoles(d);
        if (r.id) {
          const ex = rs.find((x) => x.id === r.id);
          if (!ex) return;
          ex.name = r.name; ex.description = r.description;
          // the owner always keeps everything — reference A.permTick, 7725
          if (ex.id !== 'owner') ex.perms = { ...r.perms };
          out = ex;
          audit(d, 'Role updated', ex.name + ' — ' + permCount(ex) + '/' + allPermKeys().length);
        } else {
          const base = r.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 20);
          const id = 'role_' + base + '_' + uid('r').slice(-4);
          out = { id, name: r.name, description: r.description, perms: { ...r.perms }, builtin: false };
          d.roles.push(out);
          audit(d, 'Role created', r.name);
        }
      });
      return out;
    },
    duplicateRole: (id) => {
      let out: RoleDef | null = null;
      commit((d) => {
        const rs = ensureRoles(d);
        const src = rs.find((x) => x.id === id);
        if (!src) return;
        let name = src.name + ' copy';
        let n = 2;
        while (rs.some((x) => x.name === name)) { name = src.name + ' copy ' + n; n += 1; }
        const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 20);
        out = { id: 'role_' + base + '_' + uid('r').slice(-4), name, description: src.description, perms: { ...src.perms }, builtin: false };
        d.roles.push(out);
        audit(d, 'Role duplicated', src.name + ' -> ' + name);
      });
      return out;
    },
    removeRole: (id) => {
      let ok = false;
      commit((d) => {
        const rs = ensureRoles(d);
        const r = rs.find((x) => x.id === id);
        if (!r || r.builtin) return;               // a built-in role stays
        if (d.users.some((u) => u.role === id)) return;  // reference A.deleteRole, 7758
        d.roles = rs.filter((x) => x.id !== id);
        audit(d, 'Role deleted', r.name);
        ok = true;
      });
      return ok;
    },
    usersOn: (roleId) => (dbRef.current?.users || []).filter((u) => u.role === roleId),
    canRemoveUser: (userId, patch) => {
      const d = dbRef.current;
      if (!d) return false;
      const rs = ensureRoles(d);
      const left = d.users.filter((u) => {
        const role = u.id === userId && patch.role !== undefined ? patch.role : u.role;
        const active = u.id === userId && patch.active !== undefined ? patch.active : u.active;
        return active && canWith(rs, role, 'profiles.manage') && canWith(rs, role, 'settings.manage');
      });
      return left.length > 0;
    },

    // --- Document numbers, units & categories ---
    setDocNumbering: (patch) => commit((d) => { d.numbering = { ...d.numbering, ...patch }; }),
    addUnit: (u) => commit((d) => { const v = u.trim(); if (v && d.units.indexOf(v) < 0) d.units.push(v); }),
    removeUnit: (u) => commit((d) => { d.units = d.units.filter((x) => x !== u); }),
    addCategory: (c) => commit((d) => { const v = c.trim(); if (v && d.categories.indexOf(v) < 0) d.categories.push(v); }),
    removeCategory: (c) => commit((d) => { d.categories = d.categories.filter((x) => x !== c); }),

    // --- Multi-firm ---
    addFirm: (f) => {
      let nf!: Firm;
      commit((d) => { nf = { ...f, id: uid('frm'), active: true }; d.firms.push(nf); audit(d, 'Firm added', nf.name); });
      return nf;
    },
    switchFirm: (firmId) => commit((d) => {
      const f = d.firms.find((x) => x.id === firmId);
      if (f && f.active !== false) { d.activeFirmId = f.id; d.firm = f; audit(d, 'Switched firm', f.name); }
    }),

    // --- Correcting and removing posted documents (reference 17496-17790) ---
    canEditSale: (id) => { const d = dbRef.current; return d ? logic.canEditSale(d, id) : { ok: false, why: '' }; },
    canEditPurchase: (id) => { const d = dbRef.current; return d ? logic.canEditPurchase(d, id) : { ok: false, why: '' }; },
    canEditPayment: (id) => { const d = dbRef.current; return d ? logic.canEditPayment(d, id) : { ok: false, why: '' }; },
    editSale: (saleId, o, reason) => {
      requireRecordable();
      let out: Sale | null = null;
      commit((d) => { out = logic.editSale(d, saleId, o, reason); });
      return out;
    },
    deleteSale: (saleId, reason) => { requireRecordable(); let ok = false; commit((d) => { ok = logic.deleteSale(d, saleId, reason); }); return ok; },
    editPurchase: (purchaseId, o, reason) => {
      requireRecordable();
      let out: Purchase | null = null;
      commit((d) => { out = logic.editPurchase(d, purchaseId, o, reason); });
      return out;
    },
    deletePurchase: (purchaseId, reason) => { requireRecordable(); let ok = false; commit((d) => { ok = logic.deletePurchase(d, purchaseId, reason); }); return ok; },
    editPayment: (payId, patch) => {
      requireRecordable();
      let out: Payment | null = null;
      commit((d) => { out = logic.editPayment(d, payId, patch); });
      return out;
    },
    deletePayment: (payId, reason) => { requireRecordable(); let ok = false; commit((d) => { ok = logic.deletePayment(d, payId, reason); }); return ok; },

    // --- Audit log ---
    openBranch: (plan) => {
      requireRecordable(); requirePerm('branches.manage');
      let out!: import('./logic').BranchOpened;
      commit((d) => { out = logic.openBranch(d, plan); });
      return out;
    },
    addWarehouse: (w) => commit((d) => {
      const id = 'wh_' + uid('x').slice(-6);
      d.warehouses.push({ id, name: w.name, address: w.address, phone: w.phone, active: true, openedAt: iso(new Date()) });
      audit(d, 'Branch opened', w.name);
    }),
    updateWarehouse: (id, patch) => commit((d) => {
      const w = d.warehouses.find((x) => x.id === id);
      if (!w) return;
      if (patch.active === false && d.warehouses.filter((x) => x.active !== false && x.id !== id).length === 0) {
        throw new Refusal('This is the only branch trading', 'Enable another branch before disabling this one; the shop needs somewhere to work.');
      }
      Object.assign(w, patch);
      // nobody stays working in a branch that has just been switched off
      if (patch.active === false && d.session.warehouse === id) {
        d.session.warehouse = (d.warehouses.find((x) => x.active !== false && x.id !== id) || d.warehouses[0]).id;
      }
      audit(d, 'Branch changed', w.name + (patch.active === false ? ' — disabled' : patch.active === true ? ' — enabled' : ''));
    }),
    removeWarehouse: (id) => {
      let out = { ok: false, why: '' };
      commit((d) => {
        const w = d.warehouses.find((x) => x.id === id);
        if (!w) { out = { ok: false, why: 'That branch no longer exists.' }; return; }
        if (d.warehouses.length <= 1) { out = { ok: false, why: 'A shop needs at least one branch.' }; return; }
        // Deleting a branch that holds stock or history would orphan both.
        const stock = d.products.reduce((s, p) => s + (p.stock?.[id] || 0), 0);
        if (stock > 0) { out = { ok: false, why: 'It still holds ' + Math.round(stock) + ' units of stock. Move or adjust them first.' }; return; }
        const used = d.sales.some((s) => s.warehouse === id) || d.movements.some((m) => m.wh === id);
        if (used) { out = { ok: false, why: 'It has trading history, so it can be disabled but not deleted.' }; return; }
        d.warehouses = d.warehouses.filter((x) => x.id !== id);
        if (d.session.warehouse === id) d.session.warehouse = d.warehouses[0].id;
        if (d.settings.defaultWarehouse === id) d.settings.defaultWarehouse = d.warehouses[0].id;
        audit(d, 'Branch deleted', w.name);
        out = { ok: true, why: '' };
      });
      return out;
    },
    addLedger: (l) => commit((d) => {
      d.coa = d.coa || [];
      const id = 'led_' + uid('x').slice(-6);
      d.coa.push({ id, code: l.code, name: l.name, type: l.type, note: l.note, builtin: false, active: true });
      d.coa.sort((a, b) => a.code.localeCompare(b.code));
      audit(d, 'Ledger added', l.code + ' ' + l.name);
    }),
    updateLedger: (id, patch) => commit((d) => {
      const l = (d.coa || []).find((x) => x.id === id);
      if (!l) return;
      Object.assign(l, patch);
      audit(d, 'Ledger changed', l.code + ' ' + l.name + (patch.active === false ? ' — deactivated' : ''));
    }),
    postJournal: (o) => {
      requireRecordable(); requirePerm('finance.manage_accounts');
      let ok = false;
      commit((d) => {
        const dr = o.lines.reduce((s, l) => s + (l.dr || 0), 0);
        const cr = o.lines.reduce((s, l) => s + (l.cr || 0), 0);
        // a manual entry that does not balance would corrupt every report built on the journal
        if (!o.lines.length || Math.abs(dr - cr) > 0.01) return;
        journal(d, o.ts ? new Date(o.ts) : new Date(), o.memo, o.ref || 'JNL', o.lines);
        logic.audit(
          d,
          'Journal entry posted',
          o.memo + ' — ' + Math.round(dr)
            + ' by ' + (d.users.find((u) => u.id === (o.userId || d.session.userId))?.name || 'unknown'),
        );
        ok = true;
      });
      return ok;
    },
    logAudit: (action, details) => commit((d) => audit(d, action, details || '')),

    // --- Offline queue ---
    toggleOnline: () => commit((d) => {
      d.session.online = !d.session.online;
      audit(d, d.session.online ? 'Went online' : 'Went offline', '');
      // Coming back online used to call flushQueue(), which marked every
      // waiting sale as sent and emptied the queue without ever contacting
      // the server — the queue is the real outbound buffer for cloud sync
      // now (see syncClient.ts), so that only ever pretended the books were
      // backed up. SyncKeeper already reacts to this flag flipping and
      // starts a real sync; there is nothing for this to do beyond record it.
    }),

    // --- Instalment plans ---
    createInstalmentPlan: (o) => {
      let pl: InstalmentPlan | null = null;
      commit((d) => { pl = logic.createInstalmentPlan(d, o); });
      return pl;
    },
    payInstalment: (planId, index, accountId) => {
      let ok = false;
      commit((d) => { ok = !!logic.payInstalment(d, planId, index, accountId); });
      return ok;
    },

    // --- Printing ---
    setPrinter: (patch) => commit((d) => { d.printer = { ...d.printer, ...patch }; }),
    addPrinter: (p) => {
      let np!: Printer;
      commit((d) => {
        np = { ...p, id: uid('prn') };
        if (np.dflt) d.printers.forEach((x) => { x.dflt = false; });
        d.printers.push(np);
        if (!d.printers.some((x) => x.dflt)) d.printers[0].dflt = true;
        audit(d, 'Printer added', np.name);
      });
      return np;
    },
    updatePrinter: (id, patch) => commit((d) => {
      const i = d.printers.findIndex((p) => p.id === id);
      if (i < 0) return;
      if (patch.dflt) d.printers.forEach((x) => { x.dflt = false; });
      d.printers[i] = { ...d.printers[i], ...patch };
      if (!d.printers.some((x) => x.dflt)) d.printers[0].dflt = true;
    }),
    removePrinter: (id) => commit((d) => {
      if (d.printers.length <= 1) return;   // a till always keeps one printer
      d.printers = d.printers.filter((p) => p.id !== id);
      if (!d.printers.some((x) => x.dflt)) d.printers[0].dflt = true;
    }),
    makeDefaultPrinter: (id) => commit((d) => {
      d.printers.forEach((p) => { p.dflt = p.id === id; });
      const def = d.printers.find((p) => p.dflt);
      // every Print button uses the default — reference the rcPrint wrapper at 19688
      if (def) d.printer = { ...d.printer, device: def.name, width: def.width };
    }),
    defaultPrinter: () => {
      const d = dbRef.current; if (!d) return undefined;
      return d.printers.find((p) => p.dflt) || d.printers[0];
    },
    setPrintServer: (patch) => commit((d) => { d.printServer = { ...d.printServer, ...patch }; }),
    updateTemplate: (id, patch) => commit((d) => {
      const i = d.templates.findIndex((t) => t.id === id);
      if (i >= 0) d.templates[i] = { ...d.templates[i], ...patch };
    }),
    setTemplateFor: (kind, templateId) => commit((d) => { d.templateFor = { ...d.templateFor, [kind]: templateId }; }),
    templateFor: (kind) => {
      const d = dbRef.current; if (!d) return undefined;
      return d.templates.find((t) => t.id === d.templateFor[kind])
        || d.templates.find((t) => t.id === 'tpl_receipt')
        || d.templates[0];
    },

    // --- Bulk changes ---
    applyBulkPlan: (plan) => {
      let n = 0;
      commit((d) => { n = logic.applyBulkPlan(d, plan); });
      return n;
    },

    // --- Licence / subscription / sync / updates / versions ---
    isPro: () => { const d = dbRef.current; return d ? logic.isPro(d) : false; },
    licState: () => { const d = dbRef.current; return d ? logic.licState(d) : 'none'; },
    licBlocks: () => { const d = dbRef.current; return d ? logic.licBlocks(d) : false; },
    /**
     * Asks the server what this account's licence is, and records the answer.
     *
     * The token is verified from its own claims and stored in `DB.licence`, which
     * is what licState() and the record gate already read — so a licence that has
     * run out stops new transactions through the path that was already there,
     * rather than through a second mechanism that could disagree with it.
     *
     * A failure is left alone deliberately. The licence already on the device
     * has its own grace window, and a shop that cannot reach the internet must
     * not be downgraded for it.
     */
    refreshLicence: async (access, accountId) => {
      const r = await fetchLicence(access);
      const d = dbRef.current;
      if (!r.ok) return d ? logic.licState(d) : 'unknown';
      const safe = normaliseLicenceResponse(r.value);
      if (!safe.ok) return d ? logic.licState(d) : 'invalid';
      // a token that does not verify is ignored, never stored — forging one must buy nothing
      if (!(await verifyLicenceSignature(safe.token))) return d ? logic.licState(d) : 'invalid';
      const next = licenceFromToken(safe.token, accountId);
      commit((db2) => { db2.licence = next; });
      return next.status;
    },
    licFeature: (f) => { const d = dbRef.current; return d ? logic.licFeature(d, f) : false; },
    deviceLimit: () => { const d = dbRef.current; return d ? logic.deviceLimit(d) : 1; },
    setSubscription: (patch) => commit((d) => { d.subscription = { ...d.subscription, ...patch }; }),
    setLicence: (patch) => commit((d) => { d.licence = { ...d.licence, ...patch }; }),
    /**
     * Only the owner may turn sync on or off.
     *
     * Switching it on changes where the shop's books live and makes every till
     * dependent on a connection; switching it off strands whatever has not gone
     * up yet. Neither is a decision for whoever happens to be on the counter.
     * Everything else about sync — how often, Wi-Fi only — is left alone.
     */
    setSync: (patch) => {
      const d = dbRef.current;
      if (d && patch.on !== undefined && patch.on !== d.sync.on && d.session.role !== 'owner') {
        throw new Error('Only the owner can turn cloud sync on or off.');
      }
      commit((db2) => {
        const wasOn = db2.sync.on;
        db2.sync = { ...db2.sync, ...patch };
        if (patch.on === true && !wasOn) {
          // Everything recorded while this device was on its own is what now
          // has to go up, so switching on queues the backlog rather than
          // quietly starting from today and leaving the old sales behind.
          logic.queueBacklog(db2);
          audit(db2, 'Cloud sync switched on', logic.backlogSize(db2) + ' record(s) to send up');
        }
        if (patch.on === false && wasOn) {
          audit(db2, 'Cloud sync switched off', db2.queue.length + ' record(s) still waiting');
        }
      });
    },
    // Only ids the server acknowledged are removed; anything it did not confirm stays queued.
    dropQueued: (ids) => commit((d) => { const gone = new Set(ids); d.queue = d.queue.filter((q) => !gone.has(q.id)); }),
    applyRemoteOps: (ops) => {
      let applied = 0;
      commit((d) => {
        const put = (list: any[], value: any) => {
          if (!value?.id) return false;
          const i = list.findIndex((x) => x.id === value.id);
          if (i < 0) list.push(value); else list[i] = value;
          applied++;
          return i < 0;
        };
        ops.forEach((op) => {
          const p: any = op.payload;
          if (op.kind === 'record.upsert') {
            if (p?.coll === 'products') {
              const current = d.products.find((x) => x.id === p.doc?.id);
              put(d.products, current ? { ...current, ...p.doc, stock: current.stock } : p.doc);
            } else if (p?.coll === 'parties') {
              put(d.parties, p.doc);
            }
          } else if (op.kind.startsWith('sale.')) put(d.sales, p);
          else if (op.kind.startsWith('purchase.')) put(d.purchases, p);
          else if (op.kind === 'entry.record') put(d.entries, p);
          else if (op.kind === 'journal.post') put(d.journal, p);
          else if (op.kind === 'stock.move') {
            const fresh = put(d.movements, p);
            const product = d.products.find((x) => x.id === p?.productId);
            if (fresh && product && p.wh) {
              product.stock[p.wh] = (product.stock[p.wh] || 0) + (Number(p.qty) || 0);
              if (p.batchNo && product.batches) {
                const batch = product.batches.find((x) => x.no === p.batchNo);
                if (batch) batch.qty += Number(p.qty) || 0;
              }
            }
          }
          else if (op.kind === 'payment.record') {
            const fresh = put(d.payments, p);
            if (!fresh) return;
            (p?.allocations || []).forEach((a: any) => {
              const sale = d.sales.find((x) => x.id === a.docId);
              if (sale) { sale.due = Math.max(0, sale.due - a.amount); sale.paid += a.amount; return; }
              const purchase = d.purchases.find((x) => x.id === a.docId);
              if (purchase) { purchase.due = Math.max(0, purchase.due - a.amount); purchase.paid += a.amount; }
            });
          }
          else if (op.kind.startsWith('shift.')) put(d.shifts, p);
          else if (op.kind === 'creditnote.create') put(d.creditNotes, p);
        });
      });
      return applied;
    },
    setUpdateCfg: (patch) => commit((d) => { d.update = { ...d.update, ...patch }; }),
    setNumbering: (mode) => commit((d) => { d.numberSafe = { mode }; }),
    revisionsFor: (id) => { const d = dbRef.current; return d ? logic.revisionsFor(d, id) : []; },
  }), [db, ready, commit]);
  apiRef.current = api;

  return <AppDataCtx.Provider value={api}>{children}</AppDataCtx.Provider>;
}

// Like useAppData but returns null instead of throwing when used outside the
// provider (or before it has mounted) — used by useTheme() which must work
// even for components rendered above/without AppDataProvider.
export function useAppDataSafe(): Ctx | null {
  return useContext(AppDataCtx);
}

export function useAppData(): Ctx {
  const ctx = useContext(AppDataCtx);
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider');
  return ctx;
}
