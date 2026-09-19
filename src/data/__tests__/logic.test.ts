import { DB, Product } from '../types';
import { uid } from '../uid';
import * as logic from '../logic';
import {
  defaultPrinterSettings, defaultPrinters, defaultPrintServer, defaultTemplates,
  defaultTemplateFor, defaultSubscription, defaultLicence, defaultSync, defaultUpdate,
  defaultSettings, defaultNumbering, defaultUnits, defaultCategories,
} from '../defaults';
import { builtinRoles } from '../perms';

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

function journalNet(d: DB, acc: string) {
  let n = 0;
  d.journal.forEach((e) => e.lines.forEach((l) => { if (l.acc === acc) n += (l.dr || 0) - (l.cr || 0); }));
  return n;
}

describe('the stock guard on a sale', () => {
  function strict(d: any) {
    d.settings.blockNegativeStock = true;
    d.settings.allowNegativeStock = false;
    return d;
  }

  it('lets a sale through when there is enough on the shelf', () => {
    const d = strict(makeDb());
    expect(() => logic.commitSale(d, {
      lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 5, price: 200, cost: 100, taxRate: 0 }],
      partyId: null, method: 'cash', discount: 0,
    })).not.toThrow();
  });

  it('refuses a sale that would take more than is held', () => {
    const d = strict(makeDb());
    d.products.find((p: any) => p.id === 'p_a').stock.w1 = 2;
    expect(() => logic.commitSale(d, {
      lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 5, price: 200, cost: 100, taxRate: 0 }],
      partyId: null, method: 'cash', discount: 0,
    })).toThrow(/Not enough/);
  });

  it('adds up the lines of one product before judging, so a split cannot oversell', () => {
    const d = strict(makeDb());
    d.products.find((p: any) => p.id === 'p_a').stock.w1 = 4;
    // the same product arriving as two batch lines of 3 and 2 — 5 in total
    expect(() => logic.commitSale(d, {
      lines: [
        { productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 3, price: 200, cost: 100, taxRate: 0, batchNo: 'B1' },
        { productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 2, price: 200, cost: 100, taxRate: 0, batchNo: 'B2' },
      ],
      partyId: null, method: 'cash', discount: 0,
    })).toThrow(/Not enough/);
  });

  it('allows a split that does add up to what is held', () => {
    const d = strict(makeDb());
    d.products.find((p: any) => p.id === 'p_a').stock.w1 = 5;
    expect(() => logic.commitSale(d, {
      lines: [
        { productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 3, price: 200, cost: 100, taxRate: 0, batchNo: 'B1' },
        { productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 2, price: 200, cost: 100, taxRate: 0, batchNo: 'B2' },
      ],
      partyId: null, method: 'cash', discount: 0,
    })).not.toThrow();
  });

  it('never blocks a service, which has no shelf to run short of', () => {
    const d = strict(makeDb());
    d.products.push({
      id: 'p_svc', sku: 'SVC', name: 'Delivery', unit: 'job', category: 'Gen',
      cost: 0, price: 5000, taxRate: 0, stock: {}, reorder: 0, warrantyMonths: 0,
      bom: null, active: true, kind: 'service',
    });
    expect(() => logic.commitSale(d, {
      lines: [{ productId: 'p_svc', name: 'Delivery', sku: 'SVC', unit: 'job', qty: 1, price: 5000, cost: 0, taxRate: 0 }],
      partyId: null, method: 'cash', discount: 0,
    })).not.toThrow();
  });

  it('never blocks an item that is not counted', () => {
    const d = strict(makeDb());
    d.products.push({
      id: 'p_free', sku: 'FREE', name: 'Bread', unit: 'PC', category: 'Gen',
      cost: 10, price: 20, taxRate: 0, stock: {}, reorder: 0, warrantyMonths: 0,
      bom: null, active: true, trackInventory: false,
    });
    expect(() => logic.commitSale(d, {
      lines: [{ productId: 'p_free', name: 'Bread', sku: 'FREE', unit: 'PC', qty: 9, price: 20, cost: 10, taxRate: 0 }],
      partyId: null, method: 'cash', discount: 0,
    })).not.toThrow();
  });

  it('says what is on hand and what was needed', () => {
    const d = strict(makeDb());
    d.products.find((p: any) => p.id === 'p_a').stock.w1 = 2;
    expect(() => logic.commitSale(d, {
      lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 5, price: 200, cost: 100, taxRate: 0 }],
      partyId: null, method: 'cash', discount: 0,
    })).toThrow(/2 PC on hand, 5 needed/);
  });
});

