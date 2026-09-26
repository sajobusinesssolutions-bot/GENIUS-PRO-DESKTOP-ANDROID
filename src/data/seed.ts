import { DB, Product, Party, User, Account, InstalmentPlan } from './types';
import { uid, iso, daysAgo, hoursAgo, mulberry } from './uid';
import { instalSchedule } from './logic';
import {
  defaultPrinterSettings, defaultPrinters, defaultPrintServer, defaultTemplates,
  defaultTemplateFor, defaultSubscription, defaultLicence, defaultSync, defaultUpdate,
  defaultSettings, defaultNumbering, defaultUnits, defaultCategories,
} from './defaults';
import { builtinRoles } from './perms';
import { ensureCoa } from './coa';
import { hashPin } from './pinHash';

function p(sku: string, name: string, unit: string, cat: string, cost: number, price: number,
  stock: Record<string, number>, reorder: number, warranty = 0, emoji = '📦'): Product {
  return { id: uid('prd'), sku, name, unit, category: cat, cost, price, taxRate: 18, stock, reorder, warrantyMonths: warranty, bom: null, active: true, emoji };
}

function pt(name: string, type: 'customer' | 'supplier', phone: string, ob: number, limit: number): Party {
  return { id: uid('pty'), name, type, phone, openingBalance: ob, creditLimit: limit, points: 0, active: true };
}

