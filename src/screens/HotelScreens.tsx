/**
 * THE HOTEL'S RECEPTION (hotel.ts, actions/hotel.ts).
 *
 *   FrontDesk      the day at a glance (arrivals, departures, in house, how
 *                  full), the room board (every room in its state, tap for
 *                  its guest or to book it), a two-week calendar, and the
 *                  bookings list.
 *   BookingEdit    a new booking or a change: individual, couple / family or
 *                  a company group; dates, rooms free for them, the rate plan,
 *                  the guests and the price with seasons and offers.
 *   Booking        one booking: its guests (the register), the bill, payments,
 *                  and what comes next — confirm, check in, check out, cancel.
 *   HotelSetup     room types, rooms, rate plans, seasons, offers and times.
 *   GuestRegister  everyone who stayed, with what the register asks.
 */
import React, { useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme, fonts } from '../theme';
import { Icon } from '../components/icons';
import { Card, Cap, Button, EmptyState, Chip } from '../components/ui';
import { Field, SelectField, Seg, ToggleRow } from '../components/form';
import Sheet from '../components/Sheet';
import { useToast } from '../components/Toast';
import { useAppData } from '../data/AppDataContext';
import { useGo } from '../nav/navigate';
import {
  type Booking, type BookingKind, type BookedRoom, type Guest, type RoomStatus, type FolioPayment,
  KIND_WORD, ROOM_WORD, SOURCES, STATUS_WORD, addDays, bookingOn, bookings, checkInMissing, dayAtDesk, folioOf,
  freeRooms, guestRegister, hotelSettings, nightsOf, priceStay, ratePlans, roomTypes, rooms, seasons, stayOffers, today,
} from '../data/hotel';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const nice = (day: string) => { const d = new Date(day.slice(0, 10) + 'T12:00:00'); return DOW[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()]; };
const short = (day: string) => { const d = new Date(day.slice(0, 10) + 'T12:00:00'); return d.getDate() + ' ' + MON[d.getMonth()]; };

function useTones() {
  const { colors } = useTheme();
  return {
    room: { clean: colors.good, inspected: colors.accent, dirty: colors.warn, ooo: colors.danger } as Record<RoomStatus, string>,
    status: { provisional: colors.warn, confirmed: colors.accent, in: colors.good, out: colors.faint, cancelled: colors.danger, noshow: colors.danger } as Record<Booking['status'], string>,
  };
}

function Badge({ text, color }: { text: string; color: string }) {
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: color + '22' }}>
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11, color }}>{text}</Text>
    </View>
  );
}

function DateField({ label, value, onChange, min }: { label: string; value: string; onChange: (v: string) => void; min?: string }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ flex: 1 }}>
      <Pressable onPress={() => setOpen(true)} style={{ borderWidth: 1, borderColor: colors.line, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: colors.surface }}>
        <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint }}>{label}</Text>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink, marginTop: 2 }}>{value ? nice(value) : 'Pick a date'}</Text>
      </Pressable>
      {open ? (
        <DateTimePicker
          value={value ? new Date(value + 'T12:00:00') : new Date()}
          minimumDate={min ? new Date(min + 'T00:00:00') : undefined}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onDismiss={() => setOpen(false)}
          onValueChange={(_e: unknown, date?: Date) => {
            setOpen(false);
            if (date) onChange(new Date(date.getTime() - date.getTimezoneOffset() * 6e4).toISOString().slice(0, 10));
          }}
        />
      ) : null}
    </View>
  );
}

/* ═══════════════════════════ FRONT DESK ═══════════════════════════ */
type DeskTab = 'today' | 'rooms' | 'calendar' | 'bookings';

