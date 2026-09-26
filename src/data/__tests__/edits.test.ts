/**
 * Editing and deleting posted documents.
 *
 * The rule the reference sets (SCREENS.editSale 17509, A.editSaleSave 17612,
 * A.deleteSale 17654, A.deletePayment 17745): a posted record is never
 * rewritten or spliced out. It is reversed, and — for an edit — reposted.
 * So after a delete the shelf, the party balance and the ledger must all be
 * exactly where they were before the document existed.
 */
import { DB, Product, SaleLine } from '../types';
import * as logic from '../logic';
import {
  defaultPrinterSettings, defaultPrinters, defaultPrintServer, defaultTemplates,
  defaultTemplateFor, defaultSubscription, defaultLicence, defaultSync, defaultUpdate,
  defaultSettings, defaultNumbering, defaultUnits, defaultCategories,
} from '../defaults';
import { builtinRoles } from '../perms';

function makeDb(): DB {
  const wh = { id: 'w1', name: 'Main' };
  const prodA: Product = { id: 'p_a', sku: 'A', name: 'Widget A', unit: 'PC', category: 'Gen', cost: 100, price: 200, taxRate: 18, stock: { w1: 50 }, reorder: 5, warrantyMonths: 0, bom: null, active: true };
  const prodB: Product = { id: 'p_b', sku: 'B', name: 'Component B', unit: 'PC', category: 'Gen', cost: 30, price: 60, taxRate: 0, stock: { w1: 100 }, reorder: 5, warrantyMonths: 0, bom: null, active: true };
  const firm = { id: 'frm_1', name: 'Test Co', tin: '', address: '', phone: '' };
  const user = { id: 'u1', name: 'Owner', role: 'owner' as const, pin: '1111', active: true };
  const customer = { id: 'pty_1', name: 'Cust', type: 'customer' as const, phone: '', openingBalance: 0, creditLimit: 999999, points: 0, active: true };
  const supplier = { id: 'pty_2', name: 'Supp', type: 'supplier' as const, phone: '', openingBalance: 0, creditLimit: 999999, points: 0, active: true };
  return {
    v: 1,
    firm, firms: [firm], activeFirmId: firm.id,
    settings: { ...defaultSettings(), requireShift: false, editWindowDays: 0 },
    roles: builtinRoles(),
    numbering: defaultNumbering(),
    units: defaultUnits(),
    categories: defaultCategories(),
    loyaltyRules: { enabled: false, earnPer: 1000, pointValue: 5, redeemMin: 200 },
    warehouses: [wh],
    products: [prodA, prodB],
    parties: [customer, supplier],
    users: [user],
    accounts: [{ id: 'acc_cash', name: 'Cash', type: 'cash', opening: 0 }, { id: 'acc_bank', name: 'Bank', type: 'bank', opening: 0 }],
    sales: [], purchases: [], payments: [], entries: [], journal: [], movements: [],
    shifts: [], warranties: [], claims: [],
    estimates: [], challans: [], creditNotes: [], offers: [], stockTakes: [],
    purchaseOrders: [], productionRuns: [], recurringInvoices: [], auditLog: [], businessAccess: [], queue: [],
    plans: [],
    session: { userId: user.id, role: 'owner', online: true, till: 'Till 1', warehouse: 'w1' },
    counters: { sale: 0, purchase: 0, estimate: 0, challan: 0, creditNote: 0, po: 0, plan: 0 },
    onboarded: true,
    instalmentPlans: [],
    printer: defaultPrinterSettings(),
    printers: defaultPrinters(defaultPrinterSettings()),
    printServer: defaultPrintServer(),
    templates: defaultTemplates(),
    templateFor: defaultTemplateFor(),
    subscription: defaultSubscription(),
    licence: defaultLicence(),
    sync: defaultSync(),
    update: defaultUpdate(),
    numberSafe: { mode: 'auto' },
    revisions: [],
  };
}