describe('splitExpenseOffset', () => {
  it('takes the whole expense off a bill that can cover it', () => {
    expect(logic.splitExpenseOffset(5000, 1200)).toEqual({ offset: 1200, rest: 0 });
  });

  it('caps the offset at what is still owing and lets the rest leave the drawer', () => {
    expect(logic.splitExpenseOffset(800, 1200)).toEqual({ offset: 800, rest: 400 });
  });

  it('offsets nothing against a settled bill', () => {
    expect(logic.splitExpenseOffset(0, 1200)).toEqual({ offset: 0, rest: 1200 });
  });

  it('never offsets a negative balance', () => {
    expect(logic.splitExpenseOffset(-500, 300)).toEqual({ offset: 0, rest: 300 });
  });

  it('treats a missing or negative amount as nothing', () => {
    expect(logic.splitExpenseOffset(5000, 0)).toEqual({ offset: 0, rest: 0 });
    expect(logic.splitExpenseOffset(5000, -20)).toEqual({ offset: 0, rest: 0 });
  });

  it('always accounts for the full amount across the two halves', () => {
    [[5000, 1200], [800, 1200], [0, 900], [300, 300]].forEach(([due, amt]) => {
      const r = logic.splitExpenseOffset(due, amt);
      expect(r.offset + r.rest).toBe(Math.max(0, amt));
    });
  });
});

describe('accountability', () => {
  it('stamps every stock movement with the session user by default', () => {
    const d = makeDb();
    logic.commitSale(d, {
      lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 2, price: 200, cost: 100, taxRate: 0 }],
      partyId: null, method: 'cash', discount: 0,
    });
    const mv = d.movements.filter((m) => m.type === 'sale');
    expect(mv.length).toBeGreaterThan(0);
    expect(mv.every((m) => m.userId === d.session.userId)).toBe(true);
  });

  it('credits a stock adjustment to whoever counted it', () => {
    const d = makeDb();
    d.users.push({ id: 'u2', name: 'Asha', role: 'cashier', pin: '2222', active: true });
    logic.adjustStock(d, 'p_a', 'w1', 42, 'Recount', new Date(), undefined, 'u2');
    const mv = d.movements.find((m) => m.type === 'adjust');
    expect(mv?.userId).toBe('u2');
  });

  it('names the person in the audit line for an adjustment', () => {
    const d = makeDb();
    d.users.push({ id: 'u2', name: 'Asha', role: 'cashier', pin: '2222', active: true });
    logic.adjustStock(d, 'p_a', 'w1', 7, 'Breakage', new Date(), undefined, 'u2');
    expect(d.auditLog.some((a) => a.action === 'Stock adjusted' && a.details.includes('Asha'))).toBe(true);
  });

  it('records who took a payment', () => {
    const d = makeDb();
    const pay = logic.recordPayment(d, {
      partyId: 'pty_1', amount: 100, direction: 'in', accountId: 'acc_cash', userId: 'u1',
    });
    expect(pay.userId).toBe('u1');
  });

  it('records who received a purchase', () => {
    const d = makeDb();
    const sup = { id: 'pty_s', name: 'Supp', type: 'supplier' as const, phone: '', openingBalance: 0, creditLimit: 0, points: 0, active: true };
    d.parties.push(sup);
    const pu = logic.createPurchase(d, sup.id, [{ productId: 'p_a', qty: 2, cost: 100 }], 'cash', new Date(), 'u1');
    expect(pu.userId).toBe('u1');
  });
});

