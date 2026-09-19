// Pure, framework-free business-logic functions used by AppDataContext.
// Kept separate (no React/AsyncStorage imports) so they can be unit-tested
// directly against a plain DB object without rendering a component tree.
import {
  DB, Sale, SaleLine, Purchase, PurchaseLine, Payment, JournalLine, PayMethod, Product,
  StockTake, ProductionRun, RecurringInvoice, InstalmentPlan, InstalmentDue, Revision,
  LicStatus, Subscription, Shift,
} from './types';
import { uid, iso } from './uid';
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

  d.journal.push({
    id: uid('jnl'), ts: iso(when), memo, ref, lines: rounded,
    balanced: Math.abs(cents(dr - cr)) < 0.005,
    // a branch keeps its own books, so the posting is stamped where it happened
    branch: activeBranchId(d),
  });
}

export function move(d: DB, productId: string, wh: string, qty: number, type: string, ref: string, when: Date, batchNo?: string, userId?: string) {
  const prod = d.products.find((x) => x.id === productId);
  if (!prod) return;
  prod.stock[wh] = (prod.stock[wh] || 0) + qty;
  if (batchNo && prod.batches) {
    const batch = prod.batches.find((x) => x.no === batchNo);
    if (batch) batch.qty += qty;
  }
  d.movements.push({ id: uid('mv'), ts: iso(when), productId, wh, qty, type, ref, batchNo, userId: userId || d.session.userId });
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
  return d.settings?.allowNegativeStock === true || d.settings?.blockNegativeStock === false;
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

export function enqueue(d: DB, kind: string, ref: string) {
  if (d.session.online && !d.sync?.on) return;
  d.queue.push({ id: uid('q'), ts: iso(new Date()), kind, ref });
}

export function commitSale(d: DB, o: { lines: SaleLine[]; partyId: string | null; method: PayMethod; discount: number; additionalCharges?: number; description?: string; terms?: string; redeem?: number; methods?: Array<{ method: PayMethod; amount: number }>; no?: string; ts?: string; received?: number; receivedVia?: 'cash' | 'momo' | 'bank'; userId?: string }, when = o.ts ? new Date(o.ts) : new Date()): Sale {
  if (!canWith(ensureRoles(d), d.session.role, 'sales.create')) {
    throw new Error('Permission denied: sales.create');
  }
  // With tax switched off for the shop, nothing is charged or reported.
  const taxable = d.settings.taxEnabled === false
    ? o.lines.map((l) => ({ ...l, taxRate: 0 }))
    : o.lines;
  const t = saleTotals(taxable, o.discount, pricesIncludeTax(d));
  const charges = Math.max(0, Number(o.additionalCharges) || 0);
  const finalTotal = t.total + charges;
  const redeemed = o.redeem || 0;
  const useSplitTender = o.methods && o.methods.length > 1;
  if (o.method === 'credit' && !o.partyId) throw new Error('A customer is required for credit sales');
  if (useSplitTender) {
    const splitTotal = o.methods!.reduce((s, m) => s + m.amount, 0);
    if (o.methods!.some((m) => m.method === 'credit' || m.amount < 0 || !Number.isFinite(m.amount)) || Math.abs(splitTotal - finalTotal) > 0.01) {
      throw new Error('Split payments must equal the sale total');
    }
  }
  if (o.method === 'credit' && o.partyId) {
    const customer = d.parties.find((p) => p.id === o.partyId);
    if (customer && customer.creditLimit > 0 && partyBalance(d, o.partyId) + finalTotal > customer.creditLimit) {
      throw new Error('Credit limit exceeded for this customer');
    }
  }
  const wh = d.session.warehouse || 'w1';
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
      throw new Error(
        'Not enough ' + prod.name + ' — ' + available + ' ' + prod.unit + ' on hand, ' + required + ' needed',
      );
    }
  });
  d.counters.sale += 1;
  const partPaid = Math.max(0, Math.min(Number(o.received) || 0, finalTotal));
  const paidNow = useSplitTender
    ? o.methods!.reduce((s, m) => s + m.amount, 0)
    : (o.method === 'credit' ? partPaid : finalTotal);
  const finalPaidNow = redeemed ? Math.max(0, paidNow - redeemed) : paidNow;
  const sale: Sale = {
    // each branch's paperwork carries its own prefix over a firm-wide number
    id: uid('sal'), no: (o.no || '').trim() || branchPrefix(d, wh) + '-' + String(100000 + d.counters.sale).slice(1), ts: iso(when),
    partyId: o.partyId, userId: o.userId || d.session.userId, till: d.session.till, warehouse: wh,
    lines: taxable, discount: t.discount, redeemed, gross: t.gross, tax: t.tax, total: finalTotal, cogs: t.cost,
    additionalCharges: charges, terms: o.terms, note: o.description,
    method: o.method,
    ...(o.method === 'credit' && finalPaidNow > 0 ? { receivedVia: o.receivedVia || 'cash' } : {}),
    paid: finalPaidNow + redeemed, paidAtSale: finalPaidNow + redeemed, due: finalTotal - finalPaidNow - redeemed,
    ...(useSplitTender && { methods: o.methods }),
    status: 'complete', synced: d.session.online, fiscal: d.settings.efris ? (d.session.online ? 'sent' : 'pending') : 'off',
    fdn: d.settings.efris && d.session.online ? String(9000000000 + Math.floor(Math.random() * 8999999)) : null,
  };
  d.sales.push(sale);
  sale.lines.forEach((l) => move(d, l.productId, wh, -stockQty(l), 'sale', sale.no, when, l.batchNo));
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
  if (sale.due > 0) jl.push({ acc: 'n_ar', dr: sale.due });
  if (t.discount > 0) jl.push({ acc: 'n_discount', dr: t.discount });
  jl.push({ acc: 'n_sales', cr: t.net + t.discount + charges });
  if (t.tax > 0) jl.push({ acc: 'n_tax', cr: t.tax });
  journal(d, when, 'Sale ' + sale.no, sale.no, jl);
  if (t.cost > 0) journal(d, when, 'Cost of sale ' + sale.no, sale.no, [{ acc: 'n_cogs', dr: t.cost }, { acc: 'n_inventory', cr: t.cost }]);
  if (sale.partyId && d.loyaltyRules.enabled) {
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
  s.lines.forEach((l) => move(d, l.productId, s.warehouse, stockQty(l), 'void', s.no, when, l.batchNo));
  const jl: JournalLine[] = [];
  const paidNow = s.paid - (s.redeemed || 0);
  if (s.methods && s.methods.length > 1) {
    s.methods.forEach((m) => {
      const acc = m.method === 'cash' ? 'acc_cash' : m.method === 'momo' ? 'acc_momo' : m.method === 'bank' ? 'acc_bank' : null;
      if (m.amount > 0 && acc) jl.push({ acc, cr: m.amount });
    });
  } else {
    const acc = s.method === 'cash' ? 'acc_cash' : s.method === 'momo' ? 'acc_momo' : s.method === 'bank' ? 'acc_bank' : null;
    if (paidNow > 0 && acc) jl.push({ acc, cr: paidNow });
  }
  if (s.due > 0) jl.push({ acc: 'n_ar', cr: s.due });
  if (s.redeemed) jl.push({ acc: 'n_loyalty', cr: s.redeemed });
  jl.push({ acc: 'n_sales', dr: s.total - s.tax + s.discount });
  if (s.tax > 0) jl.push({ acc: 'n_tax', dr: s.tax });
  if (s.discount > 0) jl.push({ acc: 'n_discount', cr: s.discount });
  journal(d, when, 'Void ' + s.no, s.no, jl);
  if (s.cogs > 0) journal(d, when, 'Reverse cost ' + s.no, s.no, [{ acc: 'n_inventory', dr: s.cogs }, { acc: 'n_cogs', cr: s.cogs }]);
  d.warranties = d.warranties.filter((w) => w.saleId !== s.id);
  audit(d, 'Sale voided', s.no + (reason ? ' — ' + reason : ''));
  touch(d, s, 'Voided' + (reason ? ' — ' + reason : ''), 'sales');
}