function journalNet(d: DB, acc: string) {
  let n = 0;
  d.journal.forEach((e) => e.lines.forEach((l) => { if (l.acc === acc) n += (l.dr || 0) - (l.cr || 0); }));
  return n;
}
function allNets(d: DB) {
  const accs = new Set<string>();
  d.journal.forEach((e) => e.lines.forEach((l) => accs.add(l.acc)));
  const out: Record<string, number> = {};
  accs.forEach((a) => { out[a] = journalNet(d, a); });
  return out;
}
function stock(d: DB, id: string) { return d.products.find((p) => p.id === id)!.stock.w1; }

const lineA = (qty: number): SaleLine => ({ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty, price: 200, cost: 100, taxRate: 18 });

describe('the edit window', () => {
  it('lets anything be changed when the window is off (0 = no limit)', () => {
    const d = makeDb();
    d.settings.editWindowDays = 0;
    const s = logic.commitSale(d, { lines: [lineA(2)], partyId: null, method: 'cash', discount: 0 }, new Date(2024, 0, 1));
    expect(logic.canEditSale(d, s.id, new Date(2025, 0, 1)).ok).toBe(true);
  });

  it('refuses a bill older than the window, with an explanation', () => {
    const d = makeDb();
    d.settings.editWindowDays = 7;
    const s = logic.commitSale(d, { lines: [lineA(2)], partyId: null, method: 'cash', discount: 0 }, new Date(2024, 0, 1));
    const late = logic.canEditSale(d, s.id, new Date(2024, 0, 20));
    expect(late.ok).toBe(false);
    expect(late.why).toMatch(/7 days/);
    expect(logic.canEditSale(d, s.id, new Date(2024, 0, 3)).ok).toBe(true);
  });

  it('applies to purchases and payments too, and refuses an already-void bill', () => {
    const d = makeDb();
    d.settings.editWindowDays = 1;
    const pu = logic.createPurchase(d, 'pty_2', [{ productId: 'p_a', qty: 5, cost: 100 }], 'credit', new Date(2024, 0, 1));
    const pay = logic.recordPayment(d, { partyId: 'pty_2', amount: 100, direction: 'out', accountId: 'acc_cash' }, new Date(2024, 0, 1));
    expect(logic.canEditPurchase(d, pu.id, new Date(2024, 0, 5)).ok).toBe(false);
    expect(logic.canEditPayment(d, pay.id, new Date(2024, 0, 5)).ok).toBe(false);

    d.settings.editWindowDays = 0;
    const s = logic.commitSale(d, { lines: [lineA(1)], partyId: null, method: 'cash', discount: 0 });
    logic.voidSale(d, s.id, 'gone');
    expect(logic.canEditSale(d, s.id).ok).toBe(false);
    expect(logic.canEditSale(d, s.id).why).toMatch(/already void/);
  });
});

describe('deleting a sale', () => {
  it('puts the stock back, clears the party balance and unwinds the ledger', () => {
    const d = makeDb();
    const before = { stock: stock(d, 'p_a'), bal: logic.partyBalance(d, 'pty_1'), nets: allNets(d) };
    const s = logic.commitSale(d, { lines: [lineA(4)], partyId: 'pty_1', method: 'credit', discount: 0 });
    expect(stock(d, 'p_a')).toBe(before.stock - 4);
    expect(logic.partyBalance(d, 'pty_1')).toBe(800);

    expect(logic.deleteSale(d, s.id, 'Wrong customer')).toBe(true);
    expect(stock(d, 'p_a')).toBe(before.stock);
    expect(logic.partyBalance(d, 'pty_1')).toBe(before.bal);
    Object.keys(allNets(d)).forEach((a) => expect(allNets(d)[a]).toBeCloseTo(before.nets[a] || 0, 6));
    expect(d.sales.find((x) => x.id === s.id)!.status).toBe('void');
    expect(d.auditLog.some((a) => a.action === 'Sale deleted')).toBe(true);
  });

  it('will not delete the same bill twice', () => {
    const d = makeDb();
    const s = logic.commitSale(d, { lines: [lineA(1)], partyId: null, method: 'cash', discount: 0 });
    expect(logic.deleteSale(d, s.id)).toBe(true);
    expect(logic.deleteSale(d, s.id)).toBe(false);
  });
});

