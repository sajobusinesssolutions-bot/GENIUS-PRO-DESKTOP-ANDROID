/**
 * The books under random use.
 *
 * The other suites walk each voucher through its life in a fixed order. This
 * one does what a busy shop does: hundreds of sales, bills, payments, refunds,
 * returns, expenses and stock corrections in no particular order — made,
 * changed, deleted and put back — and after every single step asks whether the
 * books are still right:
 *
 *   · every entry, and the ledger as a whole, has debits equal to credits
 *   · debtors is what the customers owe, creditors what the suppliers are owed
 *   · stock on the shelf is what its movements add up to, and no batch holds more than the shelf
 *   · no bill is paid more than its total or owes less than nothing
 *   · a payment is never set against more than it is
 *   · the app's own "Check the books" finds nothing to put right
 *   · an action that is refused leaves the book exactly as it was
 *
 * and at the end, with everything deleted again, that the books are back
 * where they started. Each run is seeded, so a failure names the seed and the
 * steps that led to it and can be run again (FUZZ_SEED=123).
 *
 *   FUZZ_RUNS=400 FUZZ_STEPS=120 npx jest fuzzbooks     a longer soak
 */
import { DB, Product } from '../types';
import * as logic from '../logic';
import {
  defaultPrinterSettings, defaultPrinters, defaultPrintServer, defaultTemplates,
  defaultTemplateFor, defaultSubscription, defaultLicence, defaultSync, defaultUpdate,
  defaultSettings, defaultNumbering, defaultUnits, defaultCategories,
} from '../defaults';
import { builtinRoles } from '../perms';
import { runReport } from '../reports';

const RUNS = Number(process.env.FUZZ_RUNS) || 60;
const STEPS = Number(process.env.FUZZ_STEPS) || 70;
const ONE = process.env.FUZZ_SEED ? Number(process.env.FUZZ_SEED) : null;

const far = new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10);
const START: Record<string, Record<string, number>> = { p_a: { w1: 50, w2: 0 }, p_b: { w1: 30, w2: 0 }, p_c: { w1: 20, w2: 0 } };

function makeDb(negative: boolean): DB {
  const base = { unit: 'PC', category: 'Gen', reorder: 5, warrantyMonths: 0, bom: null, active: true };
  const products: Product[] = [
    { ...base, id: 'p_a', sku: 'A', name: 'Widget A', cost: 100, price: 200, taxRate: 0, stock: { w1: 50 } } as any,
    { ...base, id: 'p_b', sku: 'B', name: 'Widget B (taxed)', cost: 250, price: 400, taxRate: 18, stock: { w1: 30 } } as any,
    { ...base, id: 'p_c', sku: 'C', name: 'Tablets (batches)', cost: 33.33, price: 75.5, taxRate: 0, stock: { w1: 20 }, trackBatches: true, batches: [{ no: 'B1', qty: 8, expiry: far }, { no: 'B2', qty: 12, expiry: far }] } as any,
  ];
  const firm = { id: 'frm_1', name: 'Test Co', tin: '', address: '', phone: '' };
  const user = { id: 'u1', name: 'Owner', role: 'owner' as const, pin: '1111', active: true };
  const party = (id: string, type: 'customer' | 'supplier') => ({ id, name: id, type, phone: '', openingBalance: 0, creditLimit: 0, points: 0, active: true });
  return {
    v: 1, firm, firms: [firm], activeFirmId: firm.id,
    settings: { ...defaultSettings(), requireShift: false, allowNegativeStock: negative, trackBatches: true },
    roles: builtinRoles(), numbering: defaultNumbering(), units: defaultUnits(), categories: defaultCategories(),
    loyaltyRules: { enabled: false, earnPer: 1000, pointValue: 5, redeemMin: 200 },
    warehouses: [{ id: 'w1', name: 'Main' }, { id: 'w2', name: 'Store' }],
    products,
    parties: [party('c1', 'customer'), party('c2', 'customer'), party('s1', 'supplier'), party('s2', 'supplier')],
    users: [user],
    accounts: [{ id: 'acc_cash', name: 'Cash', type: 'cash', opening: 0 }, { id: 'acc_bank', name: 'Bank', type: 'bank', opening: 0 }, { id: 'acc_momo', name: 'Mobile money', type: 'momo', opening: 0 }],
    sales: [], purchases: [], payments: [], entries: [], journal: [], movements: [],
    shifts: [], warranties: [], claims: [], estimates: [], challans: [], creditNotes: [], offers: [], stockTakes: [],
    purchaseOrders: [], productionRuns: [], recurringInvoices: [], auditLog: [], businessAccess: [], queue: [], plans: [],
    session: { userId: user.id, role: 'owner', online: true, till: 'Till 1', warehouse: 'w1' },
    counters: { sale: 0, purchase: 0, estimate: 0, challan: 0, creditNote: 0, po: 0, plan: 0 },
    onboarded: true, instalmentPlans: [],
    printer: defaultPrinterSettings(), printers: defaultPrinters(defaultPrinterSettings()), printServer: defaultPrintServer(),
    templates: defaultTemplates(), templateFor: defaultTemplateFor(), subscription: defaultSubscription(), licence: defaultLicence(),
    sync: defaultSync(), update: defaultUpdate(), numberSafe: { mode: 'auto' }, revisions: [],
  } as any;
}

