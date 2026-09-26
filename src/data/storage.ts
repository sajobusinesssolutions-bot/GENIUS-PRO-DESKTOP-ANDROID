import AsyncStorage from '@react-native-async-storage/async-storage';
import { DB } from './types';
import {
  defaultPrinterSettings, defaultPrinters, defaultPrintServer, defaultTemplates,
  defaultTemplateFor, defaultSubscription, defaultLicence, defaultSync, defaultUpdate,
  defaultSettings, defaultNumbering, defaultUnits, defaultCategories,
} from './defaults';
import { ensureRoles } from './perms';
import { ensureCoa } from './coa';
import { hashPin, isPinHashed } from './pinHash';

export const KEY = 'genius.pos.v1';
export const PIN_UNLOCK_KEY = 'genius.pos.session.unlocked';

export async function loadDB(): Promise<DB | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (d && d.v === 1 && d.products) return migrate(d) as DB;
    return null;
  } catch {
    return null;
  }
}

// Fills in defaults for fields added after a user's DB was first saved to
// AsyncStorage, so older local data doesn't crash the newer app.
export function migrate(d: any): any {
  d.estimates = d.estimates || [];
  d.challans = d.challans || [];
  d.creditNotes = d.creditNotes || [];
  d.offers = d.offers || [];
  d.stockTakes = d.stockTakes || [];
  d.purchaseOrders = d.purchaseOrders || [];
  d.productionRuns = d.productionRuns || [];
  d.recurringInvoices = d.recurringInvoices || [];
  d.auditLog = d.auditLog || [];
  d.businessAccess = d.businessAccess || [];
  d.bankStatementLines = d.bankStatementLines || [];
  d.bankReconciliations = d.bankReconciliations || [];
  d.archivedFinancialYears = d.archivedFinancialYears || [];
  ensureCoa(d);
  (d.warehouses || []).forEach((w: any) => {
    if (w.active === undefined) w.active = true;
  });
  d.queue = d.queue || [];

  // PINs used to be stored as the raw digits someone typed. A book saved
  // before hashing existed still has them that way; rehash on this one load
  // so every PIN at rest is a salted hash from here on (see pinHash.ts).
  (d.users || []).forEach((u: any) => {
    if (u.pin && !isPinHashed(u.pin)) u.pin = hashPin(u.pin);
  });
  if (!d.firm.id) d.firm.id = 'frm_1';
  d.firms = d.firms && d.firms.length ? d.firms : [d.firm];
  d.activeFirmId = d.activeFirmId || d.firm.id;
  d.counters = { sale: 0, purchase: 0, estimate: 0, challan: 0, creditNote: 0, po: 0, plan: 0, ...d.counters };

  // --- instalment plans ---
  d.instalmentPlans = d.instalmentPlans || [];

  // --- printing (reference ensurePrinting, 19496) ---
  d.printer = { ...defaultPrinterSettings(), ...(d.printer || {}) };
  if (!Array.isArray(d.printers) || !d.printers.length) d.printers = defaultPrinters(d.printer);
  d.printers.forEach((p: any) => { if (p.port == null) p.port = 9100; });
  if (!d.printers.some((p: any) => p.dflt)) d.printers[0].dflt = true;
  d.printServer = { ...defaultPrintServer(), ...(d.printServer || {}) };
  if (!Array.isArray(d.templates) || !d.templates.length) d.templates = defaultTemplates();
  d.templateFor = { ...defaultTemplateFor(), ...(d.templateFor || {}) };

  // --- licence, subscription, sync, updates, versions ---
  d.subscription = { ...defaultSubscription(), ...(d.subscription || {}) };
  d.licence = { ...defaultLicence(), ...(d.licence || {}) };
  d.sync = { ...defaultSync(d.session?.till || 'Till 1'), ...(d.sync || {}) };
  d.update = { ...defaultUpdate(), ...(d.update || {}) };
  // --- settings, roles, numbering, units & categories ---
  d.settings = { ...defaultSettings(), ...(d.settings || {}) };
  if (!d.settings.defaultWarehouse) d.settings.defaultWarehouse = (d.warehouses && d.warehouses[0] && d.warehouses[0].id) || 'w1';
  ensureRoles(d);
  d.numbering = { ...defaultNumbering(), ...(d.numbering || {}) };
  d.units = (Array.isArray(d.units) && d.units.length) ? d.units : defaultUnits();
  d.categories = (Array.isArray(d.categories) && d.categories.length) ? d.categories : defaultCategories();
  (d.products || []).forEach((p: any) => {
    if (!p.kind) p.kind = 'product';
    if (!Array.isArray(p.barcodes)) p.barcodes = [];
    if (p.trackInventory === undefined) p.trackInventory = true;
    if (d.units.indexOf(p.unit) < 0) d.units.push(p.unit);
    if (p.category && d.categories.indexOf(p.category) < 0) d.categories.push(p.category);
  });
  d.numberSafe = d.numberSafe || { mode: 'auto' };

  // "Prices already include tax" used to be ignored: tax was always taken out
  // of the price, whatever the switch said, and the switch defaulted to off.
  // Now that it is honoured, every existing book is set to what it has really
  // been doing, once — or every shop's totals would jump by the tax rate.
  if (!d.settings.taxModeFixed) {
    d.settings.pricesIncludeTax = true;
    d.settings.taxModeFixed = true;
  }
  d.revisions = d.revisions || [];

  // --- branches keep their own books ---
  // A branch is run as a separate business, so everything carrying money now
  // says which branch it belongs to. A book written before that has no stamp;
  // all of it was rung up at the first branch, so that is where it is filed.
  // Records made since keep whatever stamp they already have.
  const first = (d.warehouses && d.warehouses[0] && d.warehouses[0].id) || d.settings.defaultWarehouse;
  if (first) {
    const stamp = (list: any[]) => (list || []).forEach((r: any) => { if (!r.branch) r.branch = first; });
    stamp(d.journal);
    stamp(d.entries);
    stamp(d.payments);
    stamp(d.purchases);
    stamp(d.shifts);
    // Accounts are left unstamped on purpose: an account that predates
    // branches was the whole firm's, and branchAccounts() treats an
    // unstamped account as shared rather than hiding it from everybody.
  }

  return d;
}

