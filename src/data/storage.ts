import AsyncStorage from '@react-native-async-storage/async-storage';
import { DB } from './types';
import {
  defaultPrinterSettings, defaultPrinters, defaultPrintServer, defaultTemplates,
  defaultTemplateFor, defaultSubscription, defaultLicence, defaultSync, defaultUpdate,
  defaultSettings, defaultNumbering, defaultUnits, defaultCategories,
} from './defaults';
import { ensureRoles } from './perms';
import { ensureCoa } from './coa';
import { reconcileBatches } from './batches';
import { hashPin, isPinHashed } from './pinHash';
import { hasBook, loadBook, writeBook, clearBook, storeSet, noteChanges, COLLS, sqliteAvailable, readFullBook, faultIn, olderRows, countOlder, storeGet } from './store/bookstore';
import { tracked } from './store/track';

export const KEY = 'genius.pos.v1';
export const PIN_UNLOCK_KEY = 'genius.pos.session.unlocked';

/* ------------------------------------------------------------------
   Where the book lives.

   The book used to be one JSON string under `genius.pos.v1` in AsyncStorage.
   Android cannot read a value back past ~2 MB and holds 6 MB in all by
   default, which a busy shop reached within days. It now lives in SQLite,
   one row per record (store/bookstore.ts), and a save writes what changed.

   The first launch after this update moves the old book across once, reads
   it back and compares every part before trusting it. If anything differs
   the phone stays on the old storage, exactly as before — nothing is lost.
   The old key is left in place as a rollback copy and is no longer written.
   ------------------------------------------------------------------ */

/** 'sqlite' once the book is in SQLite; 'legacy' if moving it failed and the old storage is still in use. */
let engine: 'sqlite' | 'legacy' = 'sqlite';
/** The old book exists but Android could not read it back (too large). */
let legacyUnreadable = false;

export function storageEngine(): 'sqlite' | 'legacy' { return engine; }

/* Phase 2 (docs/STORAGE_SQLITE_PLAN.md): how many days of sales, purchases,
   payments, cash entries, journal and stock moves to hold in memory. 0 holds
   everything, as before. It stays 0 until every screen that reaches further
   back reads from history() instead of the in-memory book. */