describe('commitSale', () => {
  it('reduces stock, posts a balanced journal, and marks a cash sale fully paid', () => {
    const d = makeDb();
    const sale = logic.commitSale(d, { lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 5, price: 200, cost: 100, taxRate: 18 }], partyId: null, method: 'cash', discount: 0 });
    expect(d.products.find((p) => p.id === 'p_a')!.stock.w1).toBe(45);
    expect(sale.total).toBe(1000);
    expect(sale.due).toBe(0);
    expect(sale.paid).toBe(1000);
    d.journal.forEach((e) => expect(e.balanced).toBe(true));
    expect(journalNet(d, 'acc_cash')).toBe(1000);
    expect(journalNet(d, 'n_inventory')).toBe(-500); // cost of goods sold removed from inventory
  });

  it('records the outstanding balance as accounts receivable on a credit sale', () => {
    const d = makeDb();
    const sale = logic.commitSale(d, { lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 2, price: 200, cost: 100, taxRate: 18 }], partyId: 'pty_1', method: 'credit', discount: 0 });
    expect(sale.paid).toBe(0);
    expect(sale.due).toBe(400);
    expect(logic.partyBalance(d, 'pty_1')).toBe(400);
    expect(journalNet(d, 'n_ar')).toBe(400);
  });

  it('charges no tax when the shop has tax switched off', () => {
    const d = makeDb();
    d.settings.taxEnabled = false;
    const sale = logic.commitSale(d, {
      lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 1, price: 200, cost: 100, taxRate: 18 }],
      partyId: null, method: 'cash', discount: 0,
    });
    expect(sale.tax).toBe(0);
    expect(sale.total).toBe(200);
    expect(journalNet(d, 'n_tax')).toBe(0);
  });

  it('still charges tax when the shop has it switched on', () => {
    const d = makeDb();
    d.settings.taxEnabled = true;
    const sale = logic.commitSale(d, {
      lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 1, price: 200, cost: 100, taxRate: 18 }],
      partyId: null, method: 'cash', discount: 0,
    });
    expect(sale.tax).toBeGreaterThan(0);
  });

  it('keeps the journal balanced with tax switched off', () => {
    const d = makeDb();
    d.settings.taxEnabled = false;
    logic.commitSale(d, {
      lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 3, price: 200, cost: 100, taxRate: 18 }],
      partyId: null, method: 'cash', discount: 50,
    });
    expect(d.journal.every((e) => e.balanced)).toBe(true);
  });

  it('stamps the sale with whoever recorded it', () => {
    const d = makeDb();
    const sale = logic.commitSale(d, {
      lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 1, price: 200, cost: 100, taxRate: 0 }],
      partyId: null, method: 'cash', discount: 0, userId: 'u1',
    });
    expect(sale.userId).toBe('u1');
  });

  it('splits a credit sale into what was received and what stays owed', () => {
    const d = makeDb();
    const sale = logic.commitSale(d, {
      lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 2, price: 200, cost: 100, taxRate: 18 }],
      partyId: 'pty_1', method: 'credit', discount: 0, received: 150,
    });
    expect(sale.total).toBe(400);
    expect(sale.paid).toBe(150);
    expect(sale.due).toBe(250);
    expect(logic.partyBalance(d, 'pty_1')).toBe(250);
    expect(journalNet(d, 'n_ar')).toBe(250);
    expect(journalNet(d, 'acc_cash')).toBe(150);
  });

  it('keeps the journal balanced when a credit sale takes part payment', () => {
    const d = makeDb();
    logic.commitSale(d, {
      lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 2, price: 200, cost: 100, taxRate: 18 }],
      partyId: 'pty_1', method: 'credit', discount: 0, received: 150,
    });
    expect(d.journal.every((e) => e.balanced)).toBe(true);
  });

  it('never lets the part payment exceed the bill', () => {
    const d = makeDb();
    const sale = logic.commitSale(d, {
      lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 1, price: 200, cost: 100, taxRate: 0 }],
      partyId: 'pty_1', method: 'credit', discount: 0, received: 9999,
    });
    expect(sale.paid).toBe(200);
    expect(sale.due).toBe(0);
  });

  it('treats a negative or missing part payment as nothing received', () => {
    const d = makeDb();
    const a = logic.commitSale(d, {
      lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 1, price: 200, cost: 100, taxRate: 0 }],
      partyId: 'pty_1', method: 'credit', discount: 0, received: -50,
    });
    expect(a.paid).toBe(0);
    expect(a.due).toBe(200);
  });

  it('ignores a part payment on a cash sale, which is paid in full anyway', () => {
    const d = makeDb();
    const sale = logic.commitSale(d, {
      lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 1, price: 200, cost: 100, taxRate: 0 }],
      partyId: null, method: 'cash', discount: 0, received: 10,
    });
    expect(sale.paid).toBe(200);
    expect(sale.due).toBe(0);
  });

  it('posts additional charges and preserves sale description and terms', () => {
    const d = makeDb();
    const sale = logic.commitSale(d, {
      lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 1, price: 200, cost: 100, taxRate: 0 }],
      partyId: null, method: 'cash', discount: 20, additionalCharges: 30,
      description: 'Deliver to front desk', terms: 'Due on delivery',
    });
    expect(sale.total).toBe(210);
    expect(sale.paid).toBe(210);
    expect(sale.additionalCharges).toBe(30);
    expect(sale.note).toBe('Deliver to front desk');
    expect(sale.terms).toBe('Due on delivery');
    d.journal.forEach((e) => expect(e.balanced).toBe(true));
  });

  it('reduces the selected batch and records it on the movement', () => {
    const d = makeDb();
    const product = d.products.find((p) => p.id === 'p_a')!;
    product.trackBatches = true;
    product.batches = [{ no: 'LOT-1', expiry: '2027-01-01', qty: 12 }];
    const sale = logic.commitSale(d, {
      lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 3, price: 200, cost: 100, taxRate: 18, batchNo: 'LOT-1' }],
      partyId: null, method: 'cash', discount: 0,
    });
    expect(product.stock.w1).toBe(47);
    expect(product.batches![0].qty).toBe(9);
    expect(d.movements.find((m) => m.ref === sale.no)!.batchNo).toBe('LOT-1');
    logic.voidSale(d, sale.id);
    expect(product.batches![0].qty).toBe(12);
  });

  it('rejects incomplete split payments and credit sales without a customer', () => {
    const d = makeDb();
    expect(() => logic.commitSale(d, {
      lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 1, price: 200, cost: 100, taxRate: 18 }],
      partyId: null, method: 'cash', discount: 0, methods: [{ method: 'cash', amount: 100 }, { method: 'bank', amount: 0 }],
    })).toThrow('Split payments must equal the sale total');
    expect(() => logic.commitSale(d, {
      lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 1, price: 200, cost: 100, taxRate: 18 }],
      partyId: null, method: 'credit', discount: 0,
    })).toThrow('A customer is required for credit sales');
  });

  it('blocks a sale when negative stock is disabled and the stock is insufficient', () => {
    const d = makeDb();
    d.settings.blockNegativeStock = true;
    d.settings.allowNegativeStock = false;
    const prod = d.products.find((p) => p.id === 'p_a')!;
    prod.stock.w1 = 1;
    expect(() => logic.commitSale(d, {
      lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 2, price: 200, cost: 100, taxRate: 18 }],
      partyId: null, method: 'cash', discount: 0,
    })).toThrow('Not enough Widget A');
  });

  it('requires the sales.create permission to log a sale', () => {
    const d = makeDb();
    d.session.role = 'cashier';
    d.roles = builtinRoles();
    const cashier = d.roles.find((r) => r.id === 'cashier')!;
    cashier.perms['sales.create'] = false;

    expect(() => logic.commitSale(d, {
      lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 1, price: 200, cost: 100, taxRate: 18 }],
      partyId: null, method: 'cash', discount: 0,
    })).toThrow('Permission denied: sales.create');
  });

  it('requires sales.edit and sales.delete permissions for document edits and reversals', () => {
    const d = makeDb();
    const sale = logic.commitSale(d, {
      lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 1, price: 200, cost: 100, taxRate: 18 }],
      partyId: null, method: 'cash', discount: 0,
    });

    d.session.role = 'cashier';
    d.roles = builtinRoles();
    const cashier = d.roles.find((r) => r.id === 'cashier')!;
    cashier.perms['sales.edit'] = false;
    cashier.perms['sales.delete'] = false;

    expect(() => logic.editSale(d, sale.id, {
      lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 2, price: 200, cost: 100, taxRate: 18 }],
      partyId: null, discount: 0,
    })).toThrow('Permission denied: sales.edit');

    expect(() => logic.deleteSale(d, sale.id)).toThrow('Permission denied: sales.delete');
  });

  it('requires finance.edit permission for payment edits and deletes', () => {
    const d = makeDb();
    d.session.role = 'owner';
    logic.recordPayment(d, { partyId: 'pty_1', amount: 100, direction: 'in', accountId: 'acc_cash' });
    const pay = d.payments[0];

    d.session.role = 'cashier';
    d.roles = builtinRoles();
    const cashier = d.roles.find((r) => r.id === 'cashier')!;
    cashier.perms['finance.edit'] = false;

    expect(() => logic.editPayment(d, pay.id, { amount: 150 })).toThrow('Permission denied: finance.edit');
    expect(() => logic.deletePayment(d, pay.id)).toThrow('Permission denied: finance.delete');
  });
});