/* a small seeded generator, so a run can be repeated exactly */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return {
    f: next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: T[]): T => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const net = (d: DB, acc: string) => r2(d.journal.reduce((t, e) => t + e.lines.reduce((x, l) => x + (l.acc === acc ? (l.dr || 0) - (l.cr || 0) : 0), 0), 0));

/** Everything that must be true of a book, whatever was done to it. Returns what is wrong. */
function wrong(d: DB): string[] {
  const out: string[] = [];
  let dr = 0, cr = 0;
  d.journal.forEach((e) => {
    let a = 0, b = 0;
    e.lines.forEach((l) => {
      if (!Number.isFinite(l.dr ?? 0) || !Number.isFinite(l.cr ?? 0)) out.push('a figure that is not a number in "' + e.memo + '"');
      if ((l.dr || 0) < -0.004 || (l.cr || 0) < -0.004) out.push('a negative debit or credit in "' + e.memo + '"');
      a += l.dr || 0; b += l.cr || 0;
    });
    if (Math.abs(a - b) > 0.005) out.push('entry "' + e.memo + '" (' + e.ref + ') debits ' + r2(a) + ' credits ' + r2(b));
    dr += a; cr += b;
  });
  if (Math.abs(dr - cr) > 0.005) out.push('ledger out of balance by ' + r2(dr - cr));

  const cust = r2(d.parties.filter((p) => p.type === 'customer').reduce((t, p) => t + logic.partyBalance(d, p.id), 0));
  const supp = r2(d.parties.filter((p) => p.type === 'supplier').reduce((t, p) => t + logic.partyBalance(d, p.id), 0));
  if (Math.abs(net(d, 'n_ar') - cust) > 0.011) out.push('debtors ledger ' + net(d, 'n_ar') + ' but customers owe ' + cust);
  if (Math.abs(net(d, 'n_ap') - supp) > 0.011) out.push('creditors ledger ' + net(d, 'n_ap') + ' but suppliers balance ' + supp);
  const all = logic.allPartyBalances(d);
  d.parties.forEach((p) => { if (Math.abs((all.get(p.id) || 0) - logic.partyBalance(d, p.id)) > 0.011) out.push('two answers for what ' + p.id + ' owes: ' + r2(all.get(p.id) || 0) + ' and ' + r2(logic.partyBalance(d, p.id))); });

  d.products.forEach((p) => {
    let shelf = 0;
    ['w1', 'w2'].forEach((w) => {
      const moved = d.movements.filter((m) => m.productId === p.id && m.wh === w).reduce((t, m) => t + m.qty, 0);
      const want = r4((START[p.id][w] || 0) + moved), have = r4(p.stock[w] || 0);
      if (Math.abs(want - have) > 0.0002) out.push(p.id + ' in ' + w + ': shelf ' + have + ' but movements say ' + want);
      if (!Number.isFinite(have)) out.push(p.id + ' stock is not a number');
      shelf += p.stock[w] || 0;
    });
    if (p.trackBatches && p.batches) {
      const inBatches = r4(p.batches.reduce((t, b) => t + b.qty, 0));
      /* stock may sit outside any batch (a return, a count of the whole item); the batches may never hold more than the shelf */
      if (inBatches - Math.max(0, r4(shelf)) > 0.0011) out.push(p.id + ': batches hold ' + inBatches + ' but the shelf only ' + r4(shelf));
      p.batches.forEach((b) => { if (!Number.isFinite(b.qty) || (b.qty < -0.0005 && !d.settings.allowNegativeStock)) out.push(p.id + ' batch ' + b.no + ' holds ' + b.qty); });
    }
  });

  d.sales.forEach((s) => {
    if (s.status === 'void') return;
    if (s.due < -0.005) out.push(s.no + ' owes less than nothing: ' + r2(s.due));
    if (s.paid < -0.005) out.push(s.no + ' is paid less than nothing: ' + r2(s.paid));
    if (s.paid - s.total > 0.011) out.push(s.no + ' is paid ' + r2(s.paid) + ' on a total of ' + r2(s.total));
    if (![s.total, s.due, s.paid].every(Number.isFinite)) out.push(s.no + ' has a figure that is not a number');
  });
  d.purchases.forEach((x) => {
    if (x.status === 'void') return;
    if (x.due < -0.005) out.push(x.no + ' owes less than nothing: ' + r2(x.due));
    if (x.paid - x.total > 0.011) out.push(x.no + ' is paid ' + r2(x.paid) + ' on a total of ' + r2(x.total));
  });
  d.payments.forEach((p) => {
    const set = (p.allocations || []).reduce((t, a) => t + a.amount, 0);
    if ((p.unapplied || 0) < -0.005) out.push('a payment of ' + p.amount + ' has less than nothing left over');
    if (set + (p.unapplied || 0) - (p.amount + (p.taxDeducted || 0)) > 0.011) out.push('a payment of ' + p.amount + ' is set against ' + r2(set) + ' with ' + r2(p.unapplied || 0) + ' left over');
  });

  logic.checkBooks(d).issues.forEach((i) => out.push('Check the books: ' + i.what + ' — ' + i.detail));
  return out;
}

