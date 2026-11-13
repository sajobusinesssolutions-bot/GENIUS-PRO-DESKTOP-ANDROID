// Pure, framework-free business-logic functions used by AppDataContext.
// Kept separate (no React/AsyncStorage imports) so they can be unit-tested
// directly against a plain DB object without rendering a component tree.
import { tsMs } from './helpers';
import { BillReceipt, Entry, CreditNote, CreditNoteLine,
  DB, Sale, SaleLine, Purchase, PurchaseLine, Payment, JournalLine, JournalEntry, PayMethod, Product, Movement,
  StockTake, ProductionRun, RecurringInvoice, InstalmentPlan, InstalmentDue, Revision,
  LicStatus, Subscription, Shift,
} from './types';
import { uid, iso } from './uid';
import { Refusal } from './refusal';
import { reconcileBatches, liveBatches, isExpired } from './batches';
import { activeBranchId, branchPrefix } from './branch';
import { ensureCoa } from './coa';
import { addDays, PLANS, LIC_GRACE } from './defaults';
import { canWith, ensureRoles } from './perms';

export function stockOfImpl(p: Product, wh?: string): number {
  if (!p || !p.stock) return 0;
  if (wh) return p.stock[wh] || 0;
  return Object.keys(p.stock).reduce((s, k) => s + (p.stock[k] || 0), 0);
}

/**
 * What a set of lines comes to.
 *
 * `inclusive` is Settings → "Prices already include tax". When prices include
 * it, the tax is the part of each price that is tax and the customer pays the
 * shelf price. When they do not, the tax is added on top. Until the setting was
 * wired, the app always behaved as inclusive whatever it said — see the
 * migration in storage.ts that keeps existing shops that way.
 */
export function saleTotals(lines: SaleLine[], discount: number, inclusive = true) {
  let gross = 0, tax = 0, cost = 0;
  lines.forEach((l) => {
    const line = l.qty * l.price;
    const rate = (l.taxRate || 0) / 100;
    gross += line; cost += l.qty * (l.cost || 0);
    tax += inclusive ? line - line / (1 + rate) : line * rate;
  });
  const disc = Math.min(discount || 0, gross);
  const taxAfter = tax * (gross ? (gross - disc) / gross : 0);
  if (inclusive) {
    const total = gross - disc;
    return { gross, discount: disc, total, tax: taxAfter, net: total - taxAfter, cost };
  }
  const net = gross - disc;
  return { gross, discount: disc, total: net + taxAfter, tax: taxAfter, net, cost };
}

/** Whether a book's prices already include tax. Absent means yes, as it always behaved. */
export function pricesIncludeTax(d: { settings?: { pricesIncludeTax?: boolean } }): boolean {
  return d.settings?.pricesIncludeTax !== false;
}