describe('deleting a purchase', () => {
  it('takes the stock back off the shelf and restores the supplier balance and ledger', () => {
    const d = makeDb();
    const before = { stock: stock(d, 'p_a'), bal: logic.partyBalance(d, 'pty_2'), nets: allNets(d) };
    const pu = logic.createPurchase(d, 'pty_2', [{ productId: 'p_a', qty: 10, cost: 100 }], 'credit');
    expect(stock(d, 'p_a')).toBe(before.stock + 10);
    expect(logic.partyBalance(d, 'pty_2')).toBe(-1000);

    expect(logic.deletePurchase(d, pu.id, 'Never arrived')).toBe(true);
    expect(stock(d, 'p_a')).toBe(before.stock);
    expect(logic.partyBalance(d, 'pty_2')).toBe(before.bal);
    Object.keys(allNets(d)).forEach((a) => expect(allNets(d)[a]).toBeCloseTo(before.nets[a] || 0, 6));
    expect(d.purchases.find((x) => x.id === pu.id)!.status).toBe('void');
  });

  it('restores cash for a cash purchase', () => {
    const d = makeDb();
    const pu = logic.createPurchase(d, 'pty_2', [{ productId: 'p_b', qty: 5, cost: 30 }], 'cash');
    expect(journalNet(d, 'acc_cash')).toBe(-150);
    logic.deletePurchase(d, pu.id);
    expect(journalNet(d, 'acc_cash')).toBe(0);
    expect(journalNet(d, 'n_inventory')).toBe(0);
    expect(stock(d, 'p_b')).toBe(100);
  });
});

describe('deleting a payment', () => {
  it('re-opens the bill it settled and reverses the cash movement', () => {
    const d = makeDb();
    const s = logic.commitSale(d, { lines: [lineA(5)], partyId: 'pty_1', method: 'credit', discount: 0 });
    const afterSale = { bal: logic.partyBalance(d, 'pty_1'), nets: allNets(d) };
    expect(afterSale.bal).toBe(1000);

    const pay = logic.recordPayment(d, { partyId: 'pty_1', amount: 400, direction: 'in', accountId: 'acc_cash' });
    expect(d.sales.find((x) => x.id === s.id)!.due).toBe(600);
    expect(logic.partyBalance(d, 'pty_1')).toBe(600);

    expect(logic.deletePayment(d, pay.id, 'Entered twice')).toBe(true);
    expect(d.payments.find((x) => x.id === pay.id)).toBeUndefined();
    expect(d.sales.find((x) => x.id === s.id)!.due).toBe(1000);
    expect(d.sales.find((x) => x.id === s.id)!.paid).toBe(0);
    expect(logic.partyBalance(d, 'pty_1')).toBe(afterSale.bal);
    Object.keys(allNets(d)).forEach((a) => expect(allNets(d)[a]).toBeCloseTo(afterSale.nets[a] || 0, 6));
  });

  it('restores a supplier payment against a purchase', () => {
    const d = makeDb();
    logic.createPurchase(d, 'pty_2', [{ productId: 'p_a', qty: 10, cost: 100 }], 'credit');
    const before = { bal: logic.partyBalance(d, 'pty_2'), nets: allNets(d) };
    const pay = logic.recordPayment(d, { partyId: 'pty_2', amount: 600, direction: 'out', accountId: 'acc_cash' });
    expect(logic.partyBalance(d, 'pty_2')).toBe(-400);
    logic.deletePayment(d, pay.id);
    expect(logic.partyBalance(d, 'pty_2')).toBe(before.bal);
    Object.keys(allNets(d)).forEach((a) => expect(allNets(d)[a]).toBeCloseTo(before.nets[a] || 0, 6));
  });
});

