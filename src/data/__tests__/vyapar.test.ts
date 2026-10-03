/**
 * Moving from Vyapar. The fixture is a small invented Vyapar database that
 * carries each of the patterns found in real backups: a part-paid sale, a
 * payment linked to it, a payment that is only a discount, a payment that
 * settles an opening balance, a payment dated before its invoice, an expense
 * under a category, a quotation and a second business that must stay out.
 */
import { emptyBook } from '../seed';
import { importVyapar, vyaparFirms, VyTables, toBase64 } from '../vyapar';
import { partyBalance } from '../logic';

const held = (p: any) => Object.values(p.stock || {}).reduce((a: number, q: any) => a + (Number(q) || 0), 0);

function fixture(): VyTables {
  const tx = (o: any) => ({
    txn_firm_id: 1, txn_cash_amount: 0, txn_balance_amount: 0, txn_discount_amount: 0, txn_payment_type_id: 1,
    txn_invoice_prefix: '', txn_ref_number_char: '', txn_description: '', ...o,
  });
  return {
    kb_firms: [
      { firm_id: 1, firm_name: 'Main Shop', firm_phone: '0700', firm_email: '', firm_address: '' },
      { firm_id: 2, firm_name: 'Side Shop', firm_phone: '', firm_email: '', firm_address: '' },
    ],
    kb_names: [
      { name_id: 1, full_name: 'Petrol', name_type: 2, amount: 0 },
      { name_id: 10, full_name: 'Acme School', name_type: 1, phone_number: '0771', amount: 0 },
      { name_id: 11, full_name: 'Bob', name_type: 1, amount: 0 },
      { name_id: 12, full_name: 'Gadget Supply', name_type: 1, amount: 0 },
    ],
    kb_items: [
      { item_id: 100, item_name: 'Printer', item_type: 1, item_sale_unit_price: 500, item_purchase_unit_price: 300, item_stock_quantity: 7, item_code: 'PR1', base_unit_id: 1, item_is_active: 1 },
      { item_id: 101, item_name: 'Setup', item_type: 3, item_sale_unit_price: 100, item_purchase_unit_price: 0, item_stock_quantity: -4 },
      { item_id: 102, item_name: 'fuel', item_type: 2, item_sale_unit_price: 0, item_purchase_unit_price: 0, item_stock_quantity: 0 },
    ],
    kb_item_categories: [{ item_category_id: 1, item_category_name: 'Hardware' }],
    kb_item_categories_mapping: [{ id: 1, item_id: 100, category_id: 1 }],
    kb_item_units: [{ unit_id: 1, unit_name: 'Pieces', unit_short_name: 'Pcs' }],
    kb_transactions: [
      tx({ txn_id: 1, txn_type: 2, txn_name_id: 12, txn_date: '2025-01-02 00:00:00', txn_cash_amount: 3000 }),
      // part paid: 500 at the counter, 1100 owed
      tx({ txn_id: 2, txn_type: 1, txn_name_id: 10, txn_date: '2025-01-05 00:00:00', txn_cash_amount: 500, txn_balance_amount: 1100, txn_ref_number_char: '7' }),
      // a payment dated before the invoice it settles
      tx({ txn_id: 3, txn_type: 3, txn_name_id: 11, txn_date: '2025-01-06 00:00:00', txn_cash_amount: 500 }),
      tx({ txn_id: 4, txn_type: 1, txn_name_id: 11, txn_date: '2025-01-08 00:00:00', txn_balance_amount: 500, txn_ref_number_char: '8' }),
      // 800 paid against invoice 7, and 300 of it written off as a discount
      tx({ txn_id: 5, txn_type: 3, txn_name_id: 10, txn_date: '2025-01-10 00:00:00', txn_cash_amount: 800 }),
      tx({ txn_id: 6, txn_type: 3, txn_name_id: 10, txn_date: '2025-01-11 00:00:00', txn_discount_amount: 300 }),
      // an opening balance, and a payment that settles it
      tx({ txn_id: 7, txn_type: 5, txn_name_id: 11, txn_date: '2025-01-01 00:00:00', txn_balance_amount: 2000, txn_firm_id: null }),
      tx({ txn_id: 8, txn_type: 3, txn_name_id: 11, txn_date: '2025-01-12 00:00:00', txn_cash_amount: 1500 }),
      tx({ txn_id: 9, txn_type: 7, txn_category_id: 1, txn_date: '2025-01-13 00:00:00', txn_cash_amount: 40 }),
      tx({ txn_id: 10, txn_type: 27, txn_name_id: 10, txn_date: '2025-01-14 00:00:00', txn_balance_amount: 1000, txn_ref_number_char: '1' }),
      // the other business: never part of Main Shop's books
      tx({ txn_id: 11, txn_type: 1, txn_firm_id: 2, txn_name_id: 10, txn_date: '2025-01-15 00:00:00', txn_cash_amount: 999 }),
    ],
    kb_lineitems: [
      { lineitem_txn_id: 1, item_id: 100, quantity: 10, priceperunit: 300, total_amount: 3000 },
      { lineitem_txn_id: 2, item_id: 100, quantity: 3, priceperunit: 500, total_amount: 1500 },
      { lineitem_txn_id: 2, item_id: 101, quantity: 1, priceperunit: 100, total_amount: 100 },
      { lineitem_txn_id: 4, item_id: 101, quantity: 5, priceperunit: 100, total_amount: 500 },
      { lineitem_txn_id: 9, item_id: 102, quantity: 1, priceperunit: 40, total_amount: 40 },
      { lineitem_txn_id: 10, item_id: 100, quantity: 2, priceperunit: 500, total_amount: 1000 },
      { lineitem_txn_id: 11, item_id: 100, quantity: 1, priceperunit: 999, total_amount: 999 },
    ],
    kb_txn_links: [
      { txn_links_txn_1_id: 3, txn_links_txn_2_id: 4, txn_links_amount: 500 },
      { txn_links_txn_1_id: 5, txn_links_txn_2_id: 2, txn_links_amount: 800 },
      { txn_links_txn_1_id: 6, txn_links_txn_2_id: 2, txn_links_amount: 300 },
      { txn_links_txn_1_id: 8, txn_links_txn_2_id: 7, txn_links_amount: 1500 },
    ],
    kb_linked_transactions: [],
    kb_paymentTypes: [{ paymentType_id: 1, paymentType_type: 'CASH', paymentType_name: 'Cash' }],
  };
}