export function FrontDeskScreen() {
  const { colors } = useTheme();
  const go = useGo();
  const { db, money, can, hotel } = useAppData() as any;
  const tones = useTones();
  const [tab, setTab] = useState<DeskTab>('today');
  const [roomSheet, setRoomSheet] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [start, setStart] = useState(today());
  if (!db) return null;
  const desk = dayAtDesk(db);
  const list = rooms(db).filter((r) => r.active);

  if (!list.length) {
    return (
      <EmptyState icon="chair" title="Set up your rooms first" subtitle="Add your room types (Single, Double, Suite) with their rates, then each room by number."
        actionLabel="Set up rooms" onAction={() => go('HotelSetup')} />
    );
  }

  const BookingRow = ({ b, last }: { b: Booking; last?: boolean }) => {
    const f = folioOf(db, b);
    return (
      <Pressable onPress={() => go('Booking', { id: b.id })} style={({ pressed }) => ({ paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.line, backgroundColor: pressed ? colors.sunk : 'transparent' })}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 14.5, color: colors.ink }}>{b.groupName || b.guests[0]?.name || 'Guest'}</Text>
          <Badge text={STATUS_WORD[b.status]} color={tones.status[b.status]} />
        </View>
        <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
          {b.no} · Room {b.rooms.map((r) => rooms(db).find((x) => x.id === r.roomId)?.no || '?').join(', ')} · {short(b.arrive)} → {short(b.depart)} · {nightsOf(b.arrive, b.depart)} n
        </Text>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: f.balance > 0 ? colors.warn : colors.good, marginTop: 3 }}>
          {f.balance > 0 ? money(f.balance) + ' to pay' : 'Paid · ' + money(f.total)}
        </Text>
      </Pressable>
    );
  };

  const sheetRoom = roomSheet ? list.find((r) => r.id === roomSheet) : null;
  const sheetBooking = sheetRoom ? bookingOn(db, sheetRoom.id, today()) : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <Seg value={tab} onChange={setTab} options={[{ v: 'today', l: 'Today' }, { v: 'rooms', l: 'Rooms' }, { v: 'calendar', l: 'Calendar' }, { v: 'bookings', l: 'Bookings' }]} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 110 }}>
        {tab === 'today' ? (
          <>
            {/* how full the house is */}
            <Card style={{ padding: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                <View>
                  <Cap>Occupancy tonight</Cap>
                  <Text style={{ fontFamily: fonts.uiExtra, fontSize: 32, color: colors.ink, marginTop: 4 }}>{desk.occupancy}%</Text>
                </View>
                <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint, textAlign: 'right' }}>
                  {desk.occupied} of {desk.sellable} rooms{'\n'}{desk.guests} guest{desk.guests === 1 ? '' : 's'} in house
                </Text>
              </View>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.sunk, marginTop: 12, overflow: 'hidden' }}>
                <View style={{ width: `${desk.occupancy}%` as `${number}%`, height: 8, backgroundColor: colors.accent }} />
              </View>
              <View style={{ flexDirection: 'row', marginTop: 14, gap: 8 }}>
                {[['Arriving', desk.arrivals.length], ['Leaving', desk.departures.length], ['Dirty', desk.dirty], ['Out of order', desk.ooo]].map(([l, n]) => (
                  <View key={l as string} style={{ flex: 1, padding: 10, borderRadius: 6, backgroundColor: colors.sunk }}>
                    <Text style={{ fontFamily: fonts.uiExtra, fontSize: 18, color: colors.ink }}>{n}</Text>
                    <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 1 }}>{l}</Text>
                  </View>
                ))}
              </View>
              {desk.adr ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 10 }}>Average room rate tonight: {money(desk.adr)}</Text> : null}
            </Card>

            {desk.late.length ? (
              <>
                <Cap style={{ marginTop: 18, marginBottom: 8, color: colors.danger }}>Should have arrived · {desk.late.length}</Cap>
                <Card>{desk.late.map((b, i) => <BookingRow key={b.id} b={b} last={i === desk.late.length - 1} />)}</Card>
              </>
            ) : null}
            <Cap style={{ marginTop: 18, marginBottom: 8 }}>Arriving today · {desk.arrivals.length}</Cap>
            <Card>{desk.arrivals.length ? desk.arrivals.map((b, i) => <BookingRow key={b.id} b={b} last={i === desk.arrivals.length - 1} />)
              : <Text style={{ padding: 14, fontFamily: fonts.ui, color: colors.faint }}>Nobody is due today.</Text>}</Card>
            <Cap style={{ marginTop: 18, marginBottom: 8 }}>Leaving today · {desk.departures.length}</Cap>
            <Card>{desk.departures.length ? desk.departures.map((b, i) => <BookingRow key={b.id} b={b} last={i === desk.departures.length - 1} />)
              : <Text style={{ padding: 14, fontFamily: fonts.ui, color: colors.faint }}>Nobody checks out today.</Text>}</Card>
            <Cap style={{ marginTop: 18, marginBottom: 8 }}>In house · {desk.inHouse.length}</Cap>
            <Card>{desk.inHouse.length ? desk.inHouse.map((b, i) => <BookingRow key={b.id} b={b} last={i === desk.inHouse.length - 1} />)
              : <Text style={{ padding: 14, fontFamily: fonts.ui, color: colors.faint }}>The house is empty.</Text>}</Card>
          </>
        ) : null}

        {tab === 'rooms' ? (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {(Object.keys(ROOM_WORD) as RoomStatus[]).map((s) => (
                <View key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginRight: 8 }}>
                  <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: tones.room[s] }} />
                  <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.soft }}>{ROOM_WORD[s]}</Text>
                </View>
              ))}
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {list.map((r) => {
                const b = bookingOn(db, r.id, today());
                const type = roomTypes(db).find((t) => t.id === r.typeId);
                const occ = b && b.status === 'in';
                return (
                  <Pressable key={r.id} onPress={() => setRoomSheet(r.id)} style={({ pressed }) => ({
                    width: '31%', minWidth: 96, borderRadius: 8, padding: 10, backgroundColor: occ ? colors.accentSoft : colors.surface,
                    borderWidth: 1, borderColor: occ ? colors.accent : colors.line, opacity: pressed ? 0.85 : 1,
                  })}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={{ fontFamily: fonts.uiExtra, fontSize: 18, color: colors.ink }}>{r.no}</Text>
                      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: tones.room[r.status] }} />
                    </View>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 2 }}>{type?.name || 'Room'}</Text>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: occ ? colors.accent : b ? colors.warn : colors.good, marginTop: 6 }}>
                      {occ ? b!.guests[0]?.name : b ? 'Due · ' + (b.guests[0]?.name || '') : 'Free'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {tab === 'calendar' ? (() => {
          const days = Array.from({ length: 14 }, (_, i) => addDays(start, i));
          const W = 44;
          return (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <Button size="sm" label="‹ Week" onPress={() => setStart(addDays(start, -7))} />
                <Button size="sm" label="Today" onPress={() => setStart(today())} />
                <Button size="sm" label="Week ›" onPress={() => setStart(addDays(start, 7))} />
              </View>
              <Card style={{ padding: 0 }}>
                <ScrollView horizontal>
                  <View>
                    <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.line }}>
                      <View style={{ width: 62, padding: 8 }}><Text style={{ fontFamily: fonts.uiSemi, fontSize: 11, color: colors.faint }}>ROOM</Text></View>
                      {days.map((d) => (
                        <View key={d} style={{ width: W, paddingVertical: 6, alignItems: 'center', backgroundColor: d === today() ? colors.accentSoft : 'transparent' }}>
                          <Text style={{ fontFamily: fonts.ui, fontSize: 10.5, color: colors.faint }}>{DOW[new Date(d + 'T12:00:00').getDay()]}</Text>
                          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink }}>{+d.slice(8)}</Text>
                        </View>
                      ))}
                    </View>
                    {list.map((r) => (
                      <View key={r.id} style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.line, height: 40, alignItems: 'center' }}>
                        <View style={{ width: 62, paddingHorizontal: 8 }}><Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink }}>{r.no}</Text></View>
                        {days.map((d) => {
                          const b = bookingOn(db, r.id, d);
                          const first = b && (b.arrive.slice(0, 10) === d || d === start);
                          return (
                            <Pressable key={d} onPress={() => (b ? go('Booking', { id: b.id }) : go('BookingEdit', { roomId: r.id, arrive: d }))}
                              style={{ width: W, height: 40, justifyContent: 'center', paddingHorizontal: 1 }}>
                              {b ? (
                                <View style={{ height: 26, borderRadius: 4, backgroundColor: tones.status[b.status], opacity: b.status === 'provisional' ? 0.6 : 0.9, justifyContent: 'center', paddingHorizontal: 4, overflow: 'hidden' }}>
                                  {first ? <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 10, color: '#fff', width: 120 }}>{b.guests[0]?.name}</Text> : null}
                                </View>
                              ) : null}
                            </Pressable>
                          );
                        })}
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </Card>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 8 }}>Tap an empty night to book that room from that day; tap a booking to open it.</Text>
            </>
          );
        })() : null}

        {tab === 'bookings' ? (() => {
          const n = q.trim().toLowerCase();
          const all = bookings(db).slice().sort((a, b) => b.arrive.localeCompare(a.arrive))
            .filter((b) => !n || [b.no, b.groupName, ...b.guests.map((g) => g.name + ' ' + (g.phone || ''))].join(' ').toLowerCase().includes(n));
          return (
            <>
              <Field icon="search" value={q} onChangeText={setQ} placeholder="Search guest, phone or booking number" />
              <Card style={{ marginTop: 12 }}>
                {all.length ? all.slice(0, 200).map((b, i) => <BookingRow key={b.id} b={b} last={i === Math.min(all.length, 200) - 1} />)
                  : <Text style={{ padding: 14, fontFamily: fonts.ui, color: colors.faint }}>No bookings yet.</Text>}
              </Card>
            </>
          );
        })() : null}

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
          <View style={{ flex: 1 }}><Button label="Guest register" onPress={() => go('GuestRegister')} /></View>
          <View style={{ flex: 1 }}><Button label="Rooms & rates" onPress={() => go('HotelSetup')} /></View>
        </View>
      </ScrollView>

      {can('hotel.book') ? (
        <Pressable onPress={() => go('BookingEdit')} style={({ pressed }) => ({
          position: 'absolute', right: 18, bottom: 22, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, height: 50, borderRadius: 25,
          backgroundColor: colors.accent, elevation: 6, opacity: pressed ? 0.9 : 1,
        })}>
          <Icon name="plus" size={18} color={colors.accentInk} />
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.accentInk }}>New booking</Text>
        </Pressable>
      ) : null}

      <Sheet visible={!!sheetRoom} title={sheetRoom ? 'Room ' + sheetRoom.no : ''} subtitle={sheetRoom ? (roomTypes(db).find((t) => t.id === sheetRoom.typeId)?.name || '') + ' · ' + ROOM_WORD[sheetRoom.status] : ''} icon="chair" onClose={() => setRoomSheet(null)}>
        {sheetRoom ? (
          <View style={{ gap: 10 }}>
            {sheetBooking ? <Button variant="pri" label={'Open ' + (sheetBooking.guests[0]?.name || 'booking')} onPress={() => { setRoomSheet(null); go('Booking', { id: sheetBooking.id }); }} />
              : <Button variant="pri" label="Book this room" onPress={() => { setRoomSheet(null); go('BookingEdit', { roomId: sheetRoom.id }); }} />}
            <Cap style={{ marginTop: 6 }}>Housekeeping</Cap>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(Object.keys(ROOM_WORD) as RoomStatus[]).map((s) => (
                <Chip key={s} label={ROOM_WORD[s]} on={sheetRoom.status === s} onPress={() => { try { hotel.setRoomStatus(sheetRoom.id, s); } catch (e: any) { Alert.alert('Cannot do that', e.message); } }} />
              ))}
            </View>
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}

