/**
 * HOTEL ACTIONS — the set-up (room types, rooms, rate plans, seasons, offers)
 * and the stay: book, confirm, check in, post charges, take payments, check
 * out, cancel, the night audit and housekeeping. The provider hands in its
 * commit and permission check, as for the restaurant (actions/restaurant.ts).
 *
 * How the money reaches the books:
 *   · A deposit or payment is a receipt from the guest the moment it is
 *     taken: it is in that day's cash book and drawer, held on the guest's
 *     account (the guest is a customer in the books from the first payment).
 *   · A meal charged to the room is a sale at once, on the guest's account,
 *     so the kitchen's stock and the restaurant's takings are right that day;
 *     the room bill shows it as already billed.
 *   · Check-out turns the rest of the bill into a sale for the guest (and on
 *     a company booking one for the company, on its account), then applies
 *     the money held to the room bill and the meals. What is left owing stays
 *     on the guest's or company's account like any customer balance.
 */
import type { MutableRefObject } from 'react';
import type { DB, Product, SaleLine } from '../types';
import { uid, iso } from '../uid';
import * as logic from '../logic';
import { Refusal } from '../refusal';
import {
  type Booking, type BookingStatus, type FolioPayment, type HotelSettings, type RatePlan, type Room, type RoomStatus,
  type RoomType, type Season, type StayOffer, taxesOf, checkInMissing, folioOf, nightsOf, roomFree, rooms, today,
} from '../hotel';

export interface HotelActions {
  saveRoomType: (t: Omit<RoomType, 'id'> & { id?: string }) => RoomType;
  saveRoom: (r: Omit<Room, 'id' | 'status'> & { id?: string; status?: RoomStatus }) => Room;
  saveRatePlan: (p: Omit<RatePlan, 'id'> & { id?: string }) => RatePlan;
  saveSeason: (s: Omit<Season, 'id'> & { id?: string }) => Season;
  saveStayOffer: (o: Omit<StayOffer, 'id'> & { id?: string }) => StayOffer;
  saveHotelSettings: (s: Partial<HotelSettings>) => void;
  setRoomStatus: (roomId: string, status: RoomStatus, note?: string) => void;
  assignRoom: (roomId: string, who: string) => void;
  reportFault: (roomId: string, text: string, outOfOrder: boolean) => void;
  fixFault: (roomId: string) => void;
  saveBooking: (b: Omit<Booking, 'id' | 'no' | 'createdAt' | 'updatedAt' | 'charges' | 'payments'> & { id?: string }) => Booking;
  setBookingStatus: (id: string, status: Extract<BookingStatus, 'provisional' | 'confirmed' | 'cancelled' | 'noshow'>) => void;
  moveRoom: (id: string, fromRoomId: string, toRoomId: string) => void;
  checkIn: (id: string) => void;
  postCharge: (id: string, c: { desc: string; amount: number; payer?: 'guest' | 'company'; chargeTypeId?: string; kind?: 'charge' | 'adjust'; note?: string }) => void;
  /** Moves a charge to another guest in the house (a dinner signed to the wrong room). */
  transferCharge: (fromId: string, chargeId: string, toId: string) => void;
  removeCharge: (id: string, chargeId: string) => void;
  takeBookingPayment: (id: string, p: { amount: number; method: FolioPayment['method']; note?: string }) => void;
  /** The guest's customer record, made if needed: a meal charged to the room is sold on it. */
  roomGuestParty: (id: string) => string;
  /** A sale already made on the guest's account (a meal), shown on the room bill. */
  billSaleToRoom: (id: string, saleId: string, desc: string, amount: number) => void;
  checkOut: (id: string) => { guestSale?: string; companySale?: string };
  /** End of the hotel day: provisional holds let go, no-shows marked. */
  nightAudit: (day?: string) => { released: number; noShows: number; dueOut: number };
}

const ROOM_ITEM = 'hotel_rooms';
const EXTRA_ITEM = 'hotel_extras';