describe('voidSale', () => {
  it('restores stock and reverses the journal entries of a completed sale', () => {
    const d = makeDb();
    const sale = logic.commitSale(d, { lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 5, price: 200, cost: 100, taxRate: 18 }], partyId: null, method: 'cash', discount: 0 });
    logic.voidSale(d, sale.id, 'customer changed mind');
    expect(d.products.find((p) => p.id === 'p_a')!.stock.w1).toBe(50); // back to original
    expect(d.sales.find((s) => s.id === sale.id)!.status).toBe('void');
    expect(journalNet(d, 'acc_cash')).toBe(0); // paid in, then reversed out
    expect(journalNet(d, 'n_inventory')).toBe(0);
  });

  it('reverses accounts receivable for a voided credit sale', () => {
    const d = makeDb();
    const sale = logic.commitSale(d, { lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 2, price: 200, cost: 100, taxRate: 18 }], partyId: 'pty_1', method: 'credit', discount: 0 });
    logic.voidSale(d, sale.id);
    expect(logic.partyBalance(d, 'pty_1')).toBe(0);
  });
});

describe('recordPayment', () => {
  it('applies an incoming payment against the oldest open sale and reduces the party balance', () => {
    const d = makeDb();
    logic.commitSale(d, { lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 1, price: 200, cost: 100, taxRate: 18 }], partyId: 'pty_1', method: 'credit', discount: 0 });
    expect(logic.partyBalance(d, 'pty_1')).toBe(200);
    logic.recordPayment(d, { partyId: 'pty_1', amount: 150, direction: 'in', accountId: 'acc_cash', note: 'part payment' });
    expect(logic.partyBalance(d, 'pty_1')).toBe(50);
    expect(journalNet(d, 'acc_cash')).toBe(150);
    expect(journalNet(d, 'n_ar')).toBe(50); // 200 - 150 applied
  });

  it('does not overpay past the amount owed on a single sale', () => {
    const d = makeDb();
    logic.commitSale(d, { lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 1, price: 200, cost: 100, taxRate: 18 }], partyId: 'pty_1', method: 'credit', discount: 0 });
    logic.recordPayment(d, { partyId: 'pty_1', amount: 500, direction: 'in', accountId: 'acc_cash' });
    const sale = d.sales[0];
    expect(sale.due).toBe(0);
    expect(sale.paid).toBe(200); // capped at what was actually owed
  });

  it('requires a supplier for purchases and accepts cash-out payments for other cases', () => {
    const d = makeDb();
    const supplier = { id: 'pty_2', name: 'Sup', type: 'supplier' as const, phone: '', openingBalance: 0, creditLimit: 0, points: 0, active: true };
    d.parties.push(supplier);

    expect(() => logic.createPurchase(d, 'pty_1', [{ productId: 'p_a', qty: 1, cost: 100 }], 'cash')).toThrow('A supplier is required for purchases');
    expect(() => logic.recordPayment(d, { partyId: 'pty_1', amount: 100, direction: 'out', accountId: 'acc_cash' })).not.toThrow();
    expect(() => logic.createPurchase(d, supplier.id, [{ productId: 'p_a', qty: 1, cost: 100 }], 'cash')).not.toThrow();
  });
});

