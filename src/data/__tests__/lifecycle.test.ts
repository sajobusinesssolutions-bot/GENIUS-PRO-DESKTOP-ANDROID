/**
 * Every voucher through its life — made, edited, deleted, put back — with the
 * books checked after each step: the ledger balances, the debtors and
 * creditors ledgers agree with what each party owes, the cash book agrees with
 * the money, stock agrees with its movements, and a delete leaves every
 * figure exactly where it was before the voucher was made.
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

function makeDb(): DB {
  const prodA: Product = { id: 'p_a', sku: 'A', name: 'Widget A', unit: 'PC', category: 'Gen', cost: 100, price: 200, taxRate: 0, stock: { w1: 50 }, reorder: 5, warrantyMonths: 0, bom: null, active: true };
  const firm = { id: 'frm_1', name: 'Test Co', tin: '', address: '', phone: '' };
  const user = { id: 'u1', name: 'Owner', role: 'owner' as const, pin: '1111', active: true };
  return {
    v: 1, firm, firms: [firm], activeFirmId: firm.id,
    settings: { ...defaultSettings(), requireShift: false, allowNegativeStock: true },
    roles: builtinRoles(), numbering: defaultNumbering(), units: defaultUnits(), categories: defaultCategories(),
    loyaltyRules: { enabled: false, earnPer: 1000, pointValue: 5, redeemMin: 200 },
    warehouses: [{ id: 'w1', name: 'Main' }],
    products: [prodA],
    parties: [
      { id: 'c1', name: 'Cust', type: 'customer' as const, phone: '', openingBalance: 0, creditLimit: 0, points: 0, active: true },
      { id: 's1', name: 'Supp', type: 'supplier' as const, phone: '', openingBalance: 0, creditLimit: 0, points: 0, active: true },
    ],
    users: [user],
    accounts: [{ id: 'acc_cash', name: 'Cash', type: 'cash', opening: 0 }, { id: 'acc_bank', name: 'Bank', type: 'bank', opening: 0 }],
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

const r2 = (n: number) => Math.round(n * 100) / 100;
function net(d: DB, acc: string) {
  let n = 0;
  d.journal.forEach((e) => e.lines.forEach((l) => { if (l.acc === acc) n += (l.dr || 0) - (l.cr || 0); }));
  return r2(n);
}
/** What every account holds, and the facts that must agree. */
function books(d: DB) {
  const accs = new Set<string>();
  d.journal.forEach((e) => e.lines.forEach((l) => accs.add(l.acc)));
  const ledger: Record<string, number> = {};
  accs.forEach((a) => { const v = net(d, a); if (Math.abs(v) > 0.004) ledger[a] = v; });
  const moved = d.movements.filter((m) => m.productId === 'p_a' && m.wh === 'w1').reduce((t, m) => t + m.qty, 0);
  return {
    ledger,
    cust: r2(logic.partyBalance(d, 'c1')),
    supp: r2(logic.partyBalance(d, 's1')),
    stock: d.products[0].stock.w1,
    moved: 50 + moved,
  };
}
function check(d: DB, step: string) {
  const dr = d.journal.reduce((t, e) => t + e.lines.reduce((x, l) => x + (l.dr || 0), 0), 0);
  const cr = d.journal.reduce((t, e) => t + e.lines.reduce((x, l) => x + (l.cr || 0), 0), 0);
  const b = books(d);
  const closing = (id: string) => {
    const r = runReport(d, 'party-statement', 0, Date.now() + 864e5);
    const i = (r.rowRefs || []).findIndex((x) => x && x.id === id);
    return r2((r.rows[i][4] as any).n);
  };
  expect({ step, balanced: r2(dr - cr) }).toEqual({ step, balanced: 0 });
  // the debtors ledger is what customers owe; the creditors ledger what we owe suppliers
  expect({ step, ar: net(d, 'n_ar') }).toEqual({ step, ar: b.cust });
  expect({ step, ap: net(d, 'n_ap') }).toEqual({ step, ap: b.supp });
  // the statement says what the Parties list says
  expect({ step, c: closing('c1'), s: closing('s1') }).toEqual({ step, c: b.cust, s: b.supp });
  // stock is what its movements say
  expect({ step, stock: b.stock }).toEqual({ step, stock: b.moved });
  return b;
}
const line = (qty: number, price = 200) => ({ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty, price, cost: 100, taxRate: 0 }) as any;
const pline = (qty: number, cost = 100) => ({ productId: 'p_a', name: 'Widget A', qty, cost }) as any;

