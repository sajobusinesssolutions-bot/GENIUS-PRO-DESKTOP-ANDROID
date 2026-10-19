/**
 * KITCHEN DISPLAY — a screen for the kitchen, usually a tablet on the wall.
 *
 * Every round of an order sent from the order screen appears here as a card:
 * the table, how it is eaten (DINE IN / TAKEAWAY / DELIVERY in their own
 * colours), each dish with its choices and notes, and how long it has waited.
 * A tap moves it on — New, Cooking, Ready — and Ready tells the floor. Served
 * cards drop off; a mistake can be recalled.
 *
 * Each station can watch only its own dishes: the grill sees the grill.
 * The screen refreshes its timers every half minute and syncs like the rest.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, useWindowDimensions } from 'react-native';
import { Pressable } from '../components/Press';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Icon } from '../components/icons';
import { AppBar } from '../components/AppBar';
import { stationsOf, orderTypeWord } from '../data/restaurant';
import { requestSync } from '../data/SyncKeeper';
import { explain } from '../data/refusal';
import FirstTimeTip from '../components/FirstTimeTip';
import type { KitchenOrder } from '../data/types';

const NEXT: Record<KitchenOrder['status'], KitchenOrder['status']> = { new: 'cooking', cooking: 'ready', ready: 'served', served: 'served' };
const WORD: Record<KitchenOrder['status'], string> = { new: 'New', cooking: 'Cooking', ready: 'Ready', served: 'Served' };
const ACTION: Record<KitchenOrder['status'], string> = { new: 'Start cooking', cooking: 'Mark ready', ready: 'Served', served: '' };

export default function KitchenDisplayScreen({ navigation, route }: any) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const { db, setKitchenStatus } = useAppData();
  const [station, setStation] = useState<string>('All');
  const [show, setShow] = useState<'active' | 'served'>('active');
  const [, tick] = useState(0);

  // timers move on their own, and new orders are fetched often
  useEffect(() => {
    const t = setInterval(() => { tick((n) => n + 1); requestSync(); }, 30000);
    return () => clearInterval(t);
  }, []);

  const stations = ['All', ...stationsOf(db)];
  const orders = useMemo(() => (db?.kitchenOrders || [])
    .filter((k) => (show === 'served' ? k.status === 'served' : k.status !== 'served'))
    .map((k) => ({ ...k, lines: station === 'All' ? k.lines : k.lines.filter((l) => l.station === station) }))
    .filter((k) => k.lines.length)
    .sort((a, b) => (show === 'served' ? b.changedAt.localeCompare(a.changedAt) : a.sentAt.localeCompare(b.sentAt))), [db, station, show]);

  if (!db) return null;
  const cols = width >= 1100 ? 4 : width >= 800 ? 3 : width >= 560 ? 2 : 1;
  const cardW = (width - 32 - (cols - 1) * 12) / cols;
  const counts = { new: 0, cooking: 0, ready: 0 } as Record<string, number>;
  (db.kitchenOrders || []).forEach((k) => { if (k.status !== 'served') counts[k.status] = (counts[k.status] || 0) + 1; });

  const typeLook = (t?: string) => (t === 'takeaway' ? { bg: '#111', fg: '#fff' } : t === 'delivery' ? { bg: colors.danger, fg: '#fff' } : { bg: colors.sunk, fg: colors.ink });
  const statusTone = (s: KitchenOrder['status']) => (s === 'new' ? colors.accent : s === 'cooking' ? colors.warn : s === 'ready' ? colors.good : colors.faint);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AppBar
        title="Kitchen display"
        onBack={route?.name === 'KitchenTab' ? undefined : () => navigation.goBack()}
        right={(
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {(['new', 'cooking', 'ready'] as const).map((s) => (
              <View key={s} style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.sunk }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 12, color: statusTone(s) }}>{WORD[s]} {counts[s] || 0}</Text>
              </View>
            ))}
          </View>
        )}
      />
      <View style={{ paddingHorizontal: 12, paddingTop: 10 }}>
        <FirstTimeTip
          id="first-kds"
          title="The kitchen display"
          text="Every order saved at the till appears here. Tap the button on a card to move it on: Start cooking, Mark ready, Served. Cards turn orange after 10 minutes and red after 20. Pick a station to see only its dishes."
        />
      </View>
      {/* stations, and what is showing */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 8, padding: 12 }}>
        {stations.map((s) => {
          const on = s === station;
          return (
            <Pressable key={s} onPress={() => setStation(s)} style={{ paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999, backgroundColor: on ? colors.ink : colors.surface, borderWidth: 1, borderColor: on ? colors.ink : colors.line }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: on ? colors.bg : colors.ink }}>{s}</Text>
            </Pressable>
          );
        })}
        <View style={{ width: 1, backgroundColor: colors.line, marginHorizontal: 4 }} />
        {(['active', 'served'] as const).map((v) => (
          <Pressable key={v} onPress={() => setShow(v)} style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: show === v ? colors.accentSoft : 'transparent' }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: show === v ? colors.accent : colors.faint }}>{v === 'active' ? 'In the kitchen' : 'Served (recall)'}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 30, flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {orders.map((k) => {
          const mins = Math.max(0, Math.round((Date.now() - new Date(k.sentAt).getTime()) / 60000));
          const late = k.status !== 'ready' && mins >= 20;
          const warm = k.status !== 'ready' && mins >= 10;
          const tl = typeLook(k.orderType);
          return (
            <View key={k.id} style={{ width: cardW, borderRadius: 4, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 2, borderColor: k.status === 'ready' ? colors.good : late ? colors.danger : warm ? colors.warn : colors.line }}>
              {/* head: table, type, age */}
              <View style={{ padding: 12, backgroundColor: k.status === 'ready' ? colors.goodSoft : late ? colors.dangerSoft : warm ? colors.warnSoft : colors.sunk }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink }}>{k.table || k.no}</Text>
                  <Text style={{ fontFamily: fonts.uiExtra, fontSize: 18, color: late ? colors.danger : warm ? colors.warn : colors.ink }}>{mins}′</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
                  {k.orderType ? (
                    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4, backgroundColor: tl.bg }}>
                      <Text style={{ fontFamily: fonts.uiExtra, fontSize: 12, letterSpacing: 1, color: tl.fg }}>{orderTypeWord(k.orderType).toUpperCase()}</Text>
                    </View>
                  ) : null}
                  <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 12, color: colors.soft }} numberOfLines={1}>{k.no}{k.by ? ' · ' + k.by : ''}</Text>
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 12, color: statusTone(k.status) }}>{WORD[k.status]}</Text>
                </View>
              </View>
              {/* the dishes */}
              <View style={{ padding: 12, gap: 8 }}>
                {k.lines.map((l, i) => (
                  <View key={i}>
                    <Text style={{ fontFamily: fonts.uiExtra, fontSize: 17, color: colors.ink }}>{l.qty} × {l.name}</Text>
                    {(l.mods || []).map((m) => <Text key={m} style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.soft, marginLeft: 14 }}>+ {m}</Text>)}
                    {l.note ? <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: colors.warn, marginLeft: 14 }}>* {l.note}</Text> : null}
                    {station === 'All' && stations.length > 2 ? <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginLeft: 14 }}>{l.station}</Text> : null}
                  </View>
                ))}
                {k.note ? <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: colors.danger }}>Note: {k.note}</Text> : null}
              </View>
              {/* move it on */}
              <Pressable
                onPress={() => { try { setKitchenStatus(k.id, show === 'served' ? 'ready' : NEXT[k.status]); } catch (e) { explain(e); } }}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, backgroundColor: pressed ? colors.sunk : show === 'served' ? colors.sunk : statusTone(k.status) })}
              >
                <Icon name={show === 'served' ? 'swap' : k.status === 'cooking' ? 'check' : 'arrow'} size={18} color={show === 'served' ? colors.ink : '#fff'} />
                <Text style={{ fontFamily: fonts.uiExtra, fontSize: 16, color: show === 'served' ? colors.ink : '#fff' }}>{show === 'served' ? 'Recall' : ACTION[k.status]}</Text>
              </Pressable>
            </View>
          );
        })}
        {!orders.length ? (
          <View style={{ width: '100%', alignItems: 'center', paddingVertical: 60, gap: 10 }}>
            <Icon name="food" size={40} color={colors.faint} />
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 17, color: colors.ink }}>{show === 'served' ? 'Nothing served yet today' : 'No orders waiting'}</Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 13.5, color: colors.faint, textAlign: 'center', maxWidth: 320 }}>
              {db.settings.kitchenDisplay ? 'New orders appear here as soon as a ticket is saved or charged.' : 'Switch on "Kitchen display screen" in Menu & modifiers → Settings to send orders here.'}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
