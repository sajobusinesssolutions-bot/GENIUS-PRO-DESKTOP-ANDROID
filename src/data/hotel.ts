/**
 * THE HOTEL — rooms, rates and the stay, as a hotel's reception runs them.
 *
 *   Room types   Single, Double, Twin, Suite: a rate a night, who fits.
 *   Rooms        101, 102…: a type, a floor, and how it stands today
 *                (clean, dirty, inspected, out of order).
 *   Rate plans   Room only, Bed & breakfast, Half and Full board, a company
 *                rate: an amount a night on top of (or off) the room's rate,
 *                per person where it is food.
 *   Seasons      dates with their own price, as a percentage up or down.
 *   Offers       "stay 3 nights, pay 2", between two dates.
 *   Bookings     one guest, a couple or family, or a group a company pays
 *                for: the rooms, the nights, the guests with what Uganda's
 *                guest register asks (ID or passport, nationality, where from
 *                and going, purpose, vehicle), the bill (room nights and
 *                every charge, each marked guest or company) and what has
 *                been paid. A booking moves provisional → confirmed →
 *                in house → checked out, or is cancelled or a no-show.
 *
 * At check-out the bill becomes one sale in the books (actions/hotel.ts), so
 * the money, the guest's or company's balance and every report follow as for
 * any other sale. Everything here is a record that syncs to the other phones
 * and the computer by the latest copy.
 */
import type { DB } from './types';

export type RoomStatus = 'clean' | 'dirty' | 'inspected' | 'ooo';
export interface RoomType {
  id: string; name: string; rate: number;
  maxAdults: number; maxChildren: number;
  amenities?: string; active: boolean;
}
export interface Room {
  id: string; no: string; typeId: string; floor?: string;
  status: RoomStatus; note?: string; active: boolean;
  /** Housekeeping: who is cleaning it today. */
  assignee?: string;
  /** Out of order: what is wrong, logged with the date. */
  maintenance?: { ts: string; text: string; fixed?: string }[];
}
export interface RatePlan {
  id: string; name: string;
  /** Added to each room's rate a night (negative for a discount). */
  perNight: number;
  /** Added a night for each adult: breakfast, lunch, dinner. */
  perPerson: number;
  active: boolean;
}
export interface Season {
  id: string; name: string; from: string; to: string;
  /** +20 is 20% dearer, -15 is 15% off. */
  pct: number; active: boolean;
}
export interface StayOffer {
  id: string; name: string; from: string; to: string;
  stay: number; pay: number; active: boolean;
}
export interface Guest {
  name: string; phone?: string;
  idType?: 'national' | 'passport' | 'driving' | 'other'; idNo?: string;
  nationality?: string; address?: string; comingFrom?: string; goingTo?: string;
  purpose?: string; vehicle?: string;
  /** Child guests are listed, not charged as adults. */
  child?: boolean;
  /** Group bookings: the room this guest sleeps in (the rooming list). */
  roomId?: string;
}
export interface BookedRoom { roomId: string; typeId: string; rate: number; adults: number; children: number }
export interface FolioCharge {
  id: string; ts: string; desc: string; amount: number;
  /** Who pays it: the guest, or the company on a company booking. */
  payer: 'guest' | 'company';
  by?: string;
  /** Already a sale in the books (a meal charged to the room): shown on the bill, not billed twice. */
  saleId?: string;
  /** What kind of charge (Settings: charge types) — it decides the taxes and the revenue line. */
  chargeTypeId?: string;
  /** A charge, a correction (adjust, usually negative), or one moved in from another booking. */
  kind?: 'charge' | 'adjust' | 'transfer';
  note?: string;
}
export interface FolioPayment {
  id: string; ts: string; amount: number; method: 'cash' | 'momo' | 'bank' | 'card'; note?: string; by?: string;
  /** The receipt in the books: the money is in the cash book the day it is taken, held on the guest's account until check-out. */
  paymentId?: string;
}
export type BookingKind = 'individual' | 'couple' | 'group';
export type BookingStatus = 'provisional' | 'confirmed' | 'in' | 'out' | 'cancelled' | 'noshow';
export interface Booking {
  id: string; no: string; kind: BookingKind; status: BookingStatus;
  /** Walk-in, phone, WhatsApp, email, agent, Booking.com… */
  source: string;
  /** The guest's party (customer) in the books, made at check-out if missing. */
  partyId?: string | null;
  /** On a company booking: the company billed for what it pays. */
  companyId?: string | null;
  groupName?: string;
  arrive: string; depart: string;
  rooms: BookedRoom[];
  ratePlanId?: string | null;
  /** The room nights: who pays them on a company booking. */
  roomsPaidBy: 'guest' | 'company';
  guests: Guest[];
  charges: FolioCharge[];
  payments: FolioPayment[];
  discount: number;
  /** A provisional booking is let go on this day if not confirmed. */
  holdUntil?: string;
  note?: string;
  createdAt: string; updatedAt: string;
  checkedInAt?: string; checkedOutAt?: string;
  /** The sale the bill became at check-out. */
  saleId?: string | null;
}
export interface HotelSettings {
  checkInTime: string; checkOutTime: string; depositPct: number;
  /** Room rates and charges already include the percentage taxes (usual in Uganda), or have them added on top. */
  ratesIncludeTax: boolean;
  taxes: TaxType[];
  chargeTypes: ChargeType[];
  cancellationPolicy: string;
}

/** A tax or levy on the bill: a percentage (VAT 18%), or an amount per room a night (a tourism levy). */
export interface TaxType {
  id: string; name: string;
  pct?: number;
  perNight?: number;
  /** What it is charged on: room nights, other charges, or both. */
  on: ('room' | 'charges')[];
  active: boolean;
}
export type ChargeCategory = 'ROOM' | 'FOOD' | 'BEVERAGE' | 'MISC' | 'EVENT' | 'SPA';
/** A kind of charge on a bill, with a code, as the revenue report groups them. */
export interface ChargeType { id: string; code: string; name: string; category: ChargeCategory; taxed: boolean; active: boolean }

