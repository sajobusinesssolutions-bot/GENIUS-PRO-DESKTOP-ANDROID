/**
 * HOTEL ACTIONS — the set-up (room types, rooms, rate plans, seasons, offers)
 * and the stay: book, confirm, check in, post charges, take payments, check
 * out, cancel. The provider hands in its commit and permission check, as for
 * the restaurant (actions/restaurant.ts).
 *
 * Check-out turns the bill into sales in the books: one for the guest, and on
 * a company booking one more for the company, on its account. What was paid
 * goes against the guest's sale; the company's is owed until the company pays.
 */
import type { MutableRefObject } from 'react';
import type { DB, Product, SaleLine, PayMethod } from '../types';
import { uid, iso } from '../uid';
import * as logic from '../logic';
import { Refusal } from '../refusal';
import {
  type Booking, type BookingStatus, type FolioCharge, type FolioPayment, type HotelSettings, type RatePlan, type Room, type RoomStatus,
  type RoomType, type Season, type StayOffer, checkInMissing, folioOf, nightsOf, roomFree, rooms,
} from '../hotel';

export interface HotelActions {
  saveRoomType: (t: Omit<RoomType, 'id'> & { id?: string }) => RoomType;
  saveRoom: (r: Omit<Room, 'id' | 'status'> & { id?: string; status?: RoomStatus }) => Room;
  saveRatePlan: (p: Omit<RatePlan, 'id'> & { id?: string }) => RatePlan;
  saveSeason: (s: Omit<Season, 'id'> & { id?: string }) => Season;
  saveStayOffer: (o: Omit<StayOffer, 'id'> & { id?: string }) => StayOffer;
  saveHotelSettings: (s: Partial<HotelSettings>) => void;
  setRoomStatus: (roomId: string, status: RoomStatus, note?: string) => void;
  saveBooking: (b: Omit<Booking, 'id' | 'no' | 'createdAt' | 'updatedAt' | 'charges' | 'payments'> & { id?: string }) => Booking;
  setBookingStatus: (id: string, status: Extract<BookingStatus, 'provisional' | 'confirmed' | 'cancelled' | 'noshow'>) => void;
  checkIn: (id: string) => void;
  postCharge: (id: string, c: { desc: string; amount: number; payer?: 'guest' | 'company' }) => void;
  removeCharge: (id: string, chargeId: string) => void;
  takeBookingPayment: (id: string, p: { amount: number; method: FolioPayment['method']; note?: string }) => void;
  checkOut: (id: string) => { guestSale?: string; companySale?: string };
}

const ROOM_ITEM = 'hotel_rooms';
const EXTRA_ITEM = 'hotel_extras';

/** The two service items a hotel bill is sold as: room nights, and everything else. */
function ensureItems(d: DB) {
  for (const [id, name, cat] of [[ROOM_ITEM, 'Room accommodation', 'Rooms'], [EXTRA_ITEM, 'Hotel services', 'Rooms']]) {
    if (d.products.some((p) => p.id === id)) continue;
    const p = {
      id, sku: id.toUpperCase(), name, unit: 'Night', category: cat, cost: 0, price: 0, taxRate: 0,
      stock: {}, reorder: 0, warrantyMonths: 0, barcodes: [], active: true, kind: 'service', trackInventory: false,
    } as unknown as Product;
    d.products.push(p);
    logic.enqueue(d, 'product', id);
  }
}
const line = (productId: string, name: string, price: number): SaleLine =>
  ({ productId, name, sku: productId.toUpperCase(), unit: 'Each', qty: 1, price, cost: 0, taxRate: 0 }) as SaleLine;