export function seed(): DB {
  const warehouses = [{ id: 'w1', name: 'Main shop' }, { id: 'w2', name: 'Store room' }];

  const products = [
    p('CEM-050', 'Cement 50kg Bag', 'BAG', 'Building', 26500, 32000, { w1: 412, w2: 120 }, 40, 0, '🧱'),
    p('IRN-32G', 'Iron Sheets 32G', 'PC', 'Building', 34000, 42500, { w1: 6, w2: 0 }, 20, 0, '🏗️'),
    p('RIC-025', 'Rice 25kg', 'BAG', 'Food', 88000, 105000, { w1: 80, w2: 15 }, 15, 0, '🍚'),
    p('CHR-001', 'Wooden Chair', 'PC', 'Furniture', 7400, 10880, { w1: 0, w2: 0 }, 6, 12, '🪑'),
    p('NAI-4IN', 'Nails 4in (kg)', 'KG', 'Building', 6200, 8000, { w1: 240, w2: 60 }, 50, 0, '🔩'),
    p('PNT-20L', 'Paint White 20L', 'TIN', 'Building', 118000, 152000, { w1: 18, w2: 6 }, 5, 0, '🎨'),
    p('SUG-001', 'Sugar 1kg', 'PC', 'Food', 4300, 5200, { w1: 310, w2: 80 }, 60, 0, '🍬'),
    p('FAN-16S', 'Standing Fan 16in', 'PC', 'Electrical', 132000, 178000, { w1: 9, w2: 4 }, 4, 12, '🌀'),
    p('BLB-LED', 'LED Bulb 9W', 'PC', 'Electrical', 3100, 4800, { w1: 520, w2: 200 }, 80, 6, '💡'),
    p('TIM-2X4', 'Timber 2x4 (ft)', 'FT', 'Building', 1900, 2800, { w1: 1400, w2: 0 }, 300, 0, '🪵'),
    p('SCR-BOX', 'Screws box', 'BOX', 'Building', 9400, 13500, { w1: 44, w2: 10 }, 12, 0, '🔧'),
    p('TBL-001', 'Wooden Table', 'PC', 'Furniture', 48000, 86000, { w1: 5, w2: 2 }, 3, 12, '🛠️'),
  ];
  products[11].bom = [
    { productId: products[9].id, qty: 24 },
    { productId: products[10].id, qty: 1 },
    { productId: products[4].id, qty: 0.5 },
  ];

  const parties = [
    pt('Mukasa Hardware', 'customer', '0772 415 006', 0, 3000000),
    pt('Kato Wholesalers', 'customer', '0701 883 214', 0, 1500000),
    pt('Abdullah Jjuko', 'customer', '0754 379 586', 0, 500000),
    pt('Grace Nakato', 'customer', '0788 220 145', 0, 300000),
    pt('Hridoy Suppliers Ltd', 'supplier', '0392 700 118', 0, 0),
    pt('Kampala Cement Depot', 'supplier', '0414 259 330', 0, 0),
  ];

  const users: User[] = [
    { id: uid('usr'), name: 'Ronald Okello', role: 'owner', pin: hashPin('1234'), active: true },
    { id: uid('usr'), name: 'Grace Namono', role: 'cashier', pin: hashPin('1111'), active: true },
    { id: uid('usr'), name: 'Julius Okello', role: 'cashier', pin: hashPin('2222'), active: true },
    { id: uid('usr'), name: 'Sarah Apio', role: 'manager', pin: hashPin('3333'), active: false },
  ];

  const accounts: Account[] = [
    { id: 'acc_cash', name: 'Cash drawer — Till 1', type: 'cash', opening: 150000 },
    { id: 'acc_bank', name: 'Stanbic — Business a/c', type: 'bank', opening: 5200000 },
    { id: 'acc_momo', name: 'MTN Mobile Money', type: 'wallet', opening: 600000 },
  ];

  const printerSettings = defaultPrinterSettings();

  const firm = { id: uid('frm'), name: 'Sample Traders', tin: '1000483921', address: 'Plot 14, Nakivubo Rd, Kampala', phone: '0701 883 214', businessType: 'Retail & Hardware' };

  const db: DB = {
    v: 1,
    firm,
    firms: [firm],
    activeFirmId: firm.id,
    settings: defaultSettings(),
    roles: builtinRoles(),
    numbering: defaultNumbering(),
    units: defaultUnits(),
    categories: defaultCategories(),
    loyaltyRules: { enabled: true, earnPer: 1000, pointValue: 5, redeemMin: 200 },
    warehouses, products, parties, users, accounts,
    sales: [], purchases: [], payments: [], bankStatementLines: [], bankReconciliations: [], entries: [], journal: [], movements: [],
    shifts: [], warranties: [], claims: [],
    estimates: [], challans: [], creditNotes: [], offers: [], stockTakes: [],
    purchaseOrders: [], productionRuns: [], recurringInvoices: [], auditLog: [], businessAccess: [], queue: [],
    plans: [
      { id: 'pln_basic', name: 'Basic', price: 40000, period: 'month', features: ['1 till', 'Sales & stock', 'Basic reports'] },
      { id: 'pln_pro', name: 'Pro', price: 90000, period: 'month', features: ['Up to 3 tills', 'EFRIS e-invoicing', 'Full reports', 'Multi-branch'], highlight: true },
      { id: 'pln_enterprise', name: 'Enterprise', price: 220000, period: 'month', features: ['Unlimited tills', 'Priority support', 'Custom roles', 'API access'] },
    ],
    session: { userId: users[0].id, role: 'owner', online: true, till: 'Till 1', warehouse: 'w1' },
    counters: { sale: 0, purchase: 0, estimate: 0, challan: 0, creditNote: 0, po: 0, plan: 0 },
    onboarded: true,
    // marked, so signing in can tell a demo from a real shop that predates owners
    demo: true,

    instalmentPlans: [],

    printer: printerSettings,
    printers: defaultPrinters(printerSettings),
    printServer: defaultPrintServer(),
    templates: defaultTemplates(),
    templateFor: defaultTemplateFor(),

    subscription: defaultSubscription(),
    licence: defaultLicence(),
    sync: defaultSync('Till 1'),
    update: defaultUpdate(),
    numberSafe: { mode: 'auto' },
    revisions: [],
  };

  postOpening(db);
  seedHistory(db);
  seedPlans(db);
  return db;
}

function stockOf(p: Product): number {
  return Object.keys(p.stock).reduce((s, k) => s + (p.stock[k] || 0), 0);
}

function journal(db: DB, when: Date, memo: string, ref: string, lines: { acc: string; dr?: number; cr?: number }[]) {
  let dr = 0, cr = 0;
  lines.forEach((l) => { dr += l.dr || 0; cr += l.cr || 0; });
  db.journal.push({ id: uid('jnl'), ts: iso(when), memo, ref, lines, balanced: Math.abs(dr - cr) < 1 });
}

