/**
 * Phones sold by IMEI: they leave stock when sold, and their IMEIs, second
 * IMEI and condition reach every kind of receipt — the page and the thermal
 * printer alike — unless the receipt template turns them off.
 */
import type { DB, Product } from '../types';
import * as logic from '../logic';
import {
  defaultPrinterSettings, defaultPrinters, defaultPrintServer, defaultTemplates, defaultTemplateFor,
  defaultSubscription, defaultLicence, defaultSync, defaultUpdate, defaultSettings, defaultNumbering,
  defaultUnits, defaultCategories,
} from '../defaults';
import { builtinRoles } from '../perms';
import { escposDoc } from '../escpos';
import { printOptsFor } from '../printSetup';

jest.mock('expo-print', () => ({}));
jest.mock('expo-sharing', () => ({}));
jest.mock('expo-file-system', () => ({ File: class {}, Paths: {} }));
jest.mock('../rawPrinter', () => ({ printBluetooth: jest.fn(), testNetwork: jest.fn() }));
// eslint-disable-next-line import/first
import { docHtml } from '../docPrint';

function makeDb(): DB {
  const phone: Product = {
    id: 'p_ph', sku: 'A15', name: 'Samsung A15', unit: 'PC', category: 'Phones', cost: 400000, price: 520000, taxRate: 0,
    stock: { w1: 3 }, reorder: 1, warrantyMonths: 12, bom: null, active: true,
    trackSerials: true, dualImei: true, askCondition: true,
    serials: ['356789104512345', '356789104512360', '356789104512378'],
    serialInfo: { '356789104512345': { imei2: '356789104512352', condition: 'used' } },
  };
  const firm = { id: 'frm_1', name: 'Phone Hub', tin: '', address: '', phone: '0772' };
  const user = { id: 'u1', name: 'Owner', role: 'owner' as const, pin: '', active: true };
  return {
    v: 1, firm, firms: [firm], activeFirmId: firm.id,
    settings: { ...defaultSettings(), requireShift: false }, roles: builtinRoles(), numbering: defaultNumbering(),
    units: defaultUnits(), categories: defaultCategories(),
    loyaltyRules: { enabled: false, earnPer: 1000, pointValue: 5, redeemMin: 200 },
    warehouses: [{ id: 'w1', name: 'Main' }], products: [phone], parties: [], users: [user],
    accounts: [{ id: 'acc_cash', name: 'Cash', type: 'cash', opening: 0 }],
    sales: [], purchases: [], payments: [], entries: [], journal: [], movements: [], shifts: [], warranties: [], claims: [],
    estimates: [], challans: [], creditNotes: [], offers: [], stockTakes: [], purchaseOrders: [], productionRuns: [],
    recurringInvoices: [], auditLog: [], businessAccess: [], queue: [], plans: [],
    session: { userId: user.id, role: 'owner', online: true, till: 'Till 1', warehouse: 'w1' },
    counters: { sale: 0, purchase: 0, estimate: 0, challan: 0, creditNote: 0, po: 0, plan: 0 },
    onboarded: true, instalmentPlans: [],
    printer: defaultPrinterSettings(), printers: defaultPrinters(defaultPrinterSettings()), printServer: defaultPrintServer(),
    templates: defaultTemplates(), templateFor: defaultTemplateFor(), subscription: defaultSubscription(),
    licence: defaultLicence(), sync: defaultSync(), update: defaultUpdate(), numberSafe: { mode: 'auto' }, revisions: [],
  } as unknown as DB;
}

const sold = { imei: '356789104512345', imei2: '356789104512352', condition: 'used' as const };
const money = (n: number) => 'Sh ' + n.toLocaleString('en-US');
const doc: any = {
  kind: 'Receipt', no: 'INV-0001', ts: '2026-09-29T10:00:00Z', firmName: 'Phone Hub',
  lines: [{ name: 'Samsung A15', qty: 1, price: 520000, unit: 'PC', serials: [sold] }],
  subtotal: 520000, total: 520000, paid: 520000,
};
const text = (b: Uint8Array) => String.fromCharCode(...Array.from(b));

