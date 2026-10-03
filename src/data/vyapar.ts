/**
 * MOVING A SHOP OVER FROM VYAPAR.
 *
 * A Vyapar backup (.vyb) is a zip holding one SQLite database (.vyp). This
 * module takes that database's tables, already read into plain rows (see
 * vyaparRead.ts), and replays one of its businesses into the current books:
 *
 *   parties   kb_names (type 1). Anyone on a purchase becomes a supplier;
 *             everyone else a customer. Someone who is both gets one of each.
 *   items     kb_items. Type 3 is a service; type 2 is an expense line
 *             (fuel, a fee) and becomes the expense's note, not stock.
 *   sales     kb_transactions type 1, with kb_lineitems. What was paid at the
 *             counter is txn_cash_amount; the rest was owed. The invoice's own
 *             total is the truth: a gap to its lines is a discount or a charge.
 *   payments  type 3, settling exactly the sales kb_txn_links ties them to.
 *   purchases type 2 · expenses type 7 (under their category, as a ledger)
 *   quotes    type 27, and sale orders (type 24) · returns type 21
 *   opening   type 5, a party's opening balance.
 *
 * Every record goes through the same logic the till uses, so the journal,
 * stock movements and balances agree as if it had been rung up here. At the
 * end each item's stock is set to what Vyapar says it holds, which carries in
 * the opening stock and adjustments Vyapar keeps elsewhere.
 *
 * Each Vyapar record is remembered by its id in `d.imports`, so importing the
 * same backup twice adds nothing the second time. People and items already
 * in the books are matched by name and reused.
 */
import type { DB, Party, Product, SaleLine, PurchaseLine, PayMethod } from './types';
import * as logic from './logic';
import { uid, iso } from './uid';

export type Row = Record<string, any>;

/** The tables the importer reads, each as plain rows. */
export interface VyTables {
  kb_firms: Row[];
  kb_names: Row[];
  kb_items: Row[];
  kb_item_categories: Row[];
  kb_item_categories_mapping: Row[];
  kb_item_units: Row[];
  kb_transactions: Row[];
  kb_lineitems: Row[];
  kb_txn_links: Row[];
  kb_linked_transactions: Row[];
  kb_paymentTypes: Row[];
  /** Pictures by id — a business's logo and signature point here. */
  kb_images?: Row[];
}
export const VY_TABLES: (keyof VyTables)[] = [
  'kb_firms', 'kb_names', 'kb_items', 'kb_item_categories', 'kb_item_categories_mapping', 'kb_item_units',
  'kb_transactions', 'kb_lineitems', 'kb_txn_links', 'kb_linked_transactions', 'kb_paymentTypes', 'kb_images',
];

/** Vyapar's transaction types, as numbered in kb_transactions.txn_type. */
export const VY = { SALE: 1, PURCHASE: 2, PAYMENT_IN: 3, PAYMENT_OUT: 4, OPENING: 5, EXPENSE: 7, SALE_RETURN: 21, SALE_ORDER: 24, ESTIMATE: 27 } as const;

export interface VyFirm {
  id: number; name: string; phone: string; email: string; address: string;
  counts: { sales: number; purchases: number; payments: number; expenses: number; quotes: number; returns: number };
}

/** The businesses in a backup, with what each holds — for choosing which to bring in. */
export function vyaparFirms(t: VyTables): VyFirm[] {
  const txns = t.kb_transactions;
  const first = t.kb_firms[0]?.firm_id;
  // a transaction with no firm (an opening balance) belongs to the first one
  const of = (r: Row) => Number(r.txn_firm_id ?? first);
  return t.kb_firms.map((f) => {
    const mine = txns.filter((r) => of(r) === Number(f.firm_id));
    const n = (...types: number[]) => mine.filter((r) => types.includes(Number(r.txn_type))).length;
    return {
      id: Number(f.firm_id), name: String(f.firm_name || 'Business ' + f.firm_id).trim(),
      phone: f.firm_phone || '', email: f.firm_email || '', address: String(f.firm_address || '').trim(),
      counts: {
        sales: n(VY.SALE), purchases: n(VY.PURCHASE), payments: n(VY.PAYMENT_IN, VY.PAYMENT_OUT),
        expenses: n(VY.EXPENSE), quotes: n(VY.ESTIMATE, VY.SALE_ORDER), returns: n(VY.SALE_RETURN),
      },
    };
  });
}