type Act = { name: string; run: () => void };

function actions(d: DB, R: ReturnType<typeof rng>): Act[] {
  const custs = ['c1', 'c2'], supps = ['s1', 's2'], accs = ['acc_cash', 'acc_bank', 'acc_momo'];
  const prod = () => R.pick(d.products);
  const sline = (p = prod()) => ({ productId: p.id, name: p.name, sku: p.sku, unit: 'PC', qty: R.chance(0.15) ? R.int(1, 9) / 4 : R.int(1, 6), price: R.chance(0.2) ? r2(p.price * (0.7 + R.f())) : p.price, cost: p.cost, taxRate: p.taxRate }) as any;
  const slines = () => Array.from({ length: R.int(1, 3) }, () => sline());
  const pline = (p = prod()) => ({ productId: p.id, name: p.name, qty: R.int(1, 12), cost: R.chance(0.3) ? r2(p.cost * (0.8 + R.f() * 0.5)) : p.cost, ...(p.trackBatches ? { batchNo: R.pick(['B1', 'B2', 'B3']), expiry: far } : {}) }) as any;
  const liveSales = () => d.sales.filter((s) => s.status !== 'void');
  const liveBills = () => d.purchases.filter((x) => x.status !== 'void');
  const deadSales = () => d.sales.filter((s) => s.status === 'void');
  const deadBills = () => d.purchases.filter((x) => x.status === 'void');
  const bin = () => ((d as any).deletedPayments || (d as any).bin?.payments || []) as Array<{ id: string }>;
  const acts: Act[] = [];
  const add = (name: string, run: () => void) => acts.push({ name, run });

  add('cash sale', () => { logic.commitSale(d, { lines: slines(), partyId: R.chance(0.5) ? R.pick(custs) : null, method: R.pick(['cash', 'momo', 'bank'] as const), discount: R.chance(0.3) ? R.int(1, 60) : 0 }); });
  add('credit sale', () => { logic.commitSale(d, { lines: slines(), partyId: R.pick(custs), method: 'credit', discount: R.chance(0.2) ? R.int(1, 40) : 0 }); });
  add('part-paid sale', () => { logic.commitSale(d, { lines: slines(), partyId: R.pick(custs), method: 'credit', discount: 0, received: R.int(10, 300), receivedVia: R.pick(['cash', 'momo', 'bank'] as const) }); });
  add('credit purchase', () => { logic.createPurchase(d, R.pick(supps), [pline(), ...(R.chance(0.4) ? [pline()] : [])], 'credit'); });
  add('cash purchase', () => { logic.createPurchase(d, R.pick(supps), [pline()], R.pick(['cash', 'bank'] as const)); });
  add('receipt from a customer', () => { logic.recordPayment(d, { partyId: R.pick(custs), amount: R.int(20, 1500), direction: 'in', accountId: R.pick(accs), ...(R.chance(0.2) ? { taxDeducted: R.int(1, 30) } : {}) }); });
  add('payment to a supplier', () => { logic.recordPayment(d, { partyId: R.pick(supps), amount: R.int(20, 1500), direction: 'out', accountId: R.pick(accs), ...(R.chance(0.15) ? { taxDeducted: R.int(1, 30) } : {}) }); });
  add('refund paid to a customer', () => { logic.recordPayment(d, { partyId: R.pick(custs), amount: R.int(10, 300), direction: 'out', accountId: R.pick(accs) }); });
  add('expense', () => { logic.recordEntry(d, { direction: 'out', accountId: R.pick(accs), category: 'Transport', amount: R.int(5, 400) }); });
  add('other income', () => { logic.recordEntry(d, { direction: 'in', accountId: R.pick(accs), category: 'Rent received', amount: R.int(5, 900) }); });
  add('count stock', () => { const p = prod(); logic.adjustStock(d, p.id, 'w1', Math.max(0, r2((p.stock.w1 || 0) + R.int(-4, 6))), 'Count', new Date(), p.trackBatches && p.batches?.length && R.chance(0.6) ? R.pick(p.batches).no : undefined); });
  add('move stock between stores', () => { const p = prod(); const from = R.pick(['w1', 'w2']); logic.transferStock(d, p.id, from, from === 'w1' ? 'w2' : 'w1', R.int(1, 5)); });

  if (liveSales().length) {
    add('edit a sale', () => { const s = R.pick(liveSales()); logic.editSale(d, s.id, { lines: slines(), partyId: R.chance(0.2) ? R.pick(custs) : s.partyId, discount: R.chance(0.2) ? R.int(1, 30) : s.discount || 0 }); });
    add('delete a sale', () => { logic.deleteSale(d, R.pick(liveSales()).id); });
    add('return on a sale', () => {
      const s = R.pick(liveSales()); const l = R.pick(s.lines);
      logic.createCreditNote(d, { saleId: s.id, partyId: s.partyId, lines: [{ productId: l.productId, name: l.name, qty: Math.max(0.25, Math.min(l.qty, R.int(1, 3))), price: l.price, cost: l.cost || 0, taxRate: l.taxRate || 0 }], reason: 'Returned', refund: s.partyId ? R.pick(['account', 'cash'] as const) : 'cash' });
    });
    add('expense set against a bill', () => { const s = R.pick(liveSales().filter((x) => x.due > 0).concat(liveSales()).slice(0, 1)); logic.recordEntry(d, { direction: 'out', accountId: 'acc_cash', category: 'Delivery', amount: R.int(5, 200), offsetSaleId: s.id }); });
    add('receipt against one bill', () => { const s = R.pick(liveSales()); if (!s.partyId) return; logic.recordPayment(d, { partyId: s.partyId, amount: R.int(10, 800), direction: 'in', accountId: R.pick(accs), allocations: [{ saleId: s.id, amount: R.int(5, 600) }] } as any); });
  }
  if (deadSales().length) add('put a sale back', () => { logic.restoreSale(d, R.pick(deadSales()).id); });
  if (liveBills().length) {
    add('edit a purchase', () => { const x = R.pick(liveBills()); logic.editPurchase(d, x.id, { partyId: R.chance(0.2) ? R.pick(supps) : x.partyId, lines: [pline()], method: x.method }); });
    add('delete a purchase', () => { logic.deletePurchase(d, R.pick(liveBills()).id); });
  }
  if (deadBills().length) add('put a purchase back', () => { logic.restorePurchase(d, R.pick(deadBills()).id); });
  if (d.payments.length) {
    add('edit a payment', () => { const p = R.pick(d.payments); logic.editPayment(d, p.id, { amount: R.int(10, 1500), ...(R.chance(0.4) ? { accountId: R.pick(accs) } : {}) }); });
    add('delete a payment', () => { logic.deletePayment(d, R.pick(d.payments).id); });
  }
  if (bin().length) add('put a payment back', () => { logic.restorePayment(d, R.pick(bin()).id); });
  if (d.entries.length) add('delete an expense or income', () => { logic.deleteEntry(d, R.pick(d.entries).id); });
  if ((d.creditNotes || []).length) add('delete a return', () => { logic.deleteCreditNote(d, R.pick(d.creditNotes).id); });
  const adj = d.movements.filter((m) => m.type === 'adjust' && logic.adjustmentOpen(d, m.id));
  if (adj.length) add('take back a stock correction', () => { logic.reverseAdjustment(d, R.pick(adj).id); });
  return acts;
}