describe('editing is void-and-repost', () => {
  it('keeps the number, reverses the old posting and posts the corrected bill', () => {
    const d = makeDb();
    const s = logic.commitSale(d, { lines: [lineA(4)], partyId: 'pty_1', method: 'credit', discount: 0 }, new Date(2024, 0, 10));
    const no = s.no;
    const fresh = logic.editSale(d, s.id, { lines: [lineA(2)], partyId: 'pty_1', discount: 0, note: 'two, not four' });

    expect(fresh).toBeTruthy();
    expect(fresh!.no).toBe(no);
    expect(fresh!.ts).toBe(s.ts);
    expect(fresh!.editedFrom).toBe(s.id);
    expect(fresh!.total).toBe(400);
    /* only the corrected bill survives in the list; the reversal lives in the ledger */
    expect(d.sales.length).toBe(1);
    expect(d.counters.sale).toBe(1);
    /* four went out, four came back, two went out */
    expect(stock(d, 'p_a')).toBe(48);
    expect(logic.partyBalance(d, 'pty_1')).toBe(400);
    expect(d.journal.every((j) => j.balanced)).toBe(true);
    expect(d.journal.some((j) => j.memo === 'Void ' + no)).toBe(true);
    /* nothing is left pointing at a throwaway number */
    expect(d.journal.every((j) => !/INV-00002/.test(j.memo))).toBe(true);
  });

  it('keeps money already taken on a cash bill', () => {
    const d = makeDb();
    const s = logic.commitSale(d, { lines: [lineA(5)], partyId: null, method: 'cash', discount: 0 });
    expect(s.paid).toBe(1000);
    const fresh = logic.editSale(d, s.id, { lines: [lineA(3)], partyId: null, discount: 0 })!;
    expect(fresh.total).toBe(600);
    expect(fresh.paid).toBe(600);
    expect(fresh.due).toBe(0);
  });

  it('refuses an empty bill and a void one', () => {
    const d = makeDb();
    const s = logic.commitSale(d, { lines: [lineA(1)], partyId: null, method: 'cash', discount: 0 });
    expect(logic.editSale(d, s.id, { lines: [], partyId: null, discount: 0 })).toBeNull();
    logic.voidSale(d, s.id);
    expect(logic.editSale(d, s.id, { lines: [lineA(1)], partyId: null, discount: 0 })).toBeNull();
  });

  it('reposts a purchase under the same number, with the stock net of both', () => {
    const d = makeDb();
    const pu = logic.createPurchase(d, 'pty_2', [{ productId: 'p_a', qty: 10, cost: 100 }], 'credit');
    const fresh = logic.editPurchase(d, pu.id, { partyId: 'pty_2', lines: [{ productId: 'p_a', qty: 6, cost: 100 }], method: 'credit' })!;
    expect(fresh.no).toBe(pu.no);
    expect(fresh.total).toBe(600);
    expect(d.purchases.length).toBe(1);
    expect(stock(d, 'p_a')).toBe(56);
    expect(logic.partyBalance(d, 'pty_2')).toBe(-600);
    expect(d.journal.every((j) => j.balanced)).toBe(true);
  });

  it('reposts a payment: the old application is undone and the new amount applied', () => {
    const d = makeDb();
    const s = logic.commitSale(d, { lines: [lineA(5)], partyId: 'pty_1', method: 'credit', discount: 0 });
    const pay = logic.recordPayment(d, { partyId: 'pty_1', amount: 400, direction: 'in', accountId: 'acc_cash' });
    logic.editPayment(d, pay.id, { amount: 700, accountId: 'acc_bank', note: 'was short' });

    expect(d.payments[0].amount).toBe(700);
    expect(d.payments[0].accountId).toBe('acc_bank');
    expect(d.sales.find((x) => x.id === s.id)!.due).toBe(300);
    expect(journalNet(d, 'acc_cash')).toBe(0);
    expect(journalNet(d, 'acc_bank')).toBe(700);
    expect(journalNet(d, 'n_ar')).toBe(300);
    expect(logic.partyBalance(d, 'pty_1')).toBe(300);
    expect(d.journal.every((j) => j.balanced)).toBe(true);
  });
});