function postOpening(db: DB) {
  db.accounts.forEach((a) => {
    if (a.opening) journal(db, daysAgo(90), 'Opening balance', 'open', [{ acc: a.id, dr: a.opening }, { acc: 'n_equity', cr: a.opening }]);
  });
  const invVal = db.products.reduce((s, p) => s + p.cost * stockOf(p), 0);
  if (invVal) journal(db, daysAgo(90), 'Opening stock', 'open', [{ acc: 'n_inventory', dr: invVal }, { acc: 'n_equity', cr: invVal }]);
}

function move(db: DB, productId: string, wh: string, qty: number, type: string, ref: string, when: Date) {
  const prod = db.products.find((x) => x.id === productId);
  if (!prod) return;
  prod.stock[wh] = (prod.stock[wh] || 0) + qty;
  db.movements.push({ id: uid('mv'), ts: iso(when), productId, wh, qty, type, ref });
}

function saleTotals(lines: { qty: number; price: number; cost?: number; taxRate?: number }[], discount: number) {
  let gross = 0, tax = 0, cost = 0;
  lines.forEach((l) => {
    const line = l.qty * l.price;
    gross += line; cost += l.qty * (l.cost || 0);
    tax += line - line / (1 + (l.taxRate || 0) / 100);
  });
  const disc = Math.min(discount || 0, gross);
  const total = gross - disc;
  const taxAfter = tax * (gross ? total / gross : 0);
  return { gross, discount: disc, total, tax: taxAfter, net: total - taxAfter, cost };
}

function commitSaleSeed(db: DB, o: { lines: any[]; partyId: string | null; method: string; discount: number; userId: string; when: Date }) {
  const t = saleTotals(o.lines, o.discount);
  db.counters.sale += 1;
  const wh = db.session.warehouse || 'w1';
  const paidNow = o.method === 'credit' ? 0 : t.total;
  const sale = {
    id: uid('sal'), no: 'INV-' + String(100000 + db.counters.sale).slice(1), ts: iso(o.when),
    partyId: o.partyId, userId: o.userId, till: db.session.till, warehouse: wh,
    lines: o.lines.map((l) => ({ productId: l.productId, name: l.name, sku: l.sku, unit: l.unit, qty: l.qty, price: l.price, cost: l.cost || 0, taxRate: l.taxRate || 0 })),
    discount: t.discount, redeemed: 0, gross: t.gross, tax: t.tax, total: t.total, cogs: t.cost,
    method: o.method as any, paid: paidNow, paidAtSale: paidNow, due: t.total - paidNow,
    status: 'complete' as const, synced: true, fiscal: db.settings.efris ? 'sent' : 'off', fdn: null,
  };
  db.sales.push(sale);
  sale.lines.forEach((l) => move(db, l.productId, wh, -l.qty, 'sale', sale.no, o.when));
  const jl: any[] = [];
  const acc = o.method === 'cash' ? 'acc_cash' : o.method === 'momo' ? 'acc_momo' : o.method === 'bank' ? 'acc_bank' : null;
  if (paidNow > 0 && acc) jl.push({ acc, dr: paidNow });
  if (sale.due > 0) jl.push({ acc: 'n_ar', dr: sale.due });
  if (t.discount > 0) jl.push({ acc: 'n_discount', dr: t.discount });
  jl.push({ acc: 'n_sales', cr: t.net + t.discount });
  if (t.tax > 0) jl.push({ acc: 'n_tax', cr: t.tax });
  journal(db, o.when, 'Sale ' + sale.no, sale.no, jl);
  if (t.cost > 0) journal(db, o.when, 'Cost of sale ' + sale.no, sale.no, [{ acc: 'n_cogs', dr: t.cost }, { acc: 'n_inventory', cr: t.cost }]);
  sale.lines.forEach((l) => {
    const prod = db.products.find((x) => x.id === l.productId);
    if (prod && prod.warrantyMonths > 0) {
      db.warranties.push({ id: uid('wty'), saleId: sale.id, saleNo: sale.no, productId: prod.id, partyId: sale.partyId, soldAt: iso(o.when), months: prod.warrantyMonths, status: 'active' });
    }
  });
  return sale;
}

