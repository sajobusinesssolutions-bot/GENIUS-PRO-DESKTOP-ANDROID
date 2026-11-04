/**
 * EVENTS ON THE PHONE (hotel.ts, actions/hotel.ts) — the same events the
 * computer's events desk keeps: what is coming up and what it is worth, one
 * event with its sessions and money (take a payment, change its status, close
 * and bill it), a quick new event, and the spaces and packages to sell.
 * The full proposal wizard and the printed banquet event order are on the
 * computer; everything here syncs with it.
 */
import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useTheme, fonts } from '../theme';
import { Icon } from '../components/icons';
import { Card, Cap, Button, EmptyState, Chip } from '../components/ui';
import { Field, SelectField, Seg, ToggleRow } from '../components/form';
import Sheet from '../components/Sheet';
import { useToast } from '../components/Toast';
import { useAppData } from '../data/AppDataContext';
import {
  type EventStatus, type PricePlan, type SubEvent, EVENT_STATUS_WORD, EVENT_TYPES, PACKAGE_WORD, PLAN_WORD,
  eventPackages, eventSpaces, eventTotals, eventsDesk, hotelEvents, spaceClash, subEventTotals, today, type PackageCategory,
} from '../data/hotel';
import type { FolioPayment } from '../data/hotel';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (d: string) => { const x = new Date(d.slice(0, 10) + 'T12:00:00'); return x.getDate() + ' ' + MON[x.getMonth()]; };