describe('postStockTake variance posting', () => {
  it('increases stock and posts income for a positive variance', () => {
    const d = makeDb();
    const st = { id: 'st1', ts: new Date().toISOString(), warehouse: 'w1', status: 'open' as const, lines: [{ productId: 'p_a', name: 'Widget A', expected: 50, counted: 55 }] };
    d.stockTakes.push(st);
    logic.postStockTake(d, 'st1');
    expect(d.products.find((p) => p.id === 'p_a')!.stock.w1).toBe(55);
    expect(st.status).toBe('posted');
    expect(journalNet(d, 'n_inventory')).toBe(500); // 5 extra units * cost 100
    expect(journalNet(d, 'n_income')).toBe(-500); // credited (income accounts carry a credit-normal balance)
  });

  it('decreases stock and posts an expense for a negative (shrinkage) variance', () => {
    const d = makeDb();
    const st = { id: 'st2', ts: new Date().toISOString(), warehouse: 'w1', status: 'open' as const, lines: [{ productId: 'p_a', name: 'Widget A', expected: 50, counted: 46 }] };
    d.stockTakes.push(st);
    logic.postStockTake(d, 'st2');
    expect(d.products.find((p) => p.id === 'p_a')!.stock.w1).toBe(46);
    expect(journalNet(d, 'n_expense')).toBe(400); // 4 missing units * cost 100
  });

  it('is a no-op if already posted', () => {
    const d = makeDb();
    const st = { id: 'st3', ts: new Date().toISOString(), warehouse: 'w1', status: 'posted' as const, lines: [{ productId: 'p_a', name: 'Widget A', expected: 50, counted: 999 }] };
    d.stockTakes.push(st);
    logic.postStockTake(d, 'st3');
    expect(d.products.find((p) => p.id === 'p_a')!.stock.w1).toBe(50); // untouched
  });
});