function purchaseInSeed(db: DB, partyId: string, lines: { productId: string; qty: number; cost: number }[], method: string, when: Date) {
  db.counters.purchase += 1;
  const total = lines.reduce((s, l) => s + l.qty * l.cost, 0);
  const wh = 'w1';
  const pu = { id: uid('pur'), no: 'PUR-' + String(100000 + db.counters.purchase).slice(1), ts: iso(when), partyId, lines, total, method: method as any, paid: method === 'credit' ? 0 : total, due: method === 'credit' ? total : 0, status: 'complete' as const };
  db.purchases.push(pu);
  lines.forEach((l) => move(db, l.productId, wh, l.qty, 'purchase', pu.no, when));
  const jl: any[] = [{ acc: 'n_inventory', dr: total }];
  if (method === 'credit') jl.push({ acc: 'n_ap', cr: total });
  else jl.push({ acc: method === 'bank' ? 'acc_bank' : method === 'momo' ? 'acc_momo' : 'acc_cash', cr: total });
  journal(db, when, 'Purchase ' + pu.no, pu.no, jl);
  return pu;
}

function partyBalanceSeed(db: DB, id: string) {
  const pt = db.parties.find((x) => x.id === id);
  if (!pt) return 0;
  let b = pt.openingBalance || 0;
  db.sales.forEach((s) => { if (s.partyId === id && s.status !== 'void') b += s.due; });
  db.purchases.forEach((x) => { if (x.partyId === id) b -= x.due; });
  return b;
}

function recordPaymentSeed(db: DB, o: { partyId: string; amount: number; direction: 'in' | 'out'; accountId: string; when: Date; note: string }) {
  const acc = db.accounts.find((a) => a.id === o.accountId);
  const pay = { id: uid('pay'), ts: iso(o.when), partyId: o.partyId, amount: o.amount, direction: o.direction, accountId: o.accountId, note: o.note, method: acc ? acc.type : 'cash' };
  db.payments.push(pay);
  const partyName = db.parties.find((p) => p.id === o.partyId)?.name || '';
  if (o.direction === 'in') journal(db, o.when, 'Receipt from ' + partyName, 'RCT', [{ acc: o.accountId, dr: o.amount }, { acc: 'n_ar', cr: o.amount }]);
  else journal(db, o.when, 'Payment to ' + partyName, 'PAY', [{ acc: 'n_ap', dr: o.amount }, { acc: o.accountId, cr: o.amount }]);
  let left = o.amount;
  if (o.direction === 'in') {
    db.sales.filter((s) => s.partyId === o.partyId && s.due > 0 && s.status !== 'void').sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
      .forEach((s) => { if (left <= 0) return; const take = Math.min(left, s.due); s.due -= take; s.paid += take; left -= take; });
  } else {
    db.purchases.filter((x) => x.partyId === o.partyId && x.due > 0).sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
      .forEach((x) => { if (left <= 0) return; const take = Math.min(left, x.due); x.due -= take; x.paid += take; left -= take; });
  }
}

function recordEntrySeed(db: DB, o: { direction: 'in' | 'out'; accountId: string; category: string; amount: number; note: string; when: Date }) {
  db.entries.push({ id: uid('ent'), ts: iso(o.when), direction: o.direction, accountId: o.accountId, category: o.category, amount: o.amount, note: o.note });
  if (o.direction === 'out') journal(db, o.when, o.category + (o.note ? ' — ' + o.note : ''), 'EXP', [{ acc: 'n_expense', dr: o.amount }, { acc: o.accountId, cr: o.amount }]);
  else journal(db, o.when, o.category + (o.note ? ' — ' + o.note : ''), 'INC', [{ acc: o.accountId, dr: o.amount }, { acc: 'n_income', cr: o.amount }]);
}