export interface ImportReport {
  firm: string;
  /** The business details (name, phones, address, logo…) were taken from Vyapar. */
  details: string[];
  parties: number; items: number;
  sales: number; purchases: number; payments: number; expenses: number; quotes: number; returns: number; openings: number;
  skipped: number;
  /** Plain-language notes on anything that needed a judgement. */
  notes: string[];
}

const num = (v: any) => Number(v) || 0;
const r2 = (n: number) => Math.round(n * 100) / 100;
/** Vyapar stores "2025-02-11 00:00:00" in local time. */
function when(s: any): Date {
  const d = new Date(String(s || '').replace(' ', 'T'));
  return Number.isFinite(d.getTime()) ? d : new Date();
}

export function importVyapar(d: DB, t: VyTables, firmId: number): ImportReport {
  const firm = vyaparFirms(t).find((f) => f.id === firmId);
  if (!firm) throw new Error('That business is not in the backup.');
  const firstFirm = Number(t.kb_firms[0]?.firm_id);
  const report: ImportReport = {
    firm: firm.name, details: [], parties: 0, items: 0, sales: 0, purchases: 0, payments: 0, expenses: 0, quotes: 0, returns: 0, openings: 0,
    skipped: 0, notes: [],
  };
  const done = (d.imports = d.imports || {});
  report.details = takeFirmDetails(d, t, firmId);
  const key = (kind: string, id: any) => 'vy:' + firm.name + ':' + kind + ':' + id;

  // the import replays history, so the till's own guards on stock and credit stand aside for it
  const saved = { allowNegativeStock: d.settings.allowNegativeStock, taxEnabled: d.settings.taxEnabled };
  d.settings.allowNegativeStock = true;
  const wh = d.session.warehouse || d.warehouses?.[0]?.id || 'w1';
  const cashAcc = d.accounts.find((a) => a.id === 'acc_cash')?.id || d.accounts.find((a) => a.type === 'cash')?.id || d.accounts[0]?.id;
  const bankAcc = d.accounts.find((a) => a.type === 'bank')?.id || cashAcc;
  const accountFor = (paymentTypeId: any) => {
    const pt = t.kb_paymentTypes.find((p) => Number(p.paymentType_id) === Number(paymentTypeId));
    return pt && String(pt.paymentType_type).toUpperCase() !== 'CASH' ? bankAcc : cashAcc;
  };

  const isPayment = (r: Row) => num(r.txn_type) === VY.PAYMENT_IN || num(r.txn_type) === VY.PAYMENT_OUT;
  const byDate = (a: Row, b: Row) => when(a.txn_date).getTime() - when(b.txn_date).getTime() || num(a.txn_id) - num(b.txn_id);
  const mineAll = t.kb_transactions.filter((r) => Number(r.txn_firm_id ?? firstFirm) === firmId);
  // Vyapar lets a payment be dated before the invoice it settles, so payments
  // are replayed after everything they could settle is in place
  const txns = [...mineAll.filter((r) => !isPayment(r)).sort(byDate), ...mineAll.filter(isPayment).sort(byDate)];
  const linesOf = new Map<number, Row[]>();
  t.kb_lineitems.forEach((l) => {
    const k = num(l.lineitem_txn_id);
    if (!linesOf.has(k)) linesOf.set(k, []);
    linesOf.get(k)!.push(l);
  });

  /* ---- parties ---- */
  const suppliersIds = new Set(txns.filter((r) => num(r.txn_type) === VY.PURCHASE || num(r.txn_type) === VY.PAYMENT_OUT).map((r) => num(r.txn_name_id)));
  const customerIds = new Set(txns.filter((r) => ![VY.PURCHASE, VY.PAYMENT_OUT, VY.EXPENSE].includes(num(r.txn_type) as any)).map((r) => num(r.txn_name_id)));
  const nameRow = new Map<number, Row>(t.kb_names.map((n) => [num(n.name_id), n]));
  const partyIds = new Map<string, string>(); // 'c:12' / 's:12' → our id
  function partyFor(vyId: any, type: 'customer' | 'supplier'): string | null {
    const id = num(vyId);
    const row = nameRow.get(id);
    if (!row || num(row.name_type) !== 1) return null;
    const k = (type === 'customer' ? 'c:' : 's:') + id;
    if (partyIds.has(k)) return partyIds.get(k)!;
    const mark = key('party-' + type, id);
    let p: Party | undefined = done[mark] ? d.parties.find((x) => x.id === done[mark]) : undefined;
    const name = String(row.full_name || '').trim() || 'Vyapar party ' + id;
    if (!p) p = d.parties.find((x) => x.type === type && x.name.trim().toLowerCase() === name.toLowerCase());
    if (!p) {
      p = {
        id: uid('pty'), name, type, phone: String(row.phone_number || '').trim(), openingBalance: 0,
        // the limit is set once history is in, so an old sale cannot trip it
        creditLimit: 0, points: 0, active: num(row.name_is_active ?? 1) !== 0,
        address: String(row.address || '').trim() || undefined, email: String(row.email || '').trim() || undefined,
        gstin: String(row.name_tin_number || row.name_gstin_number || '').trim() || undefined,
      };
      d.parties.push(p);
      logic.enqueue(d, 'party', p.id);
      report.parties += 1;
    }
    done[mark] = p.id;
    partyIds.set(k, p.id);
    return p.id;
  }
  // everyone in this business's transactions, even those only on a quote
  customerIds.forEach((id) => partyFor(id, 'customer'));
  suppliersIds.forEach((id) => partyFor(id, 'supplier'));
  const both = [...suppliersIds].filter((id) => customerIds.has(id)).length;
  if (both) report.notes.push(both + ' contact(s) were both customer and supplier in Vyapar; each now has a customer and a supplier record.');

  /* ---- items ---- */
  const catName = new Map<number, string>(t.kb_item_categories.map((c) => [num(c.item_category_id), String(c.item_category_name || '').trim()]));
  const catOfItem = new Map<number, string>();
  t.kb_item_categories_mapping.forEach((m) => { if (!catOfItem.has(num(m.item_id))) catOfItem.set(num(m.item_id), catName.get(num(m.category_id)) || ''); });
  const unitName = new Map<number, string>(t.kb_item_units.map((u) => [num(u.unit_id), String(u.unit_short_name || u.unit_name || '').trim()]));
  const itemRow = new Map<number, Row>(t.kb_items.map((i) => [num(i.item_id), i]));
  const productIds = new Map<number, string>();
  const stockBefore = new Map<string, number>();
  function productFor(vyId: any, fallbackName?: string): Product {
    const id = num(vyId);
    if (productIds.has(id)) return d.products.find((p) => p.id === productIds.get(id))!;
    const row = itemRow.get(id);
    const mark = key('item', id || fallbackName);
    let p: Product | undefined = done[mark] ? d.products.find((x) => x.id === done[mark]) : undefined;
    const name = String(row?.item_name || fallbackName || 'Imported item').trim();
    if (!p) p = d.products.find((x) => x.name.trim().toLowerCase() === name.toLowerCase());
    if (!p) {
      const service = !row || num(row.item_type) === 3;
      const category = (catOfItem.get(id) || (num(row?.category_id) ? catName.get(num(row!.category_id)) : '') || 'General').trim() || 'General';
      p = {
        id: uid('prd'), sku: String(row?.item_code || '').trim() || 'VY-' + (id || d.products.length + 1),
        name, unit: unitName.get(num(row?.base_unit_id)) || 'pcs', category,
        cost: num(row?.item_purchase_unit_price), price: num(row?.item_sale_unit_price), taxRate: 0,
        stock: {}, reorder: num(row?.item_min_stock_quantity), warrantyMonths: 0,
        active: num(row?.item_is_active ?? 1) !== 0,
        kind: service ? 'service' : 'product', trackInventory: !service, barcodes: [],
      } as Product;
      d.products.push(p);
      logic.enqueue(d, 'product', p.id);
      if (!d.categories?.includes(category)) d.categories = [...(d.categories || []), category];
      report.items += 1;
    }
    if (!stockBefore.has(p.id)) stockBefore.set(p.id, Object.values(p.stock || {}).reduce((a, q) => a + num(q), 0));
    done[mark] = p.id;
    productIds.set(id, p.id);
    return p;
  }

  /** A transaction's lines as sale lines, and how its own total differs from them. */
  function saleLines(txn: Row): { lines: SaleLine[]; lineSum: number } {
    const lines: SaleLine[] = (linesOf.get(num(txn.txn_id)) || []).map((l) => {
      const p = productFor(l.item_id, l.lineitem_description || undefined);
      const qty = num(l.quantity) || 1;
      // the line's own amount after its discount and tax is what the customer was charged for it
      const price = qty ? r2(num(l.total_amount) / qty) : num(l.priceperunit);
      return { productId: p.id, name: p.name, sku: p.sku, unit: p.unit, qty, price, cost: p.cost || 0, taxRate: 0 };
    });
    return { lines, lineSum: r2(lines.reduce((a, l) => a + l.qty * l.price, 0)) };
  }
  const total = (txn: Row) => r2(num(txn.txn_cash_amount) + num(txn.txn_balance_amount));
  const docNo = (txn: Row, used: (no: string) => boolean) => {
    const no = (String(txn.txn_invoice_prefix || '') + String(txn.txn_ref_number_char || '')).trim();
    if (!no) return undefined;
    return used(no) ? 'VY-' + no : no;
  };

  /* ---- replay, oldest first ---- */
  const saleIdOf = new Map<number, string>();
  /** Vyapar opening-balance records, by id, and whose they are — payments can settle them. */
  const openingOf = new Map<number, string>();
  const purchaseIdOf = new Map<number, string>();
  const converted = new Set(t.kb_linked_transactions.map((x) => num(x.txn_source_id)));
  const links = new Map<number, PayLink[]>();
  let linksReady = false;
  for (const txn of txns) {
    const type = num(txn.txn_type);
    if (!linksReady && isPayment(txn)) {
      linksReady = true;
      t.kb_txn_links.forEach((k) => {
        const payId = num(k.txn_links_txn_1_id);
        const other = num(k.txn_links_txn_2_id);
        const entry: PayLink = openingOf.has(other)
          ? { opening: true, amount: num(k.txn_links_amount) }
          : { billId: saleIdOf.get(other) || purchaseIdOf.get(other), amount: num(k.txn_links_amount) };
        if (!links.has(payId)) links.set(payId, []);
        links.get(payId)!.push(entry);
      });
    }
    const mark = key('txn', txn.txn_id);
    if (done[mark]) {
      report.skipped += 1;
      if (type === VY.SALE) saleIdOf.set(num(txn.txn_id), done[mark]);
      if (type === VY.PURCHASE) purchaseIdOf.set(num(txn.txn_id), done[mark]);
      if (type === VY.OPENING) openingOf.set(num(txn.txn_id), done[mark]);
      continue;
    }
    const at = when(txn.txn_date);
    try {
      if (type === VY.SALE) {
        const { lines, lineSum } = saleLines(txn);
        if (!lines.length) { report.notes.push('Sale ' + (txn.txn_ref_number_char || txn.txn_id) + ' had no lines and was left out.'); continue; }
        const tot = total(txn);
        const paid = Math.min(num(txn.txn_cash_amount), tot);
        let partyId = partyFor(txn.txn_name_id, 'customer');
        if (!partyId && paid < tot) partyId = partyFor(walkInId(), 'customer');
        const sale = logic.commitSale(d, {
          lines, partyId, method: paid < tot ? 'credit' : 'cash',
          discount: lineSum > tot ? r2(lineSum - tot) : 0,
          additionalCharges: tot > lineSum ? r2(tot - lineSum) : 0,
          received: paid, receivedVia: accountFor(txn.txn_payment_type_id) === bankAcc && bankAcc !== cashAcc ? 'bank' : 'cash',
          description: txn.txn_description || undefined,
          no: docNo(txn, (no) => d.sales.some((s) => s.no === no)), ts: iso(at),
        }, at);
        saleIdOf.set(num(txn.txn_id), sale.id);
        done[mark] = sale.id;
        report.sales += 1;
      } else if (type === VY.PURCHASE) {
        const supplier = partyFor(txn.txn_name_id, 'supplier');
        if (!supplier) { report.notes.push('A purchase with no supplier was left out.'); continue; }
        const lines: PurchaseLine[] = (linesOf.get(num(txn.txn_id)) || []).map((l) => {
          const p = productFor(l.item_id, l.lineitem_description || undefined);
          const qty = num(l.quantity) || 1;
          return { productId: p.id, qty, cost: r2(num(l.total_amount) / qty) };
        });
        if (!lines.length) continue;
        const tot = total(txn);
        const paid = Math.min(num(txn.txn_cash_amount), tot);
        const method: PayMethod = paid >= tot ? 'cash' : 'credit';
        const pu = logic.createPurchase(d, supplier, lines, method, at, undefined, docNo(txn, (no) => d.purchases.some((x) => x.no === no)));
        // part paid at the time: the bill is on credit and the part paid settles it straight away
        if (method === 'credit' && paid > 0) logic.recordPayment(d, { partyId: supplier, amount: paid, direction: 'out', accountId: accountFor(txn.txn_payment_type_id)!, note: 'Paid with ' + pu.no }, at);
        purchaseIdOf.set(num(txn.txn_id), pu.id);
        done[mark] = pu.id;
        report.purchases += 1;
      } else if (type === VY.PAYMENT_IN || type === VY.PAYMENT_OUT) {
        const inbound = type === VY.PAYMENT_IN;
        const partyId = partyFor(txn.txn_name_id, inbound ? 'customer' : 'supplier');
        const cash = num(txn.txn_cash_amount);
        // a discount on a payment is part of the debt written off, not money received
        const discount = num(txn.txn_discount_amount);
        if (!partyId || cash + discount <= 0) { report.notes.push('A payment with no party or amount (' + txn.txn_id + ') was left out.'); continue; }
        const plan = settlePlan(d, links.get(num(txn.txn_id)) || [], partyId, inbound, cash, discount);
        let pay: { id: string } | null = null;
        if (cash > 0) {
          pay = logic.recordPayment(d, {
            partyId, amount: cash, direction: inbound ? 'in' : 'out', accountId: accountFor(txn.txn_payment_type_id)!,
            note: String(txn.txn_description || '').trim() || (txn.txn_ref_number_char ? 'Vyapar receipt ' + txn.txn_ref_number_char : ''),
            // an empty plan still has to stop the till's own oldest-first spread
            allocations: plan.cash.length ? plan.cash : [{ saleId: '-', amount: 0 }],
          }, at);
        }
        const p = d.parties.find((x) => x.id === partyId)!;
        // what settled an opening balance comes off it
        const offOpening = plan.openingCash + plan.openingDiscount;
        if (offOpening > 0) p.openingBalance = r2((p.openingBalance || 0) - offOpening);
        // the discount: the bills it covered are settled, and it is a cost of selling
        if (discount > 0) {
          plan.discount.forEach((x) => {
            const bill: any = inbound ? d.sales.find((y) => y.id === x.saleId) : d.purchases.find((y) => y.id === x.saleId);
            if (!bill) return;
            bill.due = r2(bill.due - x.amount);
            bill.paid = r2(bill.paid + x.amount);
          });
          logic.journal(d, at, 'Discount on payment — ' + p.name, 'DISC', inbound
            ? [{ acc: 'n_discount', dr: discount }, { acc: 'n_ar', cr: discount }]
            : [{ acc: 'n_ap', dr: discount }, { acc: 'n_income', cr: discount }]);
        }
        done[mark] = pay?.id || p.id;
        report.payments += 1;
      } else if (type === VY.EXPENSE) {
        const amount = total(txn);
        if (amount <= 0) continue;
        const category = String(nameRow.get(num(txn.txn_category_id))?.full_name || 'Expenses').trim();
        const ledger = expenseLedger(d, category);
        const items = (linesOf.get(num(txn.txn_id)) || []).map((l) => itemRow.get(num(l.item_id))?.item_name).filter(Boolean);
        const note = [txn.txn_description, items.join(', ')].filter(Boolean).join(' — ');
        const accountId = accountFor(txn.txn_payment_type_id)!;
        const e = { id: uid('ent'), ts: iso(at), direction: 'out' as const, accountId, category, ledgerId: ledger, amount, note, userId: d.session.userId };
        d.entries.push(e);
        logic.enqueue(d, 'entry', e.id);
        logic.journal(d, at, category + (note ? ' — ' + note : ''), 'EXP', [{ acc: ledger, dr: amount }, { acc: accountId, cr: amount }]);
        done[mark] = e.id;
        report.expenses += 1;
      } else if (type === VY.ESTIMATE || type === VY.SALE_ORDER) {
        const { lines, lineSum } = saleLines(txn);
        if (!lines.length) continue;
        const tot = total(txn) || lineSum;
        const est = {
          id: uid('est'), no: docNo(txn, (no) => (d.estimates || []).some((x) => x.no === no)) || 'EST-' + txn.txn_id,
          ts: iso(at), partyId: partyFor(txn.txn_name_id, 'customer'), lines,
          discount: lineSum > tot ? r2(lineSum - tot) : 0, total: tot,
          status: (converted.has(num(txn.txn_id)) ? 'converted' : 'open') as 'open' | 'converted',
        };
        d.estimates = [...(d.estimates || []), est];
        logic.enqueue(d, 'estimate', est.id);
        done[mark] = est.id;
        report.quotes += 1;
      } else if (type === VY.SALE_RETURN) {
        const { lines } = saleLines(txn);
        const amount = total(txn);
        const partyId = partyFor(txn.txn_name_id, 'customer');
        const cn = {
          id: uid('cn'), no: 'CN-' + (txn.txn_ref_number_char || txn.txn_id), ts: iso(at), saleId: null, partyId,
          lines: lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, price: l.price, cost: l.cost, taxRate: 0 })),
          total: amount, reason: String(txn.txn_description || 'Returned (from Vyapar)'), refund: 'account' as const,
        };
        d.creditNotes = [...(d.creditNotes || []), cn];
        logic.enqueue(d, 'creditNote', cn.id);
        // the goods come back, and what was owed for them goes down
        cn.lines.forEach((l) => logic.move(d, l.productId, wh, l.qty, 'return', cn.no, at));
        if (amount > 0) logic.journal(d, at, 'Credit note ' + cn.no, cn.no, [{ acc: 'n_sales', dr: amount }, { acc: partyId ? 'n_ar' : cashAcc!, cr: amount }]);
        // the return comes off what the customer owes, oldest bill first, as Vyapar counts it
        if (partyId && amount > 0) {
          let left = amount;
          d.sales.filter((x) => x.partyId === partyId && x.due > 0 && x.status !== 'void')
            .sort((x, y) => new Date(x.ts).getTime() - new Date(y.ts).getTime())
            .forEach((x) => { const c = Math.min(left, x.due); x.due = r2(x.due - c); x.paid = r2(x.paid + c); left -= c; });
        }
        done[mark] = cn.id;
        report.returns += 1;
      } else if (type === VY.OPENING) {
        const partyId = partyFor(txn.txn_name_id, 'customer');
        const p = partyId ? d.parties.find((x) => x.id === partyId) : undefined;
        if (!p) continue;
        p.openingBalance = r2((p.openingBalance || 0) + num(txn.txn_balance_amount) + num(txn.txn_cash_amount));
        openingOf.set(num(txn.txn_id), p.id);
        done[mark] = p.id;
        report.openings += 1;
      }
    } catch (e: any) {
      report.notes.push('Vyapar record ' + txn.txn_id + ' could not be brought in: ' + (e?.message || e));
    }
  }

  /* ---- stock and limits as Vyapar left them ---- */
  productIds.forEach((ourId, vyId) => {
    const row = itemRow.get(vyId);
    const p = d.products.find((x) => x.id === ourId);
    if (!row || !p || p.kind === 'service' || num(row.item_type) !== 1) return;
    const target = r2((stockBefore.get(ourId) || 0) + num(row.item_stock_quantity));
    const others = Object.entries(p.stock || {}).filter(([w]) => w !== wh).reduce((a, [, q]) => a + num(q), 0);
    logic.adjustStock(d, ourId, wh, r2(target - others), 'Opening stock from Vyapar', new Date());
  });
  // items Vyapar holds that never appeared on a transaction still come across
  t.kb_items.filter((i) => num(i.item_type) === 1 || num(i.item_type) === 3).forEach((i) => {
    if (productIds.has(num(i.item_id))) return;
    const p = productFor(i.item_id);
    if (p.kind !== 'service' && num(i.item_stock_quantity)) logic.adjustStock(d, p.id, wh, r2((stockBefore.get(p.id) || 0) + num(i.item_stock_quantity)), 'Opening stock from Vyapar', new Date());
  });
  partyIds.forEach((ourId, k) => {
    const row = nameRow.get(Number(k.slice(2)));
    const p = d.parties.find((x) => x.id === ourId);
    if (row && p && num(row.credit_limit_enabled) && num(row.credit_limit) > 0) p.creditLimit = num(row.credit_limit);
  });
  const negative = t.kb_items.filter((i) => num(i.item_type) === 1 && num(i.item_stock_quantity) < 0).length;
  if (negative) report.notes.push(negative + ' item(s) were below zero in Vyapar and come across that way — a stock count will set them right.');

  d.settings.allowNegativeStock = saved.allowNegativeStock;
  logic.audit(d, 'Imported from Vyapar', firm.name + ' — ' + report.sales + ' sales, ' + report.purchases + ' purchases, ' + report.payments + ' payments');
  return report;

  function walkInId() {
    // a credit sale needs someone to owe it; Vyapar allowed one without a name
    const existing = t.kb_names.find((n) => String(n.full_name).trim().toLowerCase() === 'walk-in (vyapar)');
    if (existing) return existing.name_id;
    const id = -1;
    nameRow.set(id, { name_id: id, full_name: 'Walk-in (Vyapar)', name_type: 1 });
    return id;
  }
}