/** Rounds to the smallest coin. Every posted figure passes through here. */
export function cents(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Posts a journal entry.
 *
 * Totals are worked out in floating point — a tax line of a third of a shilling
 * lands as 0.3333333333333333 — so debits and credits would miss each other by
 * fractions that the trial balance then had to forgive with a half-shilling
 * tolerance. Forgiving a difference hides a real one. Instead every figure is
 * rounded to the smallest coin here, and any rounding crumb left over is given
 * to the largest line on the heavier side, so the entry ties out exactly.
 *
 * A difference larger than a shilling is not rounding, it is a mistake, so it
 * is left alone and the entry stays flagged as unbalanced.
 */
export function journal(d: DB, when: Date, memo: string, ref: string, lines: JournalLine[]) {
  const rounded = lines.map((l) => ({
    ...l,
    ...(l.dr !== undefined ? { dr: cents(l.dr) } : {}),
    ...(l.cr !== undefined ? { cr: cents(l.cr) } : {}),
  }));

  let dr = 0, cr = 0;
  rounded.forEach((l) => { dr = cents(dr + (l.dr || 0)); cr = cents(cr + (l.cr || 0)); });

  const diff = cents(dr - cr);
  if (diff !== 0 && Math.abs(diff) < 1) {
    // take the crumb off whichever side is heavier, from its largest line
    const side: 'dr' | 'cr' = diff > 0 ? 'dr' : 'cr';
    let biggest: JournalLine | null = null;
    rounded.forEach((l) => {
      const v = l[side] || 0;
      if (v > (biggest ? biggest[side] || 0 : 0)) biggest = l;
    });
    if (biggest) {
      const b = biggest as JournalLine;
      b[side] = cents((b[side] || 0) - Math.abs(diff));
      if (side === 'dr') dr = cents(dr - Math.abs(diff)); else cr = cents(cr - Math.abs(diff));
    }
  }

  const entry: JournalEntry = {
    id: uid('jnl'), ts: iso(when), memo, ref, lines: rounded,
    balanced: Math.abs(cents(dr - cr)) < 0.005,
    // a branch keeps its own books, so the posting is stamped where it happened
    branch: activeBranchId(d),
  };
  d.journal.push(entry);
  if (d.sync?.on) enqueue(d, 'journal', entry.id);
  return entry;
}

export function move(d: DB, productId: string, wh: string, qty: number, type: string, ref: string, when: Date, batchNo?: string, userId?: string, extra?: Partial<Movement>): Movement | undefined {
  const prod = d.products.find((x) => x.id === productId);
  if (!prod) return undefined;
  prod.stock[wh] = (prod.stock[wh] || 0) + qty;
  if (batchNo && prod.batches) {
    const batch = prod.batches.find((x) => x.no === batchNo);
    if (batch) batch.qty += qty;
  }
  // a move that named no batch (or one that is gone) still has to land in the batches
  reconcileBatches(prod);
  const movement: Movement = { id: uid('mv'), ts: iso(when), productId, wh, qty, type, ref, batchNo, userId: userId || d.session.userId, ...(extra || {}) };
  d.movements.push(movement);
  if (d.sync?.on) enqueue(d, 'movement', movement.id);
  return movement;
}

export const AUDIT_KEEP = 5000;

export function audit(d: DB, action: string, details = '') {
  const u = d.users.find((x) => x.id === d.session.userId);
  d.auditLog.unshift({ id: uid('aud'), ts: iso(new Date()), userId: d.session.userId, userName: u?.name || 'System', action, details });
  // Accountability is only as long as the trail. A busy counter writes a few
  // hundred lines a week, so a 500-entry cap quietly threw away last month
  // before anyone came looking. This holds roughly a year of ordinary trading.
  if (d.auditLog.length > AUDIT_KEEP) d.auditLog.length = AUDIT_KEEP;
}

/**
 * Notes a record that has to go up to the account.
 *
 * With sync on, everything is queued whether or not the phone is online —
 * the queue is what the sync client sends, so skipping it while connected
 * meant a connected phone never sent anything new. With sync off, only work
 * done offline is kept, as before.
 *
 * `ref` is the record's id. The sync client finds records by id; queuing a
 * document number instead made every sale and purchase quietly unfindable.
 */
/**
 * Whether the shop lets stock go below zero.
 *
 * Settings has two switches that say the same thing from opposite ends —
 * "Refuse to sell what is not in stock" and "Allow selling below zero". The
 * screen now keeps them in step; this reads them so that either one, turned to
 * permit it, permits it.
 */
export function mayGoBelowZero(d: { settings?: { allowNegativeStock?: boolean; blockNegativeStock?: boolean } }): boolean {
  /* "Refuse to sell what is not in stock" decides; the older switch only when it was never set */
  if (d.settings?.blockNegativeStock !== undefined) return d.settings.blockNegativeStock === false;
  return d.settings?.allowNegativeStock === true;
}

/** Whether an item has a shelf at all. Services and uncounted items do not. */
export function isStocked(p: { kind?: string; trackInventory?: boolean } | null | undefined): boolean {
  return !!p && p.kind !== 'service' && p.trackInventory !== false;
}

/**
 * The most of an item that may go on a sale. Unlimited for a service, an
 * uncounted item, or any item when the shop allows selling below zero.
 */
export function sellLimit(d: Parameters<typeof mayGoBelowZero>[0], p: Product | null | undefined, onHand: number): number {
  if (!isStocked(p) || mayGoBelowZero(d)) return Infinity;
  return Math.max(0, onHand);
}

/** How much of the item's main stock unit a line uses. */
export function stockQty(l: { qty: number; unitFactor?: number }): number {
  return l.qty * (l.unitFactor && l.unitFactor > 0 ? l.unitFactor : 1);
}

/**
 * What stops these lines being sold as they are: an item that is gone, too few
 * on the shelf, or a price under cost where Settings block it. Checked before a
 * quotation becomes a sale, so the person reads the reasons instead of the sale
 * failing half way. Empty when the lines can be sold.
 */
export function saleBlockers(d: DB, lines: SaleLine[], discount = 0): string[] {
  const out: string[] = [];
  const wh = d.session.warehouse || 'w1';
  const needed = new Map<string, number>();
  lines.forEach((l) => needed.set(l.productId, (needed.get(l.productId) || 0) + stockQty(l)));
  needed.forEach((required, productId) => {
    const prod = d.products.find((p) => p.id === productId);
    const name = lines.find((l) => l.productId === productId)?.name || 'An item';
    if (!prod) { out.push(name + ' no longer exists.'); return; }
    if (!isStocked(prod) || mayGoBelowZero(d)) return;
    const available = prod.stock[wh] || 0;
    if (available < required) out.push(prod.name + ': ' + available + ' ' + prod.unit + ' on hand, ' + required + ' needed.');
  });
  const trusted = d.session.role === 'owner' || d.session.role === 'manager';
  void trusted;   // "block" holds for everyone, the owner too (as on the PC)
  if (d.settings.belowCost === 'block') {
    // the bill's discount comes off every line in proportion: it can take a line below cost too
    const gross = lines.reduce((a, l) => a + l.qty * l.price, 0);
    const k = gross > 0 ? Math.max(0, 1 - Math.min(discount || 0, gross) / gross) : 1;
    lines.forEach((l) => {
      const prod = d.products.find((p) => p.id === l.productId);
      const cost = (prod ? prod.cost * (l.unitFactor || 1) : 0) || l.cost;
      if (cost > 0 && l.price * k < cost - 0.005) out.push(l.name + ' is priced below its cost' + (k < 1 && l.price >= cost ? ' once the bill discount is taken off' : '') + '.');
    });
  }
  return out;
}

/** What a cash drawer holds now, from the journal. */
export function cashOnHand(d: DB, accountId: string): number {
  let b = 0;
  (d.journal || []).forEach((e) => e.lines.forEach((l) => {
    if (l.acc === accountId) b += (l.dr || 0) - (l.cr || 0);
  }));
  return b;
}

/**
 * Settings → Cash control. Refuses money going out of a cash drawer that does
 * not hold it, before anything is written. Banks and mobile money are left to
 * their own overdraft rules; only drawers of type "cash" are counted.
 */
export function guardCash(d: DB, takes: Array<{ acc: string; amount: number }>) {
  if (!d.settings.blockNegativeCash) return;
  const need = new Map<string, number>();
  takes.forEach((t) => { if (t.amount > 0) need.set(t.acc, (need.get(t.acc) || 0) + t.amount); });
  need.forEach((amount, acc) => {
    const account = (d.accounts || []).find((a) => a.id === acc);
    if (!account || account.type !== 'cash') return;
    const have = cashOnHand(d, acc);
    if (have - amount < -0.005) {
      throw new Refusal('Not enough cash in ' + account.name,
        'It holds ' + Math.round(have).toLocaleString('en-US') + ' and this needs ' + Math.round(amount).toLocaleString('en-US')
        + '. Cash control in Settings stops cash going below zero.');
    }
  });
}

/**
 * The offline allowance. With sync on, every voucher goes up as it is saved;
 * without a network it waits in the queue. A phone may hold up to this many
 * before it must get online, so a long outage cannot leave the devices far
 * apart. Sending them clears the count. (The computer keeps the same rule.)
 */
export const OFFLINE_ALLOWANCE = 300;
/** The start of a temporary voucher number, given while the server cannot be asked. */
export const PENDING = 'PENDING-';

/** The running number inside a voucher number: INV-03187 → 3187. */
export function numberPart(no: string): number {
  const m = /(\d+)(?:-P)?$/.exec(String(no || ''));
  return m ? Number(m[1]) : 0;
}
/** The series a sale is numbered in: its branch prefix (INV unless the branch has its own). */
export function saleSeries(d: DB, warehouse?: string): string { return branchPrefix(d, warehouse || d.session.warehouse); }
/** The highest number this book holds in a sale series, so a series that began here carries on. */
export function saleFloor(d: DB, series: string): number {
  let top = 0;
  const pre = series + '-';
  d.sales.forEach((s) => { if (s.no.startsWith(pre)) top = Math.max(top, numberPart(s.no)); });
  return top;
}
/**
 * How many digits a series is written with: as its newest number already is,
 * so the phone and the computer carry on one width. The phone wrote five
 * (INV-03189) and the computer six (INV-003190), and a book with both read as
 * two series. A series with nothing yet takes the computer's six.
 */
export function saleWidth(d: DB, series: string): number {
  const pre = series + '-';
  let best: { ts: string; w: number } | null = null;
  d.sales.forEach((s) => {
    if (!s.no.startsWith(pre) || s.numberPending) return;
    const digits = s.no.slice(pre.length).match(/^\d+/);
    if (digits && (!best || s.ts >= best.ts)) best = { ts: s.ts, w: digits[0].length };
  });
  return best ? Math.min(10, Math.max(4, (best as { w: number }).w)) : 6;
}
/** The text of a sale number in a series: INV + 3190 → INV-003190. */
export function formatSaleNo(series: string, n: number, width = 6): string { return series + '-' + String(n).padStart(width, '0'); }

/** Gives a sale saved with a temporary number its real one, and points its ledger and stock lines at it. */
export function setSaleNumber(d: DB, saleId: string, no: string): boolean {
  const s = d.sales.find((x) => x.id === saleId);
  if (!s || !s.numberPending) return false;
  renumber(d, s.no, no);
  s.no = no;
  delete s.numberPending;
  return true;
}
/** Vouchers only — sales, bills, money, notes, journals — as the computer counts; item and party edits do not use the allowance. */
const VOUCHER_KINDS = new Set(['sale', 'purchase', 'payment', 'entry', 'creditNote', 'journal', 'movement', 'estimate', 'challan', 'purchaseOrder']);
export function vouchersWaiting(d: DB): number { return (d.queue || []).filter((q) => VOUCHER_KINDS.has(q.kind)).length; }
/**
 * Whether the waiting changes are worth showing. Online, a save goes up within a
 * second or two, and "1 change waiting" flashing after every sale was noise; it
 * shows when the phone is offline, or something has waited longer than a send takes.
 */
export const WAIT_SHOWN_AFTER_MS = 20 * 1000;
export function queueStuck(d: DB | null | undefined, now = Date.now()): boolean {
  if (!d || !(d.queue || []).length) return false;
  if (d.session.online === false) return true;
  return d.queue.some((q) => now - (new Date(q.ts).getTime() || now) > WAIT_SHOWN_AFTER_MS);
}
export function offlineLeft(d: DB): number | null {
  if (!d.sync?.on) return null;
  return Math.max(0, OFFLINE_ALLOWANCE - vouchersWaiting(d));
}
function mustHaveAllowance(d: DB) {
  if (offlineLeft(d) === 0) {
    throw new Refusal('Get online to carry on',
      'This phone has saved ' + OFFLINE_ALLOWANCE + ' changes without a network. They go up by themselves once it is online, and you can carry on selling.');
  }
}

export function enqueue(d: DB, kind: string, ref: string) {
  if (d.session.online && !d.sync?.on) return;
  if (!d.queue) d.queue = [];
  if (d.queue.some((q) => q.kind === kind && q.ref === ref)) return;
  d.queue.push({ id: uid('q'), ts: iso(new Date()), kind, ref });
}

export function commitSale(d: DB, o: { lines: SaleLine[]; partyId: string | null; method: PayMethod; discount: number; additionalCharges?: number; description?: string; terms?: string; redeem?: number; methods?: Array<{ method: PayMethod; amount: number }>; no?: string; ts?: string; received?: number; receivedVia?: 'cash' | 'momo' | 'bank'; momoNetwork?: 'mtn' | 'airtel'; momoRef?: string; userId?: string; ticketName?: string; orderType?: import('./types').OrderType; priceListId?: string; rx?: import('./types').RxRecord; wht?: number; taxOnTop?: boolean; showPayment?: boolean }, when = o.ts ? new Date(o.ts) : new Date()): Sale {
  if (!canWith(ensureRoles(d), d.session.role, 'sales.create')) {
    throw new Refusal('Permission denied: sales.create');
  }
  mustHaveAllowance(d);
  // A dish made to a recipe costs what its ingredients cost, so its profit is real.
  o = { ...o, lines: o.lines.map((l) => {
    const r = d.products.find((p) => p.id === l.productId)?.recipe;
    if (!r || !r.length || l.cost) return l;
    const cost = r.reduce((n, x) => n + (d.products.find((p) => p.id === x.productId)?.cost || 0) * x.qty, 0);
    return { ...l, cost: Math.round(cost * (l.unitFactor || 1) * 100) / 100 };
  }) };
  /* A line of a batch-tracked item with no batch named (a quick sale, an
     order, a quotation turned into a sale) is drawn from its batches,
     soonest expiry first and skipping expired ones — split into a line per
     batch. Before, it took the item's stock but no batch's, so the batches
     no longer added up to what was on the shelf. */
  o = { ...o, lines: o.lines.flatMap((l) => {
    const p = d.products.find((x) => x.id === l.productId);
    if (l.batchNo || !p || !p.trackBatches || !(p.batches || []).length || (l.unitFactor && l.unitFactor !== 1) || !(l.qty > 0)) return [l];
    let left = l.qty;
    const out: SaleLine[] = [];
    for (const b of liveBatches(p).filter((x) => !isExpired(x))) {
      if (left <= 0) break;
      const take = Math.min(b.qty, left);
      if (take > 0) { out.push({ ...l, qty: take, batchNo: b.no, expiry: b.expiry } as SaleLine); left -= take; }
    }
    if (left > 0.0001) out.push({ ...l, qty: left });
    return out.length ? out : [l];
  }) };
  // With tax switched off for the shop, nothing is charged or reported.
  const taxable = d.settings.taxEnabled === false
    ? o.lines.map((l) => ({ ...l, taxRate: 0 }))
    : o.lines;
  // this bill's own choice wins over the shop's: tax added on top of the prices, or inside them
  const t = saleTotals(taxable, o.discount, o.taxOnTop === undefined ? pricesIncludeTax(d) : !o.taxOnTop);
  const charges = Math.max(0, Number(o.additionalCharges) || 0);
  const finalTotal = t.total + charges;
  const redeemed = o.redeem || 0;
  const useSplitTender = o.methods && o.methods.length > 1;
  if (o.method === 'credit' && !o.partyId) throw new Refusal('A customer is required for credit sales');
  if (useSplitTender) {
    const splitTotal = o.methods!.reduce((s, m) => s + m.amount, 0);
    if (o.methods!.some((m) => m.method === 'credit' || m.amount < 0 || !Number.isFinite(m.amount)) || Math.abs(splitTotal - finalTotal) > 0.01) {
      throw new Refusal('Split payments must equal the sale total');
    }
  }
  if (o.method === 'credit' && o.partyId) {
    const customer = d.parties.find((p) => p.id === o.partyId);
    if (customer && customer.creditLimit > 0 && partyBalance(d, o.partyId) + finalTotal > customer.creditLimit) {
      throw new Refusal('Credit limit exceeded for this customer');
    }
  }
  const wh = d.session.warehouse || 'w1';
  // a dish kept in stock that has run short is made there and then from its recipe
  {
    const want = new Map<string, number>();
    o.lines.forEach((l) => want.set(l.productId, (want.get(l.productId) || 0) + stockQty(l)));
    want.forEach((n, id) => {
      const p = d.products.find((x) => x.id === id);
      if (!p || !p.madeAhead || !p.recipe?.length) return;
      const short = n - Math.max(0, p.stock[wh] || 0);
      if (short > 0) produceDish(d, id, short, when, 'auto');
    });
  }
  // A batch-tracked item arrives as one line per lot, so the quantities have to
  // be added up per product before they are compared with what is on the shelf —
  // checking each line on its own would let an oversell through.
  const needed = new Map<string, number>();
  o.lines.forEach((l) => {
    needed.set(l.productId, (needed.get(l.productId) || 0) + stockQty(l));
  });
  needed.forEach((required, productId) => {
    const prod = d.products.find((p) => p.id === productId);
    if (!prod) return;
    // Services and anything not counted have no shelf to run short of.
    if (prod.kind === 'service' || prod.trackInventory === false) return;
    const available = prod.stock[wh] || 0;
    if (!mayGoBelowZero(d) && available < required) {
      throw new Refusal(
        'Not enough ' + prod.name + ' — ' + available + ' ' + prod.unit + ' on hand, ' + required + ' needed',
      );
    }
  });
  // a batch past its expiry is not sold, whichever screen the sale came from
  o.lines.forEach((l) => {
    if (!l.batchNo) return;
    const prod = d.products.find((p) => p.id === l.productId);
    const b = prod?.batches?.find((x) => x.no === l.batchNo);
    if (b?.expiry && new Date(b.expiry).getTime() < when.getTime()) {
      throw new Refusal(l.name + ' — batch ' + l.batchNo + ' expired', 'It expired on ' + new Date(b.expiry).toLocaleDateString('en-GB')
        + ' and cannot be sold. Choose another batch, or take the expired stock off the shelf with Adjust stock.');
    }
  });
  // the phones sold leave the IMEI list, so the same one cannot be sold twice
  o.lines.forEach((l) => {
    if (!l.serials || !l.serials.length) return;
    const prod = d.products.find((p) => p.id === l.productId);
    if (!prod || !prod.serials) return;
    const gone = new Set(l.serials.map((s) => s.imei.toUpperCase()));
    prod.serials = prod.serials.filter((s) => !gone.has(s.toUpperCase()));
    if (prod.serialInfo) gone.forEach((g) => { Object.keys(prod.serialInfo!).forEach((k) => { if (k.toUpperCase() === g) delete prod.serialInfo![k]; }); });
    l.serialNo = l.serials[0].imei;
  });
  d.counters.sale += 1;
  /* With sync on, numbers come from the server so every device shares one run
     (numbers.ts). A sale saved without one carries a temporary number until
     the next sync gives it its real one, in the order the sales were made. */
  const saleId = uid('sal');
  const givenNo = (o.no || '').trim();
  const pending = !!d.sync?.on && !d.demo;
  /* withholding tax the customer keeps back: it settles the bill as money does, and is the shop's tax credit */
  const wht = useSplitTender ? 0 : Math.max(0, Math.min(Number(o.wht) || 0, finalTotal));
  const partPaid = Math.max(0, Math.min(Number(o.received) || 0, finalTotal - wht));
  const paidNow = useSplitTender
    ? o.methods!.reduce((s, m) => s + m.amount, 0)
    : (o.method === 'credit' ? partPaid : finalTotal - wht);
  const finalPaidNow = redeemed ? Math.max(0, paidNow - redeemed) : paidNow;
  const sale: Sale = {
    // each branch's paperwork carries its own prefix over a firm-wide number
    id: saleId, no: givenNo || (pending ? PENDING + saleId.slice(-6).toUpperCase() : branchPrefix(d, wh) + '-' + String(100000 + d.counters.sale).slice(1)), ts: iso(when),
    ...(pending && !givenNo ? { numberPending: true } : {}),
    partyId: o.partyId, userId: o.userId || d.session.userId, till: d.session.till, warehouse: wh,
    lines: taxable, discount: t.discount, redeemed, gross: t.gross, tax: t.tax, total: finalTotal, cogs: t.cost,
    additionalCharges: charges, terms: o.terms, note: o.description,
    ...(o.showPayment !== undefined ? { showPayment: o.showPayment } : {}),
    ...(o.ticketName ? { ticketName: o.ticketName } : {}),
    ...(o.orderType ? { orderType: o.orderType } : {}),
    ...(o.priceListId ? { priceListId: o.priceListId } : {}),
    ...(o.rx ? { rx: o.rx } : {}),
    method: o.method,
    ...(o.method === 'credit' && finalPaidNow > 0 ? { receivedVia: o.receivedVia || 'cash' } : {}),
    ...(o.method === 'momo' || (o.method === 'credit' && o.receivedVia === 'momo') ? {
      momoNetwork: o.momoNetwork || 'mtn',
      momoRef: o.momoRef || undefined,
    } : {}),
    paid: finalPaidNow + redeemed + wht, paidAtSale: finalPaidNow + redeemed + wht, due: finalTotal - finalPaidNow - redeemed - wht,
    ...(wht ? { wht } : {}),
    ...(useSplitTender && { methods: o.methods }),
    status: 'complete', synced: d.session.online, fiscal: d.settings.efris ? (d.session.online ? 'sent' : 'pending') : 'off',
    fdn: d.settings.efris && d.session.online ? String(9000000000 + Math.floor(Math.random() * 8999999)) : null,
  };
  d.sales.push(sale);
  sale.lines.forEach((l) => move(d, l.productId, wh, -stockQty(l), 'sale', sale.no, when, l.batchNo));
  // a dish made to order draws down what it is made from
  // (a dish kept in stock was made beforehand: its plates go, not its ingredients)
  sale.lines.forEach((l) => {
    const p = d.products.find((x) => x.id === l.productId);
    if (!p?.recipe?.length || p.madeAhead) return;
    l.fromRecipe = true;
    p.recipe.forEach((r) => move(d, r.productId, wh, -(r.qty * stockQty(l)), 'recipe', sale.no, when));
  });
  const jl: JournalLine[] = [];
  if (useSplitTender && o.methods) {
    o.methods.forEach((m) => {
      const acc = m.method === 'cash' ? 'acc_cash' : m.method === 'momo' ? 'acc_momo' : m.method === 'bank' ? 'acc_bank' : null;
      if (m.amount > 0 && acc) jl.push({ acc, dr: m.amount });
    });
  } else {
    // A credit sale can still take money over the counter. It lands in whichever
    // account it was actually received into — a part-payment by mobile money is
    // not cash in the drawer — and the sale itself stays a credit sale.
    const via = o.method === 'credit' ? (o.receivedVia || 'cash') : o.method;
    const acc = via === 'momo' ? 'acc_momo' : via === 'bank' ? 'acc_bank' : 'acc_cash';
    if (finalPaidNow > 0) jl.push({ acc, dr: finalPaidNow });
  }
  if (redeemed > 0) jl.push({ acc: 'n_loyalty', dr: redeemed });
  if (wht > 0) jl.push({ acc: 'n_wht_credit', dr: wht });
  if (sale.due > 0) jl.push({ acc: 'n_ar', dr: sale.due });
  if (t.discount > 0) jl.push({ acc: 'n_discount', dr: t.discount });
  jl.push({ acc: 'n_sales', cr: t.net + t.discount + charges });
  if (t.tax > 0) jl.push({ acc: 'n_tax', cr: t.tax });
  journal(d, when, 'Sale ' + sale.no, sale.no, jl);
  if (t.cost > 0) journal(d, when, 'Cost of sale ' + sale.no, sale.no, [{ acc: 'n_cogs', dr: t.cost }, { acc: 'n_inventory', cr: t.cost }]);
  if (sale.partyId && d.loyaltyRules?.enabled) {
    const pt = d.parties.find((p) => p.id === sale.partyId);
    if (pt && pt.type === 'customer') {
      if (redeemed) pt.points = Math.max(0, pt.points - Math.round(redeemed / d.loyaltyRules.pointValue));
      pt.points = (pt.points || 0) + Math.floor(t.total / d.loyaltyRules.earnPer);
    }
  }
  sale.lines.forEach((l) => {
    const prod = d.products.find((x) => x.id === l.productId);
    if (prod && prod.warrantyMonths > 0) {
      d.warranties.push({ id: uid('wty'), saleId: sale.id, saleNo: sale.no, productId: prod.id, partyId: sale.partyId, soldAt: iso(when), months: prod.warrantyMonths, status: 'active' });
    }
  });
  enqueue(d, 'sale', sale.id);
  audit(
    d,
    'Sale created',
    sale.no + ' — total ' + Math.round(t.total)
      + ' — by ' + (d.users.find((u) => u.id === sale.userId)?.name || 'unknown'),
  );
  touch(d, sale, 'Created', 'sales');
  return sale;
}

export function voidSale(d: DB, saleId: string, reason?: string, when = new Date()) {
  const s = d.sales.find((x) => x.id === saleId);
  if (!s || s.status === 'void') return;
  s.status = 'void'; s.voidedAt = iso(when); s.voidReason = reason || '';
  enqueue(d, 'sale', s.id);
  s.lines.forEach((l) => move(d, l.productId, s.warehouse, stockQty(l), 'void', s.no, when, l.batchNo));
  s.lines.forEach((l) => {
    const p = d.products.find((x) => x.id === l.productId);
    // older sales carry no mark: their ingredients were drawn unless the dish is kept in stock
    if (!(l.fromRecipe ?? !p?.madeAhead)) return;
    (p?.recipe || []).forEach((r) => move(d, r.productId, s.warehouse, r.qty * stockQty(l), 'void', s.no, when));
  });
  /* The sale's own posting, turned back line for line (commitSale): the money
     taken at the counter out of the account it went into — for a credit sale
     with something paid down that is receivedVia, which used to be skipped,
     leaving the books out of balance by it — points and tax withheld back to
     their own ledgers, and what is owed off the debtors. Money paid on the
     bill afterwards (a receipt of its own) is still received: it comes off the
     debtors too, and stays on the customer's account — it was never in this
     sale's till, so it is not taken out of it. Before, it was credited to the
     till (or, on a credit sale, nowhere at all). */
  const jl: JournalLine[] = [];
  const redeemed = s.redeemed || 0, wht = s.wht || 0;
  const atSale = s.paidAtSale ?? (s.method === 'credit' ? 0 : s.paid);
  const later = Math.max(0, cents(s.paid - atSale));
  const tillPaid = Math.max(0, cents(atSale - redeemed - wht));
  if (s.methods && s.methods.length > 1) {
    s.methods.forEach((m) => {
      const acc = m.method === 'cash' ? 'acc_cash' : m.method === 'momo' ? 'acc_momo' : m.method === 'bank' ? 'acc_bank' : null;
      if (m.amount > 0 && acc) jl.push({ acc, cr: m.amount });
    });
  } else if (tillPaid > 0) {
    const via = s.method === 'credit' ? (s.receivedVia || 'cash') : s.method;
    jl.push({ acc: via === 'momo' ? 'acc_momo' : via === 'bank' ? 'acc_bank' : 'acc_cash', cr: tillPaid });
  }
  if (s.due + later > 0.005) jl.push({ acc: 'n_ar', cr: cents(s.due + later) });
  if (redeemed) jl.push({ acc: 'n_loyalty', cr: redeemed });
  if (wht) jl.push({ acc: 'n_wht_credit', cr: wht });
  jl.push({ acc: 'n_sales', dr: s.total - s.tax + s.discount });
  if (s.tax > 0) jl.push({ acc: 'n_tax', dr: s.tax });
  if (s.discount > 0) jl.push({ acc: 'n_discount', cr: s.discount });
  journal(d, when, 'Void ' + s.no, s.no, jl);
  if (s.cogs > 0) journal(d, when, 'Reverse cost ' + s.no, s.no, [{ acc: 'n_inventory', dr: s.cogs }, { acc: 'n_cogs', cr: s.cogs }]);
  d.warranties = d.warranties.filter((w) => w.saleId !== s.id);
  audit(d, 'Sale voided', s.no + (reason ? ' — ' + reason : ''));
  touch(d, s, 'Voided' + (reason ? ' — ' + reason : ''), 'sales');
}

export function createPurchase(d: DB, partyId: string, lines: PurchaseLine[], method: PayMethod, when = new Date(), userId?: string, no?: string): Purchase {
  mustHaveAllowance(d);
  if (!canWith(ensureRoles(d), d.session.role, 'purchases.create')) {
    throw new Refusal('Permission denied: purchases.create');
  }
  const party = d.parties.find((p) => p.id === partyId);
  if (!party || party.type !== 'supplier') throw new Refusal('A supplier is required for purchases');
  if (method !== 'credit') {
    guardCash(d, [{
      acc: method === 'bank' ? 'acc_bank' : method === 'momo' ? 'acc_momo' : 'acc_cash',
      amount: lines.reduce((s, l) => s + l.qty * l.cost, 0),
    }]);
  }

  d.counters.purchase += 1;
  const total = lines.reduce((s, l) => s + l.qty * l.cost, 0);
  const wh = d.session.warehouse || 'w1';
  const pu: Purchase = { id: uid('pur'), no: (no || '').trim() || 'PUR-' + String(100000 + d.counters.purchase).slice(1), ts: iso(when), partyId, lines, total, method, paid: method === 'credit' ? 0 : total, due: method === 'credit' ? total : 0, status: 'complete', userId: userId || d.session.userId, branch: activeBranchId(d) };
  d.purchases.push(pu);
  lines.forEach((l) => {
    const prod = d.products.find((x) => x.id === l.productId);

    // What the item costs from now on. Purchases used to leave the cost as it
    // was entered on day one, so "Costing: average / last" had nothing to act
    // on and every margin drifted as supplier prices moved.
    if (prod && l.qty > 0 && l.cost > 0) {
      if (d.settings.costing === 'last') {
        prod.cost = l.cost;
      } else {
        const onHand = Math.max(0, stockOfImpl(prod));
        prod.cost = cents((onHand * (prod.cost || 0) + l.qty * l.cost) / (onHand + l.qty));
      }
    }
    // a new selling price set while buying, as happens when a supplier's price moves
    if (prod && l.price !== undefined && l.price > 0) prod.price = l.price;

    const allocations = l.batchAllocations?.length
      ? l.batchAllocations
      : l.batchNo ? [{ batchNo: l.batchNo, qty: l.qty, expiry: l.expiry }] : [];
    if (prod?.trackBatches && allocations.length) {
      prod.batches = prod.batches || [];
      allocations.forEach((allocation) => {
        if (allocation.qty <= 0) return;
        const existing = prod.batches!.find((b) => b.no === allocation.batchNo);
        if (!existing) prod.batches!.push({ no: allocation.batchNo, expiry: allocation.expiry || '', qty: 0 });
        else if (allocation.expiry && !existing.expiry) existing.expiry = allocation.expiry;
        move(d, l.productId, wh, allocation.qty, 'purchase', pu.no, when, allocation.batchNo);
      });
    } else {
      move(d, l.productId, wh, l.qty, 'purchase', pu.no, when);
    }
  });
  const jl: JournalLine[] = [{ acc: 'n_inventory', dr: total }];
  if (method === 'credit') jl.push({ acc: 'n_ap', cr: total });
  else jl.push({ acc: method === 'bank' ? 'acc_bank' : method === 'momo' ? 'acc_momo' : 'acc_cash', cr: total });
  journal(d, when, 'Purchase ' + pu.no, pu.no, jl);
  enqueue(d, 'purchase', pu.id);
  audit(d, 'Purchase recorded', pu.no + ' — total ' + Math.round(total));
  touch(d, pu, 'Created', 'purchases');
  return pu;
}

export function recordPayment(d: DB, o: { partyId: string; amount: number; direction: 'in' | 'out'; accountId: string; note?: string; userId?: string; allocations?: Array<{ saleId: string; amount: number }>; taxDeducted?: number; onAccount?: boolean }, when = new Date()): Payment {
  mustHaveAllowance(d);
  const party = d.parties.find((p) => p.id === o.partyId);
  if (!party) throw new Refusal('A party is required for payments');
  if (o.direction === 'in' && party.type !== 'customer') throw new Refusal('A customer is required for customer payments');
  if (o.direction === 'out') guardCash(d, [{ acc: o.accountId, amount: o.amount }]);

  const acc = d.accounts.find((a) => a.id === o.accountId);
  const pay: Payment = { id: uid('pay'), ts: iso(when), partyId: o.partyId, amount: o.amount, direction: o.direction, accountId: o.accountId, note: o.note || '', method: acc?.type || 'cash', userId: o.userId || d.session.userId, branch: activeBranchId(d) };
  const wht = Math.max(0, cents(o.taxDeducted || 0));
  if (wht > 0) pay.taxDeducted = wht;
  d.payments.push(pay);
  enqueue(d, 'payment', pay.id);
  audit(d, o.direction === 'in' ? 'Payment received' : 'Payment made', Math.round(o.amount) + ' via ' + (acc?.name || o.accountId));
  const partyName = party.name;
  // withholding: a customer who kept tax back leaves us a tax credit; tax we keep back from a supplier is owed to the tax office
  if (o.direction === 'in') journal(d, when, 'Receipt from ' + partyName, 'RCT', [{ acc: o.accountId, dr: o.amount }, ...(wht ? [{ acc: 'n_wht_credit', dr: wht }] : []), { acc: ctrlOf(d, o.partyId, o.direction), cr: o.amount + wht }]);
  else journal(d, when, 'Payment to ' + partyName, 'PAY', [{ acc: ctrlOf(d, o.partyId, o.direction), dr: o.amount + wht }, { acc: o.accountId, cr: o.amount }, ...(wht ? [{ acc: 'n_tax', cr: wht }] : [])]);
  // Which bills this pays. The bills the person picked, in the amounts they
  // picked; otherwise the oldest first. Before, the picks were thrown away and
  // nothing recorded which bills a payment had settled, so a receipt could not
  // be traced to an invoice or back.
  let left = o.amount + wht;
  const bills: Array<{ id: string; no: string; ts: string; due: number; paid: number; receipts?: { paymentId: string; amount: number; ts: string }[] }> =
    (o.direction === 'in'
      ? d.sales.filter((s) => s.partyId === o.partyId && s.due > 0 && s.status !== 'void')
      : d.purchases.filter((x) => x.partyId === o.partyId && x.due > 0 && (x as any).status !== 'void')) as any;
  const order = [...bills].sort((a, b) => tsMs(a.ts) - tsMs(b.ts));
  const plan: Array<{ bill: typeof bills[number]; amount: number }> = [];
  if (o.onAccount) {
    // On account: no bill is named; all of it is held on the party's account
  } else if (o.allocations && o.allocations.length) {
    o.allocations.forEach((a) => {
      const bill = bills.find((b) => b.id === a.saleId);
      if (!bill || left <= 0) return;
      const take = Math.min(left, bill.due, Math.max(0, Number(a.amount) || 0));
      if (take > 0) { plan.push({ bill, amount: take }); left -= take; }
    });
  } else {
    order.forEach((bill) => {
      if (left <= 0) return;
      const take = Math.min(left, bill.due);
      plan.push({ bill, amount: take }); left -= take;
    });
  }
  pay.allocations = plan.map(({ bill, amount }) => {
    bill.due -= amount; bill.paid += amount;
    bill.receipts = [...(bill.receipts || []), { paymentId: pay.id, amount, ts: pay.ts }];
    return { docId: bill.id, no: bill.no, amount };
  });
  // whatever settled no bill stays on their account, not lost
  pay.unapplied = left > 0.005 ? cents(left) : 0;
  touch(d, pay, 'Recorded', 'payments');
  return pay;
}

/**
 * Every party's balance from one pass over the bills, kept for the book as it
 * stands. Asking party by party walked every sale and bill each time, so a list
 * of parties on a big book did parties × bills of work and froze the screen.
 * The book object is replaced on every change, and the counts guard against a
 * change made in place, so a kept answer is never stale.
 */
const balanceCache = new WeakMap<object, { key: string; map: Map<string, number> }>();
/**
 * Batches can be switched only on an item that has never been sold. Sold
 * without batches, the stock that went out belonged to no batch, so turning
 * them on leaves batches that never add up to what is on the shelf; sold with
 * them, turning them off strands every batch and its expiry. Either way the
 * answer is a new item. Null when the switch may change.
 */
export function batchSwitchRefusal(d: DB, productId: string, want: boolean): string | null {
  const p = d.products.find((x) => x.id === productId);
  if (!p || !!p.trackBatches === want) return null;
  const sold = d.sales.some((s) => s.status !== 'void' && s.lines.some((l) => l.productId === productId));
  if (!sold) return null;
  return want
    ? p.name + ' has already been sold without batches, so batches cannot be switched on for it now. Make a new item to track batches.'
    : p.name + ' has been sold from its batches, so batches cannot be switched off. Its batches and expiry dates stay.';
}

export function allPartyBalances(d: DB): Map<string, number> {
  const key = d.sales.length + ':' + d.purchases.length + ':' + d.parties.length + ':' + d.payments.length + ':' + (d.creditNotes || []).length;
  const had = balanceCache.get(d);
  if (had && had.key === key) return had.map;
  const map = new Map<string, number>();
  d.parties.forEach((p) => map.set(p.id, p.openingBalance || 0));
  d.sales.forEach((s) => { if (s.partyId && s.status !== 'void' && map.has(s.partyId)) map.set(s.partyId, map.get(s.partyId)! + s.due); });
  d.payments.forEach((p) => { if (p.unapplied && map.has(p.partyId)) map.set(p.partyId, map.get(p.partyId)! + (p.direction === 'in' ? -p.unapplied : p.unapplied)); });
  (d.creditNotes || []).forEach((c) => { const h = c.onAccount ? c.total : c.held || 0; if (h && c.partyId && map.has(c.partyId)) map.set(c.partyId, map.get(c.partyId)! - h); });
  d.purchases.forEach((x) => { if (x.partyId && x.status !== 'void' && map.has(x.partyId)) map.set(x.partyId, map.get(x.partyId)! - x.due); });
  map.forEach((v, id) => map.set(id, v + olderUnapplied(d, id)));
  // an expense the customer paid towards a bill since deleted: theirs, as credit
  (d.entries || []).forEach((e) => { const pid = deletedOffsetParty(d, e); if (pid && map.has(pid)) map.set(pid, map.get(pid)! - (e.offset ?? 0)); });
  balanceCache.set(d, { key, map });
  return map;
}

/**
 * With only recent trade in memory (a big book, store/bookstore.ts), an older
 * payment that settled no bill — an advance, money on account — stays on disk
 * and its amount came in only as a total. Its effect on the balance: money in
 * takes the balance down, money out takes it up. The party statement counted
 * it and the Parties list did not, so the two showed different balances.
 */
/**
 * An expense the customer settled was taken off their bill; while the bill
 * stands it is inside what the bill owes. With the bill deleted it is money
 * of theirs we used: credit on their account. The party it belongs to, then.
 */
function deletedOffsetParty(d: DB, e: Entry): string | null {
  if (!e.offsetSaleId || !(e.offset && e.offset > 0)) return null;
  const s = d.sales.find((x) => x.id === e.offsetSaleId);
  return s && s.status === 'void' && s.partyId ? s.partyId : null;
}

function olderUnapplied(d: DB, id: string): number {
  const w = (d as any).__window;
  const c = w && w.parties && w.parties[id];
  return c ? (c.payUnOut || 0) - (c.payUnIn || 0) : 0;
}

export function partyBalance(d: DB, id: string): number {
  const pt = d.parties.find((p) => p.id === id); if (!pt) return 0;
  let b = (pt.openingBalance || 0) + olderUnapplied(d, id);
  d.sales.forEach((s) => { if (s.partyId === id && s.status !== 'void') b += s.due; });
  d.purchases.forEach((x) => { if (x.partyId === id && x.status !== 'void') b -= x.due; });
  d.payments.forEach((p) => { if (p.partyId === id && p.unapplied) b += p.direction === 'in' ? -p.unapplied : p.unapplied; });
  (d.creditNotes || []).forEach((c) => { if (c.partyId === id) b -= c.onAccount ? c.total : c.held || 0; });
  (d.entries || []).forEach((e) => { if (deletedOffsetParty(d, e) === id) b -= e.offset ?? 0; });
  return b;
}

export interface FinancialYearStart {
  start: string;
  openingLines: number;
  customersCarried: number;
  suppliersCarried: number;
}

/**
 * Starts a clean reporting year without destroying the shop's setup.
 * Products retain their stock, parties retain their closing balances, and the
 * closing ledger net is represented by one balanced opening journal entry.
 */
export function startFinancialYear(d: DB, when = new Date()): FinancialYearStart {
  if (d.queue.length) throw new Refusal('Send the waiting sync changes before starting a new financial year.');
  const start = iso(when);
  const previousStart = d.financialYear?.start;
  const balances = new Map<string, number>();
  d.journal.forEach((entry) => entry.lines.forEach((line) => {
    balances.set(line.acc, (balances.get(line.acc) || 0) + (line.dr || 0) - (line.cr || 0));
  }));
  const openingLines = [...balances.entries()]
    .filter(([, value]) => Math.abs(value) >= 0.005)
    .map(([acc, value]) => value > 0 ? { acc, dr: value } : { acc, cr: -value });

  if (d.financialYear) {
    if (!d.archivedFinancialYears) d.archivedFinancialYears = [];
    d.archivedFinancialYears.push({
      id: uid('fy'), start: d.financialYear.start, endedAt: start, openingLines,
      customerBalances: d.parties.filter((p) => p.type === 'customer' && partyBalance(d, p.id) !== 0).length,
      supplierBalances: d.parties.filter((p) => p.type === 'supplier' && partyBalance(d, p.id) !== 0).length,
      stockValue: d.products.reduce((sum, p) => sum + Object.values(p.stock || {}).reduce((n, q) => n + q, 0) * p.cost, 0),
      transactionCounts: { sales: d.sales.length, purchases: d.purchases.length, payments: d.payments.length, journal: d.journal.length },
    });
  }

  const partyBalances = new Map(d.parties.map((party) => [party.id, partyBalance(d, party.id)]));
  d.parties.forEach((party) => { party.openingBalance = partyBalances.get(party.id) || 0; });

  d.sales = [];
  d.purchases = [];
  d.payments = [];
  d.entries = [];
  d.movements = [];
  d.creditNotes = [];
  d.journal = [];
  d.shifts = [];
  d.queue = [];
  if (openingLines.length) journal(d, when, 'Opening balances · ' + start.slice(0, 10), 'OPENING', openingLines);
  d.financialYear = { start, openedAt: start, previousStart };
  audit(d, 'Financial year started', start.slice(0, 10) + ' · ' + openingLines.length + ' opening balance(s)');

  return {
    start,
    openingLines: openingLines.length,
    customersCarried: d.parties.filter((p) => p.type === 'customer' && (p.openingBalance || 0) !== 0).length,
    suppliersCarried: d.parties.filter((p) => p.type === 'supplier' && (p.openingBalance || 0) !== 0).length,
  };
}

/**
 * How much of an expense a bill can absorb.
 *
 * A customer who settles a cost on the shop's behalf reduces what they owe, but
 * only up to what is still outstanding — the rest is an ordinary expense that
 * leaves the drawer. Split here so both halves post correctly.
 */
export function splitExpenseOffset(due: number, amount: number): { offset: number; rest: number } {
  const amt = Math.max(0, Number(amount) || 0);
  const owing = Math.max(0, Number(due) || 0);
  const offset = Math.min(owing, amt);
  return { offset, rest: amt - offset };
}

export function adjustStock(d: DB, productId: string, wh: string, count: number, reason = 'Stock adjustment', when = new Date(), batchNo?: string, userId?: string): number {
  const prod = d.products.find((x) => x.id === productId);
  if (!prod) return 0;
  // When a batch is named, the count is that batch's — the warehouse total moves
  // by the same difference so the two readings stay reconciled.
  const batch = batchNo ? (prod.batches || []).find((b) => b.no === batchNo) : undefined;
  const before = batch ? batch.qty : (prod.stock[wh] || 0);
  const delta = count - before;
  if (delta === 0) return 0;
  const value = postAdjustment(d, prod, wh, delta, reason, when, batch ? batch.no : undefined, userId);
  audit(
    d,
    'Stock adjusted',
    prod.name + (batch ? ' · batch ' + batch.no : ' · ' + wh) + ' ' + before + '→' + count
      + (delta !== 0 ? ' (' + (delta > 0 ? '+' : '') + delta + ')' : '')
      + ' — by ' + (d.users.find((u) => u.id === (userId || d.session.userId))?.name || 'unknown'),
  );
  return value;
}

/** One adjustment: the movement and its ledger entry, each naming the other. Returns its value. */
function postAdjustment(d: DB, prod: Product, wh: string, delta: number, reason: string, when: Date, batchNo?: string, userId?: string, extra?: Partial<Movement>): number {
  const mv = move(d, prod.id, wh, delta, 'adjust', reason, when, batchNo, userId, extra);
  const value = delta * (prod.cost || 0);
  if (value !== 0 && mv) {
    const jl: JournalLine[] = value > 0
      ? [{ acc: 'n_inventory', dr: value }, { acc: 'n_income', cr: value }]
      : [{ acc: 'n_expense', dr: -value }, { acc: 'n_inventory', cr: -value }];
    const je = journal(d, when, reason + ' — ' + prod.name, prod.id, jl);
    je.moveId = mv.id;
    mv.journalId = je.id;
  }
  return value;
}

/** Whether a movement is an adjustment that can still be taken back (not a reversal, not already reversed). */
export function adjustmentOpen(d: DB, moveId: string): Movement | null {
  const m = d.movements.find((x) => x.id === moveId);
  if (!m || m.type !== 'adjust' || m.reverses) return null;
  if (d.movements.some((x) => x.reverses === m.id)) return null;
  return m;
}

/**
 * Take back (delete) a stock adjustment. The shelf goes back to where it was
 * and the ledger entry is reversed; the pair leaves the item's transactions
 * and waits in Deleted transactions — the same as the computer's "take back",
 * so the two show the same thing.
 */
export function reverseAdjustment(d: DB, moveId: string, reason = 'Deleted', when = new Date(), userId?: string): Movement {
  if (!canWith(ensureRoles(d), d.session.role, 'inventory.stock_adjustment')) throw new Refusal('Your role cannot change stock adjustments.');
  const m = adjustmentOpen(d, moveId);
  if (!m) throw new Refusal('That adjustment is not there any more, or was already taken back.');
  const prod = d.products.find((x) => x.id === m.productId);
  if (!prod) throw new Refusal('The item of that adjustment is gone.');
  // taking back stock that came IN removes units: refused if they have since been sold
  if (m.qty > 0 && (prod.stock[m.wh] || 0) + 1e-9 < m.qty) {
    throw new Refusal('That adjustment put ' + m.qty + ' ' + prod.unit + ' on the shelf and only ' + (prod.stock[m.wh] || 0) + ' are left — taking it back would leave ' + prod.name + ' below zero.');
  }
  const back = move(d, m.productId, m.wh, -m.qty, 'adjust', 'Taken back' + (reason ? ' — ' + reason : '') + (m.ref ? ' · ' + m.ref : ''), when, m.batchNo, userId, { reverses: m.id });
  if (!back) throw new Refusal('The item of that adjustment is gone.');
  /* the ledger: exactly what the adjustment posted, the other way round */
  const je = m.journalId ? d.journal.find((x) => x.id === m.journalId) : undefined;
  const lines: JournalLine[] = je
    ? je.lines.map((l) => ({ acc: l.acc, ...(l.dr ? { cr: l.dr } : {}), ...(l.cr ? { dr: l.cr } : {}) }))
    : (() => {
      const value = -m.qty * (prod.cost || 0);
      return value === 0 ? [] : value > 0
        ? [{ acc: 'n_inventory', dr: value }, { acc: 'n_income', cr: value }]
        : [{ acc: 'n_expense', dr: -value }, { acc: 'n_inventory', cr: -value }];
    })();
  if (lines.length) {
    const rj = journal(d, when, 'Adjustment taken back — ' + prod.name, prod.id, lines);
    rj.moveId = back.id;
    back.journalId = rj.id;
  }
  audit(d, 'Stock adjustment taken back', prod.name + ' ' + (m.qty > 0 ? '+' : '') + m.qty + (reason ? ' — ' + reason : ''));
  return back;
}

/** Change an adjustment's quantity: the old one is taken back and the new one posted, in one step. */
export function changeAdjustment(d: DB, moveId: string, qty: number, reason?: string, when = new Date(), userId?: string): number {
  const m = adjustmentOpen(d, moveId);
  if (!m) throw new Refusal('That adjustment is not there any more, or was already taken back.');
  const prod = d.products.find((x) => x.id === m.productId)!;
  if (!Number.isFinite(qty) || qty === 0) throw new Refusal('Enter the quantity the adjustment should be — more than zero to add, less than zero to take off.');
  if ((prod.stock[m.wh] || 0) - m.qty + qty < -1e-9) throw new Refusal('That would leave ' + prod.name + ' below zero.');
  reverseAdjustment(d, moveId, 'Changed', when, userId);
  return postAdjustment(d, prod, m.wh, qty, reason || m.ref || 'Stock adjustment', when, m.batchNo, userId);
}

export function transferStock(d: DB, productId: string, from: string, to: string, qty: number, reason = 'Stock transfer', when = new Date()): number {
  const prod = d.products.find((x) => x.id === productId);
  if (!prod || qty <= 0 || from === to) return 0;
  const available = prod.stock[from] || 0;
  if (available < qty) return 0;
  move(d, productId, from, -qty, 'transfer', reason, when);
  move(d, productId, to, qty, 'transfer', reason, when);
  audit(d, 'Stock transfer', prod.name + ' · ' + from + '→' + to + ' ×' + qty);
  return qty;
}

/* ------------------------------------------------------------------
   Transfers to and from another business (one the same person runs).
   The account server holds the transfer and its story (server/src/
   transfers.core.js); these move this business's own stock and books:

     send      the goods leave this branch at cost — Dr Inter-branch, Cr Inventory
     receive   what arrived goes on the shelf; what did not is stock lost in
               transit — Dr Inventory, Dr Stock lost in transit, Cr Inter-branch
     call back the goods sent come back — Dr Inventory, Cr Inter-branch

   Each is keyed by the transfer's reference, so a step done twice is done once.
   ------------------------------------------------------------------ */
export interface BranchSendLine { productId: string; qty: number }
export interface BranchWireLine { name: string; item_code: string; unit: string; quantity: number; unit_cost: number; sale_price: number; batch_no: string; expiry_date: string | null }

/** Everything that would refuse a send, checked without changing anything. */
export function branchSendCheck(d: DB, lines: BranchSendLine[], ref: string): void {
  const wh = activeBranchId(d);
  const want = lines.filter((l) => l.qty > 0);
  if (!want.length) throw new Refusal('Add at least one item and quantity.');
  for (const l of want) {
    const p = d.products.find((x) => x.id === l.productId);
    if (!p) throw new Refusal('One of the items is not in this business.');
    if ((p.stock[wh] || 0) + 1e-9 < l.qty) throw new Refusal('Only ' + (p.stock[wh] || 0) + ' ' + p.unit + ' of ' + p.name + ' in stock.');
  }
  if (d.movements.some((m) => m.ref === ref && m.type === 'transfer_out')) throw new Refusal('This transfer has already been sent.');
}

export function branchSendOut(d: DB, lines: BranchSendLine[], ref: string, toName: string, when = new Date()): { lines: BranchWireLine[]; value: number } {
  branchSendCheck(d, lines, ref);
  const wh = activeBranchId(d);
  const want = lines.filter((l) => l.qty > 0);
  const out: BranchWireLine[] = [];
  let value = 0;
  for (const l of want) {
    const p = d.products.find((x) => x.id === l.productId)!;
    move(d, p.id, wh, -l.qty, 'transfer_out', ref, when);
    value += l.qty * (p.cost || 0);
    out.push({ name: p.name, item_code: p.sku || '', unit: p.unit || '', quantity: l.qty, unit_cost: p.cost || 0, sale_price: p.price || 0, batch_no: '', expiry_date: null });
  }
  value = cents(value);
  if (value > 0) journal(d, when, 'Stock sent to ' + toName, ref, [{ acc: 'n_interbranch', dr: value }, { acc: 'n_inventory', cr: value }]);
  audit(d, 'Stock sent to ' + toName, out.map((l) => l.name + ' ×' + l.quantity).join(', '));
  return { lines: out, value };
}

export interface BranchReceiveLine { productId: string; received: number; unitCost: number; sent: number }
export function branchReceiveIn(d: DB, lines: BranchReceiveLine[], ref: string, fromName: string, value: number, when = new Date()): { shortValue: number } {
  if (d.movements.some((m) => m.ref === ref && m.type === 'transfer_in')) return { shortValue: 0 };   // received already
  const wh = activeBranchId(d);
  let shortValue = 0;
  for (const l of lines) {
    if (l.received > 0) move(d, l.productId, wh, l.received, 'transfer_in', ref, when);
    shortValue += Math.max(0, l.sent - l.received) * (l.unitCost || 0);
  }
  shortValue = cents(shortValue);
  const v = cents(value || 0);
  if (v > 0) {
    const onShelf = cents(v - shortValue);
    journal(d, when, 'Stock received from ' + fromName + (shortValue > 0 ? ' (short)' : ''), ref, [
      ...(onShelf > 0 ? [{ acc: 'n_inventory', dr: onShelf }] : []),
      ...(shortValue > 0 ? [{ acc: 'n_transitloss', dr: shortValue }] : []),
      { acc: 'n_interbranch', cr: v },
    ]);
  }
  audit(d, 'Stock received from ' + fromName, lines.map((l) => l.received + '/' + l.sent).join(', '));
  return { shortValue };
}

/** The goods of a transfer this business sent come back onto the shelf. */
export function branchCallBack(d: DB, ref: string, toName: string, when = new Date()): number {
  if (d.movements.some((m) => m.ref === ref && m.type === 'transfer_cancel')) return 0;
  const sent = d.movements.filter((m) => m.ref === ref && m.type === 'transfer_out');
  let value = 0;
  for (const m of sent) {
    move(d, m.productId, m.wh, Math.abs(m.qty), 'transfer_cancel', ref, when);
    value += Math.abs(m.qty) * (d.products.find((p) => p.id === m.productId)?.cost || 0);
  }
  value = cents(value);
  if (value > 0) journal(d, when, 'Transfer to ' + toName + ' called back', ref, [{ acc: 'n_inventory', dr: value }, { acc: 'n_interbranch', cr: value }]);
  audit(d, 'Transfer called back', toName);
  return value;
}

export function postStockTake(d: DB, stockTakeId: string, when = new Date(), userId?: string): number {
  const st = d.stockTakes.find((x) => x.id === stockTakeId);
  if (!st || st.status === 'posted') return 0;
  let varValue = 0;
  st.lines.forEach((l) => {
    if (l.counted == null) return;
    const variance = l.counted - l.expected;
    if (variance === 0) return;
    const prod = d.products.find((p) => p.id === l.productId);
    if (l.batches && l.batches.length) {
      // correct each batch on its own so expiry stays attached to the right stock
      l.batches.forEach((b) => {
        if (b.counted == null) return;
        const bv = b.counted - b.expected;
        if (bv !== 0) move(d, l.productId, st.warehouse, bv, 'stocktake', st.id, when, b.no);
      });
    } else {
      move(d, l.productId, st.warehouse, variance, 'stocktake', st.id, when);
    }
    varValue += variance * (prod?.cost || 0);
  });
  if (varValue !== 0) {
    const jl: JournalLine[] = varValue > 0
      ? [{ acc: 'n_inventory', dr: varValue }, { acc: 'n_income', cr: varValue }]
      : [{ acc: 'n_expense', dr: -varValue }, { acc: 'n_inventory', cr: -varValue }];
    journal(d, when, 'Stock-take adjustment ' + st.warehouse, st.id, jl);
  }
  st.status = 'posted'; st.postedAt = iso(when); st.postedBy = userId || d.session.userId;
  audit(d, 'Stock-take posted', st.warehouse + ' — variance value ' + Math.round(varValue));
  return varValue;
}

/**
 * Makes plates of a dish from its recipe: the ingredients go out, the plates
 * come into stock at what they cost to make. Used for a batch cooked ahead
 * (Make on the menu) and, with ref 'auto', when a sale finds the stock short.
 * Ingredients may go below zero, as they may when a dish is sold to order.
 */
export function produceDish(d: DB, productId: string, qty: number, when = new Date(), ref = 'batch'): ProductionRun | null {
  const prod = d.products.find((p) => p.id === productId);
  if (!prod || !prod.recipe?.length || !(qty > 0)) return null;
  const wh = d.session.warehouse || 'w1';
  let componentCost = 0;
  prod.recipe.forEach((r) => {
    const ing = d.products.find((p) => p.id === r.productId);
    if (!ing) return;
    componentCost += (ing.cost || 0) * r.qty * qty;
    move(d, r.productId, wh, -(r.qty * qty), 'production-consume', ref === 'auto' ? 'AUTO' : 'MAKE', when);
  });
  componentCost = Math.round(componentCost * 100) / 100;
  if (componentCost > 0) prod.cost = Math.round(componentCost / qty * 100) / 100;
  move(d, productId, wh, qty, 'production-output', ref === 'auto' ? 'AUTO' : 'MAKE', when);
  const run: ProductionRun = { id: uid('prn'), ts: iso(when), productId, qty, warehouse: wh, componentCost, finishedValue: componentCost };
  d.productionRuns = d.productionRuns || [];
  d.productionRuns.push(run);
  enqueue(d, 'product', prod.id);
  if (ref !== 'auto') audit(d, 'Dish made', qty + ' x ' + prod.name);
  return run;
}

export function runProduction(d: DB, productId: string, qty: number, when = new Date()): ProductionRun | null {
  const prod = d.products.find((p) => p.id === productId);
  if (!prod || !prod.bom || !prod.bom.length || qty <= 0) return null;
  const wh = d.session.warehouse || 'w1';
  const canMake = prod.bom.every((b) => {
    const comp = d.products.find((p) => p.id === b.productId);
    return comp && (comp.stock[wh] || 0) >= b.qty * qty;
  });
  if (!canMake) return null;
  let componentCost = 0;
  prod.bom.forEach((b) => {
    const comp = d.products.find((p) => p.id === b.productId);
    if (!comp) return;
    componentCost += (comp.cost || 0) * b.qty * qty;
    move(d, b.productId, wh, -(b.qty * qty), 'production-consume', 'PRD', when);
  });
  move(d, productId, wh, qty, 'production-output', 'PRD', when);
  const finishedValue = (prod.cost || 0) * qty;
  const run: ProductionRun = { id: uid('prn'), ts: iso(when), productId, qty, warehouse: wh, componentCost, finishedValue };
  d.productionRuns.push(run);
  const jl: JournalLine[] = [{ acc: 'n_inventory', dr: finishedValue }, { acc: 'n_inventory', cr: componentCost }];
  const diff = finishedValue - componentCost;
  if (diff > 0) jl.push({ acc: 'n_income', cr: diff });
  else if (diff < 0) jl.push({ acc: 'n_expense', dr: -diff });
  journal(d, when, 'Production run ' + prod.name, run.id, jl);
  audit(d, 'Production run', qty + ' x ' + prod.name);
  return run;
}

export function nextRecurringDate(from: Date, frequency: 'weekly' | 'monthly'): Date {
  const next = new Date(from);
  if (frequency === 'weekly') next.setDate(next.getDate() + 7);
  else next.setMonth(next.getMonth() + 1);
  return next;
}

export function dueRecurring(d: DB, now = new Date()): RecurringInvoice[] {
  const t = now.getTime();
  return d.recurringInvoices.filter((r) => r.active && new Date(r.nextDue).getTime() <= t);
}

export function runRecurring(d: DB, id: string, when = new Date()): Sale | null {
  const ri = d.recurringInvoices.find((r) => r.id === id);
  if (!ri || !ri.active) return null;
  const sale = commitSale(d, { lines: ri.lines, partyId: ri.partyId, method: 'credit', discount: ri.discount }, when);
  ri.lastRun = iso(when);
  ri.nextDue = iso(nextRecurringDate(new Date(ri.nextDue), ri.frequency));
  audit(d, 'Recurring invoice run', sale.no);
  return sale;
}

/* ============================================================
   Instalment plans — reference instalSchedule (11683), the plan
   built in submitDoc (11739) and A.payInstal (11909).
   ============================================================ */

/**
 * Split `total` less `down` into `count` payments, `every` days apart,
 * the first falling due `every` days after `startIn`. Each instalment is
 * rounded to the nearest 50 and the last one carries the remainder, so
 * the schedule always adds back up to exactly what is owed.
 */
export function instalSchedule(
  total: number, down: number, count: number, every: number, startIn = 0, now = new Date(),
): InstalmentDue[] {
  const n = Math.max(1, Math.round(count) || 1);
  const dn = Math.max(0, Math.min(down || 0, total));
  const rest = Math.max(0, total - dn);
  const each = Math.round(rest / n / 50) * 50;
  const out: InstalmentDue[] = [];
  const base = addDays(now, startIn || 0);
  let run = 0;
  for (let i = 0; i < n; i++) {
    const amt = i === n - 1
      ? Math.max(0, rest - run)
      : Math.min(each, Math.max(0, rest - run));
    run += amt;
    out.push({ due: iso(addDays(base, (i + 1) * every)), amount: amt, paidAt: null });
  }
  return out;
}

export function planPaid(pl: InstalmentPlan): number {
  return pl.schedule.filter((x) => x.paidAt).reduce((a, x) => a + x.amount, 0);
}
/** What is still to come — the down payment counts as already settled. */
export function planOutstanding(pl: InstalmentPlan): number {
  return Math.max(0, pl.total - planPaid(pl) - (pl.down || 0));
}
export function planPct(pl: InstalmentPlan): number {
  if (!pl.total) return 0;
  return Math.round(Math.min(100, ((planPaid(pl) + (pl.down || 0)) / pl.total) * 100));
}
export function planNext(pl: InstalmentPlan): InstalmentDue | undefined {
  return pl.schedule.find((x) => !x.paidAt);
}
export function planIsLate(pl: InstalmentPlan, now = new Date()): boolean {
  return pl.schedule.some((x) => !x.paidAt && new Date(x.due).getTime() < now.getTime());
}

/**
 * Sell the goods on credit now and schedule the rest. The sale posts through
 * the ordinary `commitSale`, and any down payment through `recordPayment`, so
 * the ledger and the customer's balance are correct from the first moment.
 */
export function createInstalmentPlan(
  d: DB,
  o: { lines: SaleLine[]; partyId: string; discount?: number; down?: number; count?: number; every?: number; startIn?: number; note?: string },
  when = new Date(),
): InstalmentPlan | null {
  if (!o.partyId || !o.lines.length) return null;
  const t = saleTotals(o.lines, o.discount || 0, pricesIncludeTax(d));
  const down = Math.max(0, o.down || 0);
  // A down payment that covers the whole bill is an outright sale, not a plan.
  if (down >= t.total) return null;

  const sale = commitSale(d, { lines: o.lines, partyId: o.partyId, method: 'credit', discount: o.discount || 0 }, when);
  if (down > 0) {
    recordPayment(d, {
      partyId: o.partyId, amount: down, direction: 'in',
      accountId: d.accounts[0]?.id || 'acc_cash', note: 'Down payment on ' + sale.no,
    }, when);
  }
  const every = o.every || 30;
  const schedule = instalSchedule(t.total, down, o.count || 3, every, o.startIn || 0, when);
  d.counters.plan = (d.counters.plan || 0) + 1;
  const pl: InstalmentPlan = {
    id: uid('pln'), no: 'PLN-' + String(100000 + d.counters.plan).slice(1),
    saleId: sale.id, partyId: o.partyId, total: t.total, down, every,
    schedule, note: o.note || '', createdAt: iso(when),
  };
  d.instalmentPlans.push(pl);
  audit(d, 'Instalment plan created', pl.no + ' — ' + schedule.length + ' over ' + Math.round(t.total));
  enqueue(d, 'plan', pl.id);
  return pl;
}

/**
 * Receive one instalment. It posts as an ordinary receipt against the party,
 * which is what settles the credit sale behind the plan, so the plan and the
 * ledger can never drift apart.
 */
export function payInstalment(d: DB, planId: string, index: number, accountId?: string, when = new Date()): Payment | null {
  const pl = d.instalmentPlans.find((x) => x.id === planId);
  if (!pl) return null;
  const x = pl.schedule[index];
  if (!x || x.paidAt) return null;
  x.paidAt = iso(when);
  const pay = recordPayment(d, {
    partyId: pl.partyId || '', amount: x.amount, direction: 'in',
    accountId: accountId || d.accounts[0]?.id || 'acc_cash',
    note: 'Instalment on ' + pl.no,
  }, when);
  audit(d, 'Instalment received', pl.no + ' — ' + Math.round(x.amount));
  enqueue(d, 'plan', pl.id);
  return pay;
}

/* ============================================================
   Bulk changes — reference bulkScope (17167), buildBulkPlan (17242)
   and A.bulkApply (17313).
   ============================================================ */

export type BulkKind = 'bulkPrices' | 'bulkNames' | 'bulkActive' | 'bulkTags';

export type BulkForm = {
  scope?: string;            // 'all' or a category
  includeOff?: boolean;
  kind?: 'all' | 'product' | 'service';
  field?: string;            // price|cost for prices, name|note for names
  mode?: 'pct' | 'amt' | 'set';
  value?: number;
  round?: number;
  find?: string;
  replace?: string;
  act?: 'on' | 'off';
};

export type BulkRow = {
  id: string; name: string; from: string; to: string;
  apply: { field: string; value: string | number | boolean };
};

export type BulkPlan = { kind: BulkKind; title: string; note: string; rows: BulkRow[] };

/** A service is an item that is not stock-tracked — it has no unit of stock. */
function isService(p: Product): boolean {
  return !p.stock || Object.keys(p.stock).length === 0;
}

export function categoriesOf(d: DB): string[] {
  const seen: string[] = [];
  d.products.forEach((p) => { if (p.category && seen.indexOf(p.category) < 0) seen.push(p.category); });
  return seen.sort();
}

export function bulkScope(d: DB, v: BulkForm): Product[] {
  let list = d.products.filter((p) => (v.includeOff ? true : p.active));
  if (v.scope && v.scope !== 'all') list = list.filter((p) => p.category === v.scope);
  if (v.kind === 'product') list = list.filter((p) => !isService(p));
  if (v.kind === 'service') list = list.filter((p) => isService(p));
  return list;
}

/**
 * Work out exactly which items would change and to what, without touching
 * anything. The preview screen renders these rows; `applyBulkPlan` commits them.
 */
export function buildBulkPlan(d: DB, kind: BulkKind, v: BulkForm, money: (n: number) => string): BulkPlan {
  const list = bulkScope(d, v);
  const rows: BulkRow[] = [];
  let title = '', note = '';

  if (kind === 'bulkPrices') {
    const field = (v.field === 'cost' ? 'cost' : 'price') as 'cost' | 'price';
    const mode = v.mode || 'pct';
    const amt = Number(v.value) || 0;
    const round = Number(v.round) || 1;
    title = (field === 'price' ? 'Selling price' : 'Buying price') + ' — ' +
      (mode === 'pct' ? (amt >= 0 ? 'up ' : 'down ') + Math.abs(amt) + '%'
        : mode === 'amt' ? (amt >= 0 ? 'up by ' : 'down by ') + money(Math.abs(amt))
          : 'set to ' + money(amt));
    list.forEach((p) => {
      const from = Number(p[field]) || 0;
      let to = mode === 'pct' ? from * (1 + amt / 100) : mode === 'amt' ? from + amt : amt;
      to = Math.max(0, Math.round(to / round) * round);
      if (to === from) return;
      rows.push({ id: p.id, name: p.name, from: money(from), to: money(to), apply: { field, value: to } });
    });
    note = 'Prices already on a raised document do not change.';
  }

  if (kind === 'bulkNames') {
    const f = String(v.find || '');
    const r = String(v.replace || '');
    const field = v.field === 'note' ? 'note' : 'name';
    if (!f) return { kind, title: '', note: '', rows: [] };
    title = 'Replace “' + f + '” with “' + (r || 'nothing') + '” in the ' + (field === 'name' ? 'name' : 'description');
    list.forEach((p) => {
      const from = String((p as unknown as Record<string, unknown>)[field] || '');
      if (from.indexOf(f) < 0) return;
      const to = from.split(f).join(r);
      if (!to.trim() && field === 'name') return;   // never leave an item nameless
      rows.push({ id: p.id, name: p.name, from, to, apply: { field, value: to } });
    });
    note = 'Item codes and barcodes are untouched.';
  }

  if (kind === 'bulkActive') {
    const want = v.act === 'on';
    title = want ? 'Put back on the list' : 'Take off the list';
    // deliberately walks every product, not bulkScope: the inactive ones are
    // exactly the ones "put back on the list" has to find.
    d.products.forEach((p) => {
      if (v.scope && v.scope !== 'all' && p.category !== v.scope) return;
      if (p.active === want) return;
      rows.push({
        id: p.id, name: p.name,
        from: p.active ? 'On the list' : 'Off the list',
        to: want ? 'On the list' : 'Off the list',
        apply: { field: 'active', value: want },
      });
    });
    note = 'Stock and history stay exactly as they are.';
  }

  if (kind === 'bulkTags') {
    title = 'Move to a category';
    const target = String(v.replace || '').trim();
    if (!target) return { kind, title: '', note: '', rows: [] };
    list.forEach((p) => {
      if (p.category === target) return;
      rows.push({ id: p.id, name: p.name, from: p.category || '—', to: target, apply: { field: 'category', value: target } });
    });
    note = 'Reports already run are not redrawn.';
  }

  return { kind, title, note, rows };
}

export function applyBulkPlan(d: DB, plan: BulkPlan): number {
  let n = 0;
  plan.rows.forEach((r) => {
    const p = d.products.find((x) => x.id === r.id);
    if (!p) return;
    (p as unknown as Record<string, unknown>)[r.apply.field] = r.apply.value;
    n++;
  });
  if (n) audit(d, 'Bulk change applied', plan.title + ' — ' + n + ' item(s)');
  return n;
}

/* ============================================================
   Subscription and licence — reference isPro (18730), subState
   (18740), licState (21778) and the isPro override at 21908.
   ============================================================ */

export function subDaysLeft(s: Subscription, now = new Date()): number {
  const end = s.status === 'trial' ? s.trialUntil : s.renewsAt;
  return Math.ceil((new Date(end).getTime() - now.getTime()) / 864e5);
}

export function subState(s: Subscription, now = new Date()): { label: string; tone: 'accent' | 'danger' | 'warn' | 'good'; note: string } {
  const left = subDaysLeft(s, now);
  if (s.status === 'trial') {
    return left >= 0
      ? { label: 'Free trial', tone: 'accent', note: left + (left === 1 ? ' day' : ' days') + ' of Pro left' }
      : { label: 'Trial over', tone: 'danger', note: 'On Starter until you choose a plan' };
  }
  if (left < 0) return { label: 'Expired', tone: 'danger', note: 'Renew to get Pro back' };
  if (left <= 7) return { label: 'Renewing soon', tone: 'warn', note: left + (left === 1 ? ' day' : ' days') + ' to go' };
  return { label: 'Active', tone: 'good', note: 'Renews soon' };
}

export function licDaysSinceCheck(d: DB, now = new Date()): number {
  const l = d.licence;
  if (!l || !l.checkedAt) return 999;
  return (now.getTime() - new Date(l.checkedAt).getTime()) / 864e5;
}

/** What the till is allowed to do right now — reference licState(). */
export function licState(d: DB, now = new Date()): LicStatus {
  const l = d.licence;
  if (!l || !l.key) return 'none';
  if (l.status === 'active') {
    // an old answer is still an answer, for a while
    return licDaysSinceCheck(d, now) > LIC_GRACE ? 'stale' : 'active';
  }
  return l.status || 'none';
}

export function licOK(d: DB, now = new Date()): boolean {
  const s = licState(d, now);
  return s === 'active' || s === 'trial';
}

/** A stopped till may read its books and take a backup, but not record. */
export function licBlocks(d: DB, now = new Date()): boolean {
  const st = licState(d, now);
  return st === 'blocked' || st === 'expired' || st === 'revoked' ||
    st === 'unknown' || st === 'invalid' || st === 'stale' || st === 'toomany';
}

/**
 * A licensed till answers to the server; an unlicensed one keeps the local
 * trial. Reference: the isPro override at 21908.
 */
export function isPro(d: DB, now = new Date()): boolean {
  const l = d.licence;
  if (l && l.key) {
    if (!licOK(d, now) || !l.licence) return false;
    return l.licence.plan === 'pro' || l.licence.plan === 'lifetime' || l.licence.plan === 'trial';
  }
  const s = d.subscription;
  if (!s) return false;
  if (s.status === 'trial' && new Date(s.trialUntil).getTime() >= now.getTime()) return true;
  return s.plan === 'pro' && s.status === 'active';
}

/* ============================================================
   What the owner has paid for, in four words.

     paid       a paid plan, in force
     trial      the free trial, still running — everything but sync
     trialOver  the trial has ended and nothing has been bought
     lapsed     a paid plan that has run out, or been blocked

   Only `paid` and `trial` may create anything new. The books stay open to
   read, print, export and back up in every state, so nothing is held hostage.
   Sync needs `paid`: it is not part of the trial.
   ============================================================ */

export const TRIAL_DAYS = 7;
export type Access = 'paid' | 'trial' | 'trialOver' | 'lapsed';
const PAID = ['starter', 'pro', 'lifetime'];

export function access(d: DB, now = new Date()): Access {
  const l = d.licence;
  if (l && l.key && l.licence) {
    const ends = l.licence.expiresAt ? new Date(l.licence.expiresAt).getTime() : null;
    const past = ends !== null && ends < now.getTime();
    if (l.licence.plan === 'trial') return licOK(d, now) && !past ? 'trial' : 'trialOver';
    return licOK(d, now) && !past && PAID.indexOf(l.licence.plan) > -1 ? 'paid' : 'lapsed';
  }
  if (l && l.key) {
    // a licence with no plan details yet: its status is all there is to go on
    const st = licState(d, now);
    return st === 'active' ? 'paid' : st === 'trial' ? 'trial' : 'lapsed';
  }
  const s = d.subscription;
  // a device that has never heard from anyone has not run out of anything
  if (!s) return 'trial';
  if (s.status === 'trial') return new Date(s.trialUntil).getTime() >= now.getTime() ? 'trial' : 'trialOver';
  if (s.status === 'active' && new Date(s.renewsAt).getTime() >= now.getTime()) return 'paid';
  return 'lapsed';
}

/** New records may be made: a paid plan, or a trial that is still running. */
export function mayCreate(d: DB, now = new Date()): boolean {
  const a = access(d, now);
  return a === 'paid' || a === 'trial';
}

/** Whole days left on the trial or plan; null when there is no end (lifetime). */
export function accessDaysLeft(d: DB, now = new Date()): number | null {
  const l = d.licence;
  if (l && l.key && l.licence) {
    if (!l.licence.expiresAt) return null;
    return Math.ceil((new Date(l.licence.expiresAt).getTime() - now.getTime()) / 864e5);
  }
  return d.subscription ? subDaysLeft(d.subscription, now) : 0;
}

/** The plan in two short phrases, for rows and cards: "Free trial" · "5 days left". */
export function planSummary(d: DB, now = new Date()): { name: string; left: string; tone: 'good' | 'accent' | 'warn' | 'danger' } {
  const a = access(d, now);
  const days = accessDaysLeft(d, now);
  const n = Math.max(0, days || 0);
  const word = n === 1 ? '1 day left' : n + ' days left';
  const lic = d.licence && d.licence.key ? d.licence.licence : null;
  const paidName = lic ? (lic.planName || lic.plan) : d.subscription && d.subscription.plan === 'pro' ? 'Pro' : 'Starter';
  if (a === 'trial') return { name: 'Free trial', left: n === 0 ? 'Ends today' : word, tone: n <= 2 ? 'warn' : 'accent' };
  if (a === 'trialOver') return { name: 'Trial ended', left: 'Choose a plan', tone: 'danger' };
  if (a === 'lapsed') return { name: paidName + ' · expired', left: 'Renew', tone: 'danger' };
  return { name: paidName, left: days === null ? 'Lifetime' : word, tone: days !== null && n <= 7 ? 'warn' : 'good' };
}

export function licFeature(d: DB, f: string, now = new Date()): boolean {
  // sync is for paid plans only, whatever an older token may say
  if (f === 'sync' && access(d, now) !== 'paid') return false;
  const l = d.licence;
  if (l && l.key) {
    if (!licOK(d, now)) return false;
    if (!l.licence || !l.licence.features) return true;
    return l.licence.features.indexOf(f) > -1;
  }
  return isPro(d, now);
}

export function deviceLimit(d: DB): number {
  const l = d.licence;
  if (l && l.key && l.licence && l.licence.limits) return l.licence.limits.devices;
  return isPro(d) ? PLANS.pro.limits.devices : PLANS.starter.limits.devices;
}

/* ============================================================
   Version stamps — reference touch() / revisionsFor() at 20773.
   ============================================================ */

type Stamped = Record<string, unknown> & { id: string; _v?: number; _at?: string; _by?: string; _snap?: Record<string, unknown> };

/** Only scalar fields go into the diff — lines and lists stay out. */
function snapshotOf(rec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  Object.keys(rec).forEach((k) => {
    if (k.charAt(0) === '_') return;
    const v = rec[k];
    if (v && typeof v === 'object') return;
    out[k] = v;
  });
  return out;
}

function diffOf(before: Record<string, unknown> | null, after: Record<string, unknown>) {
  const changed: { f: string; from: unknown; to: unknown }[] = [];
  const keys: Record<string, 1> = {};
  Object.keys(before || {}).forEach((k) => { keys[k] = 1; });
  Object.keys(after).forEach((k) => { keys[k] = 1; });
  Object.keys(keys).forEach((k) => {
    const a = before ? before[k] : undefined;
    const b = after[k];
    if (String(a == null ? '' : a) !== String(b == null ? '' : b)) changed.push({ f: k, from: a, to: b });
  });
  return changed;
}

/**
 * An edit is a void and a fresh document under the same id: the fresh one
 * takes the old one's place in its history — compared with how it stood
 * before, so "Total 400 → 790, Due 0 → 390" shows — and the void the edit
 * made on the way is not a version of its own.
 */
function carryHistory(d: DB, id: string, fresh: unknown, wasSnap: Record<string, unknown>, wasV: number) {
  const f = fresh as Stamped;
  f._snap = wasSnap;
  f._v = wasV;
  const i = (d.revisions || []).map((r) => r.rec === id && /^Voided/.test(r.why || '')).lastIndexOf(true);
  if (i >= 0) d.revisions.splice(i, 1);
}

/** Stamp a record as changed and write the revision. The heart of version history. */
export function touch(d: DB, rec: unknown, why: string, coll: string): void {
  if (!rec || typeof rec !== 'object') return;
  const r = rec as Stamped;
  const before = r._snap || null;
  r._v = (r._v || 0) + 1;
  r._at = iso(new Date());
  r._by = d.session.userId;
  const after = snapshotOf(r as Record<string, unknown>);
  const changed = before ? diffOf(before, after) : [];
  r._snap = after;
  if (!Array.isArray(d.revisions)) d.revisions = [];
  d.revisions.push({
    id: uid('rev'), rec: r.id, coll, v: r._v, ts: r._at, by: r._by, dev: 'dev_this',
    why: why || '', changed, no: String(r.no || r.name || ''),
  });
  if (d.revisions.length > 600) d.revisions = d.revisions.slice(-500);
  const kind = coll === 'sales' ? 'sale'
    : coll === 'purchases' ? 'purchase'
      : coll === 'payments' ? 'payment'
        : coll === 'entries' ? 'entry'
          : coll === 'journal' ? 'journal'
            : coll === 'movements' ? 'movement'
              : coll === 'creditNotes' ? 'creditNote'
                : coll === 'products' ? 'product'
                  : coll === 'parties' ? 'party' : '';
  if (kind) enqueue(d, kind, r.id);
}

export function revisionsFor(d: DB, id: string): Revision[] {
  return (d.revisions || []).filter((r) => r.rec === id).slice().reverse();
}

/* ============================================================
   Updates — reference verCmp (23044).
   ============================================================ */

/**
 * Compare dotted build numbers numerically. Comparing them as text makes
 * 4.10 older than 4.2, which is how an update that matters gets skipped.
 */
export function verCmp(a: string, b: string): number {
  const A = String(a || '0').split('.').map(Number);
  const B = String(b || '0').split('.').map(Number);
  for (let i = 0; i < Math.max(A.length, B.length); i++) {
    const x = Number.isNaN(A[i]) ? 0 : (A[i] || 0);
    const y = Number.isNaN(B[i]) ? 0 : (B[i] || 0);
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

/* ============================================================
   Shifts — the drawer reconciliation
   Reference shiftTotals()/shiftVar() behind SHEETS.closeShift (7262-7300)
   and SCREENS.shifts (2585).
   ============================================================ */

export interface ShiftTotals {
  /** money received against debts on this shift, by any account, and how many payments */
  recvAll?: number; recvCount?: number;
  /** bills rung up on this shift */
  count: number;
  /** what was sold, all methods */
  total: number;
  /** cash taken at the till */
  cash: number;
  momo: number;
  bank: number;
  /** sold on credit — never reaches the drawer */
  credit: number;
  /** receipts against older bills, paid into a cash account */
  recv: number;
  /** cash paid out of the drawer: expenses and supplier payments */
  paidOut: number;
  /** opening float + cash + receipts − paid out */
  expected: number;
}

function cashAccountIds(d: DB): string[] {
  return d.accounts.filter((a) => a.type === 'cash').map((a) => a.id);
}

/** Everything that touched the drawer between a shift's open and its close (or now). */
/** The bills rung up on a shift. */
export function shiftSales(d: DB, shift: Shift): Sale[] {
  const from = new Date(shift.openedAt).getTime();
  const to = shift.closedAt ? new Date(shift.closedAt).getTime() : Date.now();
  const prevClose = d.shifts.reduce((n, s) => {
    if (s.id === shift.id || !s.closedAt || s.till !== shift.till) return n;
    const c = new Date(s.closedAt).getTime();
    return c <= from && c > n ? c : n;
  }, -1);
  return d.sales.filter((s) => {
    if (s.status === 'void' || s.userId !== shift.userId || s.till !== shift.till) return false;
    const t = new Date(s.ts).getTime();
    if (t > to) return false;
    return prevClose >= from ? t > prevClose : t >= from;
  });
}

/** Whether a record dated `ts` falls in a day that has been closed. */
export function inClosedDay(d: DB, ts: string | undefined): boolean {
  const c = d.settings.closedThrough;
  return !!c && !!ts && new Date(ts).getTime() <= new Date(c).getTime();
}

/** Refuses to change anything in a closed day. */
export function guardOpenDay(d: DB, ts: string | undefined) {
  if (!inClosedDay(d, ts)) return;
  const when = new Date(d.settings.closedThrough!).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  throw new Refusal('That day is closed', 'Everything up to ' + when + ' was frozen at day close. Ask the owner to reopen the day to change it.');
}

export function shiftTotals(d: DB, shift: Shift): ShiftTotals {
  const from = new Date(shift.openedAt).getTime();
  const to = shift.closedAt ? new Date(shift.closedAt).getTime() : Date.now();
  // A shift opened the instant the last one closed must not re-count that
  // shift's final bill, so the earlier close is an exclusive lower bound.
  const prevClose = d.shifts.reduce((n, s) => {
    if (s.id === shift.id || !s.closedAt || s.till !== shift.till) return n;
    const c = new Date(s.closedAt).getTime();
    return c <= from && c > n ? c : n;
  }, -1);
  const within = (ts: string) => {
    const t = new Date(ts).getTime();
    if (t > to) return false;
    return prevClose >= from ? t > prevClose : t >= from;
  };
  const cashAccs = cashAccountIds(d);

  const sales = d.sales.filter((s) => s.status !== 'void' && s.userId === shift.userId && s.till === shift.till && within(s.ts));
  const paidOn = (m: PayMethod) => sales.reduce((n, s) => {
    if (s.methods && s.methods.length > 1) return n + s.methods.filter((x) => x.method === m).reduce((t, x) => t + x.amount, 0);
    return n + (s.method === m ? s.paidAtSale : 0);
  }, 0);

  const cash = paidOn('cash');
  const momo = paidOn('momo');
  const bank = paidOn('bank');
  // a credit bill may still take something at the till; that part is cash in the drawer
  const creditPaid = paidOn('credit');
  const credit = sales.filter((s) => s.method === 'credit').reduce((n, s) => n + s.due, 0);

  const recv = d.payments
    .filter((p) => p.direction === 'in' && p.userId === shift.userId && cashAccs.indexOf(p.accountId) > -1 && within(p.ts))
    .reduce((n, p) => n + p.amount, 0);
  // every payment taken against a debt on this shift, by any account
  const received = d.payments.filter((p) => p.direction === 'in' && p.userId === shift.userId && within(p.ts));
  const recvAll = received.reduce((n, p) => n + p.amount, 0);

  const paidOutPayments = d.payments
    .filter((p) => p.direction === 'out' && p.userId === shift.userId && cashAccs.indexOf(p.accountId) > -1 && within(p.ts))
    .reduce((n, p) => n + p.amount, 0);
  const paidOutEntries = d.entries
    .filter((e) => e.direction === 'out' && e.userId === shift.userId && cashAccs.indexOf(e.accountId) > -1 && within(e.ts))
    .reduce((n, e) => n + e.amount, 0);
  const cashIn = d.entries
    .filter((e) => e.direction === 'in' && e.userId === shift.userId && cashAccs.indexOf(e.accountId) > -1 && within(e.ts))
    .reduce((n, e) => n + e.amount, 0);

  const paidOut = paidOutPayments + paidOutEntries;
  const drawerCash = cash + creditPaid;
  const expected = shift.openingFloat + drawerCash + recv + cashIn - paidOut;

  return {
    count: sales.length,
    total: sales.reduce((n, s) => n + s.total, 0),
    cash: drawerCash, momo, bank, credit,
    recv: recv + cashIn, paidOut,
    expected: Math.round(expected),
    recvAll, recvCount: received.length,
  };
}

export type ShiftVariance = { diff: number; state: 'balanced' | 'over' | 'short' };

/** Reference shiftVar(), line 7294 — under a shilling either way is "balanced". */
export function shiftVariance(expected: number, counted: number): ShiftVariance {
  const diff = Math.round(counted - expected);
  if (Math.abs(diff) < 1) return { diff: 0, state: 'balanced' };
  return { diff, state: diff < 0 ? 'short' : 'over' };
}

/**
 * Close a shift and make the books tie out: a short drawer is an expense, an
 * over drawer is other income, both against the cash account — reference the
 * "Posted as an expense / other income so the books still tie out" note at 7300.
 */
export function closeShift(d: DB, shiftId: string, countedCash: number, note = '', when = new Date()): Shift | null {
  const s = d.shifts.find((x) => x.id === shiftId);
  if (!s || s.closedAt) return null;
  const z = shiftTotals(d, s);
  const v = shiftVariance(z.expected, countedCash);

  s.closedAt = iso(when);
  s.countedCash = Math.round(countedCash);
  s.expected = z.expected;
  s.variance = v.diff;
  s.note = note;

  const cashAcc = d.accounts.find((a) => a.type === 'cash')?.id || 'acc_cash';
  if (v.state === 'short') {
    journal(d, when, 'Cash short on ' + s.till, 'SHIFT', [
      { acc: 'n_expense', dr: -v.diff }, { acc: cashAcc, cr: -v.diff },
    ]);
  } else if (v.state === 'over') {
    journal(d, when, 'Cash over on ' + s.till, 'SHIFT', [
      { acc: cashAcc, dr: v.diff }, { acc: 'n_income', cr: v.diff },
    ]);
  }
  audit(d, 'Shift closed', 'Counted ' + Math.round(countedCash) + ' · ' +
    (v.state === 'balanced' ? 'balanced' : v.state + ' ' + Math.abs(v.diff)));
  enqueue(d, 'shift.close', s.id);
  return s;
}

export function openShiftFor(d: DB, openingFloat: number, till?: string, when = new Date()): Shift {
  const s: Shift = {
    id: uid('sft'), userId: d.session.userId, till: till || d.session.till,
    openedAt: iso(when), closedAt: null, openingFloat: Math.round(openingFloat),
    countedCash: null, expected: null, variance: null, note: '',
    branch: activeBranchId(d),
  };
  d.shifts.push(s);
  audit(d, 'Shift opened', 'Float ' + Math.round(openingFloat));
  enqueue(d, 'shift.open', s.id);
  return s;
}

export function lastClosedShift(d: DB): Shift | undefined {
  return d.shifts.filter((s) => s.closedAt).slice(-1)[0];
}

/* ============================================================
   Correcting and removing posted documents.

   Reference: `A.editSale` (17496), `SCREENS.editSale` (17509),
   `A.editSaleSave` (17612), `A.deleteSale` (17654),
   `repostPayment` / `unapplyPayment` / `applyPayment` (17700-17745),
   `A.deletePayment` (17745), the `editWindow` sheet (17935).

   A posted record is never rewritten in place. An edit voids the
   original — reversing its ledger and stock effects — and posts a
   corrected document under the same number, so the trail survives.
   A delete is the reversal without the repost.
   ============================================================ */

/** The edit window from settings — reference A.editSale, line 17500. */
export function editWindowOK(d: DB, ts: string, now = new Date()): { ok: boolean; why: string } {
  const days = d.settings.editWindowDays || 0;
  if (days <= 0) return { ok: true, why: '' };
  const age = (now.getTime() - new Date(ts).getTime()) / 864e5;
  if (age > days) {
    return { ok: false, why: 'This was recorded more than ' + days + ' day' + (days === 1 ? '' : 's') +
      ' ago. The books are closed for it — raise a credit note instead.' };
  }
  return { ok: true, why: '' };
}

/** Anything already void, or outside the window, cannot be touched again. */
export function canEditSale(d: DB, saleId: string, now = new Date()): { ok: boolean; why: string } {
  if (inClosedDay(d, d.sales.find((x) => x.id === saleId)?.ts)) return { ok: false, why: 'That day is closed. Ask the owner to reopen it.' };
  if (!canWith(ensureRoles(d), d.session.role, 'sales.edit')) return { ok: false, why: 'Your role cannot change a raised sale.' };
  const s = d.sales.find((x) => x.id === saleId);
  if (!s) return { ok: false, why: 'That sale is gone.' };
  if (s.status === 'void') return { ok: false, why: 'That sale is already void.' };
  return editWindowOK(d, s.ts, now);
}

export function canEditPurchase(d: DB, purchaseId: string, now = new Date()): { ok: boolean; why: string } {
  if (inClosedDay(d, d.purchases.find((x) => x.id === purchaseId)?.ts)) return { ok: false, why: 'That day is closed. Ask the owner to reopen it.' };
  if (!canWith(ensureRoles(d), d.session.role, 'purchases.edit')) return { ok: false, why: 'Your role cannot change a purchase.' };
  const x = d.purchases.find((p) => p.id === purchaseId);
  if (!x) return { ok: false, why: 'That purchase is gone.' };
  if (x.status === 'void') return { ok: false, why: 'That purchase is already reversed.' };
  return editWindowOK(d, x.ts, now);
}

export function canEditPayment(d: DB, payId: string, now = new Date()): { ok: boolean; why: string } {
  if (inClosedDay(d, d.payments.find((x) => x.id === payId)?.ts)) return { ok: false, why: 'That day is closed. Ask the owner to reopen it.' };
  if (!canWith(ensureRoles(d), d.session.role, 'finance.edit')) return { ok: false, why: 'Your role cannot change a payment.' };
  const p = d.payments.find((x) => x.id === payId);
  if (!p) return { ok: false, why: 'That payment is gone.' };
  return editWindowOK(d, p.ts, now);
}

/** Point journal/stock rows posted under a freshly generated number back at the original. */
function renumber(d: DB, from: string, to: string) {
  d.journal.forEach((j) => {
    if (j.ref === from) { j.ref = to; j.memo = j.memo.split(from).join(to); }
  });
  d.movements.forEach((m) => { if (m.ref === from) m.ref = to; });
}

/** Void-and-repost a bill — reference A.editSaleSave, line 17612. */
/** How an edited sale is paid, when the edit screen says (the same choices as a new sale). */
export type EditPay = Pick<Parameters<typeof commitSale>[1], 'method' | 'methods' | 'received' | 'receivedVia' | 'momoNetwork' | 'momoRef' | 'wht' | 'taxOnTop' | 'additionalCharges' | 'description' | 'terms' | 'showPayment' | 'rx' | 'priceListId'>;

export function editSale(
  d: DB,
  saleId: string,
  o: { lines: SaleLine[]; partyId: string | null; discount: number; ref?: string; note?: string; pay?: EditPay },
  reason = 'Replaced by an edit',
  when = new Date(),
): Sale | null {
  if (!canWith(ensureRoles(d), d.session.role, 'sales.edit')) {
    throw new Refusal('Permission denied: sales.edit');
  }
  const s = d.sales.find((x) => x.id === saleId);
  if (!s || s.status === 'void') return null;
  if (!o.lines.length) return null;
  const oldNo = s.no, oldTs = s.ts, oldMethod = s.method, oldWh = s.warehouse, oldPaid = s.paid, oldTill = s.till, oldUser = s.userId;
  // the sale as it stood, so its history shows what the edit changed (total, paid, owed, customer)
  const wasSnap = snapshotOf(s as unknown as Record<string, unknown>), wasV = (s as any)._v || 0;
  // money paid on the sale after it was made (separate payments) stays with it
  const paidLater = Math.max(0, (s.paid || 0) - (s.paidAtSale ?? s.paid ?? 0));

  voidSale(d, s.id, reason, when);

  const prevWh = d.session.warehouse, prevTill = d.session.till;
  d.session.warehouse = oldWh;
  d.session.till = oldTill || prevTill;
  let fresh: Sale;
  try {
    /* The same posting as a new sale, with what the edit screen chose — the
       method, what was received, "exact" — so the sale's paid and owed agree
       with what goes into the cash book. It used to keep the old amount paid
       while posting the whole new total to cash: an increase showed a balance
       the books did not have. The person who made the sale stays its seller,
       so it stays in their list (an edit by someone else used to move it). */
    fresh = commitSale(d, { ...(o.pay || {}), lines: o.lines, partyId: o.partyId, method: o.pay?.method || oldMethod, discount: o.discount, userId: oldUser }, new Date(oldTs));
  } finally {
    d.session.warehouse = prevWh;
    d.session.till = prevTill;
  }

  /* keep the original number, date and history */
  d.counters.sale -= 1;
  renumber(d, fresh.no, oldNo);
  fresh.no = oldNo; fresh.ts = oldTs;
  // an edit keeps the number it had: real stays real, a temporary one still waits for the server
  if (s.numberPending) fresh.numberPending = true; else delete fresh.numberPending;
  fresh.ref = o.ref || ''; fresh.note = o.note || '';
  fresh.editedFrom = s.id; fresh.editedAt = iso(when);
  fresh.editedBy = d.session.userId; fresh.editCount = (s.editCount || 0) + 1;

  /* money already taken stays taken: without a payment choice from the screen,
     as before; with one, what was paid later (separate receipts) still counts */
  if (!o.pay && oldMethod !== 'credit') {
    const keep = Math.min(oldPaid, fresh.total);
    /* The new sale was posted as paid in full; only what was taken stays taken.
       The rest is owed, in the books as on the bill: before, the bill said
       owed while the till was credited with money nobody handed over — and a
       later delete of it took that money back out, unbalancing the books. */
    const extra = cents(fresh.paid - keep);
    if (extra > 0.005 && !(fresh.methods && fresh.methods.length > 1)) {
      const via = fresh.method === 'credit' ? (fresh.receivedVia || 'cash') : fresh.method;
      journal(d, when, 'Owed on edited ' + oldNo, oldNo, [{ acc: 'n_ar', dr: extra }, { acc: via === 'momo' ? 'acc_momo' : via === 'bank' ? 'acc_bank' : 'acc_cash', cr: extra }]);
    }
    fresh.paid = keep; fresh.paidAtSale = keep; fresh.due = Math.max(0, fresh.total - keep);
  } else if (paidLater > 0) {
    const add = Math.min(paidLater, Math.max(0, fresh.due));
    fresh.paid += add; fresh.due = Math.max(0, fresh.due - add);
  }
  d.sales = d.sales.filter((x) => x.id !== s.id);
  const freshId = fresh.id;
  fresh.id = s.id;
  (d.warranties || []).forEach((w) => { if (w.saleId === freshId) w.saleId = s.id; });
  d.queue = d.queue.filter((q: any) => !(q.kind === 'sale' && q.ref === freshId));
  enqueue(d, 'sale', s.id);
  audit(d, 'Sale edited', oldNo + ' — now ' + Math.round(fresh.total));
  carryHistory(d, s.id, fresh, wasSnap, wasV);
  touch(d, fresh, 'Edited' + (reason ? ' — ' + reason : ''), 'sales');
  return fresh;
}

/** Reference A.deleteSale, line 17654 — a delete is a reversal, never a splice. */
/**
 * A bill being deleted gives back the money paid on it afterwards (separate
 * receipts or payments): that money was received and stays received, now on
 * the party's account as an advance. Before, the delete treated it as handed
 * back in cash — the cash book went down, the payment still named the gone
 * bill, and the party's balance did not move although the bill had gone.
 * Returns the amount freed; the bill then owes it, so its void reverses it
 * from what is owed, not from the till.
 */
function releaseLaterReceipts(d: DB, bill: { id: string; paid: number; due: number; receipts?: BillReceipt[] }): number {
  let freed = 0;
  (bill.receipts || []).forEach((r) => {
    const pay = d.payments.find((x) => x.id === r.paymentId);
    if (!pay || !(r.amount > 0)) return;
    const a = (pay.allocations || []).find((x) => x.docId === bill.id);
    const amt = Math.min(r.amount, a ? a.amount : r.amount);
    if (a) a.amount = cents(a.amount - amt);
    pay.allocations = (pay.allocations || []).filter((x) => x.amount > 0.005);
    pay.unapplied = cents((pay.unapplied || 0) + amt);
    // remembered, so putting the bill back sets the money against it again
    (pay as any).freedFrom = [...(((pay as any).freedFrom) || []).filter((f: any) => f.docId !== bill.id), { docId: bill.id, amount: amt }];
    enqueue(d, 'payment', pay.id);
    freed += amt;
  });
  if (freed > 0) {
    bill.paid = cents(bill.paid - freed);
    bill.due = cents(bill.due + freed);
    bill.receipts = (bill.receipts || []).filter((r) => !d.payments.some((x) => x.id === r.paymentId));
  }
  return freed;
}

export function deleteSale(d: DB, saleId: string, reason = 'Deleted', when = new Date()): boolean {
  if (!canWith(ensureRoles(d), d.session.role, 'sales.delete')) {
    throw new Refusal('Permission denied: sales.delete');
  }
  const s = d.sales.find((x) => x.id === saleId);
  if (!s || s.status === 'void') return false;
  releaseLaterReceipts(d, s);
  voidSale(d, s.id, reason, when);
  s.deletedAt = iso(when); s.deletedBy = d.session.userId;
  enqueue(d, 'sale', s.id);
  audit(d, 'Sale deleted', s.no + ' — reversed and logged');
  return true;
}

/** The purchase counterpart of voidSale: stock comes back off the shelf, the ledger unwinds. */
export function voidPurchase(d: DB, purchaseId: string, reason = '', when = new Date()): boolean {
  const x = d.purchases.find((p) => p.id === purchaseId);
  if (!x || x.status === 'void') return false;
  x.status = 'void'; x.voidedAt = iso(when); x.voidReason = reason;
  enqueue(d, 'purchase', x.id);
  const wh = d.session.warehouse || 'w1';
  x.lines.forEach((l) => move(d, l.productId, wh, -l.qty, 'void', x.no, when));
  const jl: JournalLine[] = [{ acc: 'n_inventory', cr: x.total }];
  if (x.due > 0) jl.push({ acc: 'n_ap', dr: x.due });
  if (x.paid > 0) jl.push({ acc: x.method === 'bank' ? 'acc_bank' : x.method === 'momo' ? 'acc_momo' : 'acc_cash', dr: x.paid });
  journal(d, when, 'Void ' + x.no, x.no, jl);
  audit(d, 'Purchase voided', x.no + (reason ? ' — ' + reason : ''));
  touch(d, x, 'Voided' + (reason ? ' — ' + reason : ''), 'purchases');
  return true;
}

export function editPurchase(
  d: DB,
  purchaseId: string,
  o: { partyId: string; lines: PurchaseLine[]; method: PayMethod; ref?: string; note?: string },
  reason = 'Replaced by an edit',
  when = new Date(),
): Purchase | null {
  if (!canWith(ensureRoles(d), d.session.role, 'purchases.edit')) {
    throw new Refusal('Permission denied: purchases.edit');
  }
  const x = d.purchases.find((p) => p.id === purchaseId);
  if (!x || x.status === 'void') return null;
  if (!o.lines.length) return null;
  const oldNo = x.no, oldTs = x.ts;
  const wasSnap = snapshotOf(x as unknown as Record<string, unknown>), wasV = (x as any)._v || 0;
  voidPurchase(d, x.id, reason, when);
  const fresh = createPurchase(d, o.partyId, o.lines, o.method, new Date(oldTs));
  d.counters.purchase -= 1;
  renumber(d, fresh.no, oldNo);
  fresh.no = oldNo; fresh.ts = oldTs;
  fresh.ref = o.ref || ''; fresh.note = o.note || '';
  fresh.editedFrom = x.id; fresh.editedAt = iso(when);
  fresh.editedBy = d.session.userId; fresh.editCount = (x.editCount || 0) + 1;
  d.purchases = d.purchases.filter((p) => p.id !== x.id);
  const freshId = fresh.id;
  fresh.id = x.id;
  d.queue = d.queue.filter((q: any) => !(q.kind === 'purchase' && q.ref === freshId));
  enqueue(d, 'purchase', x.id);
  audit(d, 'Purchase edited', oldNo + ' — now ' + Math.round(fresh.total));
  carryHistory(d, x.id, fresh, wasSnap, wasV);
  touch(d, fresh, 'Edited' + (reason ? ' — ' + reason : ''), 'purchases');
  return fresh;
}

export function deletePurchase(d: DB, purchaseId: string, reason = 'Deleted', when = new Date()): boolean {
  if (!canWith(ensureRoles(d), d.session.role, 'purchases.delete')) {
    throw new Refusal('Permission denied: purchases.delete');
  }
  const x = d.purchases.find((p) => p.id === purchaseId);
  if (!x || x.status === 'void') return false;
  releaseLaterReceipts(d, x as any);
  voidPurchase(d, x.id, reason, when);
  x.deletedAt = iso(when); x.deletedBy = d.session.userId;
  enqueue(d, 'purchase', x.id);
  audit(d, 'Purchase deleted', x.no + ' — reversed and logged');
  return true;
}

/** Reference unapplyPayment, line 17722 — hand the money back to the bills it settled. */
export function unapplyPayment(d: DB, pay: Payment) {
  /* A payment that names the bills it settled hands back exactly those: the
     same record the computer keeps, so both take back the same money. */
  if (pay.allocations && pay.allocations.length) {
    pay.allocations.forEach((a) => {
      const bill: any = pay.direction === 'in' ? d.sales.find((x) => x.id === a.docId) : d.purchases.find((x) => x.id === a.docId);
      if (!bill) return;
      bill.paid = cents(Math.max(0, (bill.paid || 0) - a.amount));
      if (bill.status !== 'void') bill.due = cents((bill.due || 0) + a.amount);
      if (bill.receipts) bill.receipts = bill.receipts.filter((r: { paymentId: string }) => r.paymentId !== pay.id);
    });
    pay.allocations = [];
    pay.unapplied = 0;
    return;
  }
  let left = pay.amount;
  const list: { paid: number; due: number; ts: string }[] = pay.direction === 'in'
    ? d.sales.filter((s) => s.partyId === pay.partyId && s.paid > 0 && s.status !== 'void')
    : d.purchases.filter((x) => x.partyId === pay.partyId && x.paid > 0 && x.status !== 'void');
  list.sort((a, b) => tsMs(b.ts) - tsMs(a.ts));
  list.forEach((x) => {
    if (left <= 0) return;
    const give = Math.min(left, x.paid);
    x.paid -= give; x.due += give; left -= give;
  });
}

/** Reference applyPayment, line 17734 — oldest bill first. */
export function applyPayment(d: DB, pay: Payment) {
  /* oldest bill first, and the bills it settles written on the payment, as a new payment does */
  let left = pay.amount + (pay.taxDeducted || 0);
  const bills: any[] = pay.direction === 'in'
    ? d.sales.filter((x) => x.partyId === pay.partyId && x.due > 0.005 && x.status !== 'void')
    : d.purchases.filter((x) => x.partyId === pay.partyId && x.due > 0.005 && x.status !== 'void');
  bills.sort((a, b) => tsMs(a.ts) - tsMs(b.ts));
  const out: Array<{ docId: string; no: string; amount: number }> = [];
  bills.forEach((bill) => {
    if (left <= 0.005) return;
    const take = cents(Math.min(left, bill.due));
    bill.due = cents(bill.due - take); bill.paid = cents((bill.paid || 0) + take); left = cents(left - take);
    bill.receipts = [...(bill.receipts || []), { paymentId: pay.id, amount: take, ts: pay.ts }];
    out.push({ docId: bill.id, no: bill.no, amount: take });
  });
  pay.allocations = out;
  pay.unapplied = left > 0.005 ? cents(left) : 0;
}

/** The older rule, for a payment that named no bills: oldest first, nothing recorded. */
export function applyPaymentLoose(d: DB, pay: Payment) {
  let left = pay.amount;
  const list: { paid: number; due: number; ts: string }[] = pay.direction === 'in'
    ? d.sales.filter((s) => s.partyId === pay.partyId && s.due > 0 && s.status !== 'void')
    : d.purchases.filter((x) => x.partyId === pay.partyId && x.due > 0 && x.status !== 'void');
  list.sort((a, b) => tsMs(a.ts) - tsMs(b.ts));
  list.forEach((x) => {
    if (left <= 0) return;
    const take = Math.min(left, x.due);
    x.due -= take; x.paid += take; left -= take;
  });
}

/** Money to or from a customer is set against debtors, to or from a supplier
 *  against creditors, whichever way it goes — a refund to a guest lowers what
 *  the guest is owed, not what we owe suppliers. Anyone else: by direction. */
export function ctrlOf(d: DB, partyId: string | null | undefined, direction: string): 'n_ar' | 'n_ap' {
  const t = partyId ? d.parties.find((p) => p.id === partyId)?.type : undefined;
  if (t === 'supplier') return 'n_ap';
  if (t === 'customer') return 'n_ar';
  return direction === 'in' ? 'n_ar' : 'n_ap';
}

/** Reference repostPayment, line 17700 — reverse what the old one did, then post the new one. */
export function editPayment(
  d: DB,
  payId: string,
  patch: { amount: number; accountId?: string; note?: string },
  when = new Date(),
): Payment | null {
  if (!canWith(ensureRoles(d), d.session.role, 'finance.edit')) {
    throw new Refusal('Permission denied: finance.edit');
  }
  const pay = d.payments.find((x) => x.id === payId);
  if (!pay || !(patch.amount > 0)) return null;
  const oldAmt = pay.amount, oldAcc = pay.accountId;
  const rev: JournalLine[] = pay.direction === 'in'
    ? [{ acc: oldAcc, cr: oldAmt }, { acc: ctrlOf(d, pay.partyId, pay.direction), dr: oldAmt }]
    : [{ acc: ctrlOf(d, pay.partyId, pay.direction), cr: oldAmt }, { acc: oldAcc, dr: oldAmt }];
  journal(d, when, 'Reverse ' + (pay.direction === 'in' ? 'receipt' : 'payment') + ' — edit', 'EDIT', rev);
  unapplyPayment(d, pay);

  pay.amount = patch.amount;
  pay.accountId = patch.accountId || pay.accountId;
  if (patch.note !== undefined) pay.note = patch.note;
  pay.method = d.accounts.find((a) => a.id === pay.accountId)?.type || 'cash';
  pay.editedAt = iso(when);
  pay.editedBy = d.session.userId; pay.editCount = (pay.editCount || 0) + 1;

  const post: JournalLine[] = pay.direction === 'in'
    ? [{ acc: pay.accountId, dr: pay.amount }, { acc: ctrlOf(d, pay.partyId, pay.direction), cr: pay.amount }]
    : [{ acc: ctrlOf(d, pay.partyId, pay.direction), dr: pay.amount }, { acc: pay.accountId, cr: pay.amount }];
  const partyName = d.parties.find((p) => p.id === pay.partyId)?.name || '';
  journal(d, when, (pay.direction === 'in' ? 'Receipt from ' : 'Payment to ') + partyName + ' — edited', 'EDIT', post);
  applyPayment(d, pay);
  // the payment itself goes to the other devices: its new amount and the bills it now settles
  enqueue(d, 'payment', pay.id);
  audit(d, 'Payment edited', Math.round(oldAmt) + ' to ' + Math.round(pay.amount));
  touch(d, pay, 'Edited', 'payments');
  return pay;
}

/** Reference A.deletePayment, line 17745 — the balance goes back up. */
/* Everything a document posted under its number, turned back: each ledger entry
   by an opposite one, each stock movement by an opposite movement. */
function reverseRef(d: DB, ref: string, label: string, when: Date) {
  d.journal.filter((j) => j.ref === ref && !j.reversedAt).forEach((j) => {
    journal(d, when, 'Reverse ' + j.memo + ' — ' + label, 'DEL', j.lines.map((l) => ({ acc: l.acc, ...(l.dr ? { cr: l.dr } : {}), ...(l.cr ? { dr: l.cr } : {}) })));
    j.reversedAt = iso(when);
  });
  d.movements.filter((mv) => mv.ref === ref && mv.type !== 'void').forEach((mv) => move(d, mv.productId, mv.wh, -mv.qty, 'void', ref, when, mv.batchNo));
}

/** A return taken back: its stock goes out again, its money and the bill it cleared are as they were. */
export function deleteCreditNote(d: DB, id: string, when = new Date()): boolean {
  const cn = (d.creditNotes || []).find((x) => x.id === id);
  if (!cn) return false;
  reverseRef(d, cn.no, 'return deleted', when);
  if (cn.onAccount) {
    // held on account: leaving the list is all it takes
  } else if (cn.partyId && !cn.saleId) {
    const pt = d.parties.find((p) => p.id === cn.partyId);
    if (pt) pt.openingBalance += cn.total;
  } else if (cn.saleId && cn.appliedToSale) {
    const s = d.sales.find((x) => x.id === cn.saleId);
    if (s) { s.due += cn.appliedToSale; enqueue(d, 'sale', s.id); }
  }
  d.creditNotes = d.creditNotes.filter((x) => x.id !== id);
  tombstone(d, 'creditNote', { ...cn, voided: true, deletedAt: iso(when) });
  audit(d, 'Credit note deleted', cn.no + ' — ' + Math.round(cn.total));
  return true;
}

/** A record deleted here, kept just long enough to tell the other devices it is gone. */
function tombstone(d: DB, kind: string, rec: { id: string } & Record<string, unknown>) {
  if (!d.sync?.on) return;
  d.tombstones = { ...(d.tombstones || {}), [kind + ':' + rec.id]: rec };
  enqueue(d, kind, rec.id);
}

/** An expense, money in or a transfer between accounts, undone. */
export function deleteEntry(d: DB, id: string, when = new Date()): boolean {
  const e = d.entries.find((x) => x.id === id);
  if (!e) return false;
  const memo = 'Reverse ' + e.category + ' — deleted';
  if (e.direction === 'transfer') {
    journal(d, when, memo, 'DEL', [{ acc: e.accountId, dr: e.amount }, { acc: e.toId || 'acc_cash', cr: e.amount }]);
  } else if (e.direction === 'in') {
    journal(d, when, memo, 'DEL', [{ acc: e.accountId, cr: e.amount }, { acc: e.ledgerId || 'n_income', dr: e.amount }]);
  } else {
    const exp = e.ledgerId || 'n_expense';
    const s = e.offsetSaleId ? d.sales.find((x) => x.id === e.offsetSaleId) : undefined;
    // charged to a customer's bill: the part that came off the bill goes back on it
    const offset = s ? Math.min(e.offset ?? e.amount, s.paid) : 0;
    if (s && offset > 0) {
      s.due += offset; s.paid -= offset; enqueue(d, 'sale', s.id);
      journal(d, when, memo, 'DEL', [{ acc: 'n_ar', dr: offset }, { acc: exp, cr: offset }]);
    }
    const rest = e.amount - offset;
    if (rest > 0) journal(d, when, memo, 'DEL', [{ acc: e.accountId, dr: rest }, { acc: exp, cr: rest }]);
  }
  d.entries = d.entries.filter((x) => x.id !== id);
  // the other devices are told: before, only the reversal went and the computer kept the expense
  tombstone(d, 'entry', { ...e, voided: true, deletedAt: iso(when) });
  audit(d, 'Entry deleted', e.category + ' — ' + Math.round(e.amount));
  return true;
}

/**
 * What deleting a document will do, in words, for the question asked before
 * it goes: stock back or off the shelf, money out of or into an account,
 * what the party owes, and payments made on it afterwards — which stay, as
 * credit on the party's account.
 */
export function deleteEffects(d: DB, kind: 'sale' | 'purchase' | 'payment', id: string): string[] {
  const out: string[] = [];
  const n = (v: number) => Math.round(v).toLocaleString('en-US');
  const pname = (pid?: string | null) => d.parties.find((p) => p.id === pid)?.name || '';
  const accName = (aid: string) => d.accounts.find((a) => a.id === aid)?.name || aid;
  if (kind === 'sale' || kind === 'purchase') {
    const doc: any = kind === 'sale' ? d.sales.find((x) => x.id === id) : d.purchases.find((x) => x.id === id);
    if (!doc) return out;
    const units = (doc.lines || []).reduce((a: number, l: any) => a + (Number(l.qty) || 0), 0);
    if (units) out.push(kind === 'sale' ? n(units) + ' item' + (units === 1 ? '' : 's') + ' go back on the shelf.' : n(units) + ' item' + (units === 1 ? '' : 's') + ' come off the shelf.');
    const atDoc = kind === 'sale' ? (doc.paidAtSale ?? (doc.method === 'credit' ? 0 : doc.paid)) : (doc.method === 'credit' ? 0 : doc.total);
    const till = Math.max(0, atDoc - (doc.redeemed || 0) - (doc.wht || 0));
    if (till > 0.5) {
      const via = doc.method === 'credit' ? (doc.receivedVia || 'cash') : doc.method;
      const acc = via === 'momo' ? 'Mobile money' : via === 'bank' ? 'Bank' : 'Cash';
      out.push(kind === 'sale' ? n(till) + ' taken at the counter comes out of ' + acc + '.' : n(till) + ' paid with it goes back into ' + acc + '.');
    }
    const later = (doc.receipts || []).filter((r: any) => d.payments.some((p) => p.id === r.paymentId)).reduce((a: number, r: any) => a + (Number(r.amount) || 0), 0);
    if (later > 0.5) out.push((kind === 'sale' ? 'A payment of ' + n(later) + ' made on it afterwards stays as credit for ' : 'A payment of ' + n(later) + ' made on it afterwards stays as an advance to ') + (pname(doc.partyId) || 'the party') + '.');
    if (doc.due > 0.5) out.push((pname(doc.partyId) || (kind === 'sale' ? 'The customer' : 'The supplier')) + (kind === 'sale' ? ' no longer owes ' : ' is no longer owed ') + n(doc.due) + '.');
    if (kind === 'sale') {
      const cns = (d.creditNotes || []).filter((c) => c.saleId === id);
      if (cns.length) out.push('Its return' + (cns.length === 1 ? ' ' + cns[0].no + ' stays' : 's ' + cns.map((c) => c.no).join(', ') + ' stay') + ' — delete separately if it should go too.');
    }
    out.push('It can be brought back from Deleted transactions.');
  } else {
    const p = d.payments.find((x) => x.id === id);
    if (!p) return out;
    out.push(n(p.amount) + (p.direction === 'in' ? ' comes out of ' : ' goes back into ') + accName(p.accountId) + '.');
    (p.allocations || []).forEach((a) => out.push((a.no || 'A bill') + ' is owed ' + n(a.amount) + ' again.'));
    if ((p.unapplied || 0) > 0.5) out.push((pname(p.partyId) || 'The party') + "'s credit of " + n(p.unapplied || 0) + ' goes.');
    out.push('It can be brought back from Deleted transactions.');
  }
  return out;
}

/* ============================================================
   THE BOOKS THEMSELVES — find, and put right, what old deletes left wrong.

   Everything a deleted sale or purchase posted under its number, together
   with its reversal, nets to nothing on every account: that is what a delete
   is. Older versions missed a line — the money taken at the counter on a
   credit sale was never taken back out, money paid on a bill afterwards was
   taken out of the till instead of off the debtors — so some deleted
   documents still leave a balance on an account. Each one found is put right
   with one entry under its own number; a second run finds nothing more.
   ============================================================ */
export interface BookIssue { kind: 'fixable' | 'look'; what: string; detail: string; amount: number; ref?: string }
interface BookFix { ref: string; memo: string; lines: JournalLine[] }

function leftOver(d: DB, ref: string): JournalLine[] {
  const net = new Map<string, number>();
  d.journal.filter((e) => e.ref === ref).forEach((e) => e.lines.forEach((l) => net.set(l.acc, (net.get(l.acc) || 0) + (l.dr || 0) - (l.cr || 0))));
  const out: JournalLine[] = [];
  net.forEach((v, acc) => { const c = cents(v); if (Math.abs(c) >= 0.01) out.push(c > 0 ? { acc, cr: c } : { acc, dr: -c }); });
  return out;
}

export function checkBooks(d: DB): { issues: BookIssue[]; fixes: BookFix[] } {
  const issues: BookIssue[] = [];
  const fixes: BookFix[] = [];
  const accName = (id: string) => (d.coa || []).find((l) => l.id === id)?.name || d.accounts.find((a) => a.id === id)?.name || id;
  const docs: Array<{ no: string; kind: string; ts: string }> = [
    ...d.sales.filter((x) => x.status === 'void').map((x) => ({ no: x.no, kind: 'Sale', ts: x.ts })),
    ...d.purchases.filter((x) => x.status === 'void').map((x) => ({ no: x.no, kind: 'Purchase', ts: x.ts })),
  ];
  // a number a live document still uses (an edited one keeps its number) is not a deleted document's alone
  const live = new Set([...d.sales.filter((x) => x.status !== 'void').map((x) => x.no), ...d.purchases.filter((x) => x.status !== 'void').map((x) => x.no)]);
  docs.forEach((doc) => {
    if (live.has(doc.no)) return;
    const lines = leftOver(d, doc.no);
    if (!lines.length) return;
    const amount = lines.reduce((a, l) => a + (l.dr || 0), 0);
    fixes.push({ ref: doc.no, memo: 'Repair ' + doc.no + ' — what its delete left behind', lines });
    issues.push({ kind: 'fixable', ref: doc.no, amount,
      what: doc.kind + ' ' + doc.no + ' was deleted but still leaves money in the books',
      detail: lines.map((l) => accName(l.acc) + ' ' + (l.dr ? '+' : '−') + Math.round(l.dr || l.cr || 0).toLocaleString('en-US')).join(' · ') });
  });
  // a document's entries whose debits and credits differ (taken together under its number; none should)
  const byRef = new Map<string, { dr: number; cr: number; memo: string }>();
  d.journal.forEach((e) => {
    const k = byRef.get(e.ref) || { dr: 0, cr: 0, memo: e.memo };
    e.lines.forEach((l) => { k.dr += l.dr || 0; k.cr += l.cr || 0; });
    byRef.set(e.ref, k);
  });
  byRef.forEach((k, ref) => {
    if (Math.abs(k.dr - k.cr) >= 0.01 && !fixes.some((f) => f.ref === ref)) {
      issues.push({ kind: 'look', ref, amount: cents(Math.abs(k.dr - k.cr)), what: 'Entries that do not balance: ' + (k.memo || ref), detail: 'Debits ' + Math.round(k.dr).toLocaleString('en-US') + ', credits ' + Math.round(k.cr).toLocaleString('en-US') });
    }
  });
  return { issues, fixes };
}

/** Posts every fix checkBooks found. Returns what was put right. */
export function repairBooks(d: DB, when = new Date()): BookIssue[] {
  if (!canWith(ensureRoles(d), d.session.role, 'settings.edit')) throw new Refusal('Permission denied: settings.edit');
  const { issues, fixes } = checkBooks(d);
  fixes.forEach((f) => journal(d, when, f.memo, f.ref, f.lines));
  const done = issues.filter((i) => i.kind === 'fixable');
  if (done.length) audit(d, 'Books repaired', done.map((i) => i.ref + ': ' + i.detail).join('; '));
  return done;
}


/* ============================================================
   MONEY IN AND OUT, AND RETURNS — kept here, beside sales and payments,
   so the screens and the tests go through the same rules.
   ============================================================ */

/** An expense, or money in: the entry, its ledger lines, and a bill it is set against. */
export function recordEntry(d: DB, o: { direction: 'in' | 'out' | 'transfer'; accountId: string; category: string; amount: number; note?: string; ledgerId?: string; userId?: string; offsetSaleId?: string; toId?: string }): Entry {
  let e!: Entry;
  const when = new Date();
  const sale = o.offsetSaleId ? d.sales.find((x) => x.id === o.offsetSaleId) : undefined;
  // only a bill with a balance can absorb one, and only up to what is left
  const split = sale && o.direction === 'out'
    ? splitExpenseOffset(sale.due, o.amount)
    : { offset: 0, rest: o.amount };
  const offset = split.offset;

  e = {
    id: uid('ent'), ts: iso(when), direction: o.direction, accountId: o.accountId,
    branch: activeBranchId(d),
    category: o.category, amount: o.amount, note: o.note || '',
    ...(o.ledgerId ? { ledgerId: o.ledgerId } : {}),
    userId: o.userId || d.session.userId,
    ...(offset > 0 ? { offsetSaleId: sale!.id, offset } : {}),
  };
  d.entries.push(e);
  enqueue(d, 'entry', e.id);
  if (offset > 0) enqueue(d, 'sale', sale!.id);

  const memo = o.category + (o.note ? ' — ' + o.note : '');
  const expLedger = o.ledgerId || 'n_expense';
  const incLedger = o.ledgerId || 'n_income';

  if (offset > 0) {
    // the customer settled it, so the cost is ours but the debt is theirs less
    sale!.due -= offset;
    sale!.paid += offset;
    journal(d, when, memo + ' — against ' + sale!.no, sale!.no, [
      { acc: expLedger, dr: offset },
      { acc: 'n_ar', cr: offset },
    ]);
    // anything above the outstanding balance still leaves the drawer
    const rest = split.rest;
    if (rest > 0) {
      journal(d, when, memo, 'EXP', [{ acc: expLedger, dr: rest }, { acc: o.accountId, cr: rest }]);
    }
    audit(d, 'Expense offset', memo + ' — ' + Math.round(offset) + ' off ' + sale!.no);
  } else if (o.direction === 'out') {
    journal(d, when, memo, 'EXP', [{ acc: expLedger, dr: o.amount }, { acc: o.accountId, cr: o.amount }]);
  } else {
    journal(d, when, memo, 'INC', [{ acc: o.accountId, dr: o.amount }, { acc: incLedger, cr: o.amount }]);
  }
  return e;
}

/** A return: the goods back on the shelf, the sale reversed, and the customer made good. */
export function createCreditNote(d: DB, o: { saleId: string | null; partyId: string | null; lines: CreditNoteLine[]; reason: string; refund?: 'cash' | 'bank' | 'momo' | 'account'; charges?: number; userId?: string }): CreditNote {
  let cn!: CreditNote;
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
  enqueue(d, 'creditNote', cn.id);
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
  if (o.partyId && !o.saleId && refund === 'account') {
    // no bill named: held on their account, which the balance counts — the opening balance is left alone,
    // or the ledger (which shows the return itself) counted it twice
    cn.onAccount = true;
  } else if (o.saleId && refund === 'account') {
    // only a credit to the account takes it off what the bill owes; cash handed back leaves the bill as it was
    const s = d.sales.find((x) => x.id === o.saleId);
    const take = s && s.due > 0 ? Math.min(s.due, total) : 0;
    if (s && take > 0) { s.due -= take; cn.appliedToSale = take; }
    // more than the bill still owed: the rest is held on their account
    if (total - take > 0.005) cn.held = total - take;
  }
  audit(
    d,
    'Credit note issued',
    cn.no + ' — ' + Math.round(total) + (charges ? ' (charge ' + Math.round(charges) + ')' : '')
      + ' by ' + (d.users.find((u) => u.id === cn.userId)?.name || 'unknown'),
  );
  return cn;
}

/** A journal written by hand, undone by its opposite; both leave the lists. */
export function deleteJournal(d: DB, id: string, when = new Date()): boolean {
  const j = d.journal.find((x) => x.id === id);
  if (!j || j.reversedAt) return false;
  journal(d, when, 'Reverse ' + j.memo + ' — deleted', 'DEL', j.lines.map((l) => ({ acc: l.acc, ...(l.dr ? { cr: l.dr } : {}), ...(l.cr ? { dr: l.cr } : {}) })));
  j.reversedAt = iso(when);
  audit(d, 'Journal deleted', (j.memo || j.ref) + ' — ' + Math.round(j.lines.reduce((s, l) => s + (l.dr || 0), 0)));
  return true;
}

export function deletePayment(d: DB, payId: string, reason = 'Deleted', when = new Date()): boolean {
  if (!canWith(ensureRoles(d), d.session.role, 'finance.delete')) {
    throw new Refusal('Permission denied: finance.delete');
  }
  const pay = d.payments.find((x) => x.id === payId);
  if (!pay) return false;
  // the withholding tax kept back comes out with it
  const wht = pay.taxDeducted || 0;
  const rev: JournalLine[] = pay.direction === 'in'
    ? [{ acc: pay.accountId, cr: pay.amount }, ...(wht ? [{ acc: 'n_wht_credit', cr: wht }] : []), { acc: ctrlOf(d, pay.partyId, pay.direction), dr: pay.amount + wht }]
    : [{ acc: ctrlOf(d, pay.partyId, pay.direction), cr: pay.amount + wht }, { acc: pay.accountId, dr: pay.amount }, ...(wht ? [{ acc: 'n_tax', dr: wht }] : [])];
  journal(d, when, 'Reverse ' + (pay.direction === 'in' ? 'receipt' : 'payment') + ' — deleted', 'DEL', rev);
  unapplyPayment(d, pay);
  d.payments = d.payments.filter((x) => x.id !== pay.id);
  // kept in the bin, so it can be put back
  d.deletedPayments = [...(d.deletedPayments || []), { ...pay, deletedAt: iso(when), deletedBy: d.session.userId, deleteReason: reason }];
  // the other devices are told it is gone (it travels as voided, from the bin): before, only its reversal went,
  // and the computer kept the payment with its bills marked paid
  enqueue(d, 'payment', pay.id);
  audit(d, 'Payment deleted', Math.round(pay.amount) + (reason ? ' — ' + reason : ''));
  return true;
}

/* ============================================================
   DELETED TRANSACTIONS — the bin

   A delete never erased anything: it posted a reversal. Restoring posts the
   reversal's mirror image — the very lines the delete wrote, sides swapped —
   and moves the stock back, so the books end exactly as they were before
   the delete, with both steps on the record.
   ============================================================ */

/**
 * A bill put back takes back the payments its delete freed (as far as they
 * are still free and the bill still owes): restored as it was, not with its
 * payments left as credit on the account.
 */
function relinkFreed(d: DB, bill: { id: string; no: string; ts?: string; paid: number; due: number; receipts?: BillReceipt[] }) {
  d.payments.forEach((pay) => {
    const fr = ((pay as any).freedFrom || []) as { docId: string; amount: number }[];
    const mine = fr.find((f) => f.docId === bill.id);
    if (!mine) return;
    const take = cents(Math.min(mine.amount, pay.unapplied || 0, bill.due));
    (pay as any).freedFrom = fr.filter((f) => f.docId !== bill.id);
    if (take <= 0.004) return;
    pay.unapplied = cents((pay.unapplied || 0) - take);
    pay.allocations = [...(pay.allocations || []), { docId: bill.id, no: bill.no, amount: take }];
    bill.due = cents(bill.due - take); bill.paid = cents(bill.paid + take);
    bill.receipts = [...(bill.receipts || []), { paymentId: pay.id, amount: take, ts: pay.ts }];
    enqueue(d, 'payment', pay.id);
  });
}

/** Every journal entry a delete wrote for a document. */
function voidEntries(d: DB, ref: string, at?: string): JournalEntry[] {
  return (d.journal || []).filter((e) => e.ref === ref && (e.memo.startsWith('Void ') || e.memo.startsWith('Reverse cost '))
    && (!at || e.ts === at));
}

function mirror(lines: JournalLine[]): JournalLine[] {
  return lines.map((l) => ({ acc: l.acc, ...(l.dr ? { cr: l.dr } : {}), ...(l.cr ? { dr: l.cr } : {}) }));
}

export function restoreSale(d: DB, saleId: string, when = new Date()): Sale {
  if (!canWith(ensureRoles(d), d.session.role, 'settings.deleted')) throw new Refusal('Permission denied: settings.deleted');
  const s = d.sales.find((x) => x.id === saleId);
  if (!s || !s.deletedAt || s.status !== 'void') throw new Refusal('That sale is not in Deleted transactions.');
  guardOpenDay(d, s.ts);
  const keepWh = d.session.warehouse;
  d.session.warehouse = s.warehouse || keepWh;
  const blockers = saleBlockers(d, s.lines);
  d.session.warehouse = keepWh;
  if (blockers.length) throw new Refusal(s.no + ' cannot be restored yet', blockers.join('\n'));
  // the money the sale took must still be there to give back, where cash control asks
  voidEntries(d, s.no, s.voidedAt).forEach((e) => journal(d, when, 'Restore ' + s.no, s.no, mirror(e.lines)));
  s.lines.forEach((l) => move(d, l.productId, s.warehouse, -stockQty(l), 'restore', s.no, when, l.batchNo));
  s.status = 'complete';
  delete s.voidedAt; delete s.voidReason; delete s.deletedAt; delete s.deletedBy;
  relinkFreed(d, s);
  enqueue(d, 'sale', s.id);
  audit(d, 'Sale restored', s.no);
  touch(d, s, 'Restored', 'sales');
  return s;
}

export function restorePurchase(d: DB, purchaseId: string, when = new Date()): Purchase {
  if (!canWith(ensureRoles(d), d.session.role, 'settings.deleted')) throw new Refusal('Permission denied: settings.deleted');
  const x = d.purchases.find((p) => p.id === purchaseId);
  if (!x || !x.deletedAt || x.status !== 'void') throw new Refusal('That purchase is not in Deleted transactions.');
  const entries = voidEntries(d, x.no, x.voidedAt);
  // putting a paid purchase back takes its money out of the drawer again
  guardCash(d, entries.flatMap((e) => e.lines).filter((l) => l.dr).map((l) => ({ acc: l.acc, amount: l.dr || 0 })));
  entries.forEach((e) => journal(d, when, 'Restore ' + x.no, x.no, mirror(e.lines)));
  const wh = x.branch || d.session.warehouse || 'w1';
  x.lines.forEach((l) => move(d, l.productId, wh, l.qty, 'restore', x.no, when));
  x.status = 'complete';
  delete x.voidedAt; delete x.voidReason; delete x.deletedAt; delete x.deletedBy;
  relinkFreed(d, x as any);
  enqueue(d, 'purchase', x.id);
  audit(d, 'Purchase restored', x.no);
  touch(d, x, 'Restored', 'purchases');
  return x;
}

export function restorePayment(d: DB, payId: string, when = new Date()): Payment {
  if (!canWith(ensureRoles(d), d.session.role, 'settings.deleted')) throw new Refusal('Permission denied: settings.deleted');
  const held = (d.deletedPayments || []).find((p) => p.id === payId && !p.purgedAt);
  if (!held) throw new Refusal('That payment is not in Deleted transactions.');
  if (held.direction === 'out') guardCash(d, [{ acc: held.accountId, amount: held.amount }]);
  const { deletedAt: _a, deletedBy: _b, deleteReason: _c, purgedAt: _d, ...pay } = held;
  // as recordPayment posts it: the tax withheld settled the bill as much as the money did
  const wht = pay.taxDeducted || 0;
  const lines: JournalLine[] = pay.direction === 'in'
    ? [{ acc: pay.accountId, dr: pay.amount }, ...(wht ? [{ acc: 'n_wht_credit', dr: wht }] : []), { acc: ctrlOf(d, pay.partyId, pay.direction), cr: pay.amount + wht }]
    : [{ acc: ctrlOf(d, pay.partyId, pay.direction), dr: pay.amount + wht }, { acc: pay.accountId, cr: pay.amount }, ...(wht ? [{ acc: 'n_tax', cr: wht }] : [])];
  journal(d, when, 'Restore ' + (pay.direction === 'in' ? 'receipt' : 'payment'), 'RST', lines);
  d.payments.push(pay as Payment);
  applyPayment(d, pay as Payment);
  d.deletedPayments = (d.deletedPayments || []).filter((p) => p.id !== payId);
  enqueue(d, 'payment', pay.id);
  audit(d, 'Payment restored', Math.round(pay.amount) + '');
  return pay as Payment;
}

/** Takes something out of Deleted transactions for good. Its reversal stays in the books. */
export function purgeDeleted(d: DB, kind: 'sale' | 'purchase' | 'payment', id: string, when = new Date()): void {
  if (!canWith(ensureRoles(d), d.session.role, 'settings.deleted')) throw new Refusal('Permission denied: settings.deleted');
  const at = iso(when);
  if (kind === 'sale') { const s = d.sales.find((x) => x.id === id); if (s) { s.purgedAt = at; enqueue(d, 'sale', id); } }
  if (kind === 'purchase') { const x = d.purchases.find((p) => p.id === id); if (x) { x.purgedAt = at; enqueue(d, 'purchase', id); } }
  if (kind === 'payment') { const p = (d.deletedPayments || []).find((x) => x.id === id); if (p) p.purgedAt = at; }
  audit(d, 'Deleted transaction removed for good', kind + ' ' + id);
}


/* ============================================================
   OPENING A BRANCH

   A branch is run as a separate business: its own stock, its own drawer, its
   own books and its own paperwork. Opening one is therefore not "add a row to
   the warehouse list" — it is a small company formation, and it has to happen
   as one act. If the branch were created and then the float posted separately,
   a failure in between would leave a shop with no money in a book that says it
   opened, which is exactly the state nobody can explain a month later.
   ============================================================ */

export interface BranchPlan {
  name: string;
  address?: string;
  phone?: string;
  /** Document prefix, e.g. 'STALL' — falls back to 'INV'. */
  prefix?: string;
  managerId?: string;
  taxEnabled?: boolean;
  /** The branch's own cash drawer. */
  drawerName?: string;
  openingFloat?: number;
  /** An optional second account — a bank or mobile-money wallet of its own. */
  extraAccount?: { name: string; type: 'bank' | 'wallet' } | null;
  /** Stock to move in on day one, taken off the branch it comes from. */
  stockFrom?: string | null;
  stockLines?: Array<{ productId: string; qty: number }>;
  /** Start working in the new branch straight away. */
  makeActive?: boolean;
}

export interface BranchOpened {
  warehouseId: string;
  cashAccountId: string;
  moved: number;
  shortfalls: Array<{ productId: string; name: string; wanted: number; had: number }>;
}

export function openBranch(d: DB, plan: BranchPlan, when = new Date()): BranchOpened {
  const name = (plan.name || '').trim();
  if (!name) throw new Refusal('A branch needs a name.');
  if (d.warehouses.some((w) => w.name.trim().toLowerCase() === name.toLowerCase())) {
    throw new Refusal('There is already a branch called ' + name + '.');
  }

  const id = 'wh_' + uid('x').slice(-6);
  d.warehouses.push({
    id,
    name,
    address: plan.address,
    phone: plan.phone,
    prefix: (plan.prefix || '').trim().toUpperCase() || undefined,
    managerId: plan.managerId,
    taxEnabled: plan.taxEnabled,
    active: true,
    openedAt: iso(when),
  });

  // Its own drawer. Sharing the head office drawer would put two shops' cash
  // in one figure, which is the thing a separate business must not do.
  const cashAccountId = 'acc_' + id;
  d.accounts.push({
    id: cashAccountId,
    // a branch's accounts are its own, so a plain name is unambiguous inside it
    name: (plan.drawerName || '').trim() || 'Cash drawer',
    type: 'cash',
    opening: 0,
    branch: id,
  });
  if (plan.extraAccount && plan.extraAccount.name.trim()) {
    d.accounts.push({
      id: 'acc_' + id + '_2',
      name: plan.extraAccount.name.trim(),
      type: plan.extraAccount.type,
      opening: 0,
      branch: id,
    });
  }

  // The float is posted into the new branch's books, not the old branch's, so
  // journal() is called with the session already pointing at the new branch.
  const wasIn = d.session.warehouse;
  d.session.warehouse = id;

  const float = Math.max(0, Math.round(Number(plan.openingFloat) || 0));
  if (float > 0) {
    journal(d, when, 'Opening float · ' + name, 'BRANCH', [
      { acc: cashAccountId, dr: float },
      { acc: 'n_equity', cr: float },
    ]);
  }

  // Stock moved in comes off the branch it came from, so the firm's total is
  // unchanged — it is a transfer, not an invention of goods.
  const shortfalls: BranchOpened['shortfalls'] = [];
  let moved = 0;
  if (plan.stockFrom && plan.stockLines?.length) {
    plan.stockLines.forEach((line) => {
      const prod = d.products.find((p) => p.id === line.productId);
      if (!prod) return;
      const wanted = Math.max(0, Math.round(Number(line.qty) || 0));
      if (!wanted) return;
      const had = prod.stock[plan.stockFrom!] || 0;
      const take = Math.min(wanted, had);
      if (take < wanted) shortfalls.push({ productId: prod.id, name: prod.name, wanted, had });
      if (take <= 0) return;
      move(d, prod.id, plan.stockFrom!, -take, 'transfer', 'Opening ' + name, when);
      move(d, prod.id, id, take, 'transfer', 'Opening ' + name, when);
      moved += take;
    });
  }

  // The branch's own accounts have to enter the chart, or its drawer has no
  // ledger type and every balance on it reads back with the sign flipped.
  ensureCoa(d);

  d.session.warehouse = plan.makeActive === false ? wasIn : id;
  if (plan.makeActive !== false) d.settings.defaultWarehouse = id;

  audit(
    d,
    'Branch opened',
    name + ' — float ' + float + (moved ? ', ' + moved + ' units moved in' : '')
    + (shortfalls.length ? ', ' + shortfalls.length + ' item(s) short' : ''),
  );

  return { warehouseId: id, cashAccountId, moved, shortfalls };
}

/* ============================================================
   SHIFTING WHAT IS ALREADY HERE UP TO THE ACCOUNT

   Switching sync on for the first time is the moment a shop's existing trading
   has to go somewhere. Starting the queue from "now" would leave every sale,
   purchase and posting made before that moment on one phone — which is the very
   loss switching sync on was meant to prevent.

   So the backlog is enumerated and queued. The queue is only a list of what has
   to go up; the push itself belongs to the sync client (see
   docs/SYNC_BACKEND.md), and this is deliberately cheap enough to run inside a
   single commit.
   ============================================================ */

/** Every record that predates sync and therefore still owes an upload. */
export function backlogSize(d: DB): number {
  return d.sales.length + d.purchases.length + d.payments.length + d.entries.length
    + d.journal.length + d.movements.length + (d.creditNotes || []).length
    + d.products.length + d.parties.length;
}

/**
 * Fills `d.queue` with everything not yet sent.
 *
 * Idempotent: a record already in the queue is not queued twice, so turning
 * sync off and on again does not double the work.
 */
export function queueBacklog(d: DB): number {
  const have = new Set(d.queue.map((q) => q.kind + ':' + q.ref));
  let added = 0;

  const push = (kind: string, ref: string, ts: string) => {
    const key = kind + ':' + ref;
    if (have.has(key)) return;
    have.add(key);
    d.queue.push({ id: uid('q'), ts, kind, ref });
    added += 1;
  };

  d.sales.forEach((x) => { if (!x.synced) push('sale', x.id, x.ts); });
  d.purchases.forEach((x) => push('purchase', x.id, x.ts));
  d.payments.forEach((x) => push('payment', x.id, x.ts));
  d.entries.forEach((x) => push('entry', x.id, x.ts));
  d.journal.forEach((x) => push('journal', x.id, x.ts));
  d.movements.forEach((x) => push('movement', x.id, x.ts));
  (d.creditNotes || []).forEach((x) => push('creditNote', x.id, x.ts));
  // the catalogue goes up too, or the other tills have nothing to sell
  const now = iso(new Date());
  d.products.forEach((x) => push('product', x.id, now));
  d.parties.forEach((x) => push('party', x.id, now));

  return added;
}