let windowDays = 0;
/** For tests; the shop's choice is saved with saveMemoryWindowDays. Takes effect on the next load. */
export function setMemoryWindowDays(days: number): void { windowDays = Math.max(0, Math.floor(days || 0)); }
const WINDOW_KEY = 'memoryWindowDays';
/** The shop's choice, kept with the books; 0 = everything in memory. Takes effect on the next start. */
export async function saveMemoryWindowDays(days: number): Promise<void> {
  setMemoryWindowDays(days);
  await storeSet(WINDOW_KEY, String(windowDays));
}
export async function savedMemoryWindowDays(): Promise<number> {
  try { return Math.max(0, Number(await storeGet(WINDOW_KEY)) || 0); } catch { return 0; }
}
const sinceDay = (): string | undefined => {
  if (!windowDays) return undefined;
  const d = new Date(Date.now() - windowDays * 86400000);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

/** yyyy-mm-dd in local time, as the store files records. */
const dayOfMs = (ms: number): string => {
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

/** Whether a report starting at `fromMs` (0 = all time) reaches before what the book holds in memory. */
export function needsOlder(d: DB | null, fromMs: number): boolean {
  const w = d && (d as { __window?: { sinceDay?: string } }).__window;
  if (!w || !w.sinceDay) return false;
  return !fromMs || dayOfMs(fromMs) < w.sinceDay;
}

/**
 * The book a report from `fromMs` needs. Usually the one in memory. When the
 * range starts before the window, a separate book is read from disk starting
 * that day, with everything earlier brought forward the same way — exact, and
 * only as large as the range asked for. Nothing in it is ever saved.
 */
export async function bookForRange(d: DB, fromMs: number): Promise<DB> {
  if (!needsOlder(d, fromMs)) return d;
  await flushSave();
  const b = await loadBook({ sinceDay: fromMs ? dayOfMs(fromMs) : undefined, detached: true });
  if (!b) return d;
  return migrate(b) as DB;
}

/**
 * Makes sure these records are in the live book before a screen opens one or a
 * change is made to it. With the whole book in memory this does nothing.
 * Returns how many had to be read from disk.
 */
export async function ensureLoaded(d: DB, coll: string, ids: string[]): Promise<number> {
  if (!isPartialBook(d) || engine !== 'sqlite') return 0;
  return faultIn(d as unknown as Record<string, unknown>, coll, ids);
}

const windowDay = (d: unknown): string | undefined => (d as { __window?: { sinceDay?: string } } | null)?.__window?.sinceDay;
/** Records of `coll` a windowed book left on disk (none when the whole book is in memory). */
export async function rowsOnDisk<T>(d: DB | null, coll: string, q: { item?: string; eq?: Record<string, string> } = {}): Promise<T[]> {
  const since = windowDay(d);
  return since && engine === 'sqlite' ? olderRows<T>(coll, since, q) : [];
}
/** How many of those, without reading them. */
export async function countOnDisk(d: DB | null, coll: string, q: { eq?: Record<string, string>; notEq?: Record<string, string> } = {}): Promise<number> {
  const since = windowDay(d);
  return since && engine === 'sqlite' ? countOlder(coll, since, q) : 0;
}

/** True for a book loaded with a window: it is not the whole book. */
export function isPartialBook(d: unknown): boolean { return !!(d && (d as { __window?: unknown }).__window); }

/**
 * The whole book, for a backup or a cloud snapshot. With no window it is the
 * book in memory; with one, it is read from disk after the pending save lands.
 */
export async function wholeBook(d: DB): Promise<DB> {
  if (!isPartialBook(d)) return d;
  await flushSave();
  const full = await readFullBook();
  if (!full) throw new Error('The books could not be read for a backup.');
  return migrate(full) as DB;
}
export function oldBookUnreadable(): boolean { return legacyUnreadable; }

/**
 * Runs a change on the book with record tracking on, so the next save writes
 * only what this change touched. AppDataContext's commit() calls this.
 */
export function trackedChange<T extends object>(d: T, mut: (d: T) => void): void {
  tracked(d, COLLS, mut, noteChanges);
}

const sameParts = (a: Record<string, unknown>, b: Record<string, unknown>): string | null => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (a[k] === undefined && b[k] === undefined) continue;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return k;
  }
  return null;
};

async function readLegacy(): Promise<{ raw: string | null; unreadable: boolean }> {
  try {
    return { raw: await AsyncStorage.getItem(KEY), unreadable: false };
  } catch {
    /* "Row too big to fit into CursorWindow": the book is there but too big to read. */
    try {
      const keys = await AsyncStorage.getAllKeys();
      return { raw: null, unreadable: keys.includes(KEY) };
    } catch {
      return { raw: null, unreadable: false };
    }
  }
}

