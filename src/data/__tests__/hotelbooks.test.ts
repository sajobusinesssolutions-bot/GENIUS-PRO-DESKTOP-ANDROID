/**
 * Hotel bills and the books: a stay, a company's group, the night audit, an
 * event and a cancellation — each through to the money, with the books
 * checked after: debits equal credits, the debtors ledger is what guests and
 * companies owe, the money accounts hold what was taken, and a bill paid in
 * full leaves nobody owing.
 */
import { seed } from '../seed';
import { hotelActions } from '../actions/hotel';
import { addDays, today, folioOf } from '../hotel';
import * as logic from '../logic';
import type { DB } from '../types';

function setup() {
  const d: DB = seed();
  d.firm.businessType = 'hotel';
  d.settings.requireShift = false;
  const ref = { current: d };
  const commit = (mut: (x: DB) => void) => mut(ref.current);
  const h = hotelActions({ commit, requirePerm: () => {}, dbRef: ref as any });
  const dbl = h.saveRoomType({ name: 'Double', rate: 100000, maxAdults: 2, maxChildren: 1, active: true });
  const r1 = h.saveRoom({ no: '101', typeId: dbl.id, active: true });
  const r2 = h.saveRoom({ no: '102', typeId: dbl.id, active: true });
  return { d, h, dbl, r1, r2 };
}
const guest = { name: 'Jane Achieng', idType: 'national' as const, idNo: 'CF900', nationality: 'Ugandan', phone: '0700000001' };
const r2 = (n: number) => Math.round(n * 100) / 100;
const net = (d: DB, acc: string) => r2(d.journal.reduce((t, e) => t + e.lines.reduce((x, l) => x + (l.acc === acc ? (l.dr || 0) - (l.cr || 0) : 0), 0), 0));

function books(d: DB, step: string) {
  const dr = d.journal.reduce((t, e) => t + e.lines.reduce((x, l) => x + (l.dr || 0), 0), 0);
  const cr = d.journal.reduce((t, e) => t + e.lines.reduce((x, l) => x + (l.cr || 0), 0), 0);
  expect({ step, balanced: r2(dr - cr) }).toEqual({ step, balanced: 0 });
  const owed = r2(d.parties.filter((p) => p.type === 'customer').reduce((t, p) => t + logic.partyBalance(d, p.id) - (p.openingBalance || 0), 0));
  expect({ step, debtors: net(d, 'n_ar') }).toEqual({ step, debtors: owed });
}
const taken = (d: DB) => r2(d.accounts.reduce((t, a) => t + net(d, a.id), 0));
const partyOf = (d: DB, name: string) => d.parties.find((p) => p.name === name)!;