describe('a voucher made and deleted leaves the books as they were', () => {
  const cases: [string, (d: DB) => () => void][] = [
    ['cash sale', (d) => { const s = logic.commitSale(d, { lines: [line(2)], partyId: 'c1', method: 'cash', discount: 0 }); return () => logic.deleteSale(d, s.id); }],
    ['credit sale', (d) => { const s = logic.commitSale(d, { lines: [line(3)], partyId: 'c1', method: 'credit', discount: 0 }); return () => logic.deleteSale(d, s.id); }],
    ['part-paid sale', (d) => { const s = logic.commitSale(d, { lines: [line(3)], partyId: 'c1', method: 'credit', discount: 0, received: 250, receivedVia: 'cash' }); return () => logic.deleteSale(d, s.id); }],
    ['sale with a discount', (d) => { const s = logic.commitSale(d, { lines: [line(3)], partyId: 'c1', method: 'cash', discount: 50 }); return () => logic.deleteSale(d, s.id); }],
    ['credit purchase', (d) => { const p = logic.createPurchase(d, 's1', [pline(4)], 'credit'); return () => logic.deletePurchase(d, p.id); }],
    ['cash purchase', (d) => { const p = logic.createPurchase(d, 's1', [pline(4)], 'cash'); return () => logic.deletePurchase(d, p.id); }],
    ['receipt', (d) => { const p = logic.recordPayment(d, { partyId: 'c1', amount: 300, direction: 'in', accountId: 'acc_cash' }); return () => logic.deletePayment(d, p.id); }],
    ['receipt with tax withheld', (d) => { const p = logic.recordPayment(d, { partyId: 'c1', amount: 300, taxDeducted: 18, direction: 'in', accountId: 'acc_cash' }); return () => logic.deletePayment(d, p.id); }],
    ['payment to a supplier', (d) => { const p = logic.recordPayment(d, { partyId: 's1', amount: 300, direction: 'out', accountId: 'acc_bank' }); return () => logic.deletePayment(d, p.id); }],
  ];
  for (const [name, make] of cases) {
    it(name, () => {
      const d = makeDb();
      // something already on the books, so a delete has history around it
      logic.commitSale(d, { lines: [line(1)], partyId: 'c1', method: 'credit', discount: 0 });
      logic.createPurchase(d, 's1', [pline(2)], 'credit');
      const before = check(d, 'before');
      const undo = make(d);
      check(d, name + ' made');
      undo();
      const after = check(d, name + ' deleted');
      expect(after).toEqual(before);
    });
  }
});

describe('paid later, then deleted', () => {
  it('a credit sale paid by a receipt: deleted, the money stays theirs, the till untouched', () => {
    const d = makeDb();
    const s = logic.commitSale(d, { lines: [line(5)], partyId: 'c1', method: 'credit', discount: 0 });
    logic.recordPayment(d, { partyId: 'c1', amount: 1000, direction: 'in', accountId: 'acc_cash', allocations: [{ saleId: s.id, amount: 1000 }] });
    const cash = net(d, 'acc_cash');
    logic.deleteSale(d, s.id);
    const b = check(d, 'deleted');
    expect(net(d, 'acc_cash')).toBe(cash);
    expect(b.cust).toBe(-1000);
    // and put back: as it was
    logic.restoreSale(d, s.id);
    const c = check(d, 'restored');
    expect(c.cust).toBe(0);
    expect(net(d, 'acc_cash')).toBe(cash);
  });
  it('a credit purchase paid later: deleted, the payment stays on their account', () => {
    const d = makeDb();
    const p = logic.createPurchase(d, 's1', [pline(5)], 'credit');
    logic.recordPayment(d, { partyId: 's1', amount: 500, direction: 'out', accountId: 'acc_cash' });
    const cash = net(d, 'acc_cash');
    logic.deletePurchase(d, p.id);
    const b = check(d, 'deleted');
    expect(net(d, 'acc_cash')).toBe(cash);
    expect(b.supp).toBe(500);
  });
});

