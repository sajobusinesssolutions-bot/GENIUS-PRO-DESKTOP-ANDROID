/**
 * GROUPS ON THE PHONE (hotel.ts, actions/hotel.ts) — the same group blocks the
 * computer keeps: rooms held for a group until a cut-off, how many are picked
 * up, the rooming list, and picking a guest up into a held room. A new block
 * here holds the same count every night; the night-by-night allotment grid and
 * the printed rooming list are on the computer.
 */
import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useTheme, fonts } from '../theme';
import { Icon } from '../components/icons';
import { Card, Cap, Button, EmptyState } from '../components/ui';
import { Field, Seg } from '../components/form';
import Sheet from '../components/Sheet';
import { useToast } from '../components/Toast';
import { useAppData } from '../data/AppDataContext';
import { useGo } from '../nav/navigate';
import {
  type BlockStatus, BLOCK_STATUS_WORD, addDays, blockBookings, blockPicked, blockSummary, evenNights, groupBlocks, nightsList, roomTypes, rooms, today,
} from '../data/hotel';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (d: string) => { const x = new Date(d.slice(0, 10) + 'T12:00:00'); return x.getDate() + ' ' + MON[x.getMonth()]; };

export default function HotelGroupsScreen() {
  const { colors } = useTheme();
  const go = useGo();
  const { db, money, hotel, can } = useAppData() as any;
  const { success } = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const [guest, setGuest] = useState('');
  const [typeId, setTypeId] = useState('');
  const [making, setMaking] = useState(false);
  const [nw, setNw] = useState<{ name: string; contact: string; phone: string; arrive: string; depart: string; cutOff: string; counts: Record<string, string>; rates: Record<string, string> }>(
    { name: '', contact: '', phone: '', arrive: today(), depart: addDays(today(), 2), cutOff: today(), counts: {}, rates: {} });
  if (!db) return null;
  const tones: Record<BlockStatus, string> = { tentative: colors.warn, definite: colors.good, released: colors.accent, cancelled: colors.danger };
  const list = groupBlocks(db).slice().sort((a, b) => a.arrive.localeCompare(b.arrive));
  const g = open ? groupBlocks(db).find((x) => x.id === open) : null;
  const types = roomTypes(db).filter((t) => t.active);
  const run = (what: string, fn: () => void, ok?: string) => { try { fn(); if (ok) success(ok); } catch (e: any) { Alert.alert('Cannot ' + what, e.message); } };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 110, gap: 12 }}>
        {list.length ? list.map((b) => {
          const s = blockSummary(db, b);
          return (
            <Pressable key={b.id} onPress={() => { setOpen(b.id); setTypeId(b.lines[0]?.typeId || ''); }}>
              <Card style={{ padding: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{b.name}</Text>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: tones[b.status] }}>{BLOCK_STATUS_WORD[b.status]}</Text>
                </View>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>{b.no} · {short(b.arrive)} → {short(b.depart)} · cut-off {short(b.cutOff)}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 }}>
                  <View style={{ flex: 1, height: 7, borderRadius: 4, backgroundColor: colors.sunk, overflow: 'hidden' }}><View style={{ width: `${s.pct}%` as `${number}%`, height: 7, backgroundColor: colors.good }} /></View>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.ink }}>{s.picked}/{s.held} room nights</Text>
                </View>
              </Card>
            </Pressable>
          );
        }) : <EmptyState icon="user" title="No group blocks" subtitle="Hold rooms for a conference, a wedding party or a tour, at a group rate, until a cut-off date." />}
      </ScrollView>

      {can('hotel.book') && types.length ? (
        <Pressable onPress={() => setMaking(true)} style={({ pressed }) => ({ position: 'absolute', right: 18, bottom: 22, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, height: 50, borderRadius: 25, backgroundColor: colors.accent, elevation: 6, opacity: pressed ? 0.9 : 1 })}>
          <Icon name="plus" size={18} color={colors.accentInk} />
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.accentInk }}>Book a group</Text>
        </Pressable>
      ) : null}

      <Sheet visible={!!g} full title={g ? g.name : ''} subtitle={g ? g.no + ' · ' + BLOCK_STATUS_WORD[g.status] : ''} icon="user" onClose={() => setOpen(null)}>
        {g ? (() => {
          const s = blockSummary(db, g);
          const live = g.status === 'tentative' || g.status === 'definite';
          const nights = nightsList(g.arrive, g.depart);
          return (
            <View style={{ gap: 12 }}>
              <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.soft }}>{short(g.arrive)} → {short(g.depart)} · cut-off {short(g.cutOff)} · {g.contact.name}{g.contact.phone ? ' · ' + g.contact.phone : ''}</Text>
              <Card style={{ padding: 12, gap: 6 }}>
                {g.lines.map((l) => (
                  <View key={l.typeId}>
                    <Text style={{ fontFamily: fonts.uiSemi, color: colors.ink }}>{roomTypes(db).find((t) => t.id === l.typeId)?.name} · {money(l.rate)} a night</Text>
                    <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{nights.map((n) => short(n) + ' ' + blockPicked(db, g, l.typeId, n) + '/' + (l.nights[n] || 0)).join(' · ')}</Text>
                  </View>
                ))}
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink, marginTop: 4 }}>{s.pct}% picked up · worth {money(s.value)} held</Text>
              </Card>
              <Cap>Rooming list · {blockBookings(db, g).length}</Cap>
              <Card>
                {blockBookings(db, g).map((b, i, all) => (
                  <Pressable key={b.id} onPress={() => { setOpen(null); go('Booking', { id: b.id }); }} style={{ padding: 12, borderBottomWidth: i === all.length - 1 ? 0 : 1, borderBottomColor: colors.line }}>
                    <Text style={{ fontFamily: fonts.uiSemi, color: colors.ink }}>Room {rooms(db).find((r) => r.id === b.rooms[0].roomId)?.no} · {b.guests[0]?.name}</Text>
                    <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{roomTypes(db).find((t) => t.id === b.rooms[0].typeId)?.name} · {b.status}</Text>
                  </Pressable>
                ))}
                {!blockBookings(db, g).length ? <Text style={{ padding: 12, fontFamily: fonts.ui, color: colors.faint }}>Nobody picked up yet.</Text> : null}
              </Card>
              {g.status !== 'cancelled' ? (
                <Card style={{ padding: 12, gap: 10 }}>
                  <Cap>Pick up a guest</Cap>
                  {g.lines.length > 1 ? <Seg value={typeId} onChange={setTypeId} options={g.lines.map((l) => ({ v: l.typeId, l: roomTypes(db).find((t) => t.id === l.typeId)?.name || '?' }))} /> : null}
                  <Field label="Guest’s name" value={guest} onChangeText={setGuest} autoCapitalize="words" />
                  <Button variant="pri" label="Pick up into a held room" onPress={() => run('pick up', () => { hotel.pickUp(g.id, { typeId: typeId || g.lines[0].typeId, guest: { name: guest.trim(), nationality: 'Ugandan', idType: 'national' } }); setGuest(''); }, 'Picked up')} />
                </Card>
              ) : null}
              {live ? (
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {g.status === 'tentative' ? <View style={{ flex: 1 }}><Button label="Make definite" onPress={() => run('change it', () => hotel.setBlockStatus(g.id, 'definite'))} /></View> : null}
                  <View style={{ flex: 1 }}><Button label="Release now" onPress={() => Alert.alert('Release the unpicked rooms?', 'They go back on sale; guests already picked up keep their rooms.', [{ text: 'No', style: 'cancel' }, { text: 'Release', onPress: () => run('release', () => hotel.setBlockStatus(g.id, 'released')) }])} /></View>
                  <View style={{ flex: 1 }}><Button variant="dngr" label="Cancel" onPress={() => Alert.alert('Cancel ' + g.name + '?', 'The held rooms go back on sale.', [{ text: 'Keep it', style: 'cancel' }, { text: 'Cancel group', style: 'destructive', onPress: () => run('cancel', () => hotel.setBlockStatus(g.id, 'cancelled')) }])} /></View>
                </View>
              ) : null}
            </View>
          );
        })() : null}
      </Sheet>

      <Sheet visible={making} full title="Book a group" icon="user" onClose={() => setMaking(false)}
        footer={<Button variant="pri" label="Hold the rooms" onPress={() => run('book the group', () => {
          const lines = types.filter((t) => +(nw.counts[t.id] || 0) > 0).map((t) => ({ typeId: t.id, rate: +(nw.rates[t.id] || t.rate) || t.rate, nights: evenNights(nw.arrive, nw.depart, +nw.counts[t.id]) }));
          const b = hotel.saveBlock({ name: nw.name, status: 'tentative', contact: { name: nw.contact, phone: nw.phone }, arrive: nw.arrive, depart: nw.depart, cutOff: nw.cutOff, roomsPaidBy: 'guest', lines });
          setMaking(false); setOpen(b.id); setTypeId(lines[0]?.typeId || '');
        }, 'Rooms held for the group')} />}>
        <View style={{ gap: 12 }}>
          <Field label="Group name" value={nw.name} onChangeText={(v) => setNw({ ...nw, name: v })} autoCapitalize="words" />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Field style={{ flex: 1 }} label="Contact" value={nw.contact} onChangeText={(v) => setNw({ ...nw, contact: v })} autoCapitalize="words" />
            <Field style={{ flex: 1 }} label="Phone" keyboard="phone-pad" value={nw.phone} onChangeText={(v) => setNw({ ...nw, phone: v })} />
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Field style={{ flex: 1 }} label="Arrive (YYYY-MM-DD)" value={nw.arrive} onChangeText={(v) => setNw({ ...nw, arrive: v })} />
            <Field style={{ flex: 1 }} label="Leave" value={nw.depart} onChangeText={(v) => setNw({ ...nw, depart: v })} />
            <Field style={{ flex: 1 }} label="Cut-off" value={nw.cutOff} onChangeText={(v) => setNw({ ...nw, cutOff: v })} />
          </View>
          <Cap>Rooms to hold each night, and the group rate</Cap>
          {types.map((t) => (
            <View key={t.id} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <Text style={{ flex: 1.2, fontFamily: fonts.uiSemi, color: colors.ink }}>{t.name}</Text>
              <Field style={{ flex: 1 }} compact label="Rooms" numeric money={false} value={nw.counts[t.id] || ''} onChangeText={(v) => setNw({ ...nw, counts: { ...nw.counts, [t.id]: v } })} />
              <Field style={{ flex: 1.3 }} compact label="Rate" numeric money value={nw.rates[t.id] ?? String(t.rate)} onChangeText={(v) => setNw({ ...nw, rates: { ...nw.rates, [t.id]: v } })} />
            </View>
          ))}
        </View>
      </Sheet>
    </View>
  );
}