interface PayLink { billId?: string; opening?: boolean; amount: number }

/**
 * How a Vyapar payment settles what is owed. Its links say which invoices (or
 * opening balance) it paid and how much; cash covers those first, the
 * discount the rest. Money beyond the links — Vyapar keeps it as unused —
 * still lowers what the party owes there, so here it settles the oldest bills.
 */
function settlePlan(d: DB, links: PayLink[], partyId: string, inbound: boolean, cash: number, discount: number) {
  const out = { cash: [] as { saleId: string; amount: number }[], discount: [] as { saleId: string; amount: number }[], openingCash: 0, openingDiscount: 0 };
  let cashLeft = cash;
  let discLeft = discount;
  const bills: any[] = (inbound
    ? d.sales.filter((x) => x.partyId === partyId && x.status !== 'void')
    : d.purchases.filter((x) => x.partyId === partyId && x.status !== 'void'))
    .sort((a: any, b: any) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const room = new Map<string, number>(bills.map((b) => [b.id, b.due]));
  const take = (target: string, want: number) => {
    let left = want;
    const c = Math.min(cashLeft, left); cashLeft -= c; left -= c;
    const k = Math.min(discLeft, left); discLeft -= k;
    if (target === 'opening') { out.openingCash += c; out.openingDiscount += k; return; }
    if (c > 0) out.cash.push({ saleId: target, amount: r2(c) });
    if (k > 0) out.discount.push({ saleId: target, amount: r2(k) });
    room.set(target, r2((room.get(target) || 0) - c - k));
  };
  links.forEach((l) => {
    if (l.opening) take('opening', l.amount);
    else if (l.billId && (room.get(l.billId) || 0) > 0) take(l.billId, Math.min(l.amount, room.get(l.billId)!));
  });
  bills.forEach((b) => {
    if (cashLeft + discLeft <= 0) return;
    const r = room.get(b.id) || 0;
    if (r > 0) take(b.id, r);
  });
  return out;
}

/** The expense ledger for a Vyapar expense category, made if the chart has none of that name. */
function expenseLedger(d: DB, name: string): string {
  d.coa = d.coa || [];
  const found = d.coa.find((l) => l.type === 'expense' && l.name.trim().toLowerCase() === name.toLowerCase());
  if (found) return found.id;
  const used = d.coa.map((l) => Number(l.code)).filter((n) => n >= 6000 && n < 7000);
  const code = String(used.length ? Math.max(...used) + 10 : 6100);
  const id = 'led_' + uid('x').slice(-6);
  d.coa.push({ id, code, name, type: 'expense', builtin: false, active: true } as any);
  logic.enqueue(d, 'ledger', id);
  return id;
}


/* ---------------------------------------------------------------- */
/* The business's own details                                          */
/* ---------------------------------------------------------------- */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Bytes as base64, without relying on Buffer or btoa being there. */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
      + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=')
      + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out;
}