/** The two service items a hotel bill is sold as: room nights, and everything else. */
function ensureItems(d: DB) {
  for (const [id, name, unit] of [[ROOM_ITEM, 'Room accommodation', 'Night'], [EXTRA_ITEM, 'Hotel services', 'Each']]) {
    if (d.products.some((p) => p.id === id)) continue;
    const p = {
      id, sku: id.toUpperCase(), name, unit, category: 'Rooms', cost: 0, price: 0, taxRate: 0,
      stock: {}, reorder: 0, warrantyMonths: 0, barcodes: [], active: true, kind: 'service', trackInventory: false,
    } as unknown as Product;
    d.products.push(p);
    logic.enqueue(d, 'product', id);
  }
}
const line = (productId: string, name: string, price: number): SaleLine =>
  ({ productId, name, sku: productId.toUpperCase(), unit: 'Each', qty: 1, price, cost: 0, taxRate: 0 }) as SaleLine;

/** The money account a payment method lands in: the drawer, mobile money, or the bank. */
function accountFor(d: DB, m: FolioPayment['method']): string {
  const want = m === 'cash' ? 'cash' : m === 'momo' ? 'wallet' : 'bank';
  const branch = d.session?.warehouse;
  const fits = d.accounts.filter((a) => a.type === want && (!a.branch || a.branch === branch));
  return (fits[0] || d.accounts.find((a) => a.type === want) || d.accounts.find((a) => a.id === (want === 'bank' ? 'acc_bank' : 'acc_cash')) || d.accounts[0]).id;
}

/** The guest as a customer in the books: their own record, one with the same name and phone, or a new one. */
function guestParty(d: DB, b: Booking): string {
  if (b.partyId && d.parties.some((p) => p.id === b.partyId)) return b.partyId;
  const lead = b.guests[0];
  if (!lead || !lead.name.trim()) throw new Refusal('The booking needs the main guest’s name first.');
  const same = d.parties.find((p) => p.type === 'customer' && p.name.toLowerCase() === lead.name.trim().toLowerCase() && (!lead.phone || !p.phone || p.phone === lead.phone));
  let id: string;
  if (same) id = same.id;
  else {
    id = uid('pty');
    d.parties.push({ id, name: lead.name.trim(), type: 'customer', phone: lead.phone || '', openingBalance: 0, creditLimit: 0, points: 0, active: true, address: lead.address });
    logic.enqueue(d, 'party', id);
  }
  b.partyId = id;
  return id;
}