export default function HotelEventsScreen() {
  const { colors } = useTheme();
  const { db, money, hotel, can } = useAppData() as any;
  const { success } = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [setup, setSetup] = useState<null | { k: 'space' | 'pkg'; [x: string]: any }>(null);
  const [pay, setPay] = useState<{ amount: string; method: FolioPayment['method'] } | null>(null);
  // a quick new event
  const [nw, setNw] = useState({ name: '', type: 'Meeting', contact: '', phone: '', spaceId: '', date: today(), start: '09:00', end: '13:00', guests: '20', plan: 'day' as PricePlan, price: '', pkgs: [] as string[], status: 'tentative' as EventStatus });
  if (!db) return null;
  const tones: Record<EventStatus, string> = { prospect: colors.faint, tentative: colors.warn, confirmed: colors.good, closed: colors.accent, cancelled: colors.danger };
  const desk = eventsDesk(db);
  const spaces = eventSpaces(db).filter((s) => s.active);
  const pkgs = eventPackages(db).filter((p) => p.active);
  const list = hotelEvents(db).slice().sort((a, b) => (a.status === 'closed' || a.status === 'cancelled' ? 1 : 0) - (b.status === 'closed' || b.status === 'cancelled' ? 1 : 0) || a.from.localeCompare(b.from));
  const ev = open ? hotelEvents(db).find((e) => e.id === open) : null;
  const run = (what: string, fn: () => void, ok?: string) => { try { fn(); if (ok) success(ok); } catch (e: any) { Alert.alert('Cannot ' + what, e.message); } };

  const create = () => run('save the event', () => {
    const sub: SubEvent = { id: 'sub' + Date.now().toString(36), name: nw.name, spaceId: nw.spaceId || spaces[0]?.id || '', date: nw.date, start: nw.start, end: nw.end, setup: 'Theatre',
      expected: +nw.guests || 0, guaranteed: +nw.guests || 0, actual: 0, pricePlan: nw.plan, price: +nw.price || 0, serviceChargePct: 0,
      packages: nw.pkgs.map((id) => { const p = pkgs.find((x) => x.id === id)!; return { packageId: p.id, name: p.name, qty: 0, price: p.perPerson || p.flat, perPerson: p.perPerson > 0, serviceChargePct: p.serviceChargePct }; }) };
    const e = hotel.saveEvent({ name: nw.name, type: nw.type, status: nw.status, contact: { name: nw.contact, phone: nw.phone }, from: nw.date, to: nw.date, attendees: +nw.guests || 0,
      subEvents: [sub], deposits: [], tasks: [], discount: 0 });
    setMaking(false); setOpen(e.id);
  }, 'Event saved');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 110, gap: 14 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {([['Prospect', desk.prospect, desk.revProspect], ['Tentative', desk.tentative, desk.revTentative], ['Confirmed', desk.confirmed, desk.revConfirmed]] as const).map(([l, n, r]) => (
            <Card key={l} style={{ flex: 1, padding: 10 }}>
              <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint }}>{l}</Text>
              <Text style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink }}>{n}</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: fonts.uiSemi, fontSize: 11.5, color: colors.soft }}>{money(r)}</Text>
            </Card>
          ))}
        </View>
        {desk.depositsDue.length || desk.cutOffs.length || desk.tasksDue.length ? (
          <Card style={{ padding: 12, gap: 6 }}>
            {desk.depositsDue.map((e) => <Text key={'d' + e.id} onPress={() => setOpen(e.id)} style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.danger }}>Deposit owing · {e.name} · {money(eventTotals(db, e).depositOwing)}</Text>)}
            {desk.cutOffs.map((e) => <Text key={'c' + e.id} onPress={() => setOpen(e.id)} style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.warn }}>Cut-off passed · {e.name}</Text>)}
            {desk.tasksDue.map(({ e, t }) => <Text key={t.id} onPress={() => setOpen(e.id)} style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.accent }}>Task · {t.text} · {e.name}</Text>)}
          </Card>
        ) : null}
        <Cap>Events</Cap>
        {list.length ? (
          <Card>
            {list.map((e, i) => {
              const t = eventTotals(db, e);
              return (
                <Pressable key={e.id} onPress={() => setOpen(e.id)} style={({ pressed }) => ({ padding: 13, borderBottomWidth: i === list.length - 1 ? 0 : 1, borderBottomColor: colors.line, backgroundColor: pressed ? colors.sunk : 'transparent' })}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 14.5, color: colors.ink }}>{e.name}</Text>
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11.5, color: tones[e.status] }}>{EVENT_STATUS_WORD[e.status]}</Text>
                  </View>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                    {e.no} · {e.type} · {short(e.from)} · {e.attendees} guests · {e.subEvents.map((s) => spaces.find((x) => x.id === s.spaceId)?.name).filter(Boolean).join(', ')}
                  </Text>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: t.balance > 0 ? colors.warn : colors.good, marginTop: 3 }}>{money(t.total)}{t.paid ? ' · paid ' + money(t.paid) : ''}</Text>
                </Pressable>
              );
            })}
          </Card>
        ) : <EmptyState icon="calendar" title="No events yet" subtitle="Add your halls and meeting rooms below, then book meetings, conferences and weddings in them." />}

        <Cap style={{ marginTop: 6 }}>Spaces and packages</Cap>
        <Card>
          {spaces.map((s) => <Pressable key={s.id} onPress={() => setSetup({ k: 'space', ...s })} style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: colors.line }}><Text style={{ fontFamily: fonts.uiSemi, color: colors.ink }}>{s.name}</Text><Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{s.capacity} people · {money(s.rateHour)} an hour · {money(s.rateDay)} a day</Text></Pressable>)}
          {pkgs.map((p) => <Pressable key={p.id} onPress={() => setSetup({ k: 'pkg', ...p })} style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: colors.line }}><Text style={{ fontFamily: fonts.uiSemi, color: colors.ink }}>{p.name}</Text><Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{PACKAGE_WORD[p.category]} · {p.perPerson ? money(p.perPerson) + ' a person' : money(p.flat)}</Text></Pressable>)}
          <View style={{ flexDirection: 'row', gap: 10, padding: 12 }}>
            <View style={{ flex: 1 }}><Button size="sm" label="+ Space" onPress={() => setSetup({ k: 'space', name: '', capacity: '50', rateHour: '50000', rateHalfDay: '200000', rateDay: '350000', active: true })} /></View>
            <View style={{ flex: 1 }}><Button size="sm" label="+ Package" onPress={() => setSetup({ k: 'pkg', name: '', category: 'FNB', perPerson: '25000', flat: '0', serviceChargePct: '10', active: true })} /></View>
          </View>
        </Card>
      </ScrollView>

      {can('hotel.book') && spaces.length ? (
        <Pressable onPress={() => { setNw({ ...nw, name: '', contact: '', phone: '', spaceId: spaces[0].id, pkgs: [] }); setMaking(true); }} style={({ pressed }) => ({ position: 'absolute', right: 18, bottom: 22, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, height: 50, borderRadius: 25, backgroundColor: colors.accent, elevation: 6, opacity: pressed ? 0.9 : 1 })}>
          <Icon name="plus" size={18} color={colors.accentInk} />
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.accentInk }}>New event</Text>
        </Pressable>
      ) : null}

      {/* one event */}
      <Sheet visible={!!ev} full title={ev ? ev.name : ''} subtitle={ev ? ev.no + ' · ' + EVENT_STATUS_WORD[ev.status] : ''} icon="calendar" onClose={() => setOpen(null)}>
        {ev ? (() => {
          const t = eventTotals(db, ev);
          const closed = ev.status === 'closed' || ev.status === 'cancelled';
          return (
            <View style={{ gap: 12 }}>
              <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.soft }}>{ev.type} · {ev.attendees} guests · {ev.contact.name}{ev.contact.phone ? ' · ' + ev.contact.phone : ''}</Text>
              {t.subs.map(({ s, t: st }) => (
                <Card key={s.id} style={{ padding: 12 }}>
                  <Text style={{ fontFamily: fonts.uiSemi, color: colors.ink }}>{short(s.date)} · {s.start}–{s.end} · {spaces.find((x) => x.id === s.spaceId)?.name || 'Space'}</Text>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>{s.setup} · {s.guaranteed || s.expected} guests · {PLAN_WORD[s.pricePlan]} {money(st.space)}</Text>
                  {st.lines.map((p) => <Text key={p.packageId} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.soft }}>{p.name} · {money(p.amount)}</Text>)}
                </Card>
              ))}
              <Card style={{ padding: 12, gap: 4 }}>
                {([['Space', t.space], ['Packages', t.packages], ['Service charge', t.service], ['Other charges', t.charges], ['Taxes added', t.taxAdded]] as const).filter(([, v]) => v).map(([l, v]) => (
                  <View key={l} style={{ flexDirection: 'row' }}><Text style={{ flex: 1, fontFamily: fonts.ui, color: colors.soft }}>{l}</Text><Text style={{ fontFamily: fonts.uiSemi, color: colors.ink }}>{money(v)}</Text></View>
                ))}
                {t.discount ? <View style={{ flexDirection: 'row' }}><Text style={{ flex: 1, fontFamily: fonts.ui, color: colors.good }}>Discount</Text><Text style={{ fontFamily: fonts.uiSemi, color: colors.good }}>−{money(t.discount)}</Text></View> : null}
                <View style={{ flexDirection: 'row', marginTop: 4 }}><Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>Total</Text><Text style={{ fontFamily: fonts.uiExtra, fontSize: 15, color: colors.ink }}>{money(t.total)}</Text></View>
                <View style={{ flexDirection: 'row' }}><Text style={{ flex: 1, fontFamily: fonts.ui, color: colors.good }}>Paid</Text><Text style={{ fontFamily: fonts.uiSemi, color: colors.good }}>{money(t.paid)}</Text></View>
                <View style={{ flexDirection: 'row' }}><Text style={{ flex: 1, fontFamily: fonts.uiBold, color: t.balance > 0 ? colors.warn : colors.good }}>Balance</Text><Text style={{ fontFamily: fonts.uiExtra, color: t.balance > 0 ? colors.warn : colors.good }}>{money(t.balance)}</Text></View>
                {t.depositOwing ? <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.danger }}>{money(t.depositOwing)} deposit owing</Text> : null}
              </Card>
              {!closed ? (
                <>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {(['prospect', 'tentative', 'confirmed', 'cancelled'] as EventStatus[]).map((st) => <Chip key={st} label={EVENT_STATUS_WORD[st]} on={ev.status === st} onPress={() => run('change it', () => hotel.setEventStatus(ev.id, st))} />)}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1 }}><Button label="Take payment" onPress={() => setPay({ amount: String(t.depositOwing || t.balance || ''), method: 'cash' })} /></View>
                    <View style={{ flex: 1 }}><Button variant="pri" label="Close and bill" onPress={() => Alert.alert('Close and bill ' + ev.name + '?', money(t.total) + ' becomes one sale on the client’s account; ' + money(t.paid) + ' already paid is applied to it.', [{ text: 'Not yet', style: 'cancel' }, { text: 'Close and bill', onPress: () => run('bill it', () => hotel.closeEvent(ev.id), 'Billed · it is in Sales') }])} /></View>
                  </View>
                </>
              ) : null}
            </View>
          );
        })() : null}
      </Sheet>

      <Sheet visible={!!pay} title="Take a payment" icon="money" iconTone="good" onClose={() => setPay(null)}
        footer={<Button variant="pri" label="Receive payment" onPress={() => run('take it', () => { hotel.takeEventPayment(ev!.id, { amount: +pay!.amount, method: pay!.method }); setPay(null); }, 'Payment received')} />}>
        {pay ? <View style={{ gap: 12 }}>
          <Seg value={pay.method} onChange={(m) => setPay({ ...pay, method: m })} options={[{ v: 'cash', l: 'Cash' }, { v: 'momo', l: 'Mobile money' }, { v: 'bank', l: 'Bank' }]} />
          <Field label="Amount" numeric money value={pay.amount} onChangeText={(v) => setPay({ ...pay, amount: v })} big />
        </View> : null}
      </Sheet>

      <Sheet visible={making} full title="New event" icon="calendar" onClose={() => setMaking(false)} footer={<Button variant="pri" label="Save event" onPress={create} />}>
        <View style={{ gap: 12 }}>
          <Field label="Event name" value={nw.name} onChangeText={(v) => setNw({ ...nw, name: v })} autoCapitalize="words" />
          <SelectField label="Type" value={nw.type} onChange={(v) => setNw({ ...nw, type: v })} options={EVENT_TYPES.map((x) => ({ v: x, l: x }))} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Field style={{ flex: 1 }} label="Contact" value={nw.contact} onChangeText={(v) => setNw({ ...nw, contact: v })} autoCapitalize="words" />
            <Field style={{ flex: 1 }} label="Phone" keyboard="phone-pad" value={nw.phone} onChangeText={(v) => setNw({ ...nw, phone: v })} />
          </View>
          <SelectField label="Space" value={nw.spaceId} onChange={(v) => setNw({ ...nw, spaceId: v })} options={spaces.map((s) => ({ v: s.id, l: s.name + ' · ' + s.capacity + ' people' }))} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Field style={{ flex: 1.3 }} label="Date (YYYY-MM-DD)" value={nw.date} onChangeText={(v) => setNw({ ...nw, date: v })} />
            <Field style={{ flex: 1 }} label="Start" value={nw.start} onChangeText={(v) => setNw({ ...nw, start: v })} />
            <Field style={{ flex: 1 }} label="End" value={nw.end} onChangeText={(v) => setNw({ ...nw, end: v })} />
          </View>
          {(() => { const c = spaceClash(db, nw.spaceId, nw.date, nw.start, nw.end); return c ? <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.danger }}>Taken then by {c.event.name} ({c.sub.start}–{c.sub.end})</Text> : null; })()}
          <Field label="Guests" numeric money={false} value={nw.guests} onChangeText={(v) => setNw({ ...nw, guests: v })} />
          <Seg value={nw.plan} onChange={(v) => setNw({ ...nw, plan: v })} options={(Object.keys(PLAN_WORD) as PricePlan[]).map((k) => ({ v: k, l: k === 'hour' ? 'Hourly' : k === 'half' ? 'Half day' : k === 'day' ? 'Day' : 'Agreed' }))} />
          {nw.plan === 'flat' ? <Field label="Agreed amount" numeric money value={nw.price} onChangeText={(v) => setNw({ ...nw, price: v })} /> : null}
          {pkgs.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{pkgs.map((p) => <Chip key={p.id} label={p.name} on={nw.pkgs.includes(p.id)} onPress={() => setNw({ ...nw, pkgs: nw.pkgs.includes(p.id) ? nw.pkgs.filter((x) => x !== p.id) : [...nw.pkgs, p.id] })} />)}</View> : null}
          <Seg value={nw.status} onChange={(v) => setNw({ ...nw, status: v })} options={[{ v: 'prospect', l: 'Prospect' }, { v: 'tentative', l: 'Tentative' }, { v: 'confirmed', l: 'Confirmed' }]} />
          {nw.spaceId ? <Text style={{ fontFamily: fonts.uiSemi, color: colors.ink }}>About {money(subEventTotals(db, { id: 'x', name: '', spaceId: nw.spaceId, date: nw.date, start: nw.start, end: nw.end, setup: 'Theatre', expected: +nw.guests || 0, guaranteed: +nw.guests || 0, actual: 0, pricePlan: nw.plan, price: +nw.price || 0, serviceChargePct: 0,
            packages: nw.pkgs.map((id) => { const p = pkgs.find((x) => x.id === id)!; return { packageId: p.id, name: p.name, qty: 0, price: p.perPerson || p.flat, perPerson: p.perPerson > 0, serviceChargePct: p.serviceChargePct }; }) }).total)}</Text> : null}
        </View>
      </Sheet>

      <Sheet visible={!!setup} title={setup?.k === 'space' ? 'Space' : 'Package'} icon="cog" onClose={() => setSetup(null)}
        footer={<Button variant="pri" label="Save" onPress={() => run('save it', () => {
          const x = setup!;
          if (x.k === 'space') hotel.saveSpace({ id: x.id, name: x.name, capacity: +x.capacity || 0, rateHour: +x.rateHour || 0, rateHalfDay: +x.rateHalfDay || 0, rateDay: +x.rateDay || 0, active: x.active !== false });
          else hotel.savePackage({ id: x.id, name: x.name, category: x.category as PackageCategory, perPerson: +x.perPerson || 0, flat: +x.flat || 0, serviceChargePct: +x.serviceChargePct || 0, active: x.active !== false });
          setSetup(null);
        }, 'Saved')} />}>
        {setup ? <View style={{ gap: 12 }}>
          <Field label="Name" value={String(setup.name || '')} onChangeText={(v) => setSetup({ ...setup, name: v })} autoCapitalize="words" />
          {setup.k === 'space' ? <>
            <Field label="Capacity" numeric money={false} value={String(setup.capacity ?? '')} onChangeText={(v) => setSetup({ ...setup, capacity: v })} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Field style={{ flex: 1 }} label="An hour" numeric money value={String(setup.rateHour ?? '')} onChangeText={(v) => setSetup({ ...setup, rateHour: v })} />
              <Field style={{ flex: 1 }} label="Half day" numeric money value={String(setup.rateHalfDay ?? '')} onChangeText={(v) => setSetup({ ...setup, rateHalfDay: v })} />
              <Field style={{ flex: 1 }} label="Day" numeric money value={String(setup.rateDay ?? '')} onChangeText={(v) => setSetup({ ...setup, rateDay: v })} />
            </View>
          </> : <>
            <Seg value={setup.category} onChange={(v) => setSetup({ ...setup, category: v })} options={(Object.keys(PACKAGE_WORD) as PackageCategory[]).map((k) => ({ v: k, l: PACKAGE_WORD[k] }))} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Field style={{ flex: 1 }} label="A person" numeric money value={String(setup.perPerson ?? '')} onChangeText={(v) => setSetup({ ...setup, perPerson: v })} />
              <Field style={{ flex: 1 }} label="Or flat" numeric money value={String(setup.flat ?? '')} onChangeText={(v) => setSetup({ ...setup, flat: v })} />
              <Field style={{ flex: 1 }} label="Service %" numeric money={false} value={String(setup.serviceChargePct ?? '')} onChangeText={(v) => setSetup({ ...setup, serviceChargePct: v })} />
            </View>
          </>}
          <ToggleRow bare label="In use" on={setup.active !== false} onChange={(v) => setSetup({ ...setup, active: v })} />
        </View> : null}
      </Sheet>
    </View>
  );
}