export const DEFAULT_TAXES: TaxType[] = [
  { id: 'vat', name: 'VAT 18%', pct: 18, on: ['room', 'charges'], active: true },
  { id: 'levy', name: 'Tourism levy', perNight: 0, on: ['room'], active: false },
];
export const DEFAULT_CHARGE_TYPES: ChargeType[] = [
  { id: 'RR', code: 'RR', name: 'Accommodation', category: 'ROOM', taxed: true, active: true },
  { id: 'XB', code: '1020', name: 'Extra bed', category: 'ROOM', taxed: true, active: true },
  { id: 'LCO', code: '1030', name: 'Late check-out', category: 'ROOM', taxed: true, active: true },
  { id: 'FD', code: '3005', name: 'Restaurant food', category: 'FOOD', taxed: true, active: true },
  { id: 'BV', code: '3006', name: 'Bar and drinks', category: 'BEVERAGE', taxed: true, active: true },
  { id: 'MB', code: '3010', name: 'Minibar', category: 'BEVERAGE', taxed: true, active: true },
  { id: 'RS', code: '3020', name: 'Room service', category: 'FOOD', taxed: true, active: true },
  { id: 'LD', code: '2010', name: 'Laundry', category: 'MISC', taxed: true, active: true },
  { id: 'TR', code: '2020', name: 'Airport transfer', category: 'MISC', taxed: true, active: true },
  { id: 'PK', code: '2003', name: 'Car parking', category: 'MISC', taxed: true, active: true },
  { id: 'SP', code: '4031', name: 'Spa and gym', category: 'SPA', taxed: true, active: true },
  { id: 'EV', code: '5001', name: 'Hall and meeting hire', category: 'EVENT', taxed: true, active: true },
  { id: 'DM', code: '2030', name: 'Damage', category: 'MISC', taxed: false, active: true },
  { id: 'MS', code: '2099', name: 'Miscellaneous', category: 'MISC', taxed: true, active: true },
];
export const CATEGORY_WORD: Record<ChargeCategory, string> = { ROOM: 'Room', FOOD: 'Food', BEVERAGE: 'Beverage', MISC: 'Other', EVENT: 'Events', SPA: 'Spa' };

export const STATUS_WORD: Record<BookingStatus, string> = {
  provisional: 'Provisional', confirmed: 'Confirmed', in: 'In house', out: 'Checked out', cancelled: 'Cancelled', noshow: 'No-show',
};
export const ROOM_WORD: Record<RoomStatus, string> = { clean: 'Clean', dirty: 'Dirty', inspected: 'Inspected', ooo: 'Out of order' };
export const KIND_WORD: Record<BookingKind, string> = { individual: 'Individual', couple: 'Couple / family', group: 'Group / company' };
export const SOURCES = ['Walk-in', 'Phone', 'WhatsApp', 'Email', 'Travel agent', 'Booking.com', 'Expedia', 'Airbnb', 'Company'];