describe('adjustStock', () => {
  it('sets a manual count and posts the variance to the inventory ledger', () => {
    const d = makeDb();
    logic.adjustStock(d, 'p_a', 'w1', 60, 'manual count');
    expect(d.products.find((p) => p.id === 'p_a')!.stock.w1).toBe(60);
    expect(d.movements.at(-1)?.type).toBe('adjust');
    expect(journalNet(d, 'n_inventory')).toBe(1000);
    expect(journalNet(d, 'n_income')).toBe(-1000);
  });
});

describe('runProduction (BOM assembly)', () => {
  it('consumes component stock and produces finished-good stock', () => {
    const d = makeDb();
    const run = logic.runProduction(d, 'p_kit', 10);
    expect(run).not.toBeNull();
    expect(d.products.find((p) => p.id === 'p_b')!.stock.w1).toBe(80); // 100 - 2*10
    expect(d.products.find((p) => p.id === 'p_kit')!.stock.w1).toBe(10);
    expect(run!.componentCost).toBe(600); // 2*10 units * cost 30
  });

  it('refuses to run when component stock is insufficient', () => {
    const d = makeDb();
    const run = logic.runProduction(d, 'p_kit', 1000); // needs 2000 of component B, only 100 available
    expect(run).toBeNull();
    expect(d.products.find((p) => p.id === 'p_b')!.stock.w1).toBe(100); // untouched
  });

  it('returns null for a product with no bill of materials', () => {
    const d = makeDb();
    expect(logic.runProduction(d, 'p_a', 1)).toBeNull();
  });
});

describe('recurring invoice due calculation', () => {
  it('flags a recurring invoice as due once nextDue has passed', () => {
    const d = makeDb();
    const past = new Date(Date.now() - 1000).toISOString();
    d.recurringInvoices.push({ id: 'r1', partyId: 'pty_1', lines: [], discount: 0, frequency: 'monthly', nextDue: past, lastRun: null, active: true });
    expect(logic.dueRecurring(d).map((r) => r.id)).toContain('r1');
  });

  it('does not flag an invoice whose nextDue is in the future', () => {
    const d = makeDb();
    const future = new Date(Date.now() + 100000).toISOString();
    d.recurringInvoices.push({ id: 'r2', partyId: 'pty_1', lines: [], discount: 0, frequency: 'monthly', nextDue: future, lastRun: null, active: true });
    expect(logic.dueRecurring(d).map((r) => r.id)).not.toContain('r2');
  });

  it('running a due invoice creates a sale and advances nextDue by one period', () => {
    const d = makeDb();
    const start = new Date('2026-01-01T00:00:00.000Z');
    d.recurringInvoices.push({
      id: 'r3', partyId: 'pty_1',
      lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 1, price: 200, cost: 100, taxRate: 18 }],
      discount: 0, frequency: 'monthly', nextDue: start.toISOString(), lastRun: null, active: true,
    });
    const sale = logic.runRecurring(d, 'r3', start);
    expect(sale).not.toBeNull();
    expect(d.sales.length).toBe(1);
    const updated = d.recurringInvoices[0];
    expect(new Date(updated.nextDue).getUTCMonth()).toBe(1); // advanced from Jan to Feb
    expect(updated.lastRun).not.toBeNull();
  });
});