describe('edits post the difference, nothing more', () => {
  it('a sale edited to more items equals the same sale made that way', () => {
    const d = makeDb(), e = makeDb();
    const s = logic.commitSale(d, { lines: [line(2)], partyId: 'c1', method: 'credit', discount: 0 });
    logic.editSale(d, s.id, { lines: [line(5)], partyId: 'c1', discount: 0 });
    logic.commitSale(e, { lines: [line(5)], partyId: 'c1', method: 'credit', discount: 0 });
    expect(check(d, 'edited')).toEqual(check(e, 'made so'));
  });
  it('a sale paid later, then edited, keeps the money received', () => {
    const d = makeDb();
    const s = logic.commitSale(d, { lines: [line(5)], partyId: 'c1', method: 'credit', discount: 0 });
    logic.recordPayment(d, { partyId: 'c1', amount: 600, direction: 'in', accountId: 'acc_cash', allocations: [{ saleId: s.id, amount: 600 }] });
    const cash = net(d, 'acc_cash');
    logic.editSale(d, s.id, { lines: [line(4)], partyId: 'c1', discount: 0 });
    const b = check(d, 'edited');
    expect(net(d, 'acc_cash')).toBe(cash);
    expect(b.cust).toBe(800 - 600);
  });
  it('a sale moved to another customer leaves the first owing nothing', () => {
    const d = makeDb();
    d.parties.push({ id: 'c2', name: 'Other', type: 'customer', phone: '', openingBalance: 0, creditLimit: 0, points: 0, active: true } as any);
    const s = logic.commitSale(d, { lines: [line(2)], partyId: 'c1', method: 'credit', discount: 0 });
    logic.editSale(d, s.id, { lines: [line(2)], partyId: 'c2', discount: 0 });
    expect(logic.partyBalance(d, 'c1')).toBe(0);
    expect(logic.partyBalance(d, 'c2')).toBe(400);
    expect(net(d, 'n_ar')).toBe(400);
  });
  it('a purchase edited equals the same purchase made that way', () => {
    const d = makeDb(), e = makeDb();
    const p = logic.createPurchase(d, 's1', [pline(2)], 'credit');
    logic.editPurchase(d, p.id, { partyId: 's1', lines: [pline(6, 90)], method: 'credit' });
    logic.createPurchase(e, 's1', [pline(6, 90)], 'credit');
    expect(check(d, 'edited')).toEqual(check(e, 'made so'));
  });
  it('a cash purchase edited keeps the till right', () => {
    const d = makeDb(), e = makeDb();
    const p = logic.createPurchase(d, 's1', [pline(2)], 'cash');
    logic.editPurchase(d, p.id, { partyId: 's1', lines: [pline(3)], method: 'cash' });
    logic.createPurchase(e, 's1', [pline(3)], 'cash');
    expect(check(d, 'edited')).toEqual(check(e, 'made so'));
  });
  it('a receipt edited equals the same receipt made that way', () => {
    const d = makeDb(), e = makeDb();
    for (const x of [d, e]) logic.commitSale(x, { lines: [line(5)], partyId: 'c1', method: 'credit', discount: 0 });
    const p = logic.recordPayment(d, { partyId: 'c1', amount: 300, direction: 'in', accountId: 'acc_cash' });
    logic.editPayment(d, p.id, { amount: 700, accountId: 'acc_bank' });
    logic.recordPayment(e, { partyId: 'c1', amount: 700, direction: 'in', accountId: 'acc_bank' });
    expect(check(d, 'edited')).toEqual(check(e, 'made so'));
  });
  it('a receipt with tax withheld, edited, keeps the books whole', () => {
    const d = makeDb(), e = makeDb();
    for (const x of [d, e]) logic.commitSale(x, { lines: [line(5)], partyId: 'c1', method: 'credit', discount: 0 });
    const p = logic.recordPayment(d, { partyId: 'c1', amount: 300, taxDeducted: 18, direction: 'in', accountId: 'acc_cash' });
    logic.editPayment(d, p.id, { amount: 500 });
    logic.recordPayment(e, { partyId: 'c1', amount: 500, taxDeducted: 18, direction: 'in', accountId: 'acc_cash' });
    expect(check(d, 'edited')).toEqual(check(e, 'made so'));
  });
});