it('a phone that is sold leaves the IMEI stock list', () => {
  const d = makeDb();
  logic.commitSale(d, {
    lines: [{ productId: 'p_ph', name: 'Samsung A15', sku: 'A15', unit: 'PC', qty: 1, price: 520000, cost: 400000, taxRate: 0, serials: [sold] }],
    partyId: null, method: 'cash', discount: 0,
  });
  const p = d.products[0];
  expect(p.serials).toEqual(['356789104512360', '356789104512378']);
  expect(p.serialInfo?.['356789104512345']).toBeUndefined();
  expect(d.sales[0].lines[0].serialNo).toBe('356789104512345');
  expect(d.sales[0].lines[0].serials).toEqual([sold]);
});

it('the IMEIs and condition print on the thermal receipt, and can be turned off', () => {
  const on = text(escposDoc(doc, money, { paper: '80mm', tpl: defaultTemplates()[0] }));
  expect(on).toContain('IMEI 356789104512345 / 356789104512352 - Used');
  const off = text(escposDoc(doc, money, { paper: '80mm', tpl: { ...defaultTemplates()[0], showImei: false } }));
  expect(off).not.toContain('IMEI');
});

it('the IMEIs print on a page receipt and on an A4 invoice', () => {
  expect(docHtml(doc, money, { paper: '80mm', tpl: defaultTemplates()[0] })).toContain('IMEI 356789104512345 / 356789104512352 · Used');
  const a4 = defaultTemplates().find((t) => t.paper === 'A4')!;
  for (const style of ['plain', 'tally', 'quickbooks', 'gst'] as const) {
    expect(docHtml(doc, money, { paper: 'A4', tpl: { ...a4, style } })).toContain('IMEI 356789104512345');
  }
});

it('the title, rate and unit switches change what prints', () => {
  const tpl = { ...defaultTemplates()[0], title: 'Cash sale', showRate: false, showUnit: false };
  const t = text(escposDoc(doc, money, { paper: '80mm', tpl }));
  expect(t).toContain('CASH SALE');
  expect(t).not.toContain('RECEIPT');
  expect(t).not.toContain('x Sh 520,000');
  expect(t).not.toContain('1 PC');
  expect(docHtml(doc, money, { paper: '80mm', tpl })).toContain('Cash sale');
});

it('the compact template puts each item on one line', () => {
  const t = text(escposDoc(doc, money, { paper: '80mm', tpl: { ...defaultTemplates()[0], receiptStyle: 'compact' } }));
  expect(t).toMatch(/1 Samsung A15 +Sh 520,000/);
});

it('"Print receipts as A4" sends a sale receipt to the A4 layout', () => {
  const d = makeDb();
  d.printers = [{ id: 'prn_bt', name: 'MTP-II', kind: 'bluetooth', width: '80mm', address: 'AA:BB', port: 0, dflt: true, online: true, note: '' }];
  expect(printOptsFor(d, 'receipt').paper).toBe('80mm');
  expect(printOptsFor(d, 'receipt').printer?.kind).toBe('bluetooth');
  d.printer.receiptMode = 'a4';
  const o = printOptsFor(d, 'receipt');
  expect(o.paper).toBe('A4');
  expect(o.tpl?.paper).toBe('A4');
  // a thermal printer cannot print a page, so the page goes through the print dialog
  expect(o.printer).toBeUndefined();
});

it('a thermal receipt with only "Save as PDF" stays roll-sized, not A4', () => {
  const d = makeDb(); // its only printer is Save as PDF
  expect(printOptsFor(d, 'receipt').paper).toBe('80mm');
  expect(printOptsFor(d, 'invoice').paper).toBe('A4');
});

it('the receivable statement carries each customer from opening to closing', () => {
  const { runReport } = require('../reports');
  const d = makeDb();
  d.parties = [{ id: 'c1', name: 'Okello', type: 'customer', phone: '', openingBalance: 0, creditLimit: 9e9, points: 0, active: true }] as any;
  logic.commitSale(d, {
    lines: [{ productId: 'p_ph', name: 'Samsung A15', sku: 'A15', unit: 'PC', qty: 1, price: 520000, cost: 400000, taxRate: 0 }],
    partyId: 'c1', method: 'credit', discount: 0,
  });
  const r = runReport(d, 'receivable-statement', 0, Date.now() + 1000);
  const text = JSON.stringify(r.rows);
  expect(text).toContain('Opening balance');
  expect(text).toContain('Closing balance');
  expect(JSON.stringify(r.foot[5])).toContain('520,000');
  // no supplier has anything: the report says so rather than listing empty rows
  expect(runReport(d, 'payable-statement', 0, Date.now() + 1000).rows.length).toBe(0);
});