const DAY = 864e5;
export const dayOf = (s: string | Date) => (typeof s === 'string' ? s.slice(0, 10) : new Date(s.getTime() - s.getTimezoneOffset() * 6e4).toISOString().slice(0, 10));
export const today = () => dayOf(new Date());
export function addDays(day: string, n: number): string {
  const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
export function nightsOf(arrive: string, depart: string): number {
  return Math.max(0, Math.round((Date.parse(depart.slice(0, 10) + 'T12:00:00Z') - Date.parse(arrive.slice(0, 10) + 'T12:00:00Z')) / DAY));
}
/** Every night of a stay, as the day it starts. */
export function nightsList(arrive: string, depart: string): string[] {
  const n = nightsOf(arrive, depart);
  return Array.from({ length: n }, (_, i) => addDays(arrive, i));
}

/**
 * The hotel's rules: times, deposit, taxes, charge types, cancellation policy.
 * Kept as one shared record (hotelConfig, id "config") so every phone and the
 * computer tax and print a bill alike; older books kept them in settings.hotel.
 */
export function hotelSettings(d: DB | null | undefined): HotelSettings {
  const cfg = ((d as any)?.hotelConfig || []).find((x: any) => x.id === 'config') || {};
  const s = { ...((d as any)?.settings?.hotel || {}), ...cfg };
  return {
    checkInTime: '14:00', checkOutTime: '10:00', depositPct: 0, ratesIncludeTax: true, cancellationPolicy: '',
    ...s,
    taxes: Array.isArray(s.taxes) && s.taxes.length ? s.taxes : DEFAULT_TAXES,
    chargeTypes: Array.isArray(s.chargeTypes) && s.chargeTypes.length ? s.chargeTypes : DEFAULT_CHARGE_TYPES,
  };
}
export const chargeTypeOf = (d: DB, id?: string): ChargeType => {
  const all = hotelSettings(d).chargeTypes;
  return all.find((c) => c.id === id) || all.find((c) => c.category === 'MISC' && /misc/i.test(c.name)) || all[0];
};
export const roomTypes = (d: DB | null | undefined): RoomType[] => (d as any)?.roomTypes || [];
export const rooms = (d: DB | null | undefined): Room[] => ((d as any)?.rooms || []).slice().sort((a: Room, b: Room) => a.no.localeCompare(b.no, undefined, { numeric: true }));
export const ratePlans = (d: DB | null | undefined): RatePlan[] => (d as any)?.ratePlans || [];
export const seasons = (d: DB | null | undefined): Season[] => (d as any)?.seasons || [];
export const stayOffers = (d: DB | null | undefined): StayOffer[] => (d as any)?.stayOffers || [];
export const bookings = (d: DB | null | undefined): Booking[] => (d as any)?.hotelBookings || [];

/** Bookings that hold a room: not cancelled, not a no-show, not yet gone. */
export const holds = (b: Booking) => b.status === 'provisional' || b.status === 'confirmed' || b.status === 'in';

/** Who is in a room on a night (the night starting that day). */
export function bookingOn(d: DB, roomId: string, day: string, except?: string): Booking | undefined {
  return bookings(d).find((b) => b.id !== except && holds(b) && b.rooms.some((r) => r.roomId === roomId) && b.arrive.slice(0, 10) <= day && day < b.depart.slice(0, 10));
}
export function roomFree(d: DB, roomId: string, arrive: string, depart: string, except?: string): boolean {
  return nightsList(arrive, depart).every((n) => !bookingOn(d, roomId, n, except));
}
/** Rooms of a type (or any) free for every night of a stay. */
export function freeRooms(d: DB, arrive: string, depart: string, typeId?: string, except?: string): Room[] {
  return rooms(d).filter((r) => r.active && r.status !== 'ooo' && (!typeId || r.typeId === typeId) && roomFree(d, r.id, arrive, depart, except));
}

/** The season a night falls in, if any (the last made wins where two overlap). */
export function seasonOn(d: DB, day: string): Season | undefined {
  return seasons(d).filter((s) => s.active && s.from <= day && day <= s.to).slice(-1)[0];
}

export interface StayPrice {
  nights: number;
  lines: { desc: string; amount: number }[];
  rooms: number;
  /** Nights given free by an offer. */
  offer: number;
  total: number;
}
/** The room nights, with seasons, the rate plan and any stay offer. */
export function priceStay(d: DB, b: Pick<Booking, 'arrive' | 'depart' | 'rooms' | 'ratePlanId'>): StayPrice {
  const nights = nightsList(b.arrive, b.depart);
  const plan = ratePlans(d).find((p) => p.id === b.ratePlanId && p.active);
  const lines: StayPrice['lines'] = [];
  let roomsTotal = 0, offerTotal = 0;
  const offer = stayOffers(d).filter((o) => o.active && o.stay > o.pay && o.from <= b.arrive.slice(0, 10) && b.arrive.slice(0, 10) <= o.to).sort((x, y) => (y.stay - y.pay) / y.stay - (x.stay - x.pay) / x.stay)[0];
  for (const r of b.rooms) {
    const room = rooms(d).find((x) => x.id === r.roomId);
    const each = nights.map((n) => {
      const s = seasonOn(d, n);
      const base = Math.round(r.rate * (1 + (s ? s.pct : 0) / 100));
      return base + (plan ? plan.perNight + plan.perPerson * Math.max(1, r.adults) : 0);
    });
    const sum = each.reduce((a, v) => a + v, 0);
    roomsTotal += sum;
    lines.push({ desc: 'Room ' + (room?.no || '?') + ' · ' + nights.length + ' night' + (nights.length === 1 ? '' : 's') + (plan ? ' · ' + plan.name : ''), amount: sum });
    if (offer && nights.length >= offer.stay) {
      // the cheapest nights are the ones given free
      const free = Math.floor(nights.length / offer.stay) * (offer.stay - offer.pay);
      const off = each.slice().sort((x, y) => x - y).slice(0, free).reduce((a, v) => a + v, 0);
      if (off) { offerTotal += off; lines.push({ desc: offer.name + ' · ' + free + ' night' + (free === 1 ? '' : 's') + ' free', amount: -off }); }
    }
  }
  return { nights: nights.length, lines, rooms: roomsTotal, offer: offerTotal, total: roomsTotal - offerTotal };
}

export interface Folio {
  /** All tax on the bill, whether inside the prices or added. */
  tax: number;
  /** The part of it added on top of the prices. */
  taxAdded: number;
  taxLines: { id: string; name: string; amount: number; added: boolean }[];
  stay: StayPrice;
  charges: number;
  discount: number;
  total: number;
  paid: number;
  balance: number;
  /** On a company booking, what each side owes. */
  guestPart: number;
  companyPart: number;
}
export function folioOf(d: DB, b: Booking): Folio {
  const stay = priceStay(d, b);
  const charges = b.charges.reduce((a, c) => a + c.amount, 0);
  const discount = Math.max(0, Number(b.discount) || 0);
  const t = taxesOf(d, b);
  const total = Math.max(0, stay.total + charges - discount + t.added);
  const paid = b.payments.reduce((a, p) => a + p.amount, 0);
  const company = b.companyId ? (b.roomsPaidBy === 'company' ? stay.total + t.addedRoom : 0) + b.charges.filter((c) => c.payer === 'company').reduce((a, c) => a + c.amount, 0) + (b.companyId ? t.addedCompanyCharges : 0) : 0;
  return { stay, charges, discount, total, paid, balance: total - paid, tax: t.included + t.added, taxAdded: t.added, taxLines: t.lines,
    companyPart: Math.max(0, company - (b.companyId ? discount : 0)), guestPart: Math.max(0, total - company + (b.companyId ? discount : 0)) };
}

/**
 * The taxes on a bill. A percentage tax is inside the price when rates include
 * tax (shown, not added) or added on top otherwise; a per-night levy is always
 * added. Returns the lines by tax, and what was added to the total.
 */
export function taxesOf(d: DB, b: Booking) {
  const st = hotelSettings(d);
  const roomNights = nightsOf(b.arrive, b.depart) * b.rooms.length;
  const roomBase = priceStay(d, b).total;
  const taxed = (payer?: 'guest' | 'company') => b.charges
    .filter((c) => (!payer || c.payer === payer) && chargeTypeOf(d, c.chargeTypeId).taxed !== false)
    .reduce((a, c) => a + c.amount, 0);
  const lines: { id: string; name: string; amount: number; added: boolean }[] = [];
  let added = 0, included = 0, addedRoom = 0, addedCompanyCharges = 0;
  for (const x of st.taxes.filter((t) => t.active)) {
    // a percentage: inside the price when rates include tax, else on top
    if (x.pct) {
      const rate = x.pct / 100;
      const of = (v: number) => (st.ratesIncludeTax ? v - v / (1 + rate) : v * rate);
      const room = x.on.includes('room') ? of(roomBase) : 0;
      const other = x.on.includes('charges') ? of(taxed()) : 0;
      const amt = room + other;
      if (st.ratesIncludeTax) included += amt;
      else { added += amt; addedRoom += room; addedCompanyCharges += x.on.includes('charges') ? of(taxed('company')) : 0; }
      if (Math.abs(amt) >= 0.5) lines.push({ id: x.id, name: x.name, amount: Math.round(amt), added: !st.ratesIncludeTax });
    }
    // an amount per room a night: always added
    if (x.perNight && x.on.includes('room')) {
      const lv = x.perNight * roomNights;
      added += lv; addedRoom += lv;
      lines.push({ id: x.id + ':night', name: x.name, amount: Math.round(lv), added: true });
    }
  }
  return { lines, added: Math.round(added), included: Math.round(included), addedRoom: Math.round(addedRoom), addedCompanyCharges: Math.round(addedCompanyCharges) };
}

/** The day at reception: who comes, who goes, who is in, and how full the house is. */
export function dayAtDesk(d: DB, day = today()) {
  const all = bookings(d);
  const arrivals = all.filter((b) => (b.status === 'confirmed' || b.status === 'provisional') && b.arrive.slice(0, 10) === day);
  const late = all.filter((b) => (b.status === 'confirmed' || b.status === 'provisional') && b.arrive.slice(0, 10) < day);
  const departures = all.filter((b) => b.status === 'in' && b.depart.slice(0, 10) <= day);
  const inHouse = all.filter((b) => b.status === 'in');
  const live = rooms(d).filter((r) => r.active);
  const sellable = live.filter((r) => r.status !== 'ooo').length;
  const occupied = live.filter((r) => bookingOn(d, r.id, day) && bookingOn(d, r.id, day)!.status === 'in').length;
  const roomRevenue = inHouse.reduce((a, b) => a + b.rooms.reduce((x, r) => x + r.rate, 0), 0);
  return {
    arrivals, late, departures, inHouse,
    rooms: live.length, sellable, occupied,
    occupancy: sellable ? Math.round((occupied / sellable) * 100) : 0,
    adr: occupied ? Math.round(roomRevenue / occupied) : 0,
    dirty: live.filter((r) => r.status === 'dirty').length,
    ooo: live.filter((r) => r.status === 'ooo').length,
    guests: inHouse.reduce((a, b) => a + b.rooms.reduce((x, r) => x + r.adults + r.children, 0), 0),
  };
}

/** The guest register, as Uganda's tourism and police rules ask hotels to keep it. */
export function guestRegister(d: DB, from: string, to: string) {
  return bookings(d)
    .filter((b) => (b.status === 'in' || b.status === 'out') && b.checkedInAt && dayOf(b.checkedInAt) >= from && dayOf(b.checkedInAt) <= to)
    .flatMap((b) => b.guests.map((g) => ({
      booking: b.no, arrived: dayOf(b.checkedInAt!), departs: b.checkedOutAt ? dayOf(b.checkedOutAt) : b.depart.slice(0, 10),
      rooms: b.rooms.map((r) => rooms(d).find((x) => x.id === r.roomId)?.no || '?').join(', '),
      ...g,
    })))
    .sort((a, b) => a.arrived.localeCompare(b.arrived));
}

/** What a booking still needs before check-in can go ahead. */
export function checkInMissing(b: Booking): string[] {
  const out: string[] = [];
  const lead = b.guests[0];
  if (!lead || !lead.name.trim()) out.push('the main guest’s name');
  if (lead && !lead.idNo?.trim()) out.push('their ID or passport number');
  if (lead && !lead.nationality?.trim()) out.push('their nationality');
  if (!b.rooms.length) out.push('a room');
  return out;
}

/* ── Reports ──────────────────────────────────────────────────────────────
   Over a period: how full the hotel was night by night, what the rooms
   earned, the average rate a sold room fetched (ADR) and what each room
   available earned (RevPAR) — the three figures every hotel is measured by —
   with room types, where the bookings came from, and guests' nationalities. */
export function hotelReport(d: DB, from: string, to: string) {
  const live = rooms(d).filter((r) => r.active);
  const sold = bookings(d).filter((b) => b.status === 'in' || b.status === 'out' || b.status === 'confirmed');
  const nights: { day: string; occupied: number; available: number; revenue: number }[] = [];
  const byType = new Map<string, { name: string; nights: number; revenue: number }>();
  const bySource = new Map<string, { bookings: number; nights: number; revenue: number }>();
  const byNation = new Map<string, number>();
  for (let day = from; day <= to; day = addDays(day, 1)) {
    let occupied = 0, revenue = 0;
    for (const b of sold) {
      if (!(b.arrive.slice(0, 10) <= day && day < b.depart.slice(0, 10))) continue;
      for (const r of b.rooms) {
        const s = seasonOn(d, day);
        const rate = Math.round(r.rate * (1 + (s ? s.pct : 0) / 100));
        occupied++; revenue += rate;
        const t = roomTypes(d).find((x) => x.id === r.typeId);
        const k = byType.get(r.typeId) || { name: t?.name || 'Room', nights: 0, revenue: 0 };
        k.nights++; k.revenue += rate; byType.set(r.typeId, k);
        const src = bySource.get(b.source) || { bookings: 0, nights: 0, revenue: 0 };
        src.nights++; src.revenue += rate; bySource.set(b.source, src);
      }
    }
    const available = live.filter((r) => r.status !== 'ooo').length || live.length;
    nights.push({ day, occupied, available, revenue });
  }
  for (const b of sold) {
    if (b.arrive.slice(0, 10) > to || b.depart.slice(0, 10) <= from) continue;
    const src = bySource.get(b.source); if (src) src.bookings++;
    for (const g of b.guests) { const n = (g.nationality || 'Not given').trim(); byNation.set(n, (byNation.get(n) || 0) + 1); }
  }
  const roomNights = nights.reduce((a, n) => a + n.occupied, 0);
  const availableNights = nights.reduce((a, n) => a + n.available, 0);
  const revenue = nights.reduce((a, n) => a + n.revenue, 0);
  const all = bookings(d).filter((b) => b.arrive.slice(0, 10) >= from && b.arrive.slice(0, 10) <= to);
  return {
    nights, roomNights, availableNights, revenue,
    occupancy: availableNights ? Math.round((roomNights / availableNights) * 1000) / 10 : 0,
    adr: roomNights ? Math.round(revenue / roomNights) : 0,
    revpar: availableNights ? Math.round(revenue / availableNights) : 0,
    cancelled: all.filter((b) => b.status === 'cancelled').length,
    noShows: all.filter((b) => b.status === 'noshow').length,
    byType: [...byType.values()].sort((a, b) => b.revenue - a.revenue),
    bySource: [...bySource.entries()].map(([source, v]) => ({ source, ...v })).sort((a, b) => b.revenue - a.revenue),
    byNation: [...byNation.entries()].map(([nation, guests]) => ({ nation, guests })).sort((a, b) => b.guests - a.guests),
  };
}

/** The nights ahead: rooms booked and how full, from the bookings on the books. */
export function forecast(d: DB, days = 30, from = today()) {
  const live = rooms(d).filter((r) => r.active && r.status !== 'ooo').length;
  return Array.from({ length: days }, (_, i) => {
    const day = addDays(from, i);
    const booked = bookings(d).filter((b) => holds(b) && b.arrive.slice(0, 10) <= day && day < b.depart.slice(0, 10)).reduce((a, b) => a + b.rooms.length, 0);
    return { day, booked, free: Math.max(0, live - booked), pct: live ? Math.round((booked / live) * 100) : 0 };
  });
}

/** This morning's breakfast list: guests in house whose rate includes meals. */
export function breakfastList(d: DB, day = today()) {
  return bookings(d)
    .filter((b) => b.status === 'in' && b.arrive.slice(0, 10) < day && day <= b.depart.slice(0, 10))
    .flatMap((b) => {
      const plan = ratePlans(d).find((p) => p.id === b.ratePlanId);
      if (!plan || !(plan.perPerson > 0)) return [];
      return b.rooms.map((r) => ({
        room: rooms(d).find((x) => x.id === r.roomId)?.no || '?', plan: plan.name, adults: r.adults, children: r.children,
        guest: b.guests.find((g) => g.roomId === r.roomId)?.name || b.guests[0]?.name || '',
      }));
    })
    .sort((a, b) => a.room.localeCompare(b.room, undefined, { numeric: true }));
}

/** Messages a guest is sent on WhatsApp, in the hotel's words. */
export function guestMessage(d: DB, b: Booking, kind: 'confirm' | 'welcome' | 'bill' | 'thanks', money: (n: number) => string): string {
  const hotel = d.firm?.name || 'our hotel';
  const s = hotelSettings(d);
  const name = (b.guests[0]?.name || '').split(' ')[0] || 'there';
  const roomsTxt = b.rooms.map((r) => rooms(d).find((x) => x.id === r.roomId)?.no || '').filter(Boolean).join(', ');
  const f = folioOf(d, b);
  const nice = (x: string) => new Date(x.slice(0, 10) + 'T12:00:00').toDateString().slice(0, 10);
  if (kind === 'confirm') {
    return 'Hello ' + name + ', your booking ' + b.no + ' at ' + hotel + ' is confirmed: ' + nice(b.arrive) + ' to ' + nice(b.depart)
      + ' (' + nightsOf(b.arrive, b.depart) + ' nights), ' + b.rooms.length + ' room' + (b.rooms.length === 1 ? '' : 's') + '. Total ' + money(f.total)
      + (f.paid ? ', paid ' + money(f.paid) : '') + '. Check-in from ' + s.checkInTime + '. We look forward to welcoming you.';
  }
  if (kind === 'welcome') {
    return 'Welcome to ' + hotel + ', ' + name + '! You are in room ' + roomsTxt + '. Check-out is by ' + s.checkOutTime + ' on ' + nice(b.depart)
      + '. Reply here any time if you need anything.';
  }
  if (kind === 'bill') {
    const lines = [...f.stay.lines.map((l) => l.desc + ': ' + money(l.amount)), ...b.charges.map((c) => c.desc + ': ' + money(c.amount))];
    return hotel + ' · bill ' + b.no + '\n' + lines.join('\n') + (f.discount ? '\nDiscount: -' + money(f.discount) : '')
      + '\nTotal: ' + money(f.total) + '\nPaid: ' + money(f.paid) + '\nBalance: ' + money(Math.max(0, f.balance));
  }
  return 'Thank you for staying with us at ' + hotel + ', ' + name + '. We hope to see you again soon!';
}

/* ── The folio, line by line ───────────────────────────────────────────────
   What the Information Bill prints: each night of each room with its rate,
   the taxes on it, every other charge with its taxes, then each payment as a
   credit, with a running balance. Nights not yet slept are marked expected. */
export interface FolioLine {
  date: string; kind: 'room' | 'tax' | 'charge' | 'adjust' | 'transfer' | 'offer' | 'discount' | 'payment';
  desc: string; code?: string; category?: ChargeCategory;
  charge: number; credit: number; balance: number;
  payer?: 'guest' | 'company'; room?: string; future?: boolean; ref?: string;
}

/** Each night of a stay, room by room, at its own price (season and rate plan). */
export function nightly(d: DB, b: Pick<Booking, 'arrive' | 'depart' | 'rooms' | 'ratePlanId'>) {
  const plan = ratePlans(d).find((p) => p.id === b.ratePlanId && p.active);
  const out: { day: string; roomId: string; room: string; amount: number }[] = [];
  for (const r of b.rooms) {
    const no = rooms(d).find((x) => x.id === r.roomId)?.no || '?';
    for (const n of nightsList(b.arrive, b.depart)) {
      const s = seasonOn(d, n);
      out.push({ day: n, roomId: r.roomId, room: no, amount: Math.round(r.rate * (1 + (s ? s.pct : 0) / 100)) + (plan ? plan.perNight + plan.perPerson * Math.max(1, r.adults) : 0) });
    }
  }
  return out;
}

export function folioLines(d: DB, b: Booking, now = today()): FolioLine[] {
  const st = hotelSettings(d);
  const taxes = st.taxes.filter((x) => x.active);
  const plan = ratePlans(d).find((p) => p.id === b.ratePlanId && p.active);
  const rr = chargeTypeOf(d, 'RR');
  const roomPayer: 'guest' | 'company' = b.companyId && b.roomsPaidBy === 'company' ? 'company' : 'guest';
  const raw: Omit<FolioLine, 'balance'>[] = [];
  const taxFor = (amount: number, date: string, onRoom: boolean, payer: 'guest' | 'company', taxed: boolean, future?: boolean) => {
    for (const x of taxes) {
      if (!x.on.includes(onRoom ? 'room' : 'charges')) continue;
      if (x.pct && taxed) {
        const rate = x.pct / 100;
        const v = st.ratesIncludeTax ? amount - amount / (1 + rate) : amount * rate;
        if (Math.abs(v) >= 0.5) raw.push({ date, kind: 'tax', desc: x.name + (st.ratesIncludeTax ? ' (included)' : ''), charge: st.ratesIncludeTax ? 0 : Math.round(v), credit: 0, payer, future, ref: st.ratesIncludeTax ? String(Math.round(v)) : undefined });
      }
      if (x.perNight && onRoom) raw.push({ date, kind: 'tax', desc: x.name, charge: x.perNight, credit: 0, payer, future });
    }
  };
  for (const n of nightly(d, b)) {
    const future = n.day > now;
    raw.push({ date: n.day, kind: 'room', desc: (plan ? plan.name : rr.name) + ' · room ' + n.room, code: rr.code, category: 'ROOM', charge: n.amount, credit: 0, payer: roomPayer, room: n.room, future });
    taxFor(n.amount, n.day, true, roomPayer, true, future);
  }
  const stay = priceStay(d, b);
  if (stay.offer) raw.push({ date: b.depart.slice(0, 10), kind: 'offer', desc: stay.lines.find((l) => l.amount < 0)?.desc || 'Offer', charge: 0, credit: stay.offer, payer: roomPayer });
  for (const c of b.charges) {
    const ct = chargeTypeOf(d, c.chargeTypeId);
    raw.push({ date: dayOf(c.ts), kind: c.kind === 'adjust' ? 'adjust' : c.kind === 'transfer' ? 'transfer' : 'charge', desc: c.desc + (c.note ? ' — ' + c.note : '') + (c.saleId ? ' (billed)' : ''), code: ct.code, category: ct.category,
      charge: c.amount > 0 ? c.amount : 0, credit: c.amount < 0 ? -c.amount : 0, payer: c.payer, ref: c.id });
    if (c.amount > 0) taxFor(c.amount, dayOf(c.ts), false, c.payer, ct.taxed !== false);
  }
  if (b.discount) raw.push({ date: dayOf(b.updatedAt || b.createdAt), kind: 'discount', desc: 'Discount', charge: 0, credit: Math.max(0, Number(b.discount) || 0), payer: roomPayer });
  for (const p of b.payments) raw.push({ date: dayOf(p.ts), kind: 'payment', desc: 'Payment · ' + (p.method === 'momo' ? 'Mobile money' : p.method[0].toUpperCase() + p.method.slice(1)) + (p.note ? ' · ' + p.note : ''), charge: 0, credit: p.amount, ref: p.id });
  const order: Record<FolioLine['kind'], number> = { room: 0, charge: 1, transfer: 1, adjust: 2, tax: 3, offer: 4, discount: 5, payment: 6 };
  raw.sort((a, b2) => a.date.localeCompare(b2.date) || order[a.kind] - order[b2.kind]);
  let bal = 0;
  return raw.map((l) => { bal += l.charge - l.credit; return { ...l, balance: Math.round(bal) }; });
}

/* ── Revenue summary: day by day, charge type by charge type ───────────── */
export function revenueSummary(d: DB, from: string, to: string) {
  const st = hotelSettings(d);
  const pctTaxes = st.taxes.filter((x) => x.active && x.pct);
  const rows = new Map<string, { date: string; chargeType: string; code: string; category: ChargeCategory; gross: number; net: number; tax: number; taxes: Record<string, number> }>();
  const add = (date: string, ct: ChargeType, amount: number, onRoom: boolean, taxed: boolean) => {
    if (date < from || date > to || !amount) return;
    const key = date + '|' + ct.id;
    const r = rows.get(key) || { date, chargeType: ct.name, code: ct.code, category: ct.category, gross: 0, net: 0, tax: 0, taxes: {} };
    let net = amount, tax = 0;
    for (const x of pctTaxes) {
      if (!taxed || !x.on.includes(onRoom ? 'room' : 'charges')) continue;
      const rate = x.pct! / 100;
      const v = st.ratesIncludeTax ? amount - amount / (1 + rate) : amount * rate;
      tax += v; r.taxes[x.name] = (r.taxes[x.name] || 0) + v;
    }
    if (st.ratesIncludeTax) net = amount - tax;
    r.gross += st.ratesIncludeTax ? amount : amount + tax; r.net += net; r.tax += tax;
    rows.set(key, r);
  };
  const rr = chargeTypeOf(d, 'RR');
  for (const b of bookings(d).filter((x) => x.status === 'in' || x.status === 'out')) {
    for (const n of nightly(d, b)) add(n.day, rr, n.amount, true, true);
    for (const c of b.charges) { const ct = chargeTypeOf(d, c.chargeTypeId); add(dayOf(c.ts), ct, c.amount, false, ct.taxed !== false); }
  }
  const list = [...rows.values()].map((r) => ({ ...r, gross: Math.round(r.gross), net: Math.round(r.net), tax: Math.round(r.tax), taxes: Object.fromEntries(Object.entries(r.taxes).map(([k, v]) => [k, Math.round(v)])) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code));
  const sum = (k: 'gross' | 'net' | 'tax') => list.reduce((a, r) => a + r[k], 0);
  return { rows: list, taxNames: pctTaxes.map((x) => x.name), totals: { gross: sum('gross'), net: sum('net'), tax: sum('tax') } };
}

/** Every line of every bill in a period: charges, adjustments, transfers and payments, with the guest and room. */
export function allTransactions(d: DB, from: string, to: string, kinds?: FolioLine['kind'][]) {
  const out: (FolioLine & { booking: string; guest: string; rooms: string })[] = [];
  for (const b of bookings(d).filter((x) => x.status === 'in' || x.status === 'out')) {
    const roomsTxt = b.rooms.map((r) => rooms(d).find((x) => x.id === r.roomId)?.no || '?').join(', ');
    for (const l of folioLines(d, b)) {
      if (l.date < from || l.date > to || l.future) continue;
      if (kinds && kinds.length && !kinds.includes(l.kind)) continue;
      out.push({ ...l, booking: b.no, guest: b.guests[0]?.name || '', rooms: roomsTxt });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** A company's invoice: every stay billed to it in a period, as one statement. */
export function companyStays(d: DB, companyIds: string[], from: string, to: string) {
  return bookings(d)
    .filter((b) => b.companyId && companyIds.includes(b.companyId) && (b.status === 'out' || b.status === 'in') && b.depart.slice(0, 10) >= from && b.arrive.slice(0, 10) <= to)
    .map((b) => {
      const f = folioOf(d, b);
      return { date: (b.checkedOutAt || b.depart).slice(0, 10), booking: b.no, guest: b.guests[0]?.name || '', others: b.guests.slice(1).map((g) => g.name).join(', '),
        checkIn: b.arrive.slice(0, 10), checkOut: b.depart.slice(0, 10), nights: nightsOf(b.arrive, b.depart),
        room: b.rooms.map((r) => rooms(d).find((x) => x.id === r.roomId)?.no || '?').join(', '), amount: f.companyPart };
    })
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn));
}

/** Arrivals, in house and departures as reception lists them, with what is owed. */
export function deskList(d: DB, which: 'arrivals' | 'inhouse' | 'departures' | 'all', day = today()) {
  const all = bookings(d);
  const pick = which === 'arrivals' ? all.filter((b) => (b.status === 'confirmed' || b.status === 'provisional') && b.arrive.slice(0, 10) <= day)
    : which === 'inhouse' ? all.filter((b) => b.status === 'in')
    : which === 'departures' ? all.filter((b) => b.status === 'in' && b.depart.slice(0, 10) <= day)
    : all;
  return pick.map((b) => {
    const f = folioOf(d, b);
    const rs = b.rooms.map((r) => rooms(d).find((x) => x.id === r.roomId)).filter(Boolean) as Room[];
    return { b, balance: f.balance, total: f.total, rooms: rs, plan: ratePlans(d).find((p) => p.id === b.ratePlanId)?.name || 'Room only',
      nights: nightsOf(b.arrive, b.depart), adults: b.rooms.reduce((a, r) => a + r.adults, 0), children: b.rooms.reduce((a, r) => a + r.children, 0),
      pendingDeparture: b.status === 'in' && b.depart.slice(0, 10) <= day };
  });
}

/* ══ EVENTS AND MEETING SPACES ══════════════════════════════════════════════
   Halls and meeting rooms (spaces), packages (lunch, tea, AV), and events: a
   proposal that becomes tentative, then confirmed, with one or more sub-events
   (a space, a date, a time, a set-up, how many guests, a price plan and the
   packages served), a deposit schedule, payments held on account, tasks, and
   at the close one bill in the books. */
export type SpaceSetup = 'Theatre' | 'Classroom' | 'U-shape' | 'Boardroom' | 'Banquet' | 'Cocktail' | 'Cabaret';
export const SETUPS: SpaceSetup[] = ['Theatre', 'Classroom', 'U-shape', 'Boardroom', 'Banquet', 'Cocktail', 'Cabaret'];
export interface EventSpace { id: string; name: string; capacity: number; rateHour: number; rateHalfDay: number; rateDay: number; color?: string; active: boolean }
export type PackageCategory = 'FNB' | 'AV' | 'DECOR' | 'OTHER';
export const PACKAGE_WORD: Record<PackageCategory, string> = { FNB: 'Food & drinks', AV: 'Audio-visual', DECOR: 'Decor', OTHER: 'Other' };
export interface EventPackage { id: string; name: string; category: PackageCategory; perPerson: number; flat: number; serviceChargePct: number; active: boolean }
export type PricePlan = 'hour' | 'half' | 'day' | 'flat';
export const PLAN_WORD: Record<PricePlan, string> = { hour: 'By the hour', half: 'Half day', day: 'Full day', flat: 'Agreed amount' };
export interface SubEventPackage { packageId: string; name: string; qty: number; price: number; perPerson: boolean; serviceChargePct: number }
export interface SubEvent {
  id: string; name: string; spaceId: string; date: string; start: string; end: string; setup: SpaceSetup;
  expected: number; guaranteed: number; actual: number;
  pricePlan: PricePlan; price: number; serviceChargePct: number;
  packages: SubEventPackage[]; remarks?: string;
}
export type EventStatus = 'prospect' | 'tentative' | 'confirmed' | 'closed' | 'cancelled';
export const EVENT_STATUS_WORD: Record<EventStatus, string> = { prospect: 'Prospect', tentative: 'Tentative', confirmed: 'Confirmed', closed: 'Closed', cancelled: 'Cancelled' };
export const EVENT_TYPES = ['Meeting', 'Conference', 'Workshop', 'Wedding', 'Party', 'Dinner', 'Training', 'Other'];
export interface EventDeposit { id: string; due: string; amount: number }
export interface EventTask { id: string; due: string; text: string; done: boolean }
export interface HotelEvent {
  id: string; no: string; name: string; type: string; status: EventStatus;
  companyId?: string | null; contact: { name: string; phone?: string; email?: string };
  partyId?: string | null;
  from: string; to: string; attendees: number; owner?: string; source?: string;
  cutOff?: string; cancellationPolicy?: string; notes?: string;
  subEvents: SubEvent[]; deposits: EventDeposit[]; payments: FolioPayment[]; charges: FolioCharge[]; tasks: EventTask[];
  discount: number; saleId?: string | null;
  createdAt: string; updatedAt: string;
}
export const eventSpaces = (d: DB | null | undefined): EventSpace[] => (d as any)?.eventSpaces || [];
export const eventPackages = (d: DB | null | undefined): EventPackage[] => (d as any)?.eventPackages || [];
export const hotelEvents = (d: DB | null | undefined): HotelEvent[] => (d as any)?.hotelEvents || [];

const minutes = (t: string) => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
/** The space's own price for one sub-event, by its plan: by the hour, half day, day, or an agreed amount. */
export function spacePrice(d: DB, s: Pick<SubEvent, 'spaceId' | 'start' | 'end' | 'pricePlan' | 'price'>): number {
  const sp = eventSpaces(d).find((x) => x.id === s.spaceId);
  if (s.pricePlan === 'flat' || !sp) return Math.max(0, Number(s.price) || 0);
  if (s.pricePlan === 'hour') return Math.round(Math.max(0, (minutes(s.end) - minutes(s.start)) / 60) * (Number(s.price) || sp.rateHour));
  if (s.pricePlan === 'half') return Number(s.price) || sp.rateHalfDay;
  return Number(s.price) || sp.rateDay;
}
/** One sub-event's money: the space, the packages (per person on the guaranteed count, or flat), service charge. */
export function subEventTotals(d: DB, s: SubEvent) {
  const space = spacePrice(d, s);
  const heads = Math.max(s.guaranteed || 0, s.actual || 0, 0) || s.expected || 0;
  const pk = s.packages.map((p) => {
    const amount = Math.round(p.perPerson ? p.price * (p.qty || heads) : p.price * (p.qty || 1));
    return { ...p, amount, service: Math.round(amount * (p.serviceChargePct || 0) / 100) };
  });
  const packages = pk.reduce((a, p) => a + p.amount, 0);
  const service = Math.round(space * (s.serviceChargePct || 0) / 100) + pk.reduce((a, p) => a + p.service, 0);
  return { space, packages, service, total: space + packages + service, lines: pk };
}
/** The whole event: space and package revenue, service charge, other charges, taxes, payments, deposits due. */
export function eventTotals(d: DB, e: HotelEvent, now = today()) {
  const st = hotelSettings(d);
  const subs = e.subEvents.map((s) => ({ s, t: subEventTotals(d, s) }));
  const space = subs.reduce((a, x) => a + x.t.space, 0);
  const packages = subs.reduce((a, x) => a + x.t.packages, 0);
  const service = subs.reduce((a, x) => a + x.t.service, 0);
  const charges = e.charges.reduce((a, c) => a + c.amount, 0);
  const net = Math.max(0, space + packages + service + charges - (Number(e.discount) || 0));
  let taxAdded = 0, taxIncluded = 0;
  for (const x of st.taxes.filter((t) => t.active && t.pct && t.on.includes('charges'))) {
    const rate = x.pct! / 100;
    if (st.ratesIncludeTax) taxIncluded += net - net / (1 + rate); else taxAdded += net * rate;
  }
  const total = Math.round(net + taxAdded);
  const paid = e.payments.reduce((a, p) => a + p.amount, 0);
  const depositsDue = e.deposits.filter((x) => x.due <= now).reduce((a, x) => a + x.amount, 0);
  return { space, packages, service, charges, discount: Number(e.discount) || 0, taxAdded: Math.round(taxAdded), taxIncluded: Math.round(taxIncluded), total, paid,
    balance: total - paid, depositOwing: Math.max(0, depositsDue - paid), subs };
}
/** Another event holding the same space at an overlapping time on the date, if any (cancelled ones do not). */
export function spaceClash(d: DB, spaceId: string, date: string, start: string, end: string, exceptSub?: string): { event: HotelEvent; sub: SubEvent } | null {
  for (const e of hotelEvents(d)) {
    if (e.status === 'cancelled') continue;
    for (const s of e.subEvents) {
      if (s.id === exceptSub || s.spaceId !== spaceId || s.date !== date) continue;
      if (minutes(start) < minutes(s.end) && minutes(s.start) < minutes(end)) return { event: e, sub: s };
    }
  }
  return null;
}
/** The events desk: counts and revenue by status, deposits due, cut-offs and tasks today. */
export function eventsDesk(d: DB, day = today()) {
  const live = hotelEvents(d).filter((e) => e.status !== 'cancelled');
  const by = (st: EventStatus) => live.filter((e) => e.status === st);
  const rev = (list: HotelEvent[]) => list.reduce((a, e) => a + eventTotals(d, e, day).total, 0);
  return {
    prospect: by('prospect').length, tentative: by('tentative').length, confirmed: by('confirmed').length,
    revProspect: rev(by('prospect')), revTentative: rev(by('tentative')), revConfirmed: rev(by('confirmed')),
    depositsDue: live.filter((e) => e.status !== 'closed' && eventTotals(d, e, day).depositOwing > 0),
    cutOffs: live.filter((e) => (e.status === 'prospect' || e.status === 'tentative') && e.cutOff && e.cutOff <= day),
    tasksDue: live.flatMap((e) => e.tasks.filter((t) => !t.done && t.due <= day).map((t) => ({ e, t }))),
  };
}
/** What is on in the spaces on a day, by start time. */
export function eventsOn(d: DB, day: string) {
  return hotelEvents(d).filter((e) => e.status !== 'cancelled').flatMap((e) => e.subEvents.filter((s) => s.date === day).map((s) => ({ e, s })))
    .sort((a, b) => a.s.start.localeCompare(b.s.start));
}