function runOne(seed: number, negative: boolean): { ok: boolean; report: string } {
  const R = rng(seed);
  const d = makeDb(negative);
  const log: string[] = [];
  const dump = () => (ONE === null ? '' : '\n  SALES ' + JSON.stringify(d.sales.map((s) => [s.no, s.partyId, s.status, s.method, 'tot', s.total, 'paid', s.paid, 'due', s.due, 'atSale', s.paidAtSale, (s.receipts || []).map((r: any) => r.amount)]))
    + '\n  PAYS ' + JSON.stringify(d.payments.map((p) => [p.partyId, p.direction, p.amount, 'wht', p.taxDeducted || 0, 'un', p.unapplied, (p.allocations || []).map((a) => [a.no, a.amount]), (p as any).freedFrom]))
    + '\n  CNS ' + JSON.stringify((d.creditNotes || []).map((c) => [c.no, c.partyId, c.refund, c.total, 'applied', c.appliedToSale, 'held', c.held, c.onAccount]))
    + '\n  AR ' + JSON.stringify(d.journal.filter((e) => e.lines.some((l) => l.acc === 'n_ar')).map((e) => [e.memo.slice(0, 40), e.lines.filter((l) => l.acc === 'n_ar').map((l) => (l.dr || 0) - (l.cr || 0))[0]]))
    + '\n  BAL ' + JSON.stringify(d.parties.map((p) => [p.id, r2(logic.partyBalance(d, p.id))]))
    + '\n  ENT ' + JSON.stringify(d.entries.map((e) => [e.category, e.amount, e.offset, e.offsetSaleId])));
  const fail = (why: string[]) => ({ ok: false, report: dump() + 'seed ' + seed + (negative ? ' (selling below zero allowed)' : '') + '\n  ' + log.slice(-14).join('\n  ') + '\n  WRONG: ' + why.slice(0, 6).join('\n  WRONG: ') });
  for (let i = 0; i < STEPS; i++) {
    const a = R.pick(actions(d, R));
    const before = JSON.stringify(d);
    let refused = '';
    try { a.run(); } catch (e: any) { refused = String(e && e.message || e); }
    if (refused) {
      log.push((i + 1) + '. ' + a.name + ' — refused: ' + refused.slice(0, 70));
      if (!/refus|denied|not enough|cannot|only|must|closed|no |does not|already|too |before|choose|below|expired|holds|short/i.test(refused)) return fail(['an error that is not a refusal: ' + refused]);
      // the audit trail may note the attempt; nothing else may have moved
      const strip = (s: string) => { const o = JSON.parse(s); delete o.auditLog; return JSON.stringify(o); };
      if (strip(JSON.stringify(d)) !== strip(before)) {
        const A = JSON.parse(before), B = JSON.parse(JSON.stringify(d));
        const parts = Object.keys(B).filter((k) => k !== 'auditLog' && JSON.stringify(A[k]) !== JSON.stringify(B[k]));
        return fail(['"' + a.name + '" was refused (' + refused.slice(0, 80) + ') but had already changed: ' + parts.join(', ')]);
      }
      continue;
    }
    log.push((i + 1) + '. ' + a.name);
    const w = wrong(d);
    if (w.length) return fail(w);
  }

  /* the customers' statements say what the balances say */
  const st = runReport(d, 'party-statement', 0, Date.now() + 864e5);
  for (const p of d.parties) {
    const k = (st.rowRefs || []).findIndex((x) => x && x.id === p.id);
    if (k < 0) continue;
    const closing = r2((st.rows[k][4] as any).n);
    if (Math.abs(closing - r2(logic.partyBalance(d, p.id))) > 0.011) return fail(['statement of ' + p.id + ' closes at ' + closing + ' but the balance is ' + r2(logic.partyBalance(d, p.id))]);
  }

  /* everything deleted again: the books go back to where they started */
  for (let pass = 0; pass < 6; pass++) {
    const tryAll = (ids: string[], fn: (id: string) => unknown) => ids.forEach((id) => { try { fn(id); } catch { /* blocked by something still standing; the next pass takes it */ } });
    tryAll((d.creditNotes || []).map((x) => x.id), (id) => logic.deleteCreditNote(d, id));
    tryAll(d.entries.map((x) => x.id), (id) => logic.deleteEntry(d, id));
    tryAll(d.payments.map((x) => x.id), (id) => logic.deletePayment(d, id));
    tryAll(d.sales.filter((s) => s.status !== 'void').map((x) => x.id), (id) => logic.deleteSale(d, id));
    tryAll(d.purchases.filter((s) => s.status !== 'void').map((x) => x.id), (id) => logic.deletePurchase(d, id));
    tryAll(d.movements.filter((m) => m.type === 'adjust' && logic.adjustmentOpen(d, m.id)).map((m) => m.id), (id) => logic.reverseAdjustment(d, id));
  }
  log.push('— everything deleted —');
  const w = wrong(d);
  if (w.length) return fail(w);
  const left: string[] = [];
  if (d.sales.some((s) => s.status !== 'void')) left.push('a sale that would not delete');
  if (d.purchases.some((s) => s.status !== 'void')) left.push('a purchase that would not delete');
  if (d.payments.length) left.push(d.payments.length + ' payment(s) that would not delete');
  if (d.entries.length) left.push(d.entries.length + ' expense or income entries that would not delete');
  if ((d.creditNotes || []).length) left.push('a return that would not delete');
  if (!left.length) {
    const accs = new Set<string>();
    d.journal.forEach((e) => e.lines.forEach((l) => accs.add(l.acc)));
    accs.forEach((a) => { const v = net(d, a); if (Math.abs(v) > 0.011) left.push('ledger ' + a + ' is left holding ' + v); });
    d.parties.forEach((p) => { const b = r2(logic.partyBalance(d, p.id)); if (Math.abs(b) > 0.011) left.push(p.id + ' is left owing ' + b); });
    d.products.forEach((p) => { const tot = r4((p.stock.w1 || 0) + (p.stock.w2 || 0)), was = START[p.id].w1; if (Math.abs(tot - was) > 0.0002) left.push(p.id + ' stock is ' + tot + ', it started at ' + was); });
  }
  return left.length ? fail(left) : { ok: true, report: '' };
}

describe('the books under random use', () => {
  const seeds = ONE !== null ? [ONE] : Array.from({ length: RUNS }, (_, i) => 1000 + i * 7919);
  it('stay right through ' + seeds.length + ' random runs of ' + STEPS + ' steps, with stock held above zero', () => {
    const bad = seeds.map((s) => runOne(s, false)).filter((r) => !r.ok);
    expect(bad.slice(0, 3).map((b) => b.report).join('\n\n')).toBe('');
  });
  it('stay right through ' + seeds.length + ' random runs of ' + STEPS + ' steps, with selling below zero allowed', () => {
    const bad = seeds.map((s) => runOne(s + 1, true)).filter((r) => !r.ok);
    expect(bad.slice(0, 3).map((b) => b.report).join('\n\n')).toBe('');
  });
});