describe('offline queue flush', () => {
  it('queues sales made while offline and marks them synced on flush', () => {
    const d = makeDb();
    d.session.online = false;
    const sale = logic.commitSale(d, { lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 1, price: 200, cost: 100, taxRate: 18 }], partyId: null, method: 'cash', discount: 0 });
    expect(sale.synced).toBe(false);
    expect(d.queue.length).toBe(1);
    const flushed = logic.flushQueue(d);
    expect(flushed).toBe(1);
    expect(d.queue.length).toBe(0);
    expect(d.sales.find((s) => s.id === sale.id)!.synced).toBe(true);
  });

  it('does nothing when the queue is already empty', () => {
    const d = makeDb();
    expect(logic.flushQueue(d)).toBe(0);
  });
});

describe('journal rounding', () => {
  function book(): any {
    return { journal: [], session: { userId: 'u1' }, users: [] };
  }

  it('rounds every posted figure to the smallest coin', () => {
    const d = book();
    logic.journal(d, new Date('2026-01-01'), 'VAT split', 'T1', [
      { acc: 'acc_cash', dr: 100.005 },
      { acc: 'n_sales', cr: 84.7457627118644 },
      { acc: 'n_vat', cr: 15.2542372881356 },
    ]);
    const e = d.journal[0];
    e.lines.forEach((l: any) => {
      const v = l.dr ?? l.cr;
      expect(v).toBe(Math.round(v * 100) / 100);
    });
  });

  it('ties the entry out exactly rather than tolerating a crumb', () => {
    const d = book();
    // a third split three ways will not add back to the whole in floats
    logic.journal(d, new Date('2026-01-01'), 'Thirds', 'T2', [
      { acc: 'acc_cash', dr: 100 },
      { acc: 'a', cr: 100 / 3 },
      { acc: 'b', cr: 100 / 3 },
      { acc: 'c', cr: 100 / 3 },
    ]);
    const e = d.journal[0];
    const dr = e.lines.reduce((s: number, l: any) => s + (l.dr || 0), 0);
    const cr = e.lines.reduce((s: number, l: any) => s + (l.cr || 0), 0);
    expect(Math.round((dr - cr) * 100) / 100).toBe(0);
    expect(e.balanced).toBe(true);
  });

  it('takes the crumb off the largest line of the heavier side', () => {
    const d = book();
    // debits come to 10.01 against credits of 10.00
    logic.journal(d, new Date('2026-01-01'), 'Crumb', 'T3', [
      { acc: 'acc_cash', dr: 10.01 },
      { acc: 'small', cr: 0.01 },
      { acc: 'big', cr: 9.99 },
    ]);
    const e = d.journal[0];
    // the debit side was heavier, so its biggest line gives the penny back
    expect(e.lines.find((l: any) => l.acc === 'acc_cash').dr).toBe(10);
    expect(e.lines.find((l: any) => l.acc === 'small').cr).toBe(0.01);
    expect(e.lines.find((l: any) => l.acc === 'big').cr).toBe(9.99);
    expect(e.balanced).toBe(true);
  });

  it('still flags a real mistake instead of rounding it away', () => {
    const d = book();
    logic.journal(d, new Date('2026-01-01'), 'Wrong', 'T4', [
      { acc: 'acc_cash', dr: 100 },
      { acc: 'n_sales', cr: 90 },
    ]);
    expect(d.journal[0].balanced).toBe(false);
    expect(d.journal[0].lines.find((l: any) => l.acc === 'n_sales').cr).toBe(90);
  });
});

describe('cents', () => {
  it('rounds to two places without the float drift', () => {
    expect(logic.cents(1.005)).toBe(1.01);
    expect(logic.cents(0.1 + 0.2)).toBe(0.3);
    expect(logic.cents(100 / 3)).toBe(33.33);
  });
});