/* ═══════════════════════════ NEW / CHANGE A BOOKING ═══════════════════════════ */
export function BookingEditScreen({ route, navigation }: any) {
  const { colors } = useTheme();
  const { db, money, hotel } = useAppData() as any;
  const { success } = useToast();
  const existing: Booking | undefined = route?.params?.id ? bookings(db).find((b) => b.id === route.params.id) : undefined;
  const set0 = hotelSettings(db);
  const [kind, setKind] = useState<BookingKind>(existing?.kind || 'individual');
  const [source, setSource] = useState(existing?.source || 'Walk-in');
  const [arrive, setArrive] = useState(existing?.arrive.slice(0, 10) || route?.params?.arrive || today());
  const [depart, setDepart] = useState(existing?.depart.slice(0, 10) || addDays(route?.params?.arrive || today(), 1));
  const [picked, setPicked] = useState<BookedRoom[]>(() => {
    if (existing) return existing.rooms;
    const r = route?.params?.roomId ? rooms(db).find((x) => x.id === route.params.roomId) : null;
    const t = r ? roomTypes(db).find((x) => x.id === r.typeId) : null;
    return r ? [{ roomId: r.id, typeId: r.typeId, rate: t?.rate || 0, adults: kind === 'individual' ? 1 : 2, children: 0 }] : [];
  });
  const [plan, setPlan] = useState<string>(existing?.ratePlanId || '');
  const [guests, setGuests] = useState<Guest[]>(existing?.guests || [{ name: '', phone: '', nationality: 'Ugandan' }]);
  const [companyId, setCompanyId] = useState<string>(existing?.companyId || '');
  const [groupName, setGroupName] = useState(existing?.groupName || '');
  const [roomsPaidBy, setRoomsPaidBy] = useState<'guest' | 'company'>(existing?.roomsPaidBy || 'company');
  const [discount, setDiscount] = useState(String(existing?.discount || ''));
  const [note, setNote] = useState(existing?.note || '');
  const [confirmed, setConfirmed] = useState(existing ? existing.status !== 'provisional' : true);
  const [typeFilter, setTypeFilter] = useState('');
  if (!db) return null;

  const nights = nightsOf(arrive, depart);
  const free = nights > 0 ? freeRooms(db, arrive, depart, typeFilter || undefined, existing?.id) : [];
  const price = priceStay(db, { arrive, depart, rooms: picked, ratePlanId: plan || null });
  const total = Math.max(0, price.total - (Number(discount) || 0));
  const companies = db.parties.filter((p: any) => p.type === 'customer' && p.active !== false);
  const toggleRoom = (id: string) => {
    if (picked.some((p) => p.roomId === id)) { setPicked(picked.filter((p) => p.roomId !== id)); return; }
    const r = rooms(db).find((x) => x.id === id)!;
    const t = roomTypes(db).find((x) => x.id === r.typeId);
    const one = kind === 'individual';
    setPicked([...(one ? [] : picked), { roomId: id, typeId: r.typeId, rate: t?.rate || 0, adults: one ? 1 : 2, children: 0 }]);
  };
  const setG = (i: number, p: Partial<Guest>) => setGuests(guests.map((g, j) => (j === i ? { ...g, ...p } : g)));

  const save = () => {
    try {
      const b = hotel.saveBooking({
        id: existing?.id, kind, source, arrive, depart, rooms: picked, ratePlanId: plan || null,
        status: existing && existing.status !== 'provisional' && existing.status !== 'confirmed' ? existing.status : confirmed ? 'confirmed' : 'provisional',
        guests: guests.filter((g, i) => i === 0 || g.name.trim()), companyId: kind === 'group' ? companyId || null : null,
        groupName: kind === 'group' ? groupName : undefined, roomsPaidBy: kind === 'group' && companyId ? roomsPaidBy : 'guest',
        discount: Number(discount) || 0, note, partyId: existing?.partyId || null,
        holdUntil: confirmed ? undefined : addDays(today(), 2),
      });
      success(existing ? 'Booking saved' : 'Booked · ' + b.no);
      navigation.replace('Booking', { id: b.id });
    } catch (e: any) { Alert.alert('Cannot save the booking', e.message); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 14 }} keyboardShouldPersistTaps="handled">
        <Card style={{ padding: 14, gap: 12 }}>
          <Cap>Who is coming</Cap>
          <Seg value={kind} onChange={(k) => { setKind(k); if (k === 'individual' && picked.length > 1) setPicked(picked.slice(0, 1)); }}
            options={(Object.keys(KIND_WORD) as BookingKind[]).map((k) => ({ v: k, l: KIND_WORD[k] }))} />
          {kind === 'group' ? (
            <>
              <Field label="Group name" value={groupName} onChangeText={setGroupName} placeholder="MTN regional training" />
              <SelectField label="Company billed (optional)" value={companyId} onChange={setCompanyId} placeholder="No company — the guests pay"
                options={[{ v: '', l: 'No company — the guests pay' }, ...companies.map((p: any) => ({ v: p.id, l: p.name }))]} />
              {companyId ? (
                <Seg value={roomsPaidBy} onChange={setRoomsPaidBy} options={[{ v: 'company', l: 'Company pays the rooms' }, { v: 'guest', l: 'Guests pay the rooms' }]} />
              ) : null}
            </>
          ) : null}
          <SelectField label="Booked through" value={source} onChange={setSource} options={SOURCES.map((s) => ({ v: s, l: s }))} />
        </Card>

        <Card style={{ padding: 14, gap: 12 }}>
          <Cap>When</Cap>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <DateField label="Arrive" value={arrive} onChange={(v) => { setArrive(v); if (depart <= v) setDepart(addDays(v, 1)); }} />
            <DateField label="Leave" value={depart} min={addDays(arrive, 1)} onChange={setDepart} />
          </View>
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.soft }}>
            {nights} night{nights === 1 ? '' : 's'} · in from {set0.checkInTime}, out by {set0.checkOutTime}
          </Text>
        </Card>

        <Card style={{ padding: 14, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Cap style={{ flex: 1 }}>Rooms · {picked.length} chosen</Cap>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{free.length} free</Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            <Chip label="All types" on={!typeFilter} onPress={() => setTypeFilter('')} />
            {roomTypes(db).filter((t) => t.active).map((t) => <Chip key={t.id} label={t.name + ' · ' + money(t.rate)} on={typeFilter === t.id} onPress={() => setTypeFilter(t.id)} />)}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {[...picked.map((p) => rooms(db).find((r) => r.id === p.roomId)!).filter(Boolean), ...free.filter((r) => !picked.some((p) => p.roomId === r.id))].map((r) => {
              const on = picked.some((p) => p.roomId === r.id);
              return (
                <Pressable key={r.id} onPress={() => toggleRoom(r.id)} style={{ paddingHorizontal: 12, paddingVertical: 9, borderRadius: 6, borderWidth: 1.5, borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accentSoft : colors.surface }}>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: on ? colors.accent : colors.ink }}>{r.no}</Text>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>{roomTypes(db).find((t) => t.id === r.typeId)?.name}</Text>
                </Pressable>
              );
            })}
          </View>
          {picked.map((p, i) => {
            const r = rooms(db).find((x) => x.id === p.roomId);
            const upd = (x: Partial<BookedRoom>) => setPicked(picked.map((y, j) => (j === i ? { ...y, ...x } : y)));
            return (
              <View key={p.roomId} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Text style={{ width: 52, fontFamily: fonts.uiSemi, color: colors.ink }}>{r?.no}</Text>
                <Field style={{ flex: 1.4 }} compact label="Rate a night" numeric money value={String(p.rate)} onChangeText={(v) => upd({ rate: Number(v) || 0 })} />
                <Field style={{ flex: 1 }} compact label="Adults" numeric money={false} value={String(p.adults)} onChangeText={(v) => upd({ adults: Math.max(1, Number(v) || 1) })} />
                <Field style={{ flex: 1 }} compact label="Children" numeric money={false} value={String(p.children)} onChangeText={(v) => upd({ children: Math.max(0, Number(v) || 0) })} />
              </View>
            );
          })}
          {ratePlans(db).filter((x) => x.active).length ? (
            <SelectField label="Rate plan" value={plan} onChange={setPlan}
              options={[{ v: '', l: 'Room only' }, ...ratePlans(db).filter((x) => x.active).map((x) => ({ v: x.id, l: x.name }))]} />
          ) : null}
        </Card>

        <Card style={{ padding: 14, gap: 10 }}>
          <Cap>{kind === 'individual' ? 'The guest' : 'The guests'}</Cap>
          {guests.map((g, i) => (
            <View key={i} style={{ gap: 8, paddingBottom: 8, borderBottomWidth: i < guests.length - 1 ? 1 : 0, borderBottomColor: colors.line }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Field style={{ flex: 1.4 }} label={i === 0 ? 'Main guest' : 'Guest ' + (i + 1)} value={g.name} onChangeText={(v) => setG(i, { name: v })} autoCapitalize="words" />
                <Field style={{ flex: 1 }} label="Phone" keyboard="phone-pad" value={g.phone || ''} onChangeText={(v) => setG(i, { phone: v })} />
              </View>
              {i === 0 || kind !== 'individual' ? (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Field style={{ flex: 1 }} label="ID or passport no." value={g.idNo || ''} onChangeText={(v) => setG(i, { idNo: v })} autoCapitalize="characters" />
                  <Field style={{ flex: 1 }} label="Nationality" value={g.nationality || ''} onChangeText={(v) => setG(i, { nationality: v })} autoCapitalize="words" />
                </View>
              ) : null}
            </View>
          ))}
          {kind !== 'individual' ? <Button size="sm" label="+ Add a guest" onPress={() => setGuests([...guests, { name: '', nationality: 'Ugandan' }])} /> : null}
          <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>ID and nationality can wait until check-in; the register needs them then.</Text>
        </Card>

        <Card style={{ padding: 14, gap: 8 }}>
          <Cap>Price</Cap>
          {price.lines.map((l, i) => (
            <View key={i} style={{ flexDirection: 'row' }}>
              <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 13.5, color: l.amount < 0 ? colors.good : colors.soft }}>{l.desc}</Text>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: l.amount < 0 ? colors.good : colors.ink }}>{l.amount < 0 ? '−' + money(-l.amount) : money(l.amount)}</Text>
            </View>
          ))}
          <Field label="Discount" numeric money value={discount} onChangeText={setDiscount} />
          <View style={{ flexDirection: 'row', marginTop: 4 }}>
            <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 16, color: colors.ink }}>Total</Text>
            <Text style={{ fontFamily: fonts.uiExtra, fontSize: 18, color: colors.ink }}>{money(total)}</Text>
          </View>
          {set0.depositPct ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>Deposit asked: {set0.depositPct}% · {money(Math.round(total * set0.depositPct / 100))}</Text> : null}
          <Field label="Note" value={note} onChangeText={setNote} multiline placeholder="Late arrival, extra bed, airport pickup…" />
          <ToggleRow bare label="Confirmed" sub={confirmed ? 'The rooms are held for these dates' : 'Provisional: held 2 days unless a deposit or confirmation comes'} on={confirmed} onChange={setConfirmed} />
        </Card>
      </ScrollView>
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 14, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line }}>
        <Button variant="pri" label={existing ? 'Save booking' : 'Book ' + picked.length + ' room' + (picked.length === 1 ? '' : 's') + ' · ' + money(total)} onPress={save} />
      </View>
    </View>
  );
}

