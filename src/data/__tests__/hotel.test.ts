import { seed } from '../seed';
import { hotelActions } from '../actions/hotel';
import { priceStay, folioOf, freeRooms, dayAtDesk, guestRegister, addDays, today, nightsOf, folioLines, revenueSummary, taxesOf, eventTotals, eventsDesk } from '../hotel';
import { isRestaurant } from '../restaurant';
import { editionOf, servesFood } from '../editions';
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

describe('hotel edition', () => {
  it('is a restaurant as well', () => {
    const d: any = { firm: { businessType: 'hotel' } };
    expect(editionOf(d)).toBe('hotel');
    expect(isRestaurant(d)).toBe(true);
    expect(servesFood('hotel')).toBe(true);
  });

  it('prices nights with a season, a rate plan and a stay offer', () => {
    const { d, h, dbl, r1 } = setup();
    const a = today(), b = addDays(a, 3);
    h.saveSeason({ name: 'Festive', from: a, to: addDays(a, 0), pct: 20, active: true });
    const bb = h.saveRatePlan({ name: 'Bed & breakfast', perNight: 0, perPerson: 10000, active: true });
    h.saveStayOffer({ name: 'Stay 3 pay 2', from: a, to: addDays(a, 30), stay: 3, pay: 2, active: true });
    const p = priceStay(d, { arrive: a, depart: b, ratePlanId: bb.id, rooms: [{ roomId: r1.id, typeId: dbl.id, rate: 100000, adults: 2, children: 0 }] });
    // night 1: 120,000 + 20,000 breakfast; nights 2–3: 100,000 + 20,000; the cheapest night is free
    expect(p.rooms).toBe(140000 + 120000 + 120000);
    expect(p.offer).toBe(120000);
    expect(p.total).toBe(260000);
  });

  it('will not book a room twice for the same night', () => {
    const { h, dbl, r1 } = setup();
    const a = today();
    h.saveBooking({ kind: 'individual', status: 'confirmed', source: 'Walk-in', arrive: a, depart: addDays(a, 2), rooms: [{ roomId: r1.id, typeId: dbl.id, rate: 100000, adults: 1, children: 0 }], roomsPaidBy: 'guest', guests: [guest], discount: 0 });
    expect(() => h.saveBooking({ kind: 'individual', status: 'confirmed', source: 'Phone', arrive: addDays(a, 1), depart: addDays(a, 3), rooms: [{ roomId: r1.id, typeId: dbl.id, rate: 100000, adults: 1, children: 0 }], roomsPaidBy: 'guest', guests: [{ name: 'Tom' }], discount: 0 })).toThrow(/already booked/);
  });

  it('checks in with the register, bills extras, takes a deposit and checks out to a sale', () => {
    const { d, h, dbl, r1, r2 } = setup();
    const a = today();
    const bk = h.saveBooking({ kind: 'individual', status: 'provisional', source: 'WhatsApp', arrive: a, depart: addDays(a, 2), rooms: [{ roomId: r1.id, typeId: dbl.id, rate: 100000, adults: 1, children: 0 }], roomsPaidBy: 'guest', guests: [{ name: 'Jane Achieng' }], discount: 0 });
    expect(freeRooms(d, a, addDays(a, 2)).map((r) => r.id)).toEqual([r2.id]);
    expect(() => h.checkIn(bk.id)).toThrow(/ID or passport/);
    h.saveBooking({ ...d.hotelBookings!.find((x) => x.id === bk.id)!, guests: [guest] });
    h.takeBookingPayment(bk.id, { amount: 50000, method: 'momo' });
    expect(d.hotelBookings![0].status).toBe('confirmed');
    h.checkIn(bk.id);
    expect(dayAtDesk(d).inHouse).toHaveLength(1);
    expect(dayAtDesk(d).occupancy).toBe(50);
    h.postCharge(bk.id, { desc: 'Laundry', amount: 15000 });
    expect(folioOf(d, d.hotelBookings![0]).balance).toBe(200000 + 15000 - 50000);
    const sales = d.sales.length;
    const out = h.checkOut(bk.id);
    expect(d.sales.length).toBe(sales + 1);
    const sale = d.sales.find((s) => s.id === out.guestSale)!;
    expect(sale.total).toBe(215000);
    expect(sale.due).toBe(165000);
    expect(d.parties.find((p) => p.id === sale.partyId)!.name).toBe('Jane Achieng');
    expect(d.rooms!.find((r) => r.id === r1.id)!.status).toBe('dirty');
    expect(guestRegister(d, a, a)[0]).toMatchObject({ name: 'Jane Achieng', nationality: 'Ugandan', idNo: 'CF900', rooms: '101' });
  });

  it('splits a company group: rooms to the company, extras to the guest', () => {
    const { d, h, dbl, r1, r2 } = setup();
    const company = { id: 'co1', name: 'MTN Uganda', type: 'customer', phone: '', openingBalance: 0, creditLimit: 0, points: 0, active: true } as any;
    d.parties.push(company);
    const a = today();
    const bk = h.saveBooking({
      kind: 'group', status: 'confirmed', source: 'Company', companyId: 'co1', groupName: 'MTN training', arrive: a, depart: addDays(a, 1), roomsPaidBy: 'company',
      rooms: [{ roomId: r1.id, typeId: dbl.id, rate: 100000, adults: 1, children: 0 }, { roomId: r2.id, typeId: dbl.id, rate: 100000, adults: 1, children: 0 }],
      guests: [guest, { name: 'Peter Okello', idNo: 'CM1', nationality: 'Ugandan' }], discount: 0,
    });
    h.checkIn(bk.id);
    h.postCharge(bk.id, { desc: 'Minibar', amount: 8000, payer: 'guest' });
    h.postCharge(bk.id, { desc: 'Conference tea', amount: 40000, payer: 'company' });
    const f = folioOf(d, d.hotelBookings![0]);
    expect(f.companyPart).toBe(240000);
    expect(f.guestPart).toBe(8000);
    h.takeBookingPayment(bk.id, { amount: 8000, method: 'cash' });
    const out = h.checkOut(bk.id);
    expect(d.sales.find((s) => s.id === out.companySale)).toMatchObject({ partyId: 'co1', total: 240000, due: 240000 });
    expect(d.sales.find((s) => s.id === out.guestSale)).toMatchObject({ total: 8000, due: 0 });
    expect(nightsOf(a, addDays(a, 1))).toBe(1);
  });

  it('takes a deposit into the books on the day, and applies it to the bill and a meal at check-out', () => {
    const { d, h, dbl, r1 } = setup();
    const a = today();
    const bk = h.saveBooking({ kind: 'individual', status: 'confirmed', source: 'Phone', arrive: a, depart: addDays(a, 1), rooms: [{ roomId: r1.id, typeId: dbl.id, rate: 100000, adults: 1, children: 0 }], roomsPaidBy: 'guest', guests: [guest], discount: 0 });
    const pays = d.payments.length;
    h.takeBookingPayment(bk.id, { amount: 130000, method: 'cash' });
    expect(d.payments.length).toBe(pays + 1);
    const receipt = d.payments[d.payments.length - 1];
    expect(receipt).toMatchObject({ direction: 'in', amount: 130000, unapplied: 130000 });
    h.checkIn(bk.id);
    // a dinner charged to the room: a sale on the guest's account now, shown on the bill
    const partyId = h.roomGuestParty(bk.id);
    const meal = (require('../logic') as typeof import('../logic')).commitSale(d, { lines: [{ productId: 'x', name: 'Dinner', sku: 'X', unit: 'Plate', qty: 1, price: 25000, cost: 0, taxRate: 0 } as any], partyId, method: 'credit', discount: 0 });
    h.billSaleToRoom(bk.id, meal.id, 'Restaurant ' + meal.no, meal.total);
    expect(folioOf(d, d.hotelBookings![0]).total).toBe(125000);
    const out = h.checkOut(bk.id);
    const room = d.sales.find((s) => s.id === out.guestSale)!;
    expect(room.total).toBe(100000);
    expect(room.due).toBe(0);
    expect(d.sales.find((s) => s.id === meal.id)!.due).toBe(0);
    // 5,000 over stays on the guest's account
    expect(d.payments.find((p) => p.id === receipt.id)!.unapplied).toBe(5000);
  });

  it('the night audit lets expired holds go and marks no-shows; a guest can move room', () => {
    const { d, h, dbl, r1, r2 } = setup();
    const y = addDays(today(), -1);
    const late = h.saveBooking({ kind: 'individual', status: 'confirmed', source: 'Phone', arrive: y, depart: addDays(y, 2), rooms: [{ roomId: r1.id, typeId: dbl.id, rate: 1, adults: 1, children: 0 }], roomsPaidBy: 'guest', guests: [{ name: 'Late' }], discount: 0 });
    const held = h.saveBooking({ kind: 'individual', status: 'provisional', holdUntil: y, source: 'Phone', arrive: addDays(today(), 5), depart: addDays(today(), 6), rooms: [{ roomId: r2.id, typeId: dbl.id, rate: 1, adults: 1, children: 0 }], roomsPaidBy: 'guest', guests: [{ name: 'Held' }], discount: 0 });
    expect(h.nightAudit()).toMatchObject({ released: 1, noShows: 1 });
    expect(d.hotelBookings!.find((b) => b.id === late.id)!.status).toBe('noshow');
    expect(d.hotelBookings!.find((b) => b.id === held.id)!.status).toBe('cancelled');
    const bk = h.saveBooking({ kind: 'individual', status: 'confirmed', source: 'Walk-in', arrive: today(), depart: addDays(today(), 1), rooms: [{ roomId: r1.id, typeId: dbl.id, rate: 1, adults: 1, children: 0 }], roomsPaidBy: 'guest', guests: [guest], discount: 0 });
    h.checkIn(bk.id);
    h.moveRoom(bk.id, r1.id, r2.id);
    expect(d.hotelBookings!.find((b) => b.id === bk.id)!.rooms[0].roomId).toBe(r2.id);
    expect(d.rooms!.find((r) => r.id === r1.id)!.status).toBe('dirty');
  });

  it('shows VAT inside the rate by default, and adds it (and a levy) on top when rates exclude tax', () => {
    const { d, h, dbl, r1 } = setup();
    const a = today();
    const bk = h.saveBooking({ kind: 'individual', status: 'confirmed', source: 'Walk-in', arrive: a, depart: addDays(a, 2), rooms: [{ roomId: r1.id, typeId: dbl.id, rate: 118000, adults: 1, children: 0 }], roomsPaidBy: 'guest', guests: [guest], discount: 0 });
    let b = d.hotelBookings!.find((x) => x.id === bk.id)!;
    expect(folioOf(d, b).total).toBe(236000);
    expect(taxesOf(d, b).included).toBe(36000);
    h.saveHotelSettings({ ratesIncludeTax: false, taxes: [{ id: 'vat', name: 'VAT 18%', pct: 18, on: ['room', 'charges'], active: true }, { id: 'levy', name: 'Tourism levy', perNight: 2000, on: ['room'], active: true }] });
    b = d.hotelBookings!.find((x) => x.id === bk.id)!;
    // 236,000 + 18% (42,480) + 2 nights × 2,000
    expect(folioOf(d, b).total).toBe(236000 + 42480 + 4000);
    const lines = folioLines(d, b);
    expect(lines.filter((l) => l.kind === 'room')).toHaveLength(2);
    expect(lines[lines.length - 1].balance).toBe(folioOf(d, b).balance);
    h.checkIn(bk.id);
    const out = h.checkOut(bk.id);
    expect(d.sales.find((x) => x.id === out.guestSale)!.total).toBe(236000 + 42480 + 4000);
  });

  it('moves a charge to another guest, and sums revenue by charge type', () => {
    const { d, h, dbl, r1, r2 } = setup();
    const a = today();
    const one = h.saveBooking({ kind: 'individual', status: 'confirmed', source: 'Walk-in', arrive: a, depart: addDays(a, 1), rooms: [{ roomId: r1.id, typeId: dbl.id, rate: 100000, adults: 1, children: 0 }], roomsPaidBy: 'guest', guests: [guest], discount: 0 });
    const two = h.saveBooking({ kind: 'individual', status: 'confirmed', source: 'Walk-in', arrive: a, depart: addDays(a, 1), rooms: [{ roomId: r2.id, typeId: dbl.id, rate: 100000, adults: 1, children: 0 }], roomsPaidBy: 'guest', guests: [{ ...guest, name: 'Tom Okello', idNo: 'X2' }], discount: 0 });
    h.checkIn(one.id); h.checkIn(two.id);
    h.postCharge(one.id, { desc: 'Dinner', amount: 30000, chargeTypeId: 'FD' });
    const c = d.hotelBookings!.find((x) => x.id === one.id)!.charges[0];
    h.transferCharge(one.id, c.id, two.id);
    expect(d.hotelBookings!.find((x) => x.id === one.id)!.charges).toHaveLength(0);
    expect(d.hotelBookings!.find((x) => x.id === two.id)!.charges[0]).toMatchObject({ amount: 30000, kind: 'transfer' });
    const rev = revenueSummary(d, a, a);
    expect(rev.rows.find((r) => r.code === 'RR')!.gross).toBe(200000);
    expect(rev.rows.find((r) => r.code === '3005')!.gross).toBe(30000);
    expect(Math.abs(rev.totals.tax - Math.round(230000 - 230000 / 1.18))).toBeLessThanOrEqual(1);
  });

  it('prices an event, refuses a clash, takes a deposit and bills it at the close', () => {
    const { d, h } = setup();
    const hall = h.saveSpace({ name: 'Nile Hall', capacity: 120, rateHour: 50000, rateHalfDay: 200000, rateDay: 350000, active: true });
    const lunch = h.savePackage({ name: 'Lunch buffet', category: 'FNB', perPerson: 25000, flat: 0, serviceChargePct: 10, active: true });
    const day = today();
    const base = { name: 'MTN board meeting', type: 'Meeting', status: 'tentative' as const, contact: { name: 'Grace Atim', phone: '0700000009' }, from: day, to: day, attendees: 20,
      deposits: [{ id: 'd1', due: day, amount: 300000 }], tasks: [], discount: 0,
      subEvents: [{ id: 's1', name: 'Board meeting', spaceId: hall.id, date: day, start: '09:00', end: '13:00', setup: 'Boardroom' as const, expected: 20, guaranteed: 20, actual: 0,
        pricePlan: 'hour' as const, price: 0, serviceChargePct: 0, packages: [{ packageId: lunch.id, name: lunch.name, qty: 0, price: 25000, perPerson: true, serviceChargePct: 10 }] }] };
    const ev = h.saveEvent(base);
    const t = eventTotals(d, d.hotelEvents![0]);
    // 4 hours × 50,000 + 20 × 25,000 lunch + 10% service on lunch
    expect(t.space).toBe(200000);
    expect(t.packages).toBe(500000);
    expect(t.service).toBe(50000);
    expect(t.total).toBe(750000);
    expect(eventsDesk(d).depositsDue).toHaveLength(1);
    expect(() => h.saveEvent({ ...base, name: 'Wedding', subEvents: [{ ...base.subEvents[0], id: 's2', start: '12:00', end: '15:00' }] })).toThrow(/taken/);
    h.takeEventPayment(ev.id, { amount: 300000, method: 'bank' });
    expect(d.hotelEvents![0].status).toBe('confirmed');
    const out = h.closeEvent(ev.id);
    const sale = d.sales.find((x) => x.id === out.saleId)!;
    expect(sale.total).toBe(750000);
    expect(sale.due).toBe(450000);
    expect(d.hotelEvents![0].status).toBe('closed');
  });
});