export async function saveDB(db: DB): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    // storage full / unavailable — app still works for this session
  }
}

export function validateBackup(raw: string): { ok: boolean; reason: string; db?: DB } {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== 1 || !parsed.firm || !Array.isArray(parsed.products)
      || !Array.isArray(parsed.sales) || !Array.isArray(parsed.journal)) {
      return { ok: false, reason: 'This file is not a complete Genius POS backup.' };
    }
    return { ok: true, reason: '', db: migrate(parsed) as DB };
  } catch {
    return { ok: false, reason: 'The backup file is damaged or is not JSON.' };
  }
}

/* ------------------------------------------------------------------
   Coalesced saving.

   The whole book lives under one key, so every commit used to stringify
   and rewrite all of it. Typing a customer name, stepping a quantity or
   dragging a slider each fired a full serialisation, which is what makes
   a long cart feel heavy on a cheap phone. Worse, two writes could be in
   flight at once with no guarantee the later one landed last.

   Writes are therefore debounced into one, and only one runs at a time —
   anything asked for while a write is in flight is folded into the next.
   Nothing is ever dropped: the most recent book always gets written.
   ------------------------------------------------------------------ */

const SAVE_DELAY = 400;

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: DB | null = null;
let writing = false;

async function drain(): Promise<void> {
  if (writing) return;
  writing = true;
  try {
    while (pending) {
      const next = pending;
      pending = null;
      await saveDB(next);
    }
  } finally {
    writing = false;
  }
}

/** Queues the book to be written shortly. Returns at once. */
export function scheduleSave(db: DB): void {
  pending = db;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void drain(); }, SAVE_DELAY);
}

/**
 * Writes anything outstanding now and waits for it. Called when the app goes
 * to the background or is about to close, so a debounce never costs the user
 * the last thing they did.
 */
export async function flushSave(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null; }
  await drain();
}

/** True when something is still waiting to be written. For tests and status. */
export function saveIsPending(): boolean {
  return pending !== null || writing || timer !== null;
}

export async function clearDB(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {}
}
