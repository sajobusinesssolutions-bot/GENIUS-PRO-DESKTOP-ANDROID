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
}
export interface BookedRoom { roomId: string; typeId: string; rate: number; adults: number; children: number }
export interface FolioCharge {
  id: string; ts: string; desc: string; amount: number;
  /** Who pays it: the guest, or the company on a company booking. */
  payer: 'guest' | 'company';
  by?: string;
}
export interface FolioPayment { id: string; ts: string; amount: number; method: 'cash' | 'momo' | 'bank' | 'card'; note?: string; by?: string }
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
export interface HotelSettings { checkInTime: string; checkOutTime: string; depositPct: number }

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

export function hotelSettings(d: DB | null | undefined): HotelSettings {
  return { checkInTime: '14:00', checkOutTime: '10:00', depositPct: 0, ...((d as any)?.settings?.hotel || {}) };
}
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
  const total = Math.max(0, stay.total + charges - discount);
  const paid = b.payments.reduce((a, p) => a + p.amount, 0);
  const company = b.companyId ? (b.roomsPaidBy === 'company' ? stay.total : 0) + b.charges.filter((c) => c.payer === 'company').reduce((a, c) => a + c.amount, 0) : 0;
  return { stay, charges, discount, total, paid, balance: total - paid, companyPart: Math.max(0, company - (b.companyId ? discount : 0)), guestPart: Math.max(0, total - company + (b.companyId ? discount : 0)) };
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