/* ═══════════════════════════ ONE BOOKING ═══════════════════════════ */
export function BookingScreen({ route, navigation }: any) {
  const { colors } = useTheme();
  const go = useGo();
  const { db, money, can, hotel, party } = useAppData() as any;
  const tones = useTones();
  const { success } = useToast();
  const [charge, setCharge] = useState(false);
  const [pay, setPay] = useState(false);
  const [desc, setDesc] = useState('');
  const [amt, setAmt] = useState('');
  const [payer, setPayer] = useState<'guest' | 'company'>('guest');
  const [method, setMethod] = useState<FolioPayment['method']>('cash');
  const b: Booking | undefined = bookings(db).find((x) => x.id === route?.params?.id);
  if (!db) return null;
  if (!b) return <EmptyState icon="calendar" title="Booking not found" subtitle="It may have been removed on another device." />;
  const f = folioOf(db, b);
  const company = b.companyId ? party?.(b.companyId) || db.parties.find((p: any) => p.id === b.companyId) : null;
  const run = (what: string, fn: () => void, ok?: string) => { try { fn(); if (ok) success(ok); } catch (e: any) { Alert.alert('Cannot ' + what, e.message); } };
  const missing = checkInMissing(b);
  const quick = ['Laundry', 'Minibar', 'Room service', 'Restaurant', 'Bar', 'Airport transfer', 'Extra bed', 'Late check-out', 'Damage'];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 14 }}>
        <Card style={{ padding: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ flex: 1, fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink }} numberOfLines={2}>{b.groupName || b.guests[0]?.name}</Text>
            <Badge text={STATUS_WORD[b.status]} color={tones.status[b.status]} />
          </View>
          <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint, marginTop: 4 }}>
            {b.no} · {KIND_WORD[b.kind]} · {b.source}{company ? ' · billed to ' + company.name : ''}
          </Text>
          <View style={{ flexDirection: 'row', marginTop: 14, gap: 8 }}>
            {[['Arrive', nice(b.arrive)], ['Leave', nice(b.depart)], ['Nights', String(nightsOf(b.arrive, b.depart))]].map(([l, v]) => (
              <View key={l} style={{ flex: 1, padding: 10, borderRadius: 6, backgroundColor: colors.sunk }}>
                <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint }}>{l}</Text>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink, marginTop: 2 }}>{v}</Text>
              </View>
            ))}
          </View>
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.soft, marginTop: 12 }}>
            Room {b.rooms.map((r) => rooms(db).find((x) => x.id === r.roomId)?.no + ' (' + (roomTypes(db).find((t) => t.id === r.typeId)?.name || '') + ')').join(', ')}
          </Text>
          {b.note ? <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.soft, marginTop: 6 }}>{b.note}</Text> : null}
        </Card>

        {/* what happens next */}
        {b.status === 'provisional' || b.status === 'confirmed' ? (
          <View style={{ gap: 10 }}>
            {missing.length && b.status !== 'provisional' ? (
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.warn }}>For check-in, add {missing.join(', ')}.</Text>
            ) : null}
            {can('hotel.checkin') ? <Button variant="pri" label="Check in" onPress={() => {
              if (missing.length) { Alert.alert('The guest register needs more', 'Add ' + missing.join(', ') + ' first.', [{ text: 'Not now', style: 'cancel' }, { text: 'Add them', onPress: () => go('BookingEdit', { id: b.id }) }]); return; }
              run('check in', () => hotel.checkIn(b.id), 'Checked in · welcome ' + b.guests[0].name);
            }} /> : null}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {b.status === 'provisional' ? <View style={{ flex: 1 }}><Button label="Confirm" onPress={() => run('confirm', () => hotel.setBookingStatus(b.id, 'confirmed'), 'Confirmed')} /></View> : null}
              <View style={{ flex: 1 }}><Button label="Change" onPress={() => go('BookingEdit', { id: b.id })} /></View>
              {can('hotel.cancel') ? <View style={{ flex: 1 }}><Button variant="dngr" label="Cancel…" onPress={() => Alert.alert('Cancel booking ' + b.no + '?', 'The rooms are let go for these dates. Deposits taken stay on the bill until refunded.', [
                { text: 'Keep it', style: 'cancel' },
                { text: 'No-show', onPress: () => run('mark a no-show', () => hotel.setBookingStatus(b.id, 'noshow'), 'Marked as a no-show') },
                { text: 'Cancel booking', style: 'destructive', onPress: () => run('cancel', () => hotel.setBookingStatus(b.id, 'cancelled'), 'Booking cancelled') },
              ])} /></View> : null}
            </View>
          </View>
        ) : null}

        {/* the bill */}
        <Card style={{ padding: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <Cap style={{ flex: 1 }}>The bill</Cap>
            {b.status !== 'out' && b.status !== 'cancelled' && can('hotel.charge') ? (
              <Pressable onPress={() => { setDesc(''); setAmt(''); setPayer('guest'); setCharge(true); }} hitSlop={8}><Text style={{ fontFamily: fonts.uiSemi, color: colors.accent }}>+ Charge</Text></Pressable>
            ) : null}
          </View>
          {f.stay.lines.map((l, i) => (
            <View key={'s' + i} style={{ flexDirection: 'row', paddingVertical: 5 }}>
              <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 13.5, color: l.amount < 0 ? colors.good : colors.soft }}>{l.desc}{company && b.roomsPaidBy === 'company' ? ' · company' : ''}</Text>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: l.amount < 0 ? colors.good : colors.ink }}>{l.amount < 0 ? '−' + money(-l.amount) : money(l.amount)}</Text>
            </View>
          ))}
          {b.charges.map((c) => (
            <Pressable key={c.id} onLongPress={() => b.status !== 'out' && Alert.alert('Remove ' + c.desc + '?', money(c.amount) + ' comes off the bill.', [{ text: 'Keep', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => run('remove the charge', () => hotel.removeCharge(b.id, c.id)) }])}
              style={{ flexDirection: 'row', paddingVertical: 5 }}>
              <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 13.5, color: colors.soft }}>{c.desc}{company ? ' · ' + c.payer : ''} <Text style={{ color: colors.faint, fontSize: 11.5 }}>{short(c.ts)}</Text></Text>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>{money(c.amount)}</Text>
            </Pressable>
          ))}
          {f.discount ? <View style={{ flexDirection: 'row', paddingVertical: 5 }}><Text style={{ flex: 1, fontFamily: fonts.ui, color: colors.good }}>Discount</Text><Text style={{ fontFamily: fonts.uiSemi, color: colors.good }}>−{money(f.discount)}</Text></View> : null}
          <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 8 }} />
          <View style={{ flexDirection: 'row' }}><Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>Total</Text><Text style={{ fontFamily: fonts.uiExtra, fontSize: 15, color: colors.ink }}>{money(f.total)}</Text></View>
          {b.payments.map((p) => (
            <View key={p.id} style={{ flexDirection: 'row', paddingTop: 5 }}>
              <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 13, color: colors.good }}>Paid · {p.method === 'momo' ? 'Mobile money' : p.method[0].toUpperCase() + p.method.slice(1)} · {short(p.ts)}</Text>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.good }}>−{money(p.amount)}</Text>
            </View>
          ))}
          <View style={{ flexDirection: 'row', marginTop: 8 }}>
            <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 16, color: f.balance > 0 ? colors.warn : colors.good }}>{f.balance > 0 ? 'To pay' : f.balance < 0 ? 'In credit' : 'Settled'}</Text>
            <Text style={{ fontFamily: fonts.uiExtra, fontSize: 18, color: f.balance > 0 ? colors.warn : colors.good }}>{money(Math.abs(f.balance))}</Text>
          </View>
          {company ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 6 }}>{company.name} pays {money(f.companyPart)} on account · the guest pays {money(f.guestPart)}</Text> : null}
        </Card>

        {b.status !== 'out' && b.status !== 'cancelled' && can('hotel.checkout') ? (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Button label={b.status === 'in' ? 'Take payment' : 'Take a deposit'} onPress={() => { setAmt(String(Math.max(0, company ? f.guestPart - f.paid : f.balance) || '')); setMethod('cash'); setPay(true); }} /></View>
            {b.status === 'in' ? <View style={{ flex: 1 }}><Button variant="pri" label="Check out" onPress={() => {
              const owe = (company ? f.guestPart : f.total) - f.paid;
              Alert.alert('Check out ' + (b.groupName || b.guests[0].name) + '?',
                (owe > 0 ? money(owe) + ' is still unpaid and goes on ' + (b.guests[0].name) + '’s account. ' : 'The guest’s bill is settled. ')
                + (company ? company.name + ' is billed ' + money(f.companyPart) + ' on account. ' : '')
                + 'The room' + (b.rooms.length > 1 ? 's go' : ' goes') + ' to housekeeping as dirty.',
                [{ text: 'Not yet', style: 'cancel' }, { text: 'Check out', onPress: () => run('check out', () => hotel.checkOut(b.id), 'Checked out · the bill is in sales') }]);
            }} /></View> : null}
          </View>
        ) : null}

        {/* the register */}
        <Card style={{ padding: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
            <Cap style={{ flex: 1 }}>Guests · register</Cap>
            {b.status !== 'out' ? <Pressable onPress={() => go('BookingEdit', { id: b.id })} hitSlop={8}><Text style={{ fontFamily: fonts.uiSemi, color: colors.accent }}>Edit</Text></Pressable> : null}
          </View>
          {b.guests.map((g, i) => (
            <View key={i} style={{ paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink }}>{g.name}{g.phone ? '  ·  ' + g.phone : ''}</Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: g.idNo ? colors.faint : colors.warn, marginTop: 2 }}>
                {g.idNo ? 'ID ' + g.idNo : 'No ID yet'} · {g.nationality || 'nationality not given'}{g.purpose ? ' · ' + g.purpose : ''}
              </Text>
            </View>
          ))}
        </Card>
      </ScrollView>

      <Sheet visible={charge} title="Charge to the room" icon="receipt" onClose={() => setCharge(false)}
        footer={<Button variant="pri" label="Add to the bill" onPress={() => { try { hotel.postCharge(b.id, { desc, amount: Number(amt), payer }); setCharge(false); success('Added to the bill'); } catch (e: any) { Alert.alert('Cannot add it', e.message); } }} />}>
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{quick.map((x) => <Chip key={x} label={x} on={desc === x} onPress={() => setDesc(x)} />)}</View>
          <Field label="What for" value={desc} onChangeText={setDesc} />
          <Field label="Amount" numeric money value={amt} onChangeText={setAmt} />
          {company ? <Seg value={payer} onChange={setPayer} options={[{ v: 'guest', l: 'Guest pays' }, { v: 'company', l: company.name + ' pays' }]} /> : null}
        </View>
      </Sheet>

      <Sheet visible={pay} title={b.status === 'in' ? 'Take payment' : 'Take a deposit'} icon="money" iconTone="good" onClose={() => setPay(false)}
        footer={<Button variant="pri" label={'Receive ' + money(Number(amt) || 0)} onPress={() => { try { hotel.takeBookingPayment(b.id, { amount: Number(amt), method }); setPay(false); success('Payment received'); } catch (e: any) { Alert.alert('Cannot take it', e.message); } }} />}>
        <View style={{ gap: 12 }}>
          <Seg value={method} onChange={setMethod} options={[{ v: 'cash', l: 'Cash' }, { v: 'momo', l: 'Mobile money' }, { v: 'card', l: 'Card' }, { v: 'bank', l: 'Bank' }]} />
          <Field label="Amount" numeric money value={amt} onChangeText={setAmt} big />
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>Payments are kept on the bill and go into the books with the bill at check-out.</Text>
        </View>
      </Sheet>
      {void navigation}
    </View>
  );
}