function seedHistory(db: DB) {
  const rnd = mulberry(20260822);
  const cashier = db.users[1], owner = db.users[0];
  for (let d = 74; d >= 0; d--) {
    const n = 1 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const when = daysAgo(d); when.setHours(8 + Math.floor(rnd() * 10), Math.floor(rnd() * 60), 0, 0);
      const party = rnd() < 0.55 ? db.parties[Math.floor(rnd() * 4)] : null;
      const lines: any[] = [];
      const picks = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < picks; k++) {
        const pr = db.products[Math.floor(rnd() * 10)];
        if (!pr.price) continue;
        const q = 1 + Math.floor(rnd() * 5);
        if (lines.some((l) => l.productId === pr.id)) continue;
        if (stockOf(pr) < q) continue;
        lines.push({ productId: pr.id, name: pr.name, sku: pr.sku, unit: pr.unit, qty: q, price: pr.price, cost: pr.cost, taxRate: pr.taxRate });
      }
      if (!lines.length) continue;
      const methods = ['cash', 'cash', 'cash', 'momo', 'bank', 'credit'];
      let method = methods[Math.floor(rnd() * methods.length)];
      if (method === 'credit' && !party) method = 'cash';
      commitSaleSeed(db, { lines, partyId: party ? party.id : null, method, discount: 0, userId: rnd() < 0.3 ? owner.id : cashier.id, when });
    }
    if (d % 14 === 0 && d > 0) {
      const supplier = db.parties[4 + Math.floor((d / 14)) % 2];
      const need = db.products.filter((x) => x.price > 0 && stockOf(x) <= x.reorder * 1.5);
      if (need.length) {
        purchaseInSeed(db, supplier.id, need.slice(0, 3).map((x) => ({ productId: x.id, qty: Math.max(20, x.reorder * 4), cost: x.cost })), Math.floor(d / 14) % 2 ? 'bank' : 'credit', daysAgo(d));
      }
    }
  }
  purchaseInSeed(db, db.parties[4].id, [{ productId: db.products[0].id, qty: 200, cost: db.products[0].cost }], 'credit', daysAgo(9));
  purchaseInSeed(db, db.parties[5].id, [{ productId: db.products[1].id, qty: 40, cost: db.products[1].cost }], 'bank', daysAgo(4));

  db.parties.slice(0, 3).forEach((pt, i) => {
    const bal = partyBalanceSeed(db, pt.id);
    if (bal > 60000) recordPaymentSeed(db, { partyId: pt.id, amount: Math.round((bal * 0.35) / 100) * 100, direction: 'in', accountId: 'acc_cash', when: daysAgo(2 + i), note: 'Part payment' });
  });

  recordEntrySeed(db, { direction: 'out', accountId: 'acc_bank', category: 'Rent', amount: 1200000, note: 'August rent', when: daysAgo(6) });
  recordEntrySeed(db, { direction: 'out', accountId: 'acc_cash', category: 'Transport', amount: 45000, note: 'Delivery fuel', when: daysAgo(1) });
  recordEntrySeed(db, { direction: 'in', accountId: 'acc_cash', category: 'Other income', amount: 80000, note: 'Scrap sale', when: daysAgo(3) });

  [420, 260, 85, 1240].forEach((pts, i) => { if (db.parties[i] && db.parties[i].type === 'customer') db.parties[i].points = pts; });

  db.shifts.push({ id: uid('sft'), userId: db.users[1].id, till: 'Till 1', openedAt: iso(hoursAgo(5)), closedAt: null, openingFloat: 150000, countedCash: null });

  const w = db.warranties[0];
  if (w) { w.status = 'claim'; db.claims.push({ id: uid('clm'), warrantyId: w.id, openedAt: iso(daysAgo(2)), fault: 'Motor stopped after 3 weeks', status: 'open', resolution: '' }); }
}

/**
 * Two demo instalment plans against real credit sales, so the screen opens
 * with something to look at: one running to time, one a payment behind.
 */
