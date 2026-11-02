import { seed } from '../seed';
import { hotelActions } from '../actions/hotel';
import { priceStay, folioOf, freeRooms, dayAtDesk, guestRegister, addDays, today, nightsOf } from '../hotel';
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
});