/* ═══════════════════════════ SET-UP ═══════════════════════════ */
type SetupTab = 'types' | 'rooms' | 'plans' | 'seasons' | 'policy';
export function HotelSetupScreen() {
  const { colors } = useTheme();
  const { db, money, hotel } = useAppData() as any;
  const { success } = useToast();
  const [tab, setTab] = useState<SetupTab>(() => (roomTypes(db).length ? 'rooms' : 'types'));
  const [edit, setEdit] = useState<any>(null);
  const settings = hotelSettings(db);
  const [times, setTimes] = useState({ checkInTime: settings.checkInTime, checkOutTime: settings.checkOutTime, depositPct: String(settings.depositPct || '') });
  if (!db) return null;
  const types = roomTypes(db);
  const run = (fn: () => void, ok: string) => { try { fn(); setEdit(null); success(ok); } catch (e: any) { Alert.alert('Cannot save', e.message); } };

  const Row = ({ title, sub, onPress, off }: { title: string; sub: string; onPress: () => void; off?: boolean }) => (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: pressed ? colors.sunk : 'transparent', opacity: off ? 0.5 : 1 })}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14.5, color: colors.ink }}>{title}</Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>{sub}</Text>
      </View>
      <Icon name="chev" size={14} color={colors.faint} />
    </Pressable>
  );
  const add = (label: string, onPress: () => void) => (
    <Pressable onPress={onPress} style={{ padding: 14, alignItems: 'center' }}><Text style={{ fontFamily: fonts.uiSemi, color: colors.accent }}>+ {label}</Text></Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ padding: 16, paddingBottom: 6, gap: 8 }}>
        {([['types', 'Room types'], ['rooms', 'Rooms'], ['plans', 'Rate plans'], ['seasons', 'Seasons & offers'], ['policy', 'Times & deposit']] as [SetupTab, string][]).map(([k, l]) => (
          <Chip key={k} label={l} on={tab === k} onPress={() => setTab(k)} />
        ))}
      </ScrollView>
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 8, paddingBottom: 60 }}>
        {tab === 'types' ? (
          <Card>
            {types.map((t) => <Row key={t.id} off={!t.active} title={t.name} sub={money(t.rate) + ' a night · up to ' + t.maxAdults + ' adult' + (t.maxAdults === 1 ? '' : 's') + (t.maxChildren ? ', ' + t.maxChildren + ' child' : '') + ' · ' + rooms(db).filter((r) => r.typeId === t.id).length + ' rooms'} onPress={() => setEdit({ k: 'type', ...t, rate: String(t.rate), maxAdults: String(t.maxAdults), maxChildren: String(t.maxChildren) })} />)}
            {add('Room type', () => setEdit({ k: 'type', name: '', rate: '', maxAdults: '2', maxChildren: '1', amenities: '', active: true }))}
          </Card>
        ) : null}
        {tab === 'rooms' ? (
          types.length ? (
            <Card>
              {rooms(db).map((r) => <Row key={r.id} off={!r.active} title={'Room ' + r.no} sub={(types.find((t) => t.id === r.typeId)?.name || '?') + (r.floor ? ' · floor ' + r.floor : '') + ' · ' + ROOM_WORD[r.status]} onPress={() => setEdit({ k: 'room', ...r })} />)}
              {add('Room', () => setEdit({ k: 'room', no: '', typeId: types[0].id, floor: '', active: true }))}
              {add('Several rooms at once', () => setEdit({ k: 'many', from: '101', to: '110', typeId: types[0].id, floor: '1' }))}
            </Card>
          ) : <EmptyState icon="chair" title="Add a room type first" subtitle="Single, Double, Suite — each with its rate a night." />
        ) : null}
        {tab === 'plans' ? (
          <Card>
            {ratePlans(db).map((p) => <Row key={p.id} off={!p.active} title={p.name} sub={(p.perNight ? (p.perNight > 0 ? '+' : '') + money(p.perNight) + ' a room · ' : '') + (p.perPerson ? money(p.perPerson) + ' a person a night' : 'no meals')} onPress={() => setEdit({ k: 'plan', ...p, perNight: String(p.perNight), perPerson: String(p.perPerson) })} />)}
            {add('Rate plan', () => setEdit({ k: 'plan', name: 'Bed & breakfast', perNight: '0', perPerson: '15000', active: true }))}
          </Card>
        ) : null}
        {tab === 'seasons' ? (
          <>
            <Cap style={{ marginBottom: 8 }}>Seasons — dearer or cheaper dates</Cap>
            <Card>
              {seasons(db).map((s) => <Row key={s.id} off={!s.active} title={s.name} sub={short(s.from) + ' – ' + short(s.to) + ' · ' + (s.pct > 0 ? '+' : '') + s.pct + '%'} onPress={() => setEdit({ k: 'season', ...s, pct: String(s.pct) })} />)}
              {add('Season', () => setEdit({ k: 'season', name: 'Festive season', from: today(), to: addDays(today(), 14), pct: '20', active: true }))}
            </Card>
            <Cap style={{ marginTop: 18, marginBottom: 8 }}>Stay offers</Cap>
            <Card>
              {stayOffers(db).map((o) => <Row key={o.id} off={!o.active} title={o.name} sub={'Stay ' + o.stay + ', pay ' + o.pay + ' · arrivals ' + short(o.from) + ' – ' + short(o.to)} onPress={() => setEdit({ k: 'offer', ...o, stay: String(o.stay), pay: String(o.pay) })} />)}
              {add('Offer', () => setEdit({ k: 'offer', name: 'Stay 3, pay 2', from: today(), to: addDays(today(), 60), stay: '3', pay: '2', active: true }))}
            </Card>
          </>
        ) : null}
        {tab === 'policy' ? (
          <Card style={{ padding: 14, gap: 12 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Field style={{ flex: 1 }} label="Check-in from" value={times.checkInTime} onChangeText={(v) => setTimes({ ...times, checkInTime: v })} placeholder="14:00" />
              <Field style={{ flex: 1 }} label="Check-out by" value={times.checkOutTime} onChangeText={(v) => setTimes({ ...times, checkOutTime: v })} placeholder="10:00" />
            </View>
            <Field label="Deposit asked on booking" numeric money={false} suffix="%" value={times.depositPct} onChangeText={(v) => setTimes({ ...times, depositPct: v })} />
            <Button variant="pri" label="Save" onPress={() => run(() => hotel.saveHotelSettings({ checkInTime: times.checkInTime, checkOutTime: times.checkOutTime, depositPct: Number(times.depositPct) || 0 }), 'Saved')} />
          </Card>
        ) : null}
      </ScrollView>

      <Sheet visible={!!edit} title={!edit ? '' : edit.k === 'type' ? 'Room type' : edit.k === 'room' ? 'Room' : edit.k === 'many' ? 'Add rooms' : edit.k === 'plan' ? 'Rate plan' : edit.k === 'season' ? 'Season' : 'Stay offer'} icon="chair" onClose={() => setEdit(null)}
        footer={edit ? <Button variant="pri" label="Save" onPress={() => {
          const e = edit;
          if (e.k === 'type') run(() => hotel.saveRoomType({ id: e.id, name: e.name, rate: Number(e.rate) || 0, maxAdults: Number(e.maxAdults) || 1, maxChildren: Number(e.maxChildren) || 0, amenities: e.amenities, active: e.active !== false }), 'Room type saved');
          else if (e.k === 'room') run(() => hotel.saveRoom({ id: e.id, no: e.no, typeId: e.typeId, floor: e.floor, active: e.active !== false, status: e.status }), 'Room saved');
          else if (e.k === 'many') run(() => {
            const a = Number(e.from), z = Number(e.to);
            if (!(a > 0 && z >= a && z - a < 200)) throw new Error('Give a first and last room number, such as 101 and 120.');
            for (let n = a; n <= z; n++) if (!rooms(db).some((r) => r.no === String(n))) hotel.saveRoom({ no: String(n), typeId: e.typeId, floor: e.floor, active: true });
          }, 'Rooms added');
          else if (e.k === 'plan') run(() => hotel.saveRatePlan({ id: e.id, name: e.name, perNight: Number(e.perNight) || 0, perPerson: Number(e.perPerson) || 0, active: e.active !== false }), 'Rate plan saved');
          else if (e.k === 'season') run(() => hotel.saveSeason({ id: e.id, name: e.name, from: e.from, to: e.to, pct: Number(e.pct) || 0, active: e.active !== false }), 'Season saved');
          else run(() => hotel.saveStayOffer({ id: e.id, name: e.name, from: e.from, to: e.to, stay: Number(e.stay) || 0, pay: Number(e.pay) || 0, active: e.active !== false }), 'Offer saved');
        }} /> : null}>
        {edit ? (
          <View style={{ gap: 12 }}>
            {edit.k === 'type' ? <>
              <Field label="Name" value={edit.name} onChangeText={(v) => setEdit({ ...edit, name: v })} placeholder="Deluxe double" autoCapitalize="words" />
              <Field label="Rate a night" numeric money value={edit.rate} onChangeText={(v) => setEdit({ ...edit, rate: v })} />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Field style={{ flex: 1 }} label="Adults" numeric money={false} value={edit.maxAdults} onChangeText={(v) => setEdit({ ...edit, maxAdults: v })} />
                <Field style={{ flex: 1 }} label="Children" numeric money={false} value={edit.maxChildren} onChangeText={(v) => setEdit({ ...edit, maxChildren: v })} />
              </View>
              <Field label="What it has" value={edit.amenities || ''} onChangeText={(v) => setEdit({ ...edit, amenities: v })} placeholder="AC, TV, balcony, lake view" />
            </> : null}
            {edit.k === 'room' || edit.k === 'many' ? <>
              {edit.k === 'room' ? <Field label="Room number or name" value={edit.no} onChangeText={(v) => setEdit({ ...edit, no: v })} /> : (
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Field style={{ flex: 1 }} label="From number" numeric money={false} value={edit.from} onChangeText={(v) => setEdit({ ...edit, from: v })} />
                  <Field style={{ flex: 1 }} label="To number" numeric money={false} value={edit.to} onChangeText={(v) => setEdit({ ...edit, to: v })} />
                </View>
              )}
              <SelectField label="Type" value={edit.typeId} onChange={(v) => setEdit({ ...edit, typeId: v })} options={types.map((t) => ({ v: t.id, l: t.name + ' · ' + money(t.rate) }))} />
              <Field label="Floor or block" value={edit.floor || ''} onChangeText={(v) => setEdit({ ...edit, floor: v })} />
            </> : null}
            {edit.k === 'plan' ? <>
              <Field label="Name" value={edit.name} onChangeText={(v) => setEdit({ ...edit, name: v })} autoCapitalize="words" />
              <Field label="Meals, a person a night" numeric money value={edit.perPerson} onChangeText={(v) => setEdit({ ...edit, perPerson: v })} />
              <Field label="Added to the room a night (minus for a discount)" numeric money value={edit.perNight} onChangeText={(v) => setEdit({ ...edit, perNight: v })} />
            </> : null}
            {edit.k === 'season' || edit.k === 'offer' ? <>
              <Field label="Name" value={edit.name} onChangeText={(v) => setEdit({ ...edit, name: v })} autoCapitalize="words" />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <DateField label={edit.k === 'offer' ? 'Arrivals from' : 'From'} value={edit.from} onChange={(v) => setEdit({ ...edit, from: v })} />
                <DateField label="To" value={edit.to} onChange={(v) => setEdit({ ...edit, to: v })} />
              </View>
              {edit.k === 'season'
                ? <Field label="Price change, % (minus for cheaper)" numeric decimal money={false} suffix="%" value={edit.pct} onChangeText={(v) => setEdit({ ...edit, pct: v })} />
                : <View style={{ flexDirection: 'row', gap: 10 }}>
                    <Field style={{ flex: 1 }} label="Stay nights" numeric money={false} value={edit.stay} onChangeText={(v) => setEdit({ ...edit, stay: v })} />
                    <Field style={{ flex: 1 }} label="Pay for" numeric money={false} value={edit.pay} onChangeText={(v) => setEdit({ ...edit, pay: v })} />
                  </View>}
            </> : null}
            {edit.k !== 'many' ? <ToggleRow bare label="In use" on={edit.active !== false} onChange={(v) => setEdit({ ...edit, active: v })} /> : null}
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}

/* ═══════════════════════════ GUEST REGISTER ═══════════════════════════ */
export function GuestRegisterScreen() {
  const { colors } = useTheme();
  const { db } = useAppData();
  const [from, setFrom] = useState(addDays(today(), -30));
  const [to, setTo] = useState(today());
  const rows = useMemo(() => (db ? guestRegister(db, from, to) : []), [db, from, to]);
  if (!db) return null;
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flexDirection: 'row', gap: 10, padding: 16, paddingBottom: 8 }}>
        <DateField label="Arrived from" value={from} onChange={setFrom} />
        <DateField label="To" value={to} onChange={setTo} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 40 }}>
        <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginBottom: 10 }}>
          {rows.length} guest{rows.length === 1 ? '' : 's'} · the register kept for the Uganda Tourism Board and the police: name, nationality, ID or passport, where from and going, dates and room.
        </Text>
        <Card>
          {rows.length ? rows.map((r, i) => (
            <View key={i} style={{ padding: 12, borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderBottomColor: colors.line }}>
              <View style={{ flexDirection: 'row' }}>
                <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink }}>{r.name}</Text>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.soft }}>Room {r.rooms}</Text>
              </View>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>
                {r.nationality || '—'} · {r.idType === 'passport' ? 'Passport' : 'ID'} {r.idNo || '—'}{r.phone ? ' · ' + r.phone : ''}
              </Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 1 }}>
                {short(r.arrived)} → {short(r.departs)} · {r.booking}{r.comingFrom ? ' · from ' + r.comingFrom : ''}{r.goingTo ? ' · to ' + r.goingTo : ''}{r.purpose ? ' · ' + r.purpose : ''}
              </Text>
            </View>
          )) : <Text style={{ padding: 14, fontFamily: fonts.ui, color: colors.faint }}>Nobody checked in between these dates.</Text>}
        </Card>
      </ScrollView>
    </View>
  );
}