/** Applies money held on account (a payment's unapplied part) to the given sales, in order — as recordPayment would have. */
function applyHeld(d: DB, payIds: string[], saleIds: string[]) {
  const sales = saleIds.map((id) => d.sales.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s && s.due > 0.005);
  for (const pid of payIds) {
    const pay = d.payments.find((p) => p.id === pid);
    if (!pay || !(pay.unapplied! > 0.005)) continue;
    let left = pay.unapplied!;
    const allocs = [...(pay.allocations || [])];
    for (const s of sales) {
      if (left <= 0.005) break;
      const take = Math.min(left, s.due);
      if (take <= 0.005) continue;
      s.due = Math.round((s.due - take) * 100) / 100; s.paid = Math.round((s.paid + take) * 100) / 100;
      s.receipts = [...(s.receipts || []), { paymentId: pay.id, amount: take, ts: pay.ts }];
      allocs.push({ docId: s.id, no: s.no, amount: take });
      left -= take;
      logic.enqueue(d, 'sale', s.id);
    }
    pay.allocations = allocs;
    pay.unapplied = left > 0.005 ? Math.round(left * 100) / 100 : 0;
    logic.enqueue(d, 'payment', pay.id);
  }
}

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
  const room = (d: DB, id: string, mut: (r: Room) => void) => {
    const r = (d.rooms || []).find((x) => x.id === id);
    if (!r) return;
    mut(r);
    logic.enqueue(d, 'room', r.id);
  };
  const who = (d: DB) => d.users.find((u) => u.id === d.session.userId)?.name || '';
  const open = (b: Booking) => { if (b.status === 'out' || b.status === 'cancelled' || b.status === 'noshow') throw new Refusal('This booking is closed.'); };

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
      // one shared record, so every phone and the computer tax and print alike
      commit((d) => {
        d.hotelConfig = d.hotelConfig || [];
        const i = d.hotelConfig.findIndex((x) => x.id === 'config');
        const next = { ...(i >= 0 ? d.hotelConfig[i] : (d.settings as any).hotel || {}), ...s, id: 'config' };
        if (i >= 0) d.hotelConfig[i] = next; else d.hotelConfig.push(next);
        logic.enqueue(d, 'hotelConfig', 'config');
      });
    },
    setRoomStatus: (roomId, status, note) => {
      requirePerm('hotel.housekeeping');
      commit((d) => room(d, roomId, (r) => {
        r.status = status;
        if (note !== undefined) r.note = note;
        // a cleaned room is no one's job any more
        if (status === 'clean' || status === 'inspected') r.assignee = undefined;
      }));
    },
    assignRoom: (roomId, name) => {
      requirePerm('hotel.housekeeping');
      commit((d) => room(d, roomId, (r) => { r.assignee = name.trim() || undefined; }));
    },
    reportFault: (roomId, text, outOfOrder) => {
      requirePerm('hotel.housekeeping');
      if (!text.trim()) throw new Refusal('Say what is wrong.');
      commit((d) => room(d, roomId, (r) => {
        r.maintenance = [...(r.maintenance || []), { ts: iso(new Date()), text: text.trim() }];
        if (outOfOrder) r.status = 'ooo';
        logic.audit(d, 'Room fault reported', 'Room ' + r.no + ': ' + text.trim());
      }));
    },
    fixFault: (roomId) => {
      requirePerm('hotel.housekeeping');
      commit((d) => room(d, roomId, (r) => {
        const now = iso(new Date());
        r.maintenance = (r.maintenance || []).map((m) => (m.fixed ? m : { ...m, fixed: now }));
        if (r.status === 'ooo') r.status = 'dirty';
      }));
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
        // the rooming list: a guest whose room is no longer on the booking goes back to unassigned
        const guests = b.guests.map((g) => (g.roomId && !b.rooms.some((r) => r.roomId === g.roomId) ? { ...g, roomId: undefined } : g));
        if (i >= 0) {
          out = { ...d.hotelBookings[i], ...b, guests, id: d.hotelBookings[i].id, updatedAt: now };
          d.hotelBookings[i] = out;
        } else {
          d.counters = d.counters || ({} as any);
          const n = ((d.counters as any).booking || 0) + 1;
          (d.counters as any).booking = n;
          out = { ...b, guests, id: uid('bkg'), no: 'BK-' + String(10000 + n).slice(1), charges: [], payments: [], createdAt: now, updatedAt: now };
          d.hotelBookings.push(out);
        }
        logic.enqueue(d, 'booking', out.id);
      });
      return out;
    },
    setBookingStatus: (id, status) => {
      requirePerm(status === 'cancelled' || status === 'noshow' ? 'hotel.cancel' : 'hotel.book');
      touch(id, (b, d) => {
        if (b.status === 'in' || b.status === 'out') throw new Refusal('The guest has already checked in.');
        b.status = status;
        if (status === 'cancelled' || status === 'noshow') logic.audit(d, status === 'noshow' ? 'Booking no-show' : 'Booking cancelled', b.no);
      });
    },
    moveRoom: (id, fromRoomId, toRoomId) => {
      requirePerm('hotel.book');
      const d0 = deps.dbRef.current!;
      const b0 = (d0.hotelBookings || []).find((x) => x.id === id);
      if (!b0) throw new Refusal('That booking is not here any more.');
      // from tonight on, the new room must be free
      const from = b0.status === 'in' ? today() : b0.arrive.slice(0, 10);
      if (!roomFree(d0, toRoomId, from > b0.arrive ? from : b0.arrive, b0.depart, id)) throw new Refusal('That room is taken for some of the nights left.');
      touch(id, (b, d) => {
        const r = b.rooms.find((x) => x.roomId === fromRoomId);
        if (!r) throw new Refusal('That room is not on this booking.');
        const to = (d.rooms || []).find((x) => x.id === toRoomId);
        if (!to) throw new Refusal('No such room.');
        if (to.status === 'ooo') throw new Refusal('Room ' + to.no + ' is out of order.');
        r.roomId = toRoomId; r.typeId = to.typeId;
        b.guests = b.guests.map((g) => (g.roomId === fromRoomId ? { ...g, roomId: toRoomId } : g));
        // the room left behind needs cleaning if the guest was in it
        if (b.status === 'in') room(d, fromRoomId, (x) => { if (x.status !== 'ooo') x.status = 'dirty'; });
        logic.audit(d, 'Guest moved room', b.no + ' → ' + to.no);
      });
    },
    checkIn: (id) => {
      requirePerm('hotel.checkin');
      touch(id, (b, d) => {
        if (b.status !== 'confirmed' && b.status !== 'provisional') throw new Refusal('Only a booking not yet in can be checked in.');
        const missing = checkInMissing(b);
        if (missing.length) throw new Refusal('Before check-in, the guest register needs ' + missing.join(', ') + '.');
        for (const r of b.rooms) {
          const rm = (d.rooms || []).find((x) => x.id === r.roomId);
          if (rm?.status === 'ooo') throw new Refusal('Room ' + rm.no + ' is out of order. Move the guest to another room first.');
        }
        b.status = 'in';
        b.checkedInAt = iso(new Date());
        // an early arrival starts the stay today
        const t = today();
        if (b.arrive.slice(0, 10) > t) b.arrive = t;
        guestParty(d, b);
        logic.audit(d, 'Guest checked in', b.no + ' · ' + b.guests[0].name);
      });
    },
    postCharge: (id, c) => {
      requirePerm('hotel.charge');
      const amount = Math.round(Number(c.amount) || 0);
      if (!c.desc.trim() || !amount) throw new Refusal('A charge needs what it is for and an amount.');
      if (amount < 0) requirePerm('hotel.discount');
      touch(id, (b, d) => {
        open(b);
        b.charges.push({ id: uid('chg'), ts: iso(new Date()), desc: c.desc.trim(), amount, payer: b.companyId ? c.payer || 'guest' : 'guest', by: who(d),
          ...(c.chargeTypeId ? { chargeTypeId: c.chargeTypeId } : {}), ...(c.kind === 'adjust' || amount < 0 ? { kind: 'adjust' as const } : {}), ...(c.note ? { note: c.note } : {}) });
      });
    },
    transferCharge: (fromId, chargeId, toId) => {
      requirePerm('hotel.charge');
      if (fromId === toId) return;
      commit((d) => {
        const all = d.hotelBookings || [];
        const a = all.find((x) => x.id === fromId), b = all.find((x) => x.id === toId);
        if (!a || !b) throw new Refusal('That booking is not here any more.');
        if (b.status !== 'in') throw new Refusal('A charge can only move to a guest in the house.');
        const c = a.charges.find((x) => x.id === chargeId);
        if (!c) throw new Refusal('That charge is not on this bill.');
        if (c.saleId) throw new Refusal('This is a sale in the books already and stays with its guest.');
        const fromRooms = a.rooms.map((r) => (d.rooms || []).find((x) => x.id === r.roomId)?.no).join(', ');
        const toRooms = b.rooms.map((r) => (d.rooms || []).find((x) => x.id === r.roomId)?.no).join(', ');
        a.charges = a.charges.filter((x) => x.id !== chargeId);
        b.charges.push({ ...c, id: uid('chg'), kind: 'transfer', payer: 'guest', note: 'from room ' + fromRooms + ', ' + a.no });
        const now = iso(new Date());
        a.updatedAt = now; b.updatedAt = now;
        logic.enqueue(d, 'booking', a.id); logic.enqueue(d, 'booking', b.id);
        logic.audit(d, 'Charge transferred', c.desc + ' ' + c.amount + ': room ' + fromRooms + ' → ' + toRooms);
      });
    },
    removeCharge: (id, chargeId) => {
      requirePerm('hotel.discount');
      touch(id, (b) => {
        const c = b.charges.find((x) => x.id === chargeId);
        if (c?.saleId) throw new Refusal('This is a sale in the books already: void it from Sales instead.');
        b.charges = b.charges.filter((x) => x.id !== chargeId);
      });
    },
    takeBookingPayment: (id, p) => {
      requirePerm('hotel.checkout');
      const amount = Math.round(Number(p.amount) || 0);
      if (amount <= 0) throw new Refusal('Enter the amount received.');
      touch(id, (b, d) => {
        open(b);
        // a receipt in the books today, held on the guest's account until check-out
        const partyId = guestParty(d, b);
        const pay = logic.recordPayment(d, { partyId, amount, direction: 'in', accountId: accountFor(d, p.method), onAccount: true, note: 'Hotel ' + b.no + (b.status === 'in' ? '' : ' · deposit') + (p.note ? ' · ' + p.note : '') });
        b.payments.push({ id: uid('fpay'), ts: iso(new Date()), amount, method: p.method, note: p.note, by: who(d), paymentId: pay.id });
        // a deposit confirms a provisional booking
        if (b.status === 'provisional') b.status = 'confirmed';
      });
    },
    roomGuestParty: (id) => {
      let partyId = '';
      touch(id, (b, d) => {
        if (b.status !== 'in') throw new Refusal('Only a guest in the house can charge to the room.');
        partyId = guestParty(d, b);
      });
      return partyId;
    },
    billSaleToRoom: (id, saleId, desc, amount) => {
      touch(id, (b, d) => {
        open(b);
        b.charges.push({ id: uid('chg'), ts: iso(new Date()), desc, amount: Math.round(amount), payer: 'guest', by: who(d), saleId });
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
        const chargeLines = (payer: 'guest' | 'company') => b.charges.filter((c) => !c.saleId && (b.companyId ? c.payer === payer : payer === 'guest'))
          .map((c) => line(EXTRA_ITEM, c.desc, c.amount));
        const companyRooms = !!b.companyId && b.roomsPaidBy === 'company';
        const guestLines = [...(companyRooms ? [] : roomLines), ...chargeLines('guest')];
        const companyLines = b.companyId ? [...(companyRooms ? roomLines : []), ...chargeLines('company')] : [];
        /* taxes added on top of the prices (rates without tax, a per-night levy): one line each, on the bill that carries them */
        const tx = taxesOf(d, b);
        if (tx.added > 0) {
          const toCompany = Math.min(tx.added, (companyRooms ? tx.addedRoom : 0) + (b.companyId ? tx.addedCompanyCharges : 0));
          const toGuest = tx.added - toCompany;
          if (toGuest > 0) guestLines.push(line(EXTRA_ITEM, 'Taxes and levies', toGuest));
          if (toCompany > 0 && b.companyId) companyLines.push(line(EXTRA_ITEM, 'Taxes and levies', toCompany));
        }
        const lead = b.guests[0];
        const partyId = guestParty(d, b);
        const note = 'Hotel ' + b.no + ' · ' + b.guests.map((g) => g.name).join(', ') + ' · ' + b.arrive.slice(0, 10) + ' to ' + today();

        const bills: string[] = [];
        if (guestLines.length) {
          const sale = logic.commitSale(d, { lines: guestLines, partyId, discount: companyRooms ? 0 : offerAndDiscount, description: note, method: 'credit' });
          out.guestSale = sale.id;
          b.saleId = sale.id;
          bills.push(sale.id);
        }
        // the meals charged to the room are sales already: the money held settles them too
        bills.push(...b.charges.filter((c) => c.saleId).map((c) => c.saleId!));
        applyHeld(d, b.payments.map((p) => p.paymentId!).filter(Boolean), bills);

        if (companyLines.length && b.companyId) {
          const sale = logic.commitSale(d, { lines: companyLines, partyId: b.companyId, discount: companyRooms ? offerAndDiscount : 0, description: note + ' · company account', method: 'credit' });
          out.companySale = sale.id;
        }
        b.status = 'out';
        b.checkedOutAt = iso(new Date());
        b.updatedAt = b.checkedOutAt;
        // the rooms need cleaning before the next guest
        for (const r of b.rooms) room(d, r.roomId, (x) => { if (x.status !== 'ooo') x.status = 'dirty'; });
        logic.enqueue(d, 'booking', b.id);
        logic.audit(d, 'Guest checked out', b.no + ' · ' + lead.name);
      });
      return out;
    },
    nightAudit: (day = today()) => {
      requirePerm('hotel.checkout');
      const res = { released: 0, noShows: 0, dueOut: 0 };
      commit((d) => {
        for (const b of d.hotelBookings || []) {
          // a provisional hold whose day has passed lets the rooms go
          if (b.status === 'provisional' && b.holdUntil && b.holdUntil < day) {
            b.status = 'cancelled'; b.note = ((b.note || '') + ' · hold expired ' + day).trim(); res.released++;
          } else if ((b.status === 'confirmed' || b.status === 'provisional') && b.arrive.slice(0, 10) < day) {
            // expected yesterday or before and never came
            b.status = 'noshow'; res.noShows++;
          } else continue;
          b.updatedAt = iso(new Date());
          logic.enqueue(d, 'booking', b.id);
        }
        res.dueOut = (d.hotelBookings || []).filter((b) => b.status === 'in' && b.depart.slice(0, 10) <= day).length;
        (d.settings as any).hotel = { ...((d.settings as any).hotel || {}), lastAudit: day };
        logic.audit(d, 'Night audit', day + ' · ' + res.released + ' holds released, ' + res.noShows + ' no-shows');
      });
      return res;
    },
  };
}
