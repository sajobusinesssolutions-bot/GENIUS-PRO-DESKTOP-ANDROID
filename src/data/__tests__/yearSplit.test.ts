/* yearSplit.ts: closing a financial year and splitting the book at its last day. */
import { DB, Product } from '../types';
import { uid } from '../uid';
import * as logic from '../logic';
import {
  defaultPrinterSettings, defaultPrinters, defaultPrintServer, defaultTemplates,
  defaultTemplateFor, defaultSubscription, defaultLicence, defaultSync, defaultUpdate,
  defaultSettings, defaultNumbering, defaultUnits, defaultCategories,
} from '../defaults';
import { builtinRoles } from '../perms';
import { ensureCoa, trialBalance } from '../coa';

// Builds a minimal-but-realistic DB so tests exercise the real mutation
// functions in src/data/logic.ts (the same code AppDataContext calls)
// without needing to render any React component.
function makeDb(): DB {
  const wh = { id: 'w1', name: 'Main' };
  const prodA: Product = { id: 'p_a', sku: 'A', name: 'Widget A', unit: 'PC', category: 'Gen', cost: 100, price: 200, taxRate: 18, stock: { w1: 50 }, reorder: 5, warrantyMonths: 0, bom: null, active: true };
  const prodB: Product = { id: 'p_b', sku: 'B', name: 'Component B', unit: 'PC', category: 'Gen', cost: 30, price: 60, taxRate: 0, stock: { w1: 100 }, reorder: 5, warrantyMonths: 0, bom: null, active: true };
  const prodKit: Product = { id: 'p_kit', sku: 'KIT', name: 'Kit', unit: 'PC', category: 'Gen', cost: 0, price: 500, taxRate: 18, stock: { w1: 0 }, reorder: 1, warrantyMonths: 0, bom: [{ productId: 'p_b', qty: 2 }], active: true };
  const firm = { id: 'frm_1', name: 'Test Co', tin: '', address: '', phone: '' };
  const user = { id: 'u1', name: 'Owner', role: 'owner' as const, pin: '1111', active: true };
  const customer = { id: 'pty_1', name: 'Cust', type: 'customer' as const, phone: '', openingBalance: 0, creditLimit: 999999, points: 0, active: true };
  return {
    v: 1,
    firm, firms: [firm], activeFirmId: firm.id,
    settings: { ...defaultSettings(), requireShift: false },
    roles: builtinRoles(),
    numbering: defaultNumbering(),
    units: defaultUnits(),
    categories: defaultCategories(),
    loyaltyRules: { enabled: false, earnPer: 1000, pointValue: 5, redeemMin: 200 },
    warehouses: [wh],
    products: [prodA, prodB, prodKit],
    parties: [customer],
    users: [user],
    accounts: [{ id: 'acc_cash', name: 'Cash', type: 'cash', opening: 0 }],
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


import { splitYear, closedYearCopy, previewYearSplit, dayOf } from '../yearSplit';
import { ledgerBalances } from '../coa';

/* the year to 2025-12-31 and some of the next, on one book */
function tradedBook() {
  const d = makeDb();
  ensureCoa(d);
  const sup = { id: 'pty_s', name: 'Supplier', type: 'supplier' as const, phone: '', openingBalance: 0, creditLimit: 0, points: 0, active: true };
  d.parties.push(sup);
  d.parties[0].openingBalance = 4000;
  const line = (qty: number) => ({ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty, price: 200, cost: 100, taxRate: 0 });
  const at = (s: string) => new Date(s + 'T10:00:00');
  const s1 = logic.commitSale(d, { lines: [line(5)], partyId: 'pty_1', method: 'credit', discount: 0 }, at('2025-03-01'));
  logic.commitSale(d, { lines: [line(2)], partyId: null, method: 'cash', discount: 0 }, at('2025-06-01'));
  logic.createPurchase(d, 'pty_s', [{ productId: 'p_a', qty: 10, cost: 100 }], 'credit', at('2025-04-01'), 'u1');
  logic.recordPayment(d, { partyId: 'pty_1', amount: 300, direction: 'in', accountId: 'acc_cash', allocations: [{ saleId: s1.id, amount: 300 }] }, at('2025-05-01'));
  logic.recordEntry(d, { direction: 'out', accountId: 'acc_cash', category: 'Transport', amount: 50 }, at('2025-09-01'));
  /* the next year */
  logic.commitSale(d, { lines: [line(1)], partyId: 'pty_1', method: 'credit', discount: 0 }, at('2026-01-05'));
  logic.recordPayment(d, { partyId: 'pty_1', amount: 200, direction: 'in', accountId: 'acc_cash', allocations: [{ saleId: s1.id, amount: 200 }] }, at('2026-01-10'));
  d.queue = [];
  return d;
}
const r2 = (n: number) => Math.round(n * 100) / 100;
const bs = (d: DB) => {
  const m = ledgerBalances(d);
  const out: Record<string, number> = {};
  (d.coa || []).forEach((l) => {
    if (l.type === 'income' || l.type === 'expense' || l.type === 'equity') return;
    const v = r2(m.get(l.id) || 0); if (v) out[l.id] = v;
  });
  return out;
};
const equity = (d: DB) => {
  const m = ledgerBalances(d);
  return r2((d.coa || []).filter((l) => l.type === 'equity').reduce((a, l) => a + (m.get(l.id) || 0), 0)
    + (d.coa || []).filter((l) => l.type === 'income').reduce((a, l) => a + (m.get(l.id) || 0), 0)
    - (d.coa || []).filter((l) => l.type === 'expense').reduce((a, l) => a + (m.get(l.id) || 0), 0));
};
const owed = (d: DB) => Object.fromEntries(d.parties.map((p) => [p.name, r2(logic.partyBalance(d, p.id))]));

describe('closing a year and splitting the book', () => {
  const now = new Date('2026-02-01T09:00:00');

  it('previews what moves', () => {
    const p = previewYearSplit(tradedBook(), '2025-12-31');
    expect(p.sales).toBe(2);
    expect(p.purchases).toBe(1);
    expect(p.opens).toBe('2026-01-01');
  });

  it('keeps every balance-sheet ledger, each party, and the stock exactly', () => {
    const d = tradedBook();
    const before = { bs: bs(d), eq: equity(d), owed: owed(d), stock: JSON.stringify(d.products.map((p) => p.stock)) };
    const r = splitYear(d, '2025-12-31', now);
    expect(r.opens).toBe('2026-01-01');
    expect(bs(d)).toEqual(before.bs);
    expect(equity(d)).toBe(before.eq);
    expect(owed(d)).toEqual(before.owed);
    expect(JSON.stringify(d.products.map((p) => p.stock))).toBe(before.stock);
    expect(trialBalance(d).totalDebit).toBeCloseTo(trialBalance(d).totalCredit, 2);
  });

  it('leaves only the new year, with last year\'s profit in retained earnings', () => {
    const d = tradedBook();
    splitYear(d, '2025-12-31', now);
    expect(d.sales.every((s) => dayOf(s.ts) > '2025-12-31')).toBe(true);
    expect(d.sales).toHaveLength(1);
    expect(d.payments).toHaveLength(1);
    const m = ledgerBalances(d);
    /* income this year is only this year's sale */
    expect(r2(m.get('n_sales') || 0)).toBe(200);
    expect(r2(m.get('n_retained') || 0)).not.toBe(0);
  });

  it('refuses a date in the closed year, and closing it again', () => {
    const d = tradedBook();
    splitYear(d, '2025-12-31', now);
    expect(logic.inClosedDay(d, new Date('2025-12-30T12:00:00').toISOString())).toBe(true);
    expect(logic.inClosedDay(d, new Date('2026-01-02T12:00:00').toISOString())).toBe(false);
    expect(() => splitYear(d, '2025-12-31', now)).toThrow();
    expect(() => splitYear(tradedBook(), '2026-02-01', now)).toThrow();
  });

  it('keeps the closed year as its own copy, as it stood on its last day', () => {
    const d = tradedBook();
    const copy = closedYearCopy(d, '2025-12-31');
    expect(copy.sales.every((s) => dayOf(s.ts) <= '2025-12-31')).toBe(true);
    /* Cust: 4000 opening + 1000 sale − 300 paid in the year (the 200 paid in January is not in it) */
    expect(r2(logic.partyBalance(copy, 'pty_1'))).toBe(4700);
    expect(copy.products.find((p) => p.id === 'p_a')!.stock.w1).toBe(50 - 5 - 2 + 10);
    expect(copy.settings.yearArchiveTo).toBe('2025-12-31');
  });
});
