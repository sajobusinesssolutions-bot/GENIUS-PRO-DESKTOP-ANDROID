import { DB, Product, Sale } from '../types';
import * as logic from '../logic';
import {
  defaultPrinterSettings, defaultPrinters, defaultPrintServer, defaultTemplates,
  defaultTemplateFor, defaultSubscription, defaultLicence, defaultSync, defaultUpdate,
  defaultSettings, defaultNumbering, defaultUnits, defaultCategories,
} from '../defaults';
import { builtinRoles } from '../perms';
import { startOfDay, endOfDay, daysAgo } from '../helpers';
import {
  REPORTS, REPORT_CATEGORIES, runReport, reportById, isImplemented,
  salesBetween, sumCol, cellText, cellNum, sortRows, Cell, stockMovementDrill,
  inventoryMetricDrill,
} from '../reports';

/* ------------------------------------------------------------------ */
/* Fixture                                                             */
/* ------------------------------------------------------------------ */

function makeDb(): DB {
  const wh = { id: 'w1', name: 'Main' };
  const prodA: Product = { id: 'p_a', sku: 'A', name: 'Widget A', unit: 'PC', category: 'Hardware', cost: 100, price: 200, taxRate: 0, stock: { w1: 500 }, reorder: 5, warrantyMonths: 0, bom: null, active: true };
  const prodB: Product = { id: 'p_b', sku: 'B', name: 'Gadget B', unit: 'PC', category: 'Tools', cost: 30, price: 60, taxRate: 0, stock: { w1: 500 }, reorder: 5, warrantyMonths: 0, bom: null, active: true };
  const firm = { id: 'frm_1', name: 'Test Co', tin: '', address: '', phone: '' };
  const owner = { id: 'u1', name: 'Owner', role: 'owner' as const, pin: '1111', active: true };
  const clerk = { id: 'u2', name: 'Clerk', role: 'cashier' as const, pin: '2222', active: true };
  const customer = { id: 'pty_1', name: 'Acme Ltd', type: 'customer' as const, phone: '', openingBalance: 0, creditLimit: 9e9, points: 0, active: true };
  return {
    v: 1,
    firm, firms: [firm], activeFirmId: firm.id,
    settings: { ...defaultSettings(), requireShift: false, efris: false },
    roles: builtinRoles(),
    numbering: defaultNumbering(),
    units: defaultUnits(),
    categories: defaultCategories(),
    loyaltyRules: { enabled: false, earnPer: 1000, pointValue: 5, redeemMin: 200 },
    warehouses: [wh],
    products: [prodA, prodB],
    parties: [customer],
    users: [owner, clerk],
    accounts: [{ id: 'acc_cash', name: 'Cash', type: 'cash', opening: 0 }],
    sales: [], purchases: [], payments: [], entries: [], journal: [], movements: [],
    shifts: [], warranties: [], claims: [],
    estimates: [], challans: [], creditNotes: [], offers: [], stockTakes: [],
    purchaseOrders: [], productionRuns: [], recurringInvoices: [], auditLog: [], businessAccess: [], queue: [],
    plans: [],
    session: { userId: owner.id, role: 'owner', online: true, till: 'Till 1', warehouse: 'w1' },
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

/** A day-old date at a fixed hour, so "today" vs "older" is unambiguous. */
function at(daysBack: number, hour = 10): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function lineA(qty: number) {
  return { productId: 'p_a', name: 'Widget A', sku: 'A', unit: 'PC', qty, price: 200, cost: 100, taxRate: 0 };
}
function lineB(qty: number) {
  return { productId: 'p_b', name: 'Gadget B', sku: 'B', unit: 'PC', qty, price: 60, cost: 30, taxRate: 0 };
}

/**
 * Three bills:
 *  - today, owner, walk-in, cash, 2 × Widget A = 400
 *  - today, clerk, Acme, credit, 5 × Gadget B = 300 (all outstanding)
 *  - 10 days ago, owner, walk-in, cash, 1 × Widget A = 200
 */
function seeded(): { db: DB; today: Sale[]; old: Sale } {
  const db = makeDb();
  // an open shift, so the Z report has something to close
  logic.openShiftFor(db, 50000, 'Till 1', at(0, 8));
  const s1 = logic.commitSale(db, { lines: [lineA(2)], partyId: null, method: 'cash', discount: 0 }, at(0, 9));
  db.session.userId = 'u2';
  const s2 = logic.commitSale(db, { lines: [lineB(5)], partyId: 'pty_1', method: 'credit', discount: 0 }, at(0, 14));
  db.session.userId = 'u1';
  const s3 = logic.commitSale(db, { lines: [lineA(1)], partyId: null, method: 'cash', discount: 0 }, at(10, 9));
  return { db, today: [s1, s2], old: s3 };
}

/**
 * `seeded()` plus the records the other categories need: a supplier with one
 * unpaid credit purchase 45 days old, a cash expense, and a tracked batch.
 */
function seededFull(): { db: DB; purchaseId: string } {
  const { db } = seeded();
  db.parties.push({
    id: 'pty_s', name: 'Bolt Supplies', type: 'supplier', phone: '',
    openingBalance: 0, creditLimit: 9e9, points: 0, active: true,
  });
  const p = logic.createPurchase(db, 'pty_s', [{ productId: 'p_a', qty: 10, cost: 100 }], 'credit', at(45));
  db.entries.push({
    id: 'ent_1', ts: at(1).toISOString(), direction: 'out', accountId: 'acc_cash',
    category: 'Transport', amount: 45000, note: 'Delivery fuel',
  });
  db.products[0].trackBatches = true;
  db.products[0].batches = [{ no: 'B-1', expiry: at(-10).toISOString(), qty: 20 }];
  return { db, purchaseId: p.id };
}

const TODAY = { from: startOfDay(), to: endOfDay() };
const ALL = { from: 0, to: endOfDay() };

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

describe('batch reports', () => {
  it('registers inventory metric reports at module load', () => {
    expect(isImplemented('days-out-of-stock')).toBe(true);
    expect(isImplemented('amc')).toBe(true);
    expect(isImplemented('aamc')).toBe(true);
    expect(isImplemented('aawc')).toBe(true);
  });

  it('builds batch movement without throwing, even with no tracked item', () => {
    const db = makeDb();
    const r = runReport(db, 'batch-movement', ALL.from, ALL.to);
    expect(r.error).toBeFalsy();
    expect(r.cols.map((c) => c.h)).toContain('Balance');
  });

  it('keeps the mandatory transaction fields in daily sales and adds cash/credit detail', () => {
    const { db } = seeded();
    const r = runReport(db, 'daily-sales', startOfDay(daysAgo(30)), endOfDay());
    expect(r.cols.map((c) => c.h).slice(0, 3)).toEqual(['Date', 'Vch Type', 'Vch No']);
    expect(r.cols.map((c) => c.h)).toContain('Cash');
    expect(r.cols.map((c) => c.h)).toContain('Credit');
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.some((row) => String(row[2]).includes('INV') || String(row[2]).length > 0)).toBe(true);
  });

  it('builds a daybook report with debit and credit columns for each transaction', () => {
    const { db } = seeded();
    const r = runReport(db, 'daybook', startOfDay(daysAgo(30)), endOfDay());
    expect(r.cols.map((c) => c.h).slice(0, 3)).toEqual(['Date', 'Vch Type', 'Vch No']);
    expect(r.cols.map((c) => c.h)).toContain('Debit');
    expect(r.cols.map((c) => c.h)).toContain('Credit');
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it('keeps the mandatory transaction columns on invoice lists too', () => {
    const { db } = seeded();
    const r = runReport(db, 'invoice-list', startOfDay(daysAgo(30)), endOfDay());
    expect(r.cols.map((c) => c.h).slice(0, 3)).toEqual(['Date', 'Vch Type', 'Vch No']);
    expect(r.cols.map((c) => c.h)).toContain('Customer');
  });

  it('shows all items first, with item drill-down to monthly movement', () => {
    const { db } = seeded();
    const r = runReport(db, 'stock-movement', startOfDay(daysAgo(30)), endOfDay());
    expect(r.cols.map((c) => c.h)).toEqual(['Item', 'Stock In', 'Stock Out', 'Closing']);
    expect(r.rows.some((row) => cellText(row[0]) === 'Widget A')).toBe(true);
    expect(r.rows.some((row) => cellText(row[0]) === 'Gadget B')).toBe(true);
    expect(r.rowRefs?.some((ref) => ref && ref.kind === 'product')).toBe(true);
  });

  it('builds an item drill-down that groups movement by month and exposes month rows', () => {
    const { db } = seeded();
    const p = db.products[0];
    const r = stockMovementDrill(db, p.id, startOfDay(daysAgo(30)), endOfDay());
    expect(r.cols.map((c) => c.h)).toEqual(['Month', 'Stock In', 'Stock Out', 'Closing']);
    expect(r.rows.some((row) => typeof row[0] === 'string' && String(row[0]).length > 0)).toBe(true);
    expect(r.rowRefs?.some((ref) => ref && ref.kind === 'month')).toBe(true);
  });

  it('tracks stockout days from zero balance to replenishment and drills metric reports', () => {
    const db = makeDb();
    const p = db.products[0];
    p.stock.w1 = 5;
    const when = (daysBack: number) => at(daysBack).toISOString();
    db.movements.push(
      { id: 'm1', ts: when(29), productId: p.id, wh: 'w1', qty: 10, type: 'purchase', ref: 'PUR-1' },
      { id: 'm2', ts: when(20), productId: p.id, wh: 'w1', qty: -15, type: 'sale', ref: 'INV-1' },
      { id: 'm3', ts: when(10), productId: p.id, wh: 'w1', qty: 5, type: 'purchase', ref: 'PUR-2' },
    );
    const from = startOfDay(daysAgo(30));
    const to = endOfDay();
    const days = runReport(db, 'days-out-of-stock', from, to);
    expect(days.rows[0][0]).toBe('Widget A');
    expect(days.cols.map((c) => c.h)).toEqual(['Item', 'Days out', 'Consumed', 'Closing']);
    expect(Number(cellText(days.rows[0][1]))).toBeGreaterThan(0);

    const availableDb = makeDb();
    availableDb.products[0].stock.w1 = 3;
    availableDb.movements.push(
      { id: 'in', ts: when(10), productId: 'p_a', wh: 'w1', qty: 10, type: 'purchase', ref: 'PUR-IN' },
      { id: 'out', ts: when(5), productId: 'p_a', wh: 'w1', qty: -7, type: 'sale', ref: 'INV-OUT' },
    );
    const available = runReport(availableDb, 'days-out-of-stock', from, to);
    expect(Number(cellText(available.rows[0][1]))).toBe(0);

    const months = inventoryMetricDrill(db, 'aamc', p.id, from, to);
    expect(months.cols.map((c) => c.h)).toEqual(['Month', 'Inward', 'Outward', 'Closing', 'Days out', 'AAMC']);
    expect(months.rowRefs?.some((ref) => ref?.kind === 'month')).toBe(true);
    const month = months.rowRefs?.find((ref) => ref?.kind === 'month')?.id;
    expect(month).toBeTruthy();
    const aawcMonths = inventoryMetricDrill(db, 'aawc', p.id, startOfDay(daysAgo(89)), to);
    const aawcMonth = aawcMonths.rowRefs?.find((ref) => ref?.kind === 'month')?.id;
    expect(aawcMonth).toBeTruthy();
    const daily = inventoryMetricDrill(db, 'aawc', p.id, startOfDay(daysAgo(89)), to, aawcMonth!);
    expect(daily.cols.map((c) => c.h)).toEqual(['Date', 'Inward', 'Outward', 'Closing', 'Days out', 'AAWC']);
    expect(daily.rows.length).toBeGreaterThan(0);
  });

  it('calculates AAMC from consumption in a rolling 90-day sample using 30.5 days per month', () => {
    const db = makeDb();
    db.products[0].stock.w1 = 6;
    db.movements.push({ id: 'aamc-sale', ts: at(60).toISOString(), productId: 'p_a', wh: 'w1', qty: -4, type: 'sale', ref: 'INV-AAMC' });
    const report = runReport(db, 'aamc', startOfDay(daysAgo(29)), endOfDay());
    const value = Number(cellText(report.rows[0][1]));
    expect(value).toBeCloseTo((4 * 30.5) / (90 - 0), 6);
  });

  it('calculates AAWC from consumption in a rolling 8-week sample', () => {
    const db = makeDb();
    db.products[0].stock.w1 = 6;
    db.movements.push({ id: 'aawc-sale', ts: at(30).toISOString(), productId: 'p_a', wh: 'w1', qty: -8, type: 'sale', ref: 'INV-AAWC' });
    const report = runReport(db, 'aawc', startOfDay(daysAgo(6)), endOfDay());
    const value = Number(cellText(report.rows[0][1]));
    expect(value).toBeCloseTo((8 * 7) / (56 - 0), 6);
  });

  it('builds batch balances without throwing', () => {
    const db = makeDb();
    const r = runReport(db, 'batch-balances', ALL.from, ALL.to);
    expect(r.error).toBeFalsy();
    expect(r.cols.map((c) => c.h)).toContain('Left');
  });

  it('reports both as implemented', () => {
    expect(isImplemented('batch-movement')).toBe(true);
    expect(isImplemented('batch-balances')).toBe(true);
  });
});

describe('REPORTS catalogue', () => {
  it('holds the report catalogue and unique ids', () => {
    expect(REPORTS.length).toBeGreaterThan(70);
    expect(new Set(REPORTS.map((r) => r.id)).size).toBe(REPORTS.length);
  });

  it('includes the ledger, voucher and chart-of-accounts summary reports', () => {
    expect(reportById('ledger-summary')).toBeTruthy();
    expect(reportById('voucher-summary')).toBeTruthy();
    expect(reportById('chart-of-accounts')).toBeTruthy();

    const db = makeDb();
    db.journal.push({ id: 'j1', ts: at(1).toISOString(), memo: 'Sale cash', ref: 'JV-1', balanced: true, lines: [{ acc: 'acc_cash', dr: 1000 }, { acc: 'n_sales', cr: 1000 }] });
    const ledger = runReport(db, 'ledger-summary', startOfDay(daysAgo(30)), endOfDay());
    const voucher = runReport(db, 'voucher-summary', startOfDay(daysAgo(30)), endOfDay());
    const coa = runReport(db, 'chart-of-accounts', startOfDay(daysAgo(30)), endOfDay());

    expect(ledger.error).toBeFalsy();
    expect(voucher.error).toBeFalsy();
    expect(coa.error).toBeFalsy();
    expect(ledger.cols.map((c) => c.h).slice(0, 3)).toEqual(['Ledger', 'Debit', 'Credit']);
    expect(voucher.cols.map((c) => c.h)).toEqual(['Vch Type', 'Vouchers', 'Debit', 'Credit']);
    expect(voucher.rows.map((r) => r[0])).toEqual(['Journal']); // a hand-made entry, not a sale
    expect(coa.rows.some((r) => String(r[1]).includes('Cash'))).toBe(true);
  });

  it('groups the accounting reports in asset, liability and equity order', () => {
    const db = makeDb();
    db.coa = [
      { id: 'n_equity', code: '3000', name: 'Owner equity', type: 'equity', builtin: true, active: true },
      { id: 'n_ap', code: '2100', name: 'Accounts payable', type: 'liability', builtin: true, active: true },
      { id: 'acc_cash', code: '1001', name: 'Cash', type: 'asset', builtin: true, active: true },
    ];
    db.journal.push({ id: 'j1', ts: at(1).toISOString(), memo: 'Cash sale', ref: 'JV-1', balanced: true, lines: [{ acc: 'acc_cash', dr: 1000 }, { acc: 'n_equity', cr: 1000 }] });

    const ledger = runReport(db, 'ledger-summary', 0, endOfDay());
    const coa = runReport(db, 'chart-of-accounts', 0, endOfDay());
    const tb = runReport(db, 'trial-balance', 0, endOfDay());
    const gl = runReport(db, 'general-ledger', 0, endOfDay());
    const bs = runReport(db, 'balance-sheet', 0, endOfDay());

    expect(ledger.rows[0][0]).toBe('Cash');
    expect(coa.rows.find((r) => r[1] === 'Cash')?.[0]).toBe('1001');
    expect(tb.rows.find((r) => r[0] === 'Cash')?.[0]).toBe('Cash');
    expect(gl.rows[0][0]).toBe('Cash');
    expect(coa.rows.some((r) => r[1] === 'Total Assets')).toBe(true);
    expect(tb.rows.some((r) => r[0] === 'Total Assets')).toBe(true);
    expect(bs.rows.some((r) => r[1] === 'Total assets')).toBe(true);
    expect(bs.rows.some((r) => r[0] === 'Liabilities' && r[1] === 'Total liabilities')).toBe(true);
  });

  it('carries no EFRIS report — this build excludes fiscalisation', () => {
    expect(REPORTS.some((r) => r.id === 'efris-log')).toBe(false);
    expect(REPORTS.some((r) => /efris/i.test(r.name))).toBe(false);
  });

  it('only uses declared categories, and every category has at least one report', () => {
    REPORTS.forEach((r) => expect(REPORT_CATEGORIES).toContain(r.cat));
    REPORT_CATEGORIES.forEach((c) => expect(REPORTS.some((r) => r.cat === c)).toBe(true));
  });

  it('has every report in the catalogue implemented', () => {
    REPORTS.forEach((r) => {
      expect([r.id, isImplemented(r.id)]).toEqual([r.id, true]);
    });
    expect(['days-out-of-stock', 'amc', 'aamc', 'aawc'].every(isImplemented)).toBe(true);
  });

  it('builds every report without throwing, on a full fixture and on an empty one', () => {
    const { db } = seededFull();
    const bare = makeDb();
    REPORTS.forEach((def) => {
      [db, bare].forEach((d) => {
        const r = runReport(d, def.id, ALL.from, ALL.to);
        expect([def.id, r.error]).toEqual([def.id, undefined]);
        expect([def.id, r.notImplemented]).toEqual([def.id, undefined]);
        expect([def.id, r.title]).toEqual([def.id, expect.any(String)]);
      });
    });
  });

  it('returns a marked result rather than throwing for an unknown id', () => {
    const { db } = seeded();
    const bogus = runReport(db, 'no-such-report', ALL.from, ALL.to);
    expect(bogus.notImplemented).toBe(true);
    expect(bogus.title).toBe('Report');
  });
});

/* ------------------------------------------------------------------ */
/* Date-range filtering                                                */
/* ------------------------------------------------------------------ */

describe('date-range filtering', () => {
  it('salesBetween keeps only bills inside the window', () => {
    const { db } = seeded();
    expect(salesBetween(db, ALL.from, ALL.to)).toHaveLength(3);
    expect(salesBetween(db, TODAY.from, TODAY.to)).toHaveLength(2);
    expect(salesBetween(db, startOfDay(daysAgo(6)), endOfDay())).toHaveLength(2);
    expect(salesBetween(db, startOfDay(daysAgo(29)), endOfDay())).toHaveLength(3);
  });

  it('excludes void bills from every range', () => {
    const { db, old } = seeded();
    logic.voidSale(db, old.id, 'Test void');
    expect(salesBetween(db, ALL.from, ALL.to)).toHaveLength(2);
    // ...but the voided-bills report still finds it
    const voided = runReport(db, 'voided-items', ALL.from, ALL.to);
    expect(voided.rows).toHaveLength(1);
    expect(cellText(voided.rows[0][3])).toBe('Test void');
  });

  it('narrows the rows of a report as the range narrows', () => {
    const { db } = seeded();
    expect(runReport(db, 'invoice-list', ALL.from, ALL.to).rows).toHaveLength(3);
    expect(runReport(db, 'invoice-list', TODAY.from, TODAY.to).rows).toHaveLength(2);
    expect(runReport(db, 'invoice-list', startOfDay(daysAgo(2)), endOfDay(daysAgo(2))).rows).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* Representative Sales computations                                   */
/* ------------------------------------------------------------------ */

describe('sale-summary', () => {
  it('adds up gross, tax, cost and what is still owing', () => {
    const { db } = seeded();
    const r = runReport(db, 'sale-summary', ALL.from, ALL.to);
    const by = (label: string) => cellNum(r.rows.find((row) => cellText(row[0]) === label)![1]);

    expect(by('Gross sales')).toBe(900);       // 400 + 300 + 200
    expect(by('Discounts given')).toBe(0);
    expect(by('VAT included')).toBe(0);        // the fixture sells zero-rated goods
    expect(by('Cost of goods sold')).toBe(450); // 200 + 150 + 100
    expect(by('Average sale')).toBe(300);
    expect(by('Settled at the till')).toBe(600); // the credit bill of 300 is open

    // the pinned totals row carries gross profit
    expect(cellNum(r.foot![1])).toBe(450);     // 900 − 0 tax − 450 cost
    expect(cellText(r.foot![0])).toBe('Gross profit');
  });

  it('follows the range', () => {
    const { db } = seeded();
    const r = runReport(db, 'sale-summary', TODAY.from, TODAY.to);
    expect(cellNum(r.rows.find((row) => cellText(row[0]) === 'Gross sales')![1])).toBe(700);
  });
});

describe('item-sales', () => {
  it('groups lines per product, ranks by revenue and totals the money columns', () => {
    const { db } = seeded();
    const r = runReport(db, 'item-sales', ALL.from, ALL.to);

    expect(r.rows).toHaveLength(2);
    // Widget A: 3 units, 600 revenue, 300 profit — ahead of Gadget B
    expect(cellText(r.rows[0][0])).toBe('Widget A');
    expect(cellNum(r.rows[0][1])).toBe(3);
    expect(cellNum(r.rows[0][2])).toBe(600);
    expect(cellNum(r.rows[0][3])).toBe(300);

    expect(cellText(r.rows[1][0])).toBe('Gadget B');
    expect(cellNum(r.rows[1][1])).toBe(5);
    expect(cellNum(r.rows[1][2])).toBe(300);
    expect(cellNum(r.rows[1][3])).toBe(150);
  });
});

describe('sales-by-user', () => {
  it('splits bills and value per cashier with an average', () => {
    const { db } = seeded();
    const r = runReport(db, 'sales-by-user', ALL.from, ALL.to);
    const row = (name: string) => r.rows.find((x) => cellText(x[0]) === name)!;

    expect(cellNum(row('Owner')[1])).toBe(2);
    expect(cellNum(row('Owner')[2])).toBe(600);
    expect(cellNum(row('Owner')[3])).toBe(300);

    expect(cellNum(row('Clerk')[1])).toBe(1);
    expect(cellNum(row('Clerk')[2])).toBe(300);
  });
});

describe('sales-by-customer', () => {
  it('keeps walk-ins separate and carries the unpaid balance', () => {
    const { db } = seeded();
    const r = runReport(db, 'sales-by-customer', ALL.from, ALL.to);
    const acme = r.rows.find((x) => cellText(x[0]) === 'Acme Ltd')!;
    const walk = r.rows.find((x) => cellText(x[0]) === 'Walk-in')!;

    expect(cellNum(acme[3])).toBe(300); // the whole credit bill is outstanding
    expect(cellText(walk[3])).toBe('—'); // cash bills show a dash, not a zero
    expect(cellNum(walk[2])).toBe(600);
  });
});

/* ------------------------------------------------------------------ */
/* One representative report from each new category                    */
/* ------------------------------------------------------------------ */

describe('Purchase — purchase-summary', () => {
  it('lists the supplier bill, totals it and makes the row tappable', () => {
    const { db, purchaseId } = seededFull();
    const r = runReport(db, 'purchase-summary', ALL.from, ALL.to);
    expect(r.rows).toHaveLength(1);
    expect(cellText(r.rows[0][1])).toBe('Bolt Supplies');
    expect(cellNum(r.rows[0][2])).toBe(1000);   // 10 × 100
    expect(cellNum(r.rows[0][3])).toBe(1000);   // bought on credit
    expect(cellNum(r.foot![2])).toBe(1000);
    expect(r.rowRefs![0]).toEqual({ kind: 'purchase', id: purchaseId });
  });

  it('bill-list is the same computation under its own title', () => {
    const { db } = seededFull();
    const a = runReport(db, 'purchase-summary', ALL.from, ALL.to);
    const b = runReport(db, 'bill-list', ALL.from, ALL.to);
    expect(b.title).toBe('Purchase bill list');
    expect(b.rows).toEqual(a.rows);
  });
});

describe('Money — payment-types and expenses-by-category', () => {
  it('splits the tender and shares add to the whole', () => {
    const { db } = seededFull();
    const r = runReport(db, 'payment-types', ALL.from, ALL.to);
    const row = (t: string) => r.rows.find((x) => cellText(x[0]) === t)!;
    expect(cellNum(row('Cash')[1])).toBe(2);
    expect(cellNum(row('Cash')[2])).toBe(600);
    expect(cellNum(row('On credit')[2])).toBe(300);
    expect(cellNum(r.foot![2])).toBe(900);
  });

  it('ranks expenses by amount', () => {
    const { db } = seededFull();
    const r = runReport(db, 'expenses-by-category', ALL.from, ALL.to);
    expect(cellText(r.rows[0][0])).toBe('Transport');
    expect(cellNum(r.foot![1])).toBe(45000);
  });
});

describe('Receivables — ar-aging-summary and its details', () => {
  it('drops the open credit bill in the 0–30 bucket', () => {
    const { db } = seededFull();
    const r = runReport(db, 'ar-aging-summary', ALL.from, ALL.to);
    const acme = r.rows.find((x) => cellText(x[0]) === 'Acme Ltd')!;
    expect(cellNum(acme[1])).toBe(300);  // 0–30
    expect(cellNum(acme[4])).toBe(0);    // 90+
    expect(cellNum(acme[5])).toBe(300);
    expect(cellNum(r.foot![5])).toBe(300);
  });

  it('receivable-details reuses ar-aging-details and keeps the sale ref', () => {
    const { db } = seededFull();
    const r = runReport(db, 'receivable-details', ALL.from, ALL.to);
    expect(r.title).toBe('Receivable details');
    expect(r.rows).toHaveLength(1);
    expect(cellNum(r.rows[0][5])).toBe(300);
    expect(r.rowRefs![0]!.kind).toBe('sale');
  });
});

describe('Payables — ap-aging-summary', () => {
  it('ages the 45-day-old supplier bill into 31–60', () => {
    const { db } = seededFull();
    const r = runReport(db, 'ap-aging-summary', ALL.from, ALL.to);
    const s = r.rows.find((x) => cellText(x[0]) === 'Bolt Supplies')!;
    expect(cellNum(s[1])).toBe(0);      // 0–30
    expect(cellNum(s[2])).toBe(1000);   // 31–60
    expect(cellNum(s[5])).toBe(1000);
  });

  it('payable-summary buckets the same money', () => {
    const { db } = seededFull();
    const r = runReport(db, 'payable-summary', ALL.from, ALL.to);
    expect(cellNum(r.rows.find((x) => cellText(x[0]) === '31–60')![1])).toBe(1000);
    expect(cellText(r.foot![0])).toBe('Total you owe');
    expect(cellNum(r.foot![1])).toBe(1000);
  });
});

describe('Stock — stock-summary and expiry', () => {
  it('values stock at cost and at sale price', () => {
    const { db } = seededFull();
    const r = runReport(db, 'stock-summary', ALL.from, ALL.to);
    const a = r.rows.find((x) => cellText(x[0]) === 'Widget A')!;
    // 500 seeded − 3 sold + 10 purchased = 507
    expect(cellNum(a[1])).toBe(507);
    expect(cellNum(a[2])).toBe(507 * 100);
    expect(cellNum(a[3])).toBe(507 * 200);
    expect(cellNum(r.foot![2])).toBe(sumCol(r.rows, 2));
  });

  it('lists a tracked batch with its days to expiry and value at cost', () => {
    const { db } = seededFull();
    const r = runReport(db, 'expiry', ALL.from, ALL.to);
    expect(r.rows).toHaveLength(1);
    expect(cellText(r.rows[0][1])).toBe('B-1');
    expect(cellNum(r.rows[0][3])).toBeGreaterThan(0); // expires in the future
    expect(cellNum(r.foot![4])).toBe(2000);           // 20 × 100 at cost
  });
});

describe('Tax & books — pnl and trial-balance', () => {
  it('works down to net profit', () => {
    const { db } = seededFull();
    const r = runReport(db, 'pnl', ALL.from, ALL.to);
    const by = (label: string) => cellNum(r.rows.find((x) => cellText(x[0]) === label)![1]);
    expect(by('Sales (net of VAT)')).toBe(900);
    expect(by('Less cost of goods sold')).toBe(-450);
    expect(by('Gross profit')).toBe(450);
    expect(cellNum(r.foot![1])).toBe(450 - 45000);   // the expense outweighs the margin
    expect(cellText(r.foot![0])).toBe('Net profit');
  });

  it('balances the books', () => {
    const { db } = seededFull();
    const r = runReport(db, 'trial-balance', ALL.from, ALL.to);
    expect(Math.abs(cellNum(r.foot![1]) - cellNum(r.foot![2]))).toBeLessThan(2);
    expect(r.stats![0].k).toBe('Books balance');
  });
});

/* ------------------------------------------------------------------ */
/* Totals row                                                          */
/* ------------------------------------------------------------------ */

describe('the totals row', () => {
  it('every live tabular report in every category supplies one', () => {
    const { db } = seededFull();
    REPORTS.forEach((def) => {
      const r = runReport(db, def.id, ALL.from, ALL.to);
      // A calm empty state (no shift open, no batches tracked) has no table to total.
      if (!r.rows.length && r.note && !r.foot) return;
      expect([def.id, Array.isArray(r.foot)]).toEqual([def.id, true]);
      expect([def.id, r.foot!.length]).toEqual([def.id, r.cols.length]);
    });
  });

  it('a foot cell sums the column above it, in each new category', () => {
    const { db } = seededFull();
    const check = (id: string, col: number) => {
      const r = runReport(db, id, ALL.from, ALL.to);
      expect([id, cellNum(r.foot![col])]).toEqual([id, sumCol(r.rows, col)]);
    };
    check('purchase-summary', 2);
    check('cash-flow', 1);
    check('ar-aging-details', 5);
    check('ap-aging-details', 4);
    check('stock-summary', 2);
    check('general-ledger', 1);
  });

  it('sums the numeric columns of the rows above it', () => {
    const { db } = seeded();
    const r = runReport(db, 'invoice-list', ALL.from, ALL.to);
    expect(r.rows).toHaveLength(3);
    expect(cellNum(r.foot![5])).toBe(sumCol(r.rows, 5));
    expect(cellNum(r.foot![5])).toBe(900);
    expect(cellNum(r.foot![6])).toBe(300); // only the credit bill is due
  });

  it('sumCol reads the number behind a formatted cell', () => {
    const rows: Cell[][] = [['a', { text: '1,250', n: 1250 }], ['b', { text: '750', n: 750 }]];
    expect(sumCol(rows, 1)).toBe(2000);
  });
});

/* ------------------------------------------------------------------ */
/* Sorting                                                             */
/* ------------------------------------------------------------------ */

describe('sortRows', () => {
  it('sorts numeric columns on the number, both ways, and carries rowRefs along', () => {
    const { db } = seeded();
    const r = runReport(db, 'invoice-list', ALL.from, ALL.to);

    const asc = sortRows(r, 5, 'asc');
    expect(asc.rows.map((x) => cellNum(x[5]))).toEqual([200, 300, 400]);

    const desc = sortRows(r, 5, 'desc');
    expect(desc.rows.map((x) => cellNum(x[5]))).toEqual([400, 300, 200]);

    // the ref still points at the bill on that row
    const top = desc.rowRefs![0]!;
    expect(db.sales.find((s) => s.id === top.id)!.total).toBe(400);
  });

  it('sorts text columns alphabetically, and the catalogue still looks itself up by id', () => {
    expect(reportById('pnl')!.cat).toBe('Tax & books');
    const { db } = seeded();
    const r = runReport(db, 'invoice-list', ALL.from, ALL.to);
    const asc = sortRows(r, 3, 'asc');
    expect(cellText(asc.rows[0][3])).toBe('Acme Ltd');
  });
});

describe('voucher summary by type', () => {
  it('names sales, purchases and expenses for what they are, not all as journals', () => {
    const { db } = seededFull();
    const r = runReport(db, 'voucher-summary', ALL.from, ALL.to);
    const types = r.rows.map((x) => cellText(x[0]));
    expect(types.some((t) => t === 'Cash sale' || t === 'Sales invoice')).toBe(true);
    expect(r.rowRefs!.every((ref) => ref?.kind === 'vouchertype')).toBe(true);
  });
});