describe('deleted, then put back', () => {
  it('a receipt with tax withheld comes back whole', () => {
    const d = makeDb();
    logic.commitSale(d, { lines: [line(5)], partyId: 'c1', method: 'credit', discount: 0 });
    const p = logic.recordPayment(d, { partyId: 'c1', amount: 300, taxDeducted: 18, direction: 'in', accountId: 'acc_cash' });
    const made = check(d, 'made');
    logic.deletePayment(d, p.id);
    check(d, 'deleted');
    logic.restorePayment(d, p.id);
    expect(check(d, 'restored')).toEqual(made);
  });
  it('a cash purchase comes back whole', () => {
    const d = makeDb();
    const p = logic.createPurchase(d, 's1', [pline(3)], 'cash');
    const made = check(d, 'made');
    logic.deletePurchase(d, p.id);
    logic.restorePurchase(d, p.id);
    expect(check(d, 'restored')).toEqual(made);
  });
  it('a part-paid sale comes back whole', () => {
    const d = makeDb();
    const s = logic.commitSale(d, { lines: [line(3)], partyId: 'c1', method: 'credit', discount: 0, received: 250, receivedVia: 'cash' });
    const made = check(d, 'made');
    logic.deleteSale(d, s.id);
    logic.restoreSale(d, s.id);
    expect(check(d, 'restored')).toEqual(made);
  });
});

describe('every way a sale is paid, deleted', () => {
  const cases: [string, any][] = [
    ['split cash and mobile money', { method: 'cash', methods: [{ method: 'cash', amount: 300 }, { method: 'momo', amount: 300 }] }],
    ['mobile money', { method: 'momo' }],
    ['bank', { method: 'bank' }],
    ['tax withheld at the counter', { method: 'cash', wht: 36 }],
    ['credit, part paid by mobile money', { method: 'credit', received: 150, receivedVia: 'momo' }],
  ];
  for (const [name, pay] of cases) {
    it(name, () => {
      const d = makeDb();
      (d.accounts as any).push({ id: 'acc_momo', name: 'MoMo', type: 'momo', opening: 0 });
      const before = check(d, 'before');
      const s = logic.commitSale(d, { lines: [line(3)], partyId: 'c1', discount: 0, ...pay });
      check(d, name + ' made');
      logic.deleteSale(d, s.id);
      expect(check(d, name + ' deleted')).toEqual(before);
      logic.restoreSale(d, s.id);
      check(d, name + ' restored');
    });
  }
});

describe('more edits', () => {
  it('a cash sale edited onto credit', () => {
    const d = makeDb(), e = makeDb();
    const s = logic.commitSale(d, { lines: [line(2)], partyId: 'c1', method: 'cash', discount: 0 });
    logic.editSale(d, s.id, { lines: [line(2)], partyId: 'c1', discount: 0, pay: { method: 'credit' } as any });
    logic.commitSale(e, { lines: [line(2)], partyId: 'c1', method: 'credit', discount: 0 });
    expect(check(d, 'edited')).toEqual(check(e, 'made so'));
  });
  it('a receipt edited, then deleted, leaves nothing behind', () => {
    const d = makeDb();
    logic.commitSale(d, { lines: [line(5)], partyId: 'c1', method: 'credit', discount: 0 });
    const before = check(d, 'before');
    const p = logic.recordPayment(d, { partyId: 'c1', amount: 300, direction: 'in', accountId: 'acc_cash' });
    logic.editPayment(d, p.id, { amount: 450, accountId: 'acc_bank' });
    logic.deletePayment(d, p.id);
    expect(check(d, 'deleted')).toEqual(before);
  });
  it('a sale edited twice, then deleted, leaves nothing behind', () => {
    const d = makeDb();
    const before = check(d, 'before');
    const s = logic.commitSale(d, { lines: [line(2)], partyId: 'c1', method: 'cash', discount: 0 });
    logic.editSale(d, s.id, { lines: [line(4)], partyId: 'c1', discount: 10 });
    const up = check(d, 'edited up');
    expect(up.cust).toBe(390);
    logic.editSale(d, s.id, { lines: [line(1)], partyId: 'c1', discount: 0 });
    check(d, 'edited down');
    logic.deleteSale(d, s.id);
    expect(check(d, 'deleted')).toEqual(before);
  });
  it('a purchase edited, then deleted, leaves nothing behind', () => {
    const d = makeDb();
    const before = check(d, 'before');
    const p = logic.createPurchase(d, 's1', [pline(2)], 'cash');
    logic.editPurchase(d, p.id, { partyId: 's1', lines: [pline(5, 120)], method: 'credit' });
    logic.deletePurchase(d, p.id);
    expect(check(d, 'deleted')).toEqual(before);
  });
});