/** A Vyapar picture as an image the app can show and print, or nothing. */
function imageUri(t: VyTables, id: any): string | undefined {
  if (id == null || id === '') return undefined;
  const row = (t.kb_images || []).find((r) => Number(r.image_id) === Number(id));
  const blob = row?.image_bitmap;
  if (!blob) return undefined;
  const bytes = blob instanceof Uint8Array ? blob : Array.isArray(blob) ? Uint8Array.from(blob) : null;
  if (!bytes || !bytes.length) return undefined;
  // PNG starts 89 50 4E 47; JPEG FF D8
  const mime = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : 'image/png';
  return 'data:' + mime + ';base64,' + toBase64(bytes);
}

/**
 * The business details from Vyapar replace these books' own: name, phones,
 * email, address, TIN, description, bank details, logo and signature. A field
 * Vyapar has blank leaves what is here alone. Returns what changed.
 */
function takeFirmDetails(d: DB, t: VyTables, firmId: number): string[] {
  const row = t.kb_firms.find((x) => Number(x.firm_id) === firmId);
  if (!row) return [];
  // Vyapar sometimes keeps a stray quote mark at either end of a field
  const text = (v: any) => String(v ?? '').trim().replace(/^"+|"+$/g, '').trim();
  const bank = [text(row.firm_bank_name), text(row.firm_bank_account_number) && 'A/C ' + text(row.firm_bank_account_number), text(row.firm_bank_ifsc_code)]
    .filter(Boolean).join(' · ');
  const next: Partial<DB['firm']> = {
    name: text(row.firm_name),
    phone: text(row.firm_phone),
    phone2: text(row.firm_phone_secondary),
    email: text(row.firm_email),
    address: text(row.firm_address),
    tin: text(row.firm_tin_number) || text(row.firm_gstin_number),
    description: text(row.firm_description),
    bankDetails: bank,
    logo: imageUri(t, row.firm_logo),
    signature: imageUri(t, row.firm_signature),
  };
  const label: Record<string, string> = {
    name: 'name', phone: 'phone', phone2: 'second phone', email: 'email', address: 'address', tin: 'TIN',
    description: 'description', bankDetails: 'bank details', logo: 'logo', signature: 'signature',
  };
  const changed: string[] = [];
  const firm: any = { ...d.firm };
  Object.entries(next).forEach(([k, v]) => {
    if (!v || firm[k] === v) return;
    firm[k] = v;
    changed.push(label[k] || k);
  });
  if (!changed.length) return [];
  d.firm = firm;
  const i = (d.firms || []).findIndex((x) => x.id === firm.id);
  if (i >= 0) d.firms[i] = firm;
  logic.enqueue(d, 'firm', firm.id);
  return changed;
}