export function hotelActions(deps: {
  commit: (mut: (d: DB) => void) => void;
  requirePerm: (key: string) => void;
  dbRef: MutableRefObject<DB | null>;
}): HotelActions {
  const { commit, requirePerm } = deps;
  const save = <T extends { id: string }>(coll: string, kind: string, prefix: string, v: Omit<T, 'id'> & { id?: string }): T => {
    let out!: T;
    commit((d) => {
      const list: T[] = ((d as any)[coll] = (d as any)[coll] || []);
      const i = v.id ? list.findIndex((x) => x.id === v.id) : -1;
      out = { ...(i >= 0 ? list[i] : {}), ...v, id: i >= 0 ? list[i].id : uid(prefix) } as T;
      if (i >= 0) list[i] = out; else list.push(out);
      logic.enqueue(d, kind, out.id);
    });
    return out;
  };
  const touch = (id: string, mut: (b: Booking, d: DB) => void) => {
    commit((d) => {
      const b = (d.hotelBookings || []).find((x) => x.id === id);
      if (!b) throw new Refusal('That booking is not here any more.');
      mut(b, d);
      b.updatedAt = iso(new Date());
      logic.enqueue(d, 'booking', b.id);
    });
  };
  const who = (d: DB) => d.users.find((u) => u.id === d.session.userId)?.name || '';

  return {
    saveRoomType: (t) => {
      requirePerm('hotel.setup');
      if (!t.name.trim()) throw new Refusal('Give the room type a name.');
      return save<RoomType>('roomTypes', 'roomType', 'rtyp', { ...t, name: t.name.trim(), rate: Math.max(0, Number(t.rate) || 0) });
    },
    saveRoom: (r) => {
      requirePerm('hotel.setup');
      const no = r.no.trim();
      if (!no) throw new Refusal('Give the room a number or name.');
      const d = deps.dbRef.current;
      if (d && rooms(d).some((x) => x.no.toLowerCase() === no.toLowerCase() && x.id !== r.id)) throw new Refusal('There is already a room ' + no + '.');
      return save<Room>('rooms', 'room', 'room', { status: 'clean', ...r, no });
    },
    saveRatePlan: (p) => { requirePerm('hotel.setup'); if (!p.name.trim()) throw new Refusal('Give the rate plan a name.'); return save<RatePlan>('ratePlans', 'ratePlan', 'rpln', { ...p, name: p.name.trim() }); },
    saveSeason: (s) => {
      requirePerm('hotel.setup');
      if (!s.name.trim() || !s.from || !s.to) throw new Refusal('A season needs a name and both dates.');
      if (s.to < s.from) throw new Refusal('The season ends before it starts.');
      return save<Season>('seasons', 'season', 'seas', { ...s, name: s.name.trim() });
    },
    saveStayOffer: (o) => {
      requirePerm('hotel.setup');
      if (!(o.stay > o.pay && o.pay >= 1)) throw new Refusal('An offer is "stay more nights, pay fewer": stay must be more than pay.');
      return save<StayOffer>('stayOffers', 'stayOffer', 'soff', { ...o, name: o.name.trim() || 'Stay ' + o.stay + ', pay ' + o.pay });
    },
    saveHotelSettings: (s) => {
      requirePerm('hotel.setup');
      commit((d) => { (d.settings as any).hotel = { ...((d.settings as any).hotel || {}), ...s }; logic.enqueue(d, 'settings', 'settings'); });
    },
    setRoomStatus: (roomId, status, note) => {
      requirePerm('hotel.housekeeping');
      commit((d) => {
        const r = (d.rooms || []).find((x) => x.id === roomId);
        if (!r) return;
        r.status = status;
        if (note !== undefined) r.note = note;
        logic.enqueue(d, 'room', r.id);
      });
    },
    saveBooking: (b) => {
      requirePerm('hotel.book');
      const d0 = deps.dbRef.current!;
      if (!b.arrive || !b.depart || nightsOf(b.arrive, b.depart) < 1) throw new Refusal('The stay must be at least one night: departure after arrival.');
      if (!b.rooms.length) throw new Refusal('Choose at least one room.');
      if (!b.guests.length || !b.guests[0].name.trim()) throw new Refusal('Who is staying? Give the main guest’s name.');
      if (b.kind === 'group' && !b.companyId && !(b.groupName || '').trim()) throw new Refusal('Name the group, or choose the company it is for.');
      for (const r of b.rooms) {
        if (!roomFree(d0, r.roomId, b.arrive, b.depart, b.id)) {
          const no = rooms(d0).find((x) => x.id === r.roomId)?.no || 'A room';
          throw new Refusal('Room ' + no + ' is already booked for some of those nights.');
        }
      }
      let out!: Booking;
      commit((d) => {
        d.hotelBookings = d.hotelBookings || [];
        const now = iso(new Date());
        const i = b.id ? d.hotelBookings.findIndex((x) => x.id === b.id) : -1;
        if (i >= 0) {
          out = { ...d.hotelBookings[i], ...b, id: d.hotelBookings[i].id, updatedAt: now };
          d.hotelBookings[i] = out;
        } else {
          d.counters = d.counters || ({} as any);
          const n = ((d.counters as any).booking || 0) + 1;
          (d.counters as any).booking = n;
          out = { ...b, id: uid('bkg'), no: 'BK-' + String(10000 + n).slice(1), charges: [], payments: [], createdAt: now, updatedAt: now };
          d.hotelBookings.push(out);
        }
        logic.enqueue(d, 'booking', out.id);
      });
      return out;
    },
    setBookingStatus: (id, status) => {
      requirePerm(status === 'cancelled' || status === 'noshow' ? 'hotel.cancel' : 'hotel.book');
      touch(id, (b) => {
        if (b.status === 'in' || b.status === 'out') throw new Refusal('The guest has already checked in.');
        b.status = status;
      });
    },
    checkIn: (id) => {
      requirePerm('hotel.checkin');
      touch(id, (b, d) => {
        if (b.status !== 'confirmed' && b.status !== 'provisional') throw new Refusal('Only a booking not yet in can be checked in.');
        const missing = checkInMissing(b);
        if (missing.length) throw new Refusal('Before check-in, the guest register needs ' + missing.join(', ') + '.');
        for (const r of b.rooms) {
          const room = (d.rooms || []).find((x) => x.id === r.roomId);
          if (room?.status === 'ooo') throw new Refusal('Room ' + room.no + ' is out of order. Move the guest to another room first.');
        }
        b.status = 'in';
        b.checkedInAt = iso(new Date());
        // an early arrival starts the stay today
        const t = iso(new Date()).slice(0, 10);
        if (b.arrive.slice(0, 10) > t) b.arrive = t;
        logic.audit(d, 'Guest checked in', b.no + ' · ' + b.guests[0].name);
      });
    },
    postCharge: (id, c) => {
      requirePerm('hotel.charge');
      const amount = Math.round(Number(c.amount) || 0);
      if (!c.desc.trim() || !amount) throw new Refusal('A charge needs what it is for and an amount.');
      touch(id, (b, d) => {
        if (b.status === 'out' || b.status === 'cancelled' || b.status === 'noshow') throw new Refusal('This booking is closed.');
        if (amount < 0) requirePerm('hotel.discount');
        const ch: FolioCharge = { id: uid('chg'), ts: iso(new Date()), desc: c.desc.trim(), amount, payer: b.companyId ? c.payer || 'guest' : 'guest', by: who(d) };
        b.charges.push(ch);
      });
    },
    removeCharge: (id, chargeId) => {
      requirePerm('hotel.discount');
      touch(id, (b) => { b.charges = b.charges.filter((c) => c.id !== chargeId); });
    },
    takeBookingPayment: (id, p) => {
      requirePerm('hotel.checkout');
      const amount = Math.round(Number(p.amount) || 0);
      if (amount <= 0) throw new Refusal('Enter the amount received.');
      touch(id, (b, d) => {
        if (b.status === 'out' || b.status === 'cancelled') throw new Refusal('This booking is closed.');
        b.payments.push({ id: uid('pay'), ts: iso(new Date()), amount, method: p.method, note: p.note, by: who(d) });
        // a deposit confirms a provisional booking
        if (b.status === 'provisional') b.status = 'confirmed';
      });
    },
    checkOut: (id) => {
      requirePerm('hotel.checkout');
      const out: { guestSale?: string; companySale?: string } = {};
      commit((d) => {
        const b = (d.hotelBookings || []).find((x) => x.id === id);
        if (!b) throw new Refusal('That booking is not here any more.');
        if (b.status !== 'in') throw new Refusal('Only a guest in the house can be checked out.');
        ensureItems(d);
        const f = folioOf(d, b);
        const offerAndDiscount = f.stay.offer + f.discount;
        const roomLines = f.stay.lines.filter((l) => l.amount > 0).map((l) => line(ROOM_ITEM, l.desc, l.amount));
        const chargeLines = (payer: 'guest' | 'company') => b.charges.filter((c) => (b.companyId ? c.payer === payer : payer === 'guest'))
          .map((c) => line(EXTRA_ITEM, c.desc, c.amount));
        const companyRooms = !!b.companyId && b.roomsPaidBy === 'company';
        const guestLines = [...(companyRooms ? [] : roomLines), ...chargeLines('guest')];
        const companyLines = b.companyId ? [...(companyRooms ? roomLines : []), ...chargeLines('company')] : [];

        // the guest, as a customer in the books, so an unpaid balance is owed by someone
        const lead = b.guests[0];
        let partyId = b.partyId && d.parties.some((p) => p.id === b.partyId) ? b.partyId : null;
        if (!partyId && guestLines.length) {
          const same = d.parties.find((p) => p.type === 'customer' && p.name.toLowerCase() === lead.name.trim().toLowerCase() && (!lead.phone || p.phone === lead.phone));
          if (same) partyId = same.id;
          else {
            partyId = uid('pty');
            d.parties.push({ id: partyId, name: lead.name.trim(), type: 'customer', phone: lead.phone || '', openingBalance: 0, creditLimit: 0, points: 0, active: true, address: lead.address });
            logic.enqueue(d, 'party', partyId);
          }
          b.partyId = partyId;
        }
        const paid = b.payments.reduce((a, p) => a + p.amount, 0);
        const by = new Map<string, number>();
        b.payments.forEach((p) => by.set(p.method, (by.get(p.method) || 0) + p.amount));
        const main = ([...by.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] || 'cash') as FolioPayment['method'];
        const via: 'cash' | 'momo' | 'bank' = main === 'card' ? 'bank' : main;
        const note = 'Hotel ' + b.no + ' · ' + b.guests.map((g) => g.name).join(', ') + ' · ' + b.arrive.slice(0, 10) + ' to ' + iso(new Date()).slice(0, 10);

        // the discount and free nights come off whichever bill carries the rooms
        if (guestLines.length) {
          const discount = companyRooms ? 0 : offerAndDiscount;
          const total = guestLines.reduce((a, l) => a + l.price, 0) - discount;
          const methods = [...by.entries()].filter(([, v]) => v > 0);
          const fullyPaid = paid >= total - 0.5;
          const one = methods.length <= 1;
          const sale = logic.commitSale(d, {
            lines: guestLines, partyId, discount, description: note,
            method: fullyPaid && one ? (via as PayMethod) : 'credit',
            ...(fullyPaid && !one ? { method: 'cash' as PayMethod, methods: methods.map(([m, v]) => ({ method: (m === 'card' ? 'bank' : m) as PayMethod, amount: v })).map((m, i, arr) => (i === arr.length - 1 ? { ...m, amount: m.amount - (paid - total) } : m)) } : {}),
            ...(!fullyPaid ? { received: paid, receivedVia: via } : {}),
          });
          out.guestSale = sale.id;
          b.saleId = sale.id;
        }
        if (companyLines.length && b.companyId) {
          const discount = companyRooms ? offerAndDiscount : 0;
          const sale = logic.commitSale(d, { lines: companyLines, partyId: b.companyId, discount, description: note + ' · company account', method: 'credit' });
          out.companySale = sale.id;
        }
        b.status = 'out';
        b.checkedOutAt = iso(new Date());
        b.updatedAt = b.checkedOutAt;
        // the rooms need cleaning before the next guest
        for (const r of b.rooms) {
          const room = (d.rooms || []).find((x) => x.id === r.roomId);
          if (room && room.status !== 'ooo') { room.status = 'dirty'; logic.enqueue(d, 'room', room.id); }
        }
        logic.enqueue(d, 'booking', b.id);
        logic.audit(d, 'Guest checked out', b.no + ' · ' + lead.name);
      });
      return out;
    },
  };
}