describe('a credit sale with a part-payment', () => {
  const line = { productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 2, price: 200, cost: 100, taxRate: 0 };

  it('stays a credit sale when the part is paid by mobile money', () => {
    const d = makeDb();
    const s = logic.commitSale(d, { lines: [line], partyId: 'c1', method: 'credit', discount: 0, received: 150, receivedVia: 'momo' });
    expect(s.method).toBe('credit');
    expect(s.due).toBe(250);
    expect(s.receivedVia).toBe('momo');
  });

  it('puts the part-payment in the account it was paid into, not the drawer', () => {
    const d = makeDb();
    logic.commitSale(d, { lines: [line], partyId: 'c1', method: 'credit', discount: 0, received: 150, receivedVia: 'momo' });
    const last = d.journal.find((e: any) => e.memo.startsWith('Sale '))!;
    expect(last.lines.find((l: any) => l.acc === 'acc_momo')?.dr).toBe(150);
    expect(last.lines.find((l: any) => l.acc === 'acc_cash')).toBeUndefined();
    expect(last.balanced).toBe(true);
  });

  it('still treats an unspecified part-payment as cash, as before', () => {
    const d = makeDb();
    logic.commitSale(d, { lines: [line], partyId: 'c1', method: 'credit', discount: 0, received: 100 });
    const last = d.journal.find((e: any) => e.memo.startsWith('Sale '))!;
    expect(last.lines.find((l: any) => l.acc === 'acc_cash')?.dr).toBe(100);
  });
});

describe('selling in a second unit', () => {
  it('moves only the fraction of a main unit that a piece is', () => {
    const d = makeDb();
    const before = d.products.find((p: any) => p.id === 'p_a')!.stock.w1;
    // four pieces of an item sold in 24-piece cartons
    logic.commitSale(d, {
      lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 4, price: 20, cost: 10, taxRate: 0, unitFactor: 1 / 24 }],
      partyId: null, method: 'cash', discount: 0,
    });
    const after = d.products.find((p: any) => p.id === 'p_a')!.stock.w1;
    expect(before - after).toBeCloseTo(4 / 24, 6);
  });

  it('judges stock in the main unit, so pieces can be sold from one carton', () => {
    const d = makeDb();
    d.settings.blockNegativeStock = true;
    d.settings.allowNegativeStock = false;
    d.products.find((p: any) => p.id === 'p_a')!.stock.w1 = 1;
    expect(() => logic.commitSale(d, {
      lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 20, price: 20, cost: 10, taxRate: 0, unitFactor: 1 / 24 }],
      partyId: null, method: 'cash', discount: 0,
    })).not.toThrow();
  });

  it('gives the stock back in the same measure when the sale is voided', () => {
    const d = makeDb();
    const before = d.products.find((p: any) => p.id === 'p_a')!.stock.w1;
    const s = logic.commitSale(d, {
      lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 6, price: 20, cost: 10, taxRate: 0, unitFactor: 1 / 24 }],
      partyId: null, method: 'cash', discount: 0,
    });
    logic.voidSale(d, s.id, 'test');
    expect(d.products.find((p: any) => p.id === 'p_a')!.stock.w1).toBeCloseTo(before, 6);
  });
});

describe('prices with or without tax', () => {
  const lines = [{ productId: 'p', name: 'X', sku: 'X', unit: 'PC', qty: 1, price: 118, cost: 50, taxRate: 18 }];

  it('takes the tax out of the price when prices include it, as it always has', () => {
    const t = logic.saleTotals(lines as any, 0, true);
    expect(t.total).toBe(118);
    expect(Math.round(t.tax)).toBe(18);
    expect(Math.round(t.net)).toBe(100);
  });

  it('adds the tax on top when they do not', () => {
    const t = logic.saleTotals([{ ...lines[0], price: 100 }] as any, 0, false);
    expect(t.net).toBe(100);
    expect(t.tax).toBe(18);
    expect(t.total).toBe(118);
  });

  it('treats a book without the setting as tax-included, so old books keep their totals', () => {
    expect(logic.pricesIncludeTax({ settings: {} } as any)).toBe(true);
    expect(logic.pricesIncludeTax({ settings: { pricesIncludeTax: false } } as any)).toBe(false);
  });

  it('posts a tax-exclusive sale in balance', () => {
    const d = makeDb();
    d.settings.pricesIncludeTax = false;
    d.settings.taxEnabled = true;
    const s = logic.commitSale(d, {
      lines: [{ productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty: 1, price: 100, cost: 50, taxRate: 18 }],
      partyId: null, method: 'cash', discount: 0,
    });
    expect(s.total).toBe(118);
    expect(d.journal.every((e: any) => e.balanced)).toBe(true);
  });
});