export function createPurchase(d: DB, partyId: string, lines: PurchaseLine[], method: PayMethod, when = new Date(), userId?: string): Purchase {
  if (!canWith(ensureRoles(d), d.session.role, 'purchases.create')) {
    throw new Error('Permission denied: purchases.create');
  }
  const party = d.parties.find((p) => p.id === partyId);
  if (!party || party.type !== 'supplier') throw new Error('A supplier is required for purchases');

  d.counters.purchase += 1;
  const total = lines.reduce((s, l) => s + l.qty * l.cost, 0);
  const wh = d.session.warehouse || 'w1';
  const pu: Purchase = { id: uid('pur'), no: 'PUR-' + String(100000 + d.counters.purchase).slice(1), ts: iso(when), partyId, lines, total, method, paid: method === 'credit' ? 0 : total, due: method === 'credit' ? total : 0, status: 'complete', userId: userId || d.session.userId, branch: activeBranchId(d) };
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

    // A batch-tracked delivery opens its lot before the stock moves, so the
    // quantity lands on the batch as well as the warehouse.
    if (prod?.trackBatches && l.batchNo) {
      prod.batches = prod.batches || [];
      if (!prod.batches.some((b) => b.no === l.batchNo)) {
        prod.batches.push({ no: l.batchNo, expiry: l.expiry || '', qty: 0 });
      } else if (l.expiry) {
        const b = prod.batches.find((x) => x.no === l.batchNo)!;
        if (!b.expiry) b.expiry = l.expiry;
      }
    }
    move(d, l.productId, wh, l.qty, 'purchase', pu.no, when, prod?.trackBatches ? l.batchNo : undefined);
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

export function recordPayment(d: DB, o: { partyId: string; amount: number; direction: 'in' | 'out'; accountId: string; note?: string; userId?: string }, when = new Date()): Payment {
  const party = d.parties.find((p) => p.id === o.partyId);
  if (!party) throw new Error('A party is required for payments');
  if (o.direction === 'in' && party.type !== 'customer') throw new Error('A customer is required for customer payments');

  const acc = d.accounts.find((a) => a.id === o.accountId);
  const pay: Payment = { id: uid('pay'), ts: iso(when), partyId: o.partyId, amount: o.amount, direction: o.direction, accountId: o.accountId, note: o.note || '', method: acc?.type || 'cash', userId: o.userId || d.session.userId, branch: activeBranchId(d) };
  d.payments.push(pay);
  enqueue(d, 'payment', pay.id);
  audit(d, o.direction === 'in' ? 'Payment received' : 'Payment made', Math.round(o.amount) + ' via ' + (acc?.name || o.accountId));
  const partyName = party.name;
  if (o.direction === 'in') journal(d, when, 'Receipt from ' + partyName, 'RCT', [{ acc: o.accountId, dr: o.amount }, { acc: 'n_ar', cr: o.amount }]);
  else journal(d, when, 'Payment to ' + partyName, 'PAY', [{ acc: 'n_ap', dr: o.amount }, { acc: o.accountId, cr: o.amount }]);
  let left = o.amount;
  if (o.direction === 'in') {
    d.sales.filter((s) => s.partyId === o.partyId && s.due > 0 && s.status !== 'void').sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
      .forEach((s) => { if (left <= 0) return; const take = Math.min(left, s.due); s.due -= take; s.paid += take; left -= take; });
  } else {
    d.purchases.filter((x) => x.partyId === o.partyId && x.due > 0 && x.status !== 'void').sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
      .forEach((x) => { if (left <= 0) return; const take = Math.min(left, x.due); x.due -= take; x.paid += take; left -= take; });
  }
  touch(d, pay, 'Recorded', 'payments');
  return pay;
}

export function partyBalance(d: DB, id: string): number {
  const pt = d.parties.find((p) => p.id === id); if (!pt) return 0;
  let b = pt.openingBalance || 0;
  d.sales.forEach((s) => { if (s.partyId === id && s.status !== 'void') b += s.due; });
  d.purchases.forEach((x) => { if (x.partyId === id && x.status !== 'void') b -= x.due; });
  return b;
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
  move(d, productId, wh, delta, 'adjust', reason, when, batch ? batch.no : undefined, userId);
  const value = delta * (prod.cost || 0);
  if (value !== 0) {
    const jl: JournalLine[] = value > 0
      ? [{ acc: 'n_inventory', dr: value }, { acc: 'n_income', cr: value }]
      : [{ acc: 'n_expense', dr: -value }, { acc: 'n_inventory', cr: -value }];
    journal(d, when, reason + ' — ' + prod.name, productId, jl);
  }
  audit(
    d,
    'Stock adjusted',
    prod.name + (batch ? ' · batch ' + batch.no : ' · ' + wh) + ' ' + before + '→' + count
      + (delta !== 0 ? ' (' + (delta > 0 ? '+' : '') + delta + ')' : '')
      + ' — by ' + (d.users.find((u) => u.id === (userId || d.session.userId))?.name || 'unknown'),
  );
  return value;
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

export function flushQueue(d: DB): number {
  const n = d.queue.length;
  if (!n) return 0;
  d.sales.forEach((s) => { if (!s.synced) s.synced = true; });
  d.queue = [];
  audit(d, 'Sync queue flushed', n + ' item(s)');
  return n;
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

export function licFeature(d: DB, f: string, now = new Date()): boolean {
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
  return isPro(d) ? 99 : PLANS.starter.limits.devices;
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
    .filter((p) => p.direction === 'in' && cashAccs.indexOf(p.accountId) > -1 && within(p.ts))
    .reduce((n, p) => n + p.amount, 0);

  const paidOutPayments = d.payments
    .filter((p) => p.direction === 'out' && cashAccs.indexOf(p.accountId) > -1 && within(p.ts))
    .reduce((n, p) => n + p.amount, 0);
  const paidOutEntries = d.entries
    .filter((e) => e.direction === 'out' && cashAccs.indexOf(e.accountId) > -1 && within(e.ts))
    .reduce((n, e) => n + e.amount, 0);
  const cashIn = d.entries
    .filter((e) => e.direction === 'in' && cashAccs.indexOf(e.accountId) > -1 && within(e.ts))
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
  const s = d.sales.find((x) => x.id === saleId);
  if (!s) return { ok: false, why: 'That bill is gone.' };
  if (s.status === 'void') return { ok: false, why: 'That bill is already void.' };
  return editWindowOK(d, s.ts, now);
}

export function canEditPurchase(d: DB, purchaseId: string, now = new Date()): { ok: boolean; why: string } {
  const x = d.purchases.find((p) => p.id === purchaseId);
  if (!x) return { ok: false, why: 'That purchase is gone.' };
  if (x.status === 'void') return { ok: false, why: 'That purchase is already reversed.' };
  return editWindowOK(d, x.ts, now);
}

export function canEditPayment(d: DB, payId: string, now = new Date()): { ok: boolean; why: string } {
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
export function editSale(
  d: DB,
  saleId: string,
  o: { lines: SaleLine[]; partyId: string | null; discount: number; ref?: string; note?: string },
  reason = 'Replaced by an edit',
  when = new Date(),
): Sale | null {
  if (!canWith(ensureRoles(d), d.session.role, 'sales.edit')) {
    throw new Error('Permission denied: sales.edit');
  }
  const s = d.sales.find((x) => x.id === saleId);
  if (!s || s.status === 'void') return null;
  if (!o.lines.length) return null;
  const oldNo = s.no, oldTs = s.ts, oldMethod = s.method, oldWh = s.warehouse, oldPaid = s.paid;

  voidSale(d, s.id, reason, when);

  const prevWh = d.session.warehouse;
  d.session.warehouse = oldWh;
  const fresh = commitSale(d, { lines: o.lines, partyId: o.partyId, method: oldMethod, discount: o.discount }, new Date(oldTs));
  d.session.warehouse = prevWh;

  /* keep the original number, date and history */
  d.counters.sale -= 1;
  renumber(d, fresh.no, oldNo);
  fresh.no = oldNo; fresh.ts = oldTs;
  fresh.ref = o.ref || ''; fresh.note = o.note || '';
  fresh.editedFrom = s.id; fresh.editedAt = iso(when);

  /* money already taken stays taken */
  if (oldMethod !== 'credit') {
    const keep = Math.min(oldPaid, fresh.total);
    fresh.paid = keep; fresh.due = Math.max(0, fresh.total - keep);
  }
  d.sales = d.sales.filter((x) => x.id !== s.id);
  audit(d, 'Sale edited', oldNo + ' — now ' + Math.round(fresh.total));
  touch(d, fresh, 'Edited' + (reason ? ' — ' + reason : ''), 'sales');
  return fresh;
}

/** Reference A.deleteSale, line 17654 — a delete is a reversal, never a splice. */
export function deleteSale(d: DB, saleId: string, reason = 'Deleted', when = new Date()): boolean {
  if (!canWith(ensureRoles(d), d.session.role, 'sales.delete')) {
    throw new Error('Permission denied: sales.delete');
  }
  const s = d.sales.find((x) => x.id === saleId);
  if (!s || s.status === 'void') return false;
  voidSale(d, s.id, reason, when);
  audit(d, 'Sale deleted', s.no + ' — reversed and logged');
  return true;
}

/** The purchase counterpart of voidSale: stock comes back off the shelf, the ledger unwinds. */
export function voidPurchase(d: DB, purchaseId: string, reason = '', when = new Date()): boolean {
  const x = d.purchases.find((p) => p.id === purchaseId);
  if (!x || x.status === 'void') return false;
  x.status = 'void'; x.voidedAt = iso(when); x.voidReason = reason;
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
    throw new Error('Permission denied: purchases.edit');
  }
  const x = d.purchases.find((p) => p.id === purchaseId);
  if (!x || x.status === 'void') return null;
  if (!o.lines.length) return null;
  const oldNo = x.no, oldTs = x.ts;
  voidPurchase(d, x.id, reason, when);
  const fresh = createPurchase(d, o.partyId, o.lines, o.method, new Date(oldTs));
  d.counters.purchase -= 1;
  renumber(d, fresh.no, oldNo);
  fresh.no = oldNo; fresh.ts = oldTs;
  fresh.ref = o.ref || ''; fresh.note = o.note || '';
  fresh.editedFrom = x.id; fresh.editedAt = iso(when);
  d.purchases = d.purchases.filter((p) => p.id !== x.id);
  audit(d, 'Purchase edited', oldNo + ' — now ' + Math.round(fresh.total));
  touch(d, fresh, 'Edited' + (reason ? ' — ' + reason : ''), 'purchases');
  return fresh;
}

export function deletePurchase(d: DB, purchaseId: string, reason = 'Deleted', when = new Date()): boolean {
  if (!canWith(ensureRoles(d), d.session.role, 'purchases.delete')) {
    throw new Error('Permission denied: purchases.delete');
  }
  const x = d.purchases.find((p) => p.id === purchaseId);
  if (!x || x.status === 'void') return false;
  voidPurchase(d, x.id, reason, when);
  audit(d, 'Purchase deleted', x.no + ' — reversed and logged');
  return true;
}

/** Reference unapplyPayment, line 17722 — hand the money back to the bills it settled. */
export function unapplyPayment(d: DB, pay: Payment) {
  let left = pay.amount;
  const list: { paid: number; due: number; ts: string }[] = pay.direction === 'in'
    ? d.sales.filter((s) => s.partyId === pay.partyId && s.paid > 0 && s.status !== 'void')
    : d.purchases.filter((x) => x.partyId === pay.partyId && x.paid > 0 && x.status !== 'void');
  list.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  list.forEach((x) => {
    if (left <= 0) return;
    const give = Math.min(left, x.paid);
    x.paid -= give; x.due += give; left -= give;
  });
}

/** Reference applyPayment, line 17734 — oldest bill first. */
export function applyPayment(d: DB, pay: Payment) {
  let left = pay.amount;
  const list: { paid: number; due: number; ts: string }[] = pay.direction === 'in'
    ? d.sales.filter((s) => s.partyId === pay.partyId && s.due > 0 && s.status !== 'void')
    : d.purchases.filter((x) => x.partyId === pay.partyId && x.due > 0 && x.status !== 'void');
  list.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  list.forEach((x) => {
    if (left <= 0) return;
    const take = Math.min(left, x.due);
    x.due -= take; x.paid += take; left -= take;
  });
}

/** Reference repostPayment, line 17700 — reverse what the old one did, then post the new one. */
export function editPayment(
  d: DB,
  payId: string,
  patch: { amount: number; accountId?: string; note?: string },
  when = new Date(),
): Payment | null {
  if (!canWith(ensureRoles(d), d.session.role, 'finance.edit')) {
    throw new Error('Permission denied: finance.edit');
  }
  const pay = d.payments.find((x) => x.id === payId);
  if (!pay || !(patch.amount > 0)) return null;
  const oldAmt = pay.amount, oldAcc = pay.accountId;
  const rev: JournalLine[] = pay.direction === 'in'
    ? [{ acc: oldAcc, cr: oldAmt }, { acc: 'n_ar', dr: oldAmt }]
    : [{ acc: 'n_ap', cr: oldAmt }, { acc: oldAcc, dr: oldAmt }];
  journal(d, when, 'Reverse ' + (pay.direction === 'in' ? 'receipt' : 'payment') + ' — edit', 'EDIT', rev);
  unapplyPayment(d, pay);

  pay.amount = patch.amount;
  pay.accountId = patch.accountId || pay.accountId;
  if (patch.note !== undefined) pay.note = patch.note;
  pay.method = d.accounts.find((a) => a.id === pay.accountId)?.type || 'cash';
  pay.editedAt = iso(when);

  const post: JournalLine[] = pay.direction === 'in'
    ? [{ acc: pay.accountId, dr: pay.amount }, { acc: 'n_ar', cr: pay.amount }]
    : [{ acc: 'n_ap', dr: pay.amount }, { acc: pay.accountId, cr: pay.amount }];
  const partyName = d.parties.find((p) => p.id === pay.partyId)?.name || '';
  journal(d, when, (pay.direction === 'in' ? 'Receipt from ' : 'Payment to ') + partyName + ' — edited', 'EDIT', post);
  applyPayment(d, pay);
  audit(d, 'Payment edited', Math.round(oldAmt) + ' to ' + Math.round(pay.amount));
  touch(d, pay, 'Edited', 'payments');
  return pay;
}

/** Reference A.deletePayment, line 17745 — the balance goes back up. */
export function deletePayment(d: DB, payId: string, reason = 'Deleted', when = new Date()): boolean {
  if (!canWith(ensureRoles(d), d.session.role, 'finance.delete')) {
    throw new Error('Permission denied: finance.delete');
  }
  const pay = d.payments.find((x) => x.id === payId);
  if (!pay) return false;
  const rev: JournalLine[] = pay.direction === 'in'
    ? [{ acc: pay.accountId, cr: pay.amount }, { acc: 'n_ar', dr: pay.amount }]
    : [{ acc: 'n_ap', cr: pay.amount }, { acc: pay.accountId, dr: pay.amount }];
  journal(d, when, 'Reverse ' + (pay.direction === 'in' ? 'receipt' : 'payment') + ' — deleted', 'DEL', rev);
  unapplyPayment(d, pay);
  d.payments = d.payments.filter((x) => x.id !== pay.id);
  audit(d, 'Payment deleted', Math.round(pay.amount) + (reason ? ' — ' + reason : ''));
  return true;
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
  if (!name) throw new Error('A branch needs a name.');
  if (d.warehouses.some((w) => w.name.trim().toLowerCase() === name.toLowerCase())) {
    throw new Error('There is already a branch called ' + name + '.');
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
