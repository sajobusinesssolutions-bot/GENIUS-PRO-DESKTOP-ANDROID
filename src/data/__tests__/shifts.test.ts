import { DB, Product } from '../types';
import * as logic from '../logic';
import {
  defaultPrinterSettings, defaultPrinters, defaultPrintServer, defaultTemplates,
  defaultTemplateFor, defaultSubscription, defaultLicence, defaultSync, defaultUpdate,
  defaultSettings, defaultNumbering, defaultUnits, defaultCategories,
} from '../defaults';
import { builtinRoles } from '../perms';

// A minimal book so the shift maths is exercised against the same functions
// AppDataContext calls, with nothing else in the way.
function makeDb(): DB {
  const wh = { id: 'w1', name: 'Main' };
  const prod: Product = {
    id: 'p_a', sku: 'A', name: 'Widget', unit: 'PC', category: 'Gen',
    cost: 100, price: 200, taxRate: 0, stock: { w1: 500 }, reorder: 5,
    warrantyMonths: 0, bom: null, active: true,
  };
  const firm = { id: 'frm_1', name: 'Test Co', tin: '', address: '', phone: '' };
  const user = { id: 'u1', name: 'Owner', role: 'owner' as const, pin: '1111', active: true };
  const customer = { id: 'pty_1', name: 'Cust', type: 'customer' as const, phone: '', openingBalance: 0, creditLimit: 9e9, points: 0, active: true };
  return {
    v: 1,
    firm, firms: [firm], activeFirmId: firm.id,
    settings: { ...defaultSettings(), requireShift: false, taxRate: 0 },
    roles: builtinRoles(),
    numbering: defaultNumbering(),
    units: defaultUnits(),
    categories: defaultCategories(),
    loyaltyRules: { enabled: false, earnPer: 1000, pointValue: 5, redeemMin: 200 },
    warehouses: [wh],
    products: [prod],
    parties: [customer],
    users: [user],
    accounts: [
      { id: 'acc_cash', name: 'Cash', type: 'cash', opening: 0 },
      { id: 'acc_bank', name: 'Bank', type: 'bank', opening: 0 },
    ],
    sales: [], purchases: [], payments: [], entries: [], journal: [], movements: [],
    shifts: [], warranties: [], claims: [],
    estimates: [], challans: [], creditNotes: [], offers: [], stockTakes: [],
    purchaseOrders: [], productionRuns: [], recurringInvoices: [], auditLog: [], queue: [],
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

function line(qty: number, price: number) {
  return { productId: 'p_a', name: 'Widget', sku: 'A', unit: 'PC', qty, price, cost: 100, taxRate: 0 };
}

describe('shiftVariance', () => {
  it('calls an exact drawer balanced', () => {
    expect(logic.shiftVariance(150000, 150000)).toEqual({ diff: 0, state: 'balanced' });
  });

  it('ignores a difference of under a shilling', () => {
    expect(logic.shiftVariance(150000, 150000.4).state).toBe('balanced');
  });

  it('reports a light drawer as short, with a negative difference', () => {
    expect(logic.shiftVariance(200000, 185000)).toEqual({ diff: -15000, state: 'short' });
  });

  it('reports a heavy drawer as over', () => {
    expect(logic.shiftVariance(200000, 212500)).toEqual({ diff: 12500, state: 'over' });
  });
});

describe('shiftTotals', () => {
  it('starts at the opening float with nothing sold', () => {
    const d = makeDb();
    const s = logic.openShiftFor(d, 150000);
    const z = logic.shiftTotals(d, s);
    expect(z.count).toBe(0);
    expect(z.expected).toBe(150000);
  });

  it('adds cash sales but not mobile money or bank to the drawer', () => {
    const d = makeDb();
    const s = logic.openShiftFor(d, 100000);
    logic.commitSale(d, { lines: [line(2, 5000)], partyId: null, method: 'cash', discount: 0 });
    logic.commitSale(d, { lines: [line(1, 7000)], partyId: null, method: 'momo', discount: 0 });
    logic.commitSale(d, { lines: [line(1, 9000)], partyId: null, method: 'bank', discount: 0 });
    const z = logic.shiftTotals(d, s);
    expect(z.count).toBe(3);
    expect(z.cash).toBe(10000);
    expect(z.momo).toBe(7000);
    expect(z.bank).toBe(9000);
    expect(z.expected).toBe(110000);
  });

  it('includes the cash portion of a split-tender sale in the drawer', () => {
    const d = makeDb();
    const s = logic.openShiftFor(d, 100000);
    logic.commitSale(d, {
      lines: [line(1, 10000)], partyId: null, method: 'cash', discount: 0,
      methods: [{ method: 'cash', amount: 6000 }, { method: 'bank', amount: 4000 }],
    });
    const z = logic.shiftTotals(d, s);
    expect(z.cash).toBe(6000);
    expect(z.bank).toBe(4000);
    expect(z.expected).toBe(106000);
  });

  it('leaves a credit sale out of the drawer but counts it as sold', () => {
    const d = makeDb();
    const s = logic.openShiftFor(d, 50000);
    logic.commitSale(d, { lines: [line(1, 30000)], partyId: 'pty_1', method: 'credit', discount: 0 });
    const z = logic.shiftTotals(d, s);
    expect(z.total).toBe(30000);
    expect(z.credit).toBe(30000);
    expect(z.expected).toBe(50000);
  });

  it('adds a cash receipt and takes away cash paid out', () => {
    const d = makeDb();
    const s = logic.openShiftFor(d, 100000);
    logic.commitSale(d, { lines: [line(1, 40000)], partyId: 'pty_1', method: 'credit', discount: 0 });
    logic.recordPayment(d, { partyId: 'pty_1', amount: 40000, direction: 'in', accountId: 'acc_cash' });
    logic.recordPayment(d, { partyId: 'pty_1', amount: 15000, direction: 'out', accountId: 'acc_cash' });
    const z = logic.shiftTotals(d, s);
    expect(z.recv).toBe(40000);
    expect(z.paidOut).toBe(15000);
    expect(z.expected).toBe(125000);
  });

  it('ignores a receipt paid into the bank', () => {
    const d = makeDb();
    const s = logic.openShiftFor(d, 100000);
    logic.recordPayment(d, { partyId: 'pty_1', amount: 60000, direction: 'in', accountId: 'acc_bank' });
    expect(logic.shiftTotals(d, s).expected).toBe(100000);
  });
});

describe('closeShift', () => {
  it('stamps the shift with what was expected and the variance', () => {
    const d = makeDb();
    const s = logic.openShiftFor(d, 100000);
    logic.commitSale(d, { lines: [line(1, 25000)], partyId: null, method: 'cash', discount: 0 });
    const closed = logic.closeShift(d, s.id, 120000);
    expect(closed).toBeTruthy();
    expect(closed!.expected).toBe(125000);
    expect(closed!.countedCash).toBe(120000);
    expect(closed!.variance).toBe(-5000);
    expect(closed!.closedAt).toBeTruthy();
  });

  it('posts a short drawer as an expense against cash', () => {
    const d = makeDb();
    const s = logic.openShiftFor(d, 100000);
    const before = d.journal.length;
    logic.closeShift(d, s.id, 96000);
    const j = d.journal[d.journal.length - 1];
    expect(d.journal.length).toBe(before + 1);
    expect(j.ref).toBe('SHIFT');
    expect(j.balanced).toBe(true);
    expect(j.lines).toEqual([
      { acc: 'n_expense', dr: 4000 },
      { acc: 'acc_cash', cr: 4000 },
    ]);
  });

  it('posts an over drawer as other income', () => {
    const d = makeDb();
    const s = logic.openShiftFor(d, 100000);
    logic.closeShift(d, s.id, 103000);
    const j = d.journal[d.journal.length - 1];
    expect(j.lines).toEqual([
      { acc: 'acc_cash', dr: 3000 },
      { acc: 'n_income', cr: 3000 },
    ]);
  });

  it('posts nothing when the drawer balances', () => {
    const d = makeDb();
    const s = logic.openShiftFor(d, 100000);
    const before = d.journal.length;
    logic.closeShift(d, s.id, 100000);
    expect(d.journal.length).toBe(before);
  });

  it('refuses to close a shift twice', () => {
    const d = makeDb();
    const s = logic.openShiftFor(d, 100000);
    logic.closeShift(d, s.id, 100000);
    expect(logic.closeShift(d, s.id, 999)).toBeNull();
    expect(d.shifts[0].countedCash).toBe(100000);
  });

  it('only counts what happened while the shift was open', () => {
    const d = makeDb();
    const first = logic.openShiftFor(d, 100000);
    logic.commitSale(d, { lines: [line(1, 10000)], partyId: null, method: 'cash', discount: 0 });
    logic.closeShift(d, first.id, 110000);
    const second = logic.openShiftFor(d, 110000);
    const z = logic.shiftTotals(d, second);
    expect(z.count).toBe(0);
    expect(z.expected).toBe(110000);
  });
});