export async function loadDB(): Promise<DB | null> {
  /* Every load decides afresh; a previous failure must not stick. */
  engine = 'sqlite';
  legacyUnreadable = false;
  try {
    if (await hasBook()) {
      engine = 'sqlite';
      const saved = await storeGet(WINDOW_KEY);
      if (saved !== null) setMemoryWindowDays(Number(saved));
      const b = await loadBook({ sinceDay: sinceDay() });
      if (b && b.v === 1 && b.products) return migrate(b) as DB;
      return null;
    }
  } catch {
    /* SQLite would not open at all: carry on with the old storage. */
    engine = 'legacy';
  }
  const { raw, unreadable } = await readLegacy();
  legacyUnreadable = unreadable;
  if (!raw) return null;
  let d: DB | null = null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.v === 1 && parsed.products) d = migrate(parsed) as DB;
  } catch { d = null; }
  if (!d) return null;
  if (engine === 'legacy') return d;
  /* Move it across once, then prove it arrived. */
  try {
    await writeBook(d as unknown as Record<string, unknown>, { full: true });
    const back = await loadBook();
    const bad = back ? sameParts(d as unknown as Record<string, unknown>, migrate(back) as unknown as Record<string, unknown>) : 'everything';
    if (bad) throw new Error('moved book differs at "' + bad + '"');
    await storeSet('movedFromAsyncStorage', new Date().toISOString());
    engine = 'sqlite';
    return migrate(back!) as DB;
  } catch {
    try { await clearBook(); } catch { /* nothing to undo */ }
    engine = 'legacy';
    return d;
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
  // repair items whose batches drifted from their stock before moves kept them in step
  (d.products || []).forEach((p: any) => reconcileBatches(p));
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
  // the two demo printers every book used to start with were never real: a
  // Bluetooth one with no address and a network one at a made-up address
  d.printers = d.printers.filter((p: any) => !(p.id === 'prn_1' && p.kind === 'bluetooth' && !p.address)
    && !(p.id === 'prn_2' && p.address === '192.168.1.44'));
  if (!d.printers.length) d.printers = defaultPrinters(d.printer);
  if (d.printer.device === 'POS-80 (Bluetooth)') d.printer.device = '';
  d.printers.forEach((p: any) => { if (p.port == null) p.port = 9100; });
  if (!d.printers.some((p: any) => p.dflt)) d.printers[0].dflt = true;
  d.printServer = { ...defaultPrintServer(), ...(d.printServer || {}) };
  if (!Array.isArray(d.templates) || !d.templates.length) d.templates = defaultTemplates();
  // IMEIs started printing on receipts; the old receipt template had the switch off by default
  if (!d.imeiOnReceiptsV1) { d.templates.forEach((t: any) => { t.showImei = true; }); d.imeiOnReceiptsV1 = true; }
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
  d.categories = Array.isArray(d.categories) ? d.categories : [];
  // Every book used to be handed a starter list of categories nobody chose.
  // Those that no item uses are removed, once; anything in use stays.
  if (!d.starterCategoriesClearedV1) {
    const starter = new Set(defaultCategories());
    const used = new Set((d.products || []).map((p: any) => p.category));
    d.categories = d.categories.filter((c: string) => !starter.has(c) || used.has(c));
    d.starterCategoriesClearedV1 = true;
  }
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

/* ------------------------------------------------------------------
   Whether writes are actually landing.

   A failed write used to just be swallowed — the app kept working for the
   rest of the session, but whatever was just done (a sale, a payment, a
   stock count) only ever existed in memory and was gone the moment the app
   closed, with nothing on screen to say so. One blip is not worth alarming
   anyone over — a phone's storage hiccups occasionally and the very next
   write usually lands fine — but a run of them means something is actually
   wrong (storage full, permission revoked), and that is worth surfacing.
   See StorageKeeper.tsx, which turns this into a toast.
   ------------------------------------------------------------------ */

export type SaveStatus = 'ok' | 'failing';

const SAVE_FAILURE_THRESHOLD = 2;

let saveStatus: SaveStatus = 'ok';
let consecutiveFailures = 0;
const statusListeners = new Set<(status: SaveStatus) => void>();

function setSaveStatus(next: SaveStatus): void {
  if (next === saveStatus) return;
  saveStatus = next;
  statusListeners.forEach((l) => l(next));
}

/** For a "saving is stuck" banner. Fires again once resolved. */
export function onSaveStatus(cb: (status: SaveStatus) => void): () => void {
  statusListeners.add(cb);
  return () => { statusListeners.delete(cb); };
}

export function currentSaveStatus(): SaveStatus {
  return saveStatus;
}

export async function saveDB(db: DB): Promise<boolean> {
  try {
    /* A device with no working SQLite at all keeps the old storage. A write
       that fails on a working SQLite is a real failure and is reported. */
    if (engine === 'sqlite' && !(await sqliteAvailable())) engine = 'legacy';
    if (engine === 'sqlite') await writeBook(db as unknown as Record<string, unknown>);
    else await AsyncStorage.setItem(KEY, JSON.stringify(db));
    consecutiveFailures = 0;
    setSaveStatus('ok');
    return true;
  } catch {
    // storage full / unavailable — the app still works for this session,
    // but repeated failures are reported rather than swallowed outright
    consecutiveFailures += 1;
    if (consecutiveFailures >= SAVE_FAILURE_THRESHOLD) setSaveStatus('failing');
    return false;
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

export async function clearDB(): Promise<boolean> {
  try {
    /* Both: an old copy left behind would be moved across again on the next start. */
    if (engine === 'sqlite') await clearBook();
    await AsyncStorage.removeItem(KEY);
    legacyUnreadable = false;
    return true;
  } catch {
    return false;
  }
}