function books() {
  const d = emptyBook({ firmName: 'Test' });
  d.session.role = 'owner' as any;
  return d;
}

describe('importing from Vyapar', () => {
  it('lists each business with what it holds', () => {
    const firms = vyaparFirms(fixture());
    expect(firms.map((f) => f.name)).toEqual(['Main Shop', 'Side Shop']);
    expect(firms[0].counts).toMatchObject({ sales: 2, purchases: 1, payments: 4, expenses: 1, quotes: 1 });
  });

  it('brings one business across with what is owed exactly as Vyapar has it', () => {
    const d = books();
    const r = importVyapar(d, fixture(), 1);
    expect(r).toMatchObject({ sales: 2, purchases: 1, payments: 4, expenses: 1, quotes: 1, openings: 1 });
    expect(d.sales.reduce((a, s) => a + s.total, 0)).toBe(2100); // the other business's 999 stays out

    const acme = d.parties.find((p) => p.name === 'Acme School' && p.type === 'customer')!;
    const bob = d.parties.find((p) => p.name === 'Bob')!;
    // 1600 sold, 500 at the counter, 800 paid and 300 written off
    expect(partyBalance(d, acme.id)).toBe(0);
    // opening 2000 less 1500 paid on it; the early payment settles invoice 8
    expect(partyBalance(d, bob.id)).toBe(500);
    expect(d.parties.find((p) => p.name === 'Gadget Supply')!.type).toBe('supplier');
  });

  it('files the expense under its category as a ledger and sets stock to Vyapar\'s', () => {
    const d = books();
    importVyapar(d, fixture(), 1);
    const petrol = d.coa!.find((l) => l.name === 'Petrol');
    expect(petrol?.type).toBe('expense');
    expect(d.entries.find((e) => e.ledgerId === petrol!.id)?.amount).toBe(40);
    const printer = d.products.find((p) => p.name === 'Printer')!;
    expect(held(printer)).toBe(7);
    expect(printer.category).toBe('Hardware');
    expect(d.products.find((p) => p.name === 'Setup')!.kind).toBe('service');
    expect(d.products.some((p) => p.name === 'fuel')).toBe(false); // an expense line, not stock
  });

  it('keeps the books balanced', () => {
    const d = books();
    importVyapar(d, fixture(), 1);
    const dr = d.journal.reduce((a, e) => a + e.lines.reduce((s, l) => s + (l.dr || 0), 0), 0);
    const cr = d.journal.reduce((a, e) => a + e.lines.reduce((s, l) => s + (l.cr || 0), 0), 0);
    expect(Math.abs(dr - cr)).toBeLessThan(0.01);
  });

  it('adds nothing the second time the same backup is imported', () => {
    const d = books();
    importVyapar(d, fixture(), 1);
    const before = { sales: d.sales.length, pays: d.payments.length, parties: d.parties.length, products: d.products.length };
    const again = importVyapar(d, fixture(), 1);
    expect(again.sales + again.payments + again.parties + again.items).toBe(0);
    expect({ sales: d.sales.length, pays: d.payments.length, parties: d.parties.length, products: d.products.length }).toEqual(before);
  });
});

describe("the business's own details", () => {
  it('takes the name, phones, address, logo and signature, and keeps what Vyapar has blank', () => {
    const t = fixture();
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    t.kb_firms[0] = {
      ...t.kb_firms[0], firm_phone: '0700', firm_phone_secondary: '0788', firm_email: 'shop@example.com',
      firm_address: 'Main Street', firm_description: '"Welcome!', firm_logo: 5, firm_signature: null, firm_tin_number: '',
    };
    t.kb_images = [{ image_id: 5, image_bitmap: png }];
    const d = books();
    d.firm.tin = '1000123';
    const r = importVyapar(d, t, 1);
    expect(d.firm).toMatchObject({
      name: 'Main Shop', phone: '0700', phone2: '0788', email: 'shop@example.com', address: 'Main Street', description: 'Welcome!',
    });
    expect(d.firm.logo).toBe('data:image/png;base64,' + toBase64(png));
    expect(d.firm.tin).toBe('1000123'); // blank in Vyapar: kept
    expect(r.details).toEqual(expect.arrayContaining(['name', 'logo', 'address']));
    expect(d.firms.find((x) => x.id === d.firm.id)?.name).toBe('Main Shop');
  });

  it('encodes base64 exactly', () => {
    expect(toBase64(Uint8Array.from([77, 97, 110]))).toBe('TWFu');
    expect(toBase64(Uint8Array.from([77, 97]))).toBe('TWE=');
    expect(toBase64(Uint8Array.from([77]))).toBe('TQ==');
  });
});