function seedPlans(db: DB) {
  const candidates = db.sales
    .filter((s) => s.status !== 'void' && s.partyId && s.method === 'credit' && s.total > 100000)
    .sort((a, b) => b.total - a.total)
    .slice(0, 2);

  candidates.forEach((sale, i) => {
    const startedDaysAgo = i === 0 ? 70 : 96;
    const started = daysAgo(startedDaysAgo);
    const every = i === 0 ? 30 : 14;
    const count = i === 0 ? 3 : 4;
    const down = Math.round((sale.total * 0.2) / 1000) * 1000;
    const schedule = instalSchedule(sale.total, down, count, every, 0, started);

    // The first plan has kept up; the second has fallen one instalment behind.
    const settle = i === 0 ? schedule.length - 1 : 1;
    db.counters.plan += 1;
    const pl: InstalmentPlan = {
      id: uid('pln'), no: 'PLN-' + String(100000 + db.counters.plan).slice(1),
      saleId: sale.id, partyId: sale.partyId, total: sale.total, down, every,
      schedule, note: '', createdAt: iso(started),
    };

    if (down > 0) {
      recordPaymentSeed(db, { partyId: sale.partyId!, amount: down, direction: 'in', accountId: 'acc_cash', when: started, note: 'Down payment on ' + pl.no });
    }
    schedule.slice(0, settle).forEach((x) => {
      const paidOn = new Date(x.due);
      x.paidAt = iso(paidOn);
      recordPaymentSeed(db, { partyId: sale.partyId!, amount: x.amount, direction: 'in', accountId: 'acc_cash', when: paidOn, note: 'Instalment on ' + pl.no });
    });

    db.instalmentPlans.push(pl);
  });
}

/**
 * A genuinely empty set of books, for a shop that has just signed up.
 *
 * `seed()` builds a demo: twelve products, a few customers and about five
 * million shillings of opening balances belonging to "Sample Traders". That is
 * useful for looking around, and wrong for somebody who has just created an
 * account — they would have to find and delete a stranger's stock and money
 * before they could trust a single figure the app showed them.
 *
 * So this shares the seed's defaults and none of its contents. `onboarded` is
 * false, because the next thing that should happen is the business setup.
 */
export function emptyBook(o: { firmName?: string; ownerName?: string; branchName?: string; ownerEmail?: string } = {}): DB {
  const db = seed();

  const firm = {
    id: uid('frm'),
    name: (o.firmName || '').trim() || 'My shop',
    tin: '',
    address: '',
    phone: '',
    businessType: '',
  };

  db.firm = firm;
  db.firms = [firm];
  db.activeFirmId = firm.id;

  db.warehouses = [{ id: 'w1', name: (o.branchName || '').trim() || 'Main shop', active: true }];

  db.products = [];
  db.parties = [];

  // The drawer and the bank still exist — a shop needs somewhere to put money
  // on day one — but they start at nothing rather than at someone else's float.
  // Neutral names: the demo's included a real bank ("Stanbic"), which on a new
  // shop's books reads as somebody else's account.
  const plain: Record<string, string> = { cash: 'Cash drawer', bank: 'Bank account', wallet: 'Mobile money' };
  db.accounts = db.accounts.map((a) => ({ ...a, name: plain[a.type] || a.name, opening: 0 }));

  // A fresh book gets its own owner rather than inheriting the demo's staff.
  // Keeping users[0] meant a real shop opened with 'Ronald Okello' on the till.
  db.users = [{
    id: uid('usr'),
    name: (o.ownerName || '').trim() || 'Owner',
    role: 'owner' as const,
    // no PIN until the owner chooses one — onboarding asks, and so does the lock screen
    pin: '',
    active: true,
  }];

  db.sales = [];
  db.purchases = [];
  db.payments = [];
  db.entries = [];
  db.journal = [];
  db.movements = [];
  db.shifts = [];
  db.warranties = [];
  db.claims = [];
  db.estimates = [];
  db.challans = [];
  db.creditNotes = [];
  db.offers = [];
  db.stockTakes = [];
  db.purchaseOrders = [];
  db.productionRuns = [];
  db.recurringInvoices = [];
  db.instalmentPlans = [];
  db.auditLog = [];
  db.queue = [];
  db.revisions = [];

  db.counters = { sale: 0, purchase: 0, estimate: 0, challan: 0, creditNote: 0, po: 0, plan: 0 };
  db.session = {
    userId: db.users[0].id, role: 'owner', online: true, till: 'Till 1', warehouse: 'w1',
  };
  db.settings = { ...db.settings, defaultWarehouse: 'w1' };

  // the chart of accounts is rebuilt so it holds the ledgers and nothing posted
  db.coa = undefined;
  ensureCoa(db);

  db.onboarded = false;
  db.demo = false;
  db.ownerEmail = (o.ownerEmail || '').trim().toLowerCase() || undefined;
  return db;
}