describe('hotel bills in the books', () => {
  it('a stay: deposit, charges, check-out, the rest paid — nobody owes, the money is in', () => {
    const { d, h, dbl, r1 } = setup();
    const a = today();
    const bk = h.saveBooking({ kind: 'individual', status: 'confirmed', source: 'Phone', arrive: a, depart: addDays(a, 2), rooms: [{ roomId: r1.id, typeId: dbl.id, rate: 100000, adults: 1, children: 0 }], roomsPaidBy: 'guest', guests: [guest], discount: 0 });
    const cash0 = taken(d);
    h.takeBookingPayment(bk.id, { amount: 50000, method: 'momo' });
    books(d, 'deposit');
    h.checkIn(bk.id);
    h.postCharge(bk.id, { desc: 'Laundry', amount: 15000 });
    books(d, 'in house');
    const out = h.checkOut(bk.id);
    books(d, 'checked out');
    const sale = d.sales.find((s) => s.id === out.guestSale)!;
    expect(logic.partyBalance(d, sale.partyId!)).toBe(215000 - 50000);
    logic.recordPayment(d, { partyId: sale.partyId!, amount: 165000, direction: 'in', accountId: 'acc_cash' });
    books(d, 'paid');
    expect(logic.partyBalance(d, sale.partyId!)).toBe(0);
    expect(taken(d) - cash0).toBe(215000);
  });

  it("a company's group: the rooms on the company's account, the extras on the guest's", () => {
    const { d, h, dbl, r1, r2: room2 } = setup();
    d.parties.push({ id: 'co1', name: 'MTN Uganda', type: 'customer', phone: '', openingBalance: 0, creditLimit: 0, points: 0, active: true } as any);
    const a = today();
    const bk = h.saveBooking({ kind: 'group', status: 'confirmed', source: 'Company', companyId: 'co1', groupName: 'MTN training', arrive: a, depart: addDays(a, 1), roomsPaidBy: 'company',
      rooms: [{ roomId: r1.id, typeId: dbl.id, rate: 100000, adults: 1, children: 0 }, { roomId: room2.id, typeId: dbl.id, rate: 100000, adults: 1, children: 0 }],
      guests: [guest, { name: 'Peter Okello', idNo: 'CM1', nationality: 'Ugandan' }], discount: 0 });
    h.checkIn(bk.id);
    h.postCharge(bk.id, { desc: 'Minibar', amount: 8000, payer: 'guest' });
    h.postCharge(bk.id, { desc: 'Conference tea', amount: 40000, payer: 'company' });
    h.takeBookingPayment(bk.id, { amount: 8000, method: 'cash' });
    const out = h.checkOut(bk.id);
    books(d, 'checked out');
    expect(logic.partyBalance(d, 'co1')).toBe(240000);
    const g = d.sales.find((s) => s.id === out.guestSale)!;
    expect(logic.partyBalance(d, g.partyId!)).toBe(0);
    logic.recordPayment(d, { partyId: 'co1', amount: 240000, direction: 'in', accountId: 'acc_bank' });
    books(d, 'company paid');
    expect(logic.partyBalance(d, 'co1')).toBe(0);
  });

  it('nights billed at the night audit and the rest at check-out add up to the stay, once', () => {
    const { d, h, dbl, r1 } = setup();
    const a = today();
    const bk = h.saveBooking({ kind: 'individual', status: 'confirmed', source: 'Walk-in', arrive: addDays(a, -2), depart: addDays(a, 1), rooms: [{ roomId: r1.id, typeId: dbl.id, rate: 100000, adults: 1, children: 0 }], roomsPaidBy: 'guest', guests: [guest], discount: 0 });
    h.checkIn(bk.id);
    h.nightAudit(addDays(a, -1));
    h.nightAudit(addDays(a, -1));
    books(d, 'after the night audit');
    h.postCharge(bk.id, { desc: 'Laundry', amount: 15000 });
    const out = h.checkOut(bk.id);
    books(d, 'checked out');
    const pid = d.sales.find((s) => s.id === out.guestSale)!.partyId!;
    const billed = r2(d.sales.filter((s) => s.partyId === pid && s.status !== 'void').reduce((t, s) => t + s.total, 0));
    expect(billed).toBe(3 * 100000 + 15000);
    expect(logic.partyBalance(d, pid)).toBe(billed);
    expect(folioOf(d, d.hotelBookings!.find((x) => x.id === bk.id)!).total).toBe(billed);
  });

  it('an event: deposit, closed to a bill, the rest paid', () => {
    const { d, h } = setup();
    const hall = h.saveSpace({ name: 'Nile Hall', capacity: 120, rateHour: 50000, rateHalfDay: 200000, rateDay: 350000, active: true });
    const day = today();
    const ev = h.saveEvent({ name: 'Board meeting', type: 'Meeting', status: 'tentative', contact: { name: 'Grace Atim', phone: '0700000009' }, from: day, to: day, attendees: 10,
      deposits: [], tasks: [], discount: 0,
      subEvents: [{ id: 's1', name: 'Meeting', spaceId: hall.id, date: day, start: '09:00', end: '13:00', setup: 'Boardroom', expected: 10, guaranteed: 10, actual: 0, pricePlan: 'hour', price: 0, serviceChargePct: 0, packages: [] }] } as any);
    h.takeEventPayment(ev.id, { amount: 80000, method: 'bank' });
    books(d, 'event deposit');
    const out = h.closeEvent(ev.id);
    books(d, 'event closed');
    const sale = d.sales.find((x) => x.id === out.saleId)!;
    expect(logic.partyBalance(d, sale.partyId!)).toBe(200000 - 80000);
    logic.recordPayment(d, { partyId: sale.partyId!, amount: 120000, direction: 'in', accountId: 'acc_cash' });
    books(d, 'event paid');
    expect(logic.partyBalance(d, sale.partyId!)).toBe(0);
  });

  it('a cancellation keeping a fee and refunding the rest: nobody owes, the fee is the money kept', () => {
    const { d, h, dbl, r1 } = setup();
    const a = today();
    const bk = h.saveBooking({ kind: 'individual', status: 'confirmed', source: 'Phone', arrive: addDays(a, 3), depart: addDays(a, 5), rooms: [{ roomId: r1.id, typeId: dbl.id, rate: 100000, adults: 1, children: 0 }], roomsPaidBy: 'guest', guests: [guest], discount: 0 });
    const cash0 = taken(d);
    h.takeBookingPayment(bk.id, { amount: 100000, method: 'cash' });
    h.endBooking(bk.id, { status: 'cancelled', fee: 30000, refund: 70000, method: 'cash', reason: 'Plans changed' });
    books(d, 'cancelled');
    const pid = partyOf(d, 'Jane Achieng').id;
    expect(r2(logic.partyBalance(d, pid))).toBe(0);
    expect(taken(d) - cash0).toBe(30000);
  });

  it('a refund an older version took off creditors is moved to debtors once, however often the book is opened', () => {
    const { d, h, dbl, r1 } = setup();
    const a = today();
    const bk = h.saveBooking({ kind: 'individual', status: 'confirmed', source: 'Phone', arrive: addDays(a, 3), depart: addDays(a, 5), rooms: [{ roomId: r1.id, typeId: dbl.id, rate: 100000, adults: 1, children: 0 }], roomsPaidBy: 'guest', guests: [guest], discount: 0 });
    h.takeBookingPayment(bk.id, { amount: 100000, method: 'cash' });
    h.endBooking(bk.id, { status: 'cancelled', fee: 30000, refund: 70000, method: 'cash', reason: 'Plans changed' });
    // as the older version left it
    const pay = d.payments.find((p) => p.direction === 'out' && p.amount === 70000)!;
    const e = d.journal.find((x) => x.ref === 'PAY' && x.ts === pay.ts)!;
    e.lines.forEach((l) => { if (l.acc === 'n_ar') l.acc = 'n_ap'; });
    const ap0 = net(d, 'n_ap');
    expect(logic.checkBooks(d).issues.filter((i) => i.ref === 'Refund')).toHaveLength(1);
    expect(logic.repairRefundControl(d)).toBe(1);
    expect(logic.repairRefundControl(d)).toBe(0);
    books(d, 'repaired');
    expect(net(d, 'n_ap') - ap0).toBe(-70000);
    expect(logic.checkBooks(d).issues.filter((i) => i.ref === 'Refund')).toHaveLength(0);
  });
});
