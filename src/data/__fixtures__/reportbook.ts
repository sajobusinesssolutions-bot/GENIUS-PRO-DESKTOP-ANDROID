/** A book with a bit of everything, for checking the reports against each other. */
import { DB, Product } from '../types';
import * as logic from '../logic';
import {
  defaultPrinterSettings, defaultPrinters, defaultPrintServer, defaultTemplates,
  defaultTemplateFor, defaultSubscription, defaultLicence, defaultSync, defaultUpdate,
  defaultSettings, defaultNumbering, defaultUnits, defaultCategories,
} from '../defaults';
import { builtinRoles } from '../perms';
import { ensureCoa } from '../coa';

export function makeDb(): DB {
  const prodA: Product = { id: 'p_a', sku: 'A', name: 'Widget A', unit: 'PC', category: 'Gen', cost: 100, price: 200, taxRate: 0, stock: { w1: 0 }, reorder: 5, warrantyMonths: 0, bom: null, active: true };
  const prodB: Product = { id: 'p_b', sku: 'B', name: 'Gadget B', unit: 'PC', category: 'Gen', cost: 300, price: 450, taxRate: 18, stock: { w1: 0 }, reorder: 5, warrantyMonths: 0, bom: null, active: true };
  const firm = { id: 'frm_1', name: 'Test Co', tin: '', address: '', phone: '' };
  const user = { id: 'u1', name: 'Owner', role: 'owner' as const, pin: '1111', active: true };
  const d: any = {
    v: 1, firm, firms: [firm], activeFirmId: firm.id,
    settings: { ...defaultSettings(), requireShift: false, allowNegativeStock: true },
    roles: builtinRoles(), numbering: defaultNumbering(), units: defaultUnits(), categories: defaultCategories(),
    loyaltyRules: { enabled: false, earnPer: 1000, pointValue: 5, redeemMin: 200 },
    warehouses: [{ id: 'w1', name: 'Main' }], products: [prodA, prodB],
    parties: [
      { id: 'c1', name: 'Cust One', type: 'customer', phone: '', openingBalance: 0, creditLimit: 0, points: 0, active: true },
      { id: 'c2', name: 'Cust Two', type: 'customer', phone: '', openingBalance: 0, creditLimit: 0, points: 0, active: true },
      { id: 's1', name: 'Supp One', type: 'supplier', phone: '', openingBalance: 0, creditLimit: 0, points: 0, active: true },
    ],
    users: [user],
    accounts: [{ id: 'acc_cash', name: 'Cash', type: 'cash', opening: 0 }, { id: 'acc_bank', name: 'Bank', type: 'bank', opening: 0 }, { id: 'acc_momo', name: 'MoMo', type: 'momo', opening: 0 }],
    sales: [], purchases: [], payments: [], entries: [], journal: [], movements: [],
    shifts: [], warranties: [], claims: [], estimates: [], challans: [], creditNotes: [], offers: [], stockTakes: [],
    purchaseOrders: [], productionRuns: [], recurringInvoices: [], auditLog: [], businessAccess: [], queue: [], plans: [],
    session: { userId: user.id, role: 'owner', online: true, till: 'Till 1', warehouse: 'w1' },
    counters: { sale: 0, purchase: 0, estimate: 0, challan: 0, creditNote: 0, po: 0, plan: 0 },
    onboarded: true, instalmentPlans: [],
    printer: defaultPrinterSettings(), printers: defaultPrinters(defaultPrinterSettings()), printServer: defaultPrintServer(),
    templates: defaultTemplates(), templateFor: defaultTemplateFor(), subscription: defaultSubscription(), licence: defaultLicence(),
    sync: defaultSync(), update: defaultUpdate(), numberSafe: { mode: 'auto' }, revisions: [],
  };
  ensureCoa(d);
  return d;
}
export const line = (p: 'p_a' | 'p_b', qty: number, price: number, taxRate = 0) => ({ productId: p, name: p, sku: p, unit: 'PC', qty, price, cost: p === 'p_a' ? 100 : 300, taxRate }) as any;
export const pline = (p: 'p_a' | 'p_b', qty: number, cost: number) => ({ productId: p, name: p, qty, cost }) as any;
export const day = (n: number) => new Date(Date.now() - n * 864e5);

/** The book: every kind of voucher, an edit, deletes and opening balances both ways. */
export function busyBook(): DB {
  const d = makeDb();
  d.parties[1].openingBalance = 5000;           // Cust Two owed 5,000 when added (to receive)
  d.parties[2].openingBalance = -8000;          // Supp One was owed 8,000 (to pay)
  logic.createPurchase(d, 's1', [pline('p_a', 30, 100), pline('p_b', 10, 300)], 'credit', day(20));
  logic.createPurchase(d, 's1', [pline('p_a', 5, 100)], 'cash', day(18));
  const s1 = logic.commitSale(d, { lines: [line('p_a', 4, 200)], partyId: 'c1', method: 'credit', discount: 0 }, day(15));
  logic.commitSale(d, { lines: [line('p_b', 2, 450, 18)], partyId: 'c1', method: 'cash', discount: 50 }, day(14));
  logic.commitSale(d, { lines: [line('p_a', 3, 200)], partyId: 'c2', method: 'credit', discount: 0, received: 200, receivedVia: 'momo' }, day(12));
  logic.commitSale(d, { lines: [line('p_a', 1, 200)], partyId: null, method: 'cash', discount: 0 }, day(10));
  logic.recordPayment(d, { partyId: 'c1', amount: 500, taxDeducted: 30, direction: 'in', accountId: 'acc_bank', allocations: [{ saleId: s1.id, amount: 530 }] }, day(9));
  logic.recordPayment(d, { partyId: 'c2', amount: 1000, direction: 'in', accountId: 'acc_cash', onAccount: true }, day(8));
  logic.recordPayment(d, { partyId: 's1', amount: 6000, direction: 'out', accountId: 'acc_bank' }, day(7));
  const s5 = logic.commitSale(d, { lines: [line('p_a', 2, 200)], partyId: 'c1', method: 'credit', discount: 0 }, day(6));
  logic.editSale(d, s5.id, { lines: [line('p_a', 3, 200)], partyId: 'c1', discount: 0 }, 'more', day(5));
  const s6 = logic.commitSale(d, { lines: [line('p_b', 1, 450)], partyId: 'c2', method: 'credit', discount: 0 }, day(4));
  logic.recordPayment(d, { partyId: 'c2', amount: 450, direction: 'in', accountId: 'acc_cash', allocations: [{ saleId: s6.id, amount: 450 }] }, day(3));
  logic.deleteSale(d, s6.id, 'wrong customer', day(2));
  const px = logic.createPurchase(d, 's1', [pline('p_b', 2, 300)], 'credit', day(2));
  logic.deletePurchase(d, px.id, 'entered twice', day(1));
  return d;
}
