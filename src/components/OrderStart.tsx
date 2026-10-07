/**
 * STARTING AN ORDER — the first steps on the order screen, before the menu.
 *
 *   1. How it is eaten: Dine in, Takeaway or Delivery, as three big cards in
 *      the same colours the kitchen sees on its tickets. With it, who it is
 *      for: a customer from the books (a regular, a delivery), or a name.
 *      Dine in asks how many guests; delivery asks for the phone and address.
 *   2. Dine in only: the floor. Tables by area, free ones green, busy ones
 *      with their bill and how long they have sat. A busy table opens its
 *      ticket; a free one starts the order there. A table smaller than the
 *      party is flagged before it is chosen.
 *   3. The menu (the order screen itself).
 *
 * The usual restaurant sequence (type, then table, then items, then send) so
 * a waiter never sends a ticket to the kitchen without a table or a name.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { Pressable } from './Press';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useToast } from './Toast';
import { Icon } from './icons';
import Sheet from './Sheet';
import { Button } from './ui';
import { Field } from './form';
import type { OrderType, Ticket } from '../data/types';

export interface OrderStartValue {
  orderType: OrderType; name: string; guests: number; partyId?: string; address?: string; phone?: string;
}

const NO_AREA = 'Main floor';

export default function OrderStart({ initial, seeAll, onDone, onOpenTicket, onClose }: {
  initial: OrderStartValue;
  /** may this person open other waiters' tables */
  seeAll: boolean;
  onDone: (v: OrderStartValue) => void;
  onOpenTicket: (t: Ticket) => void;
  /** set when an order is already under way: leaves without changing it */
  onClose?: () => void;
}) {
  const { colors } = useTheme();
  const { db, money } = useAppData();
  const { error } = useToast();
  const [v, setV] = useState<OrderStartValue>(initial);
  const [step, setStep] = useState<'type' | 'table'>('type');
  const [picking, setPicking] = useState(false);
  const [q, setQ] = useState('');
  const [tableName, setTableName] = useState(initial.orderType === 'dine' ? initial.name : '');

  const customers = useMemo(() => (db?.parties || []).filter((p) => p.type === 'customer' && p.active !== false), [db]);
  if (!db) return null;

  const tables = db.settings.tables || [];
  const info = db.settings.tableInfo || {};
  const areaOf = (t: string) => info[t]?.area || NO_AREA;
  const areas = [...new Set(tables.map(areaOf))];
  const customer = v.partyId ? customers.find((c) => c.id === v.partyId) : undefined;

  const TYPES: { v: OrderType; l: string; sub: string; icon: 'chair' | 'cart' | 'taxi'; bg: string; fg: string }[] = [
    { v: 'dine', l: 'Dine in', sub: 'At a table', icon: 'chair', bg: colors.sunk, fg: colors.ink },
    { v: 'takeaway', l: 'Takeaway', sub: 'Collected at the counter', icon: 'cart', bg: '#111', fg: '#fff' },
    { v: 'delivery', l: 'Delivery', sub: 'Sent to an address', icon: 'taxi', bg: colors.danger, fg: '#fff' },
  ];

  function next() {
    if (v.orderType === 'delivery') {
      if (!(customer || v.name.trim())) { error('Who is the delivery for? Choose the customer or type a name.'); return; }
      if (!v.address?.trim()) { error('Type the delivery address.'); return; }
      if (!v.phone?.trim()) { error('Type a phone number for the rider to call.'); return; }
    }
    if (v.orderType === 'dine') { setStep('table'); return; }
    const n = v.name.trim() || customer?.name || '';
    onDone({ ...v, name: n || (v.orderType === 'takeaway' ? 'Takeaway' : 'Delivery') });
  }

  function seat(t: string) {
    const seats = info[t]?.seats || 0;
    const go = () => onDone({ ...v, name: t });
    if (seats && v.guests > seats) {
      Alert.alert(t + ' seats ' + seats, 'This party is ' + v.guests + '. Seat them here anyway?', [
        { text: 'Choose another', style: 'cancel' }, { text: 'Seat here', onPress: go },
      ]);
      return;
    }
    go();
  }

  const stepper = (val: number, set: (n: number) => void) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Pressable onPress={() => set(Math.max(1, val - 1))} style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: colors.sunk, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 22, color: colors.ink }}>−</Text></Pressable>
      <Text style={{ minWidth: 30, textAlign: 'center', fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink }}>{val}</Text>
      <Pressable onPress={() => set(Math.min(60, val + 1))} style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: colors.sunk, alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 22, color: colors.ink }}>+</Text></Pressable>
    </View>
  );
  const heading = (t: string) => <Text style={{ fontFamily: fonts.uiBold, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.faint, marginBottom: 10, marginTop: 18 }}>{t}</Text>;

  /* ---------------- step 1: type and customer ---------------- */
  if (step === 'type') {
    return (
      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ flex: 1, fontFamily: fonts.uiExtra, fontSize: 22, color: colors.ink }}>{onClose ? 'Change the order' : 'New order'}</Text>
            {onClose ? <Pressable hitSlop={8} onPress={onClose}><Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: colors.accent }}>Back to the menu</Text></Pressable> : null}
          </View>
          {heading('How is it eaten')}
          <View style={{ gap: 10 }}>
            {TYPES.map((t) => {
              const on = v.orderType === t.v;
              return (
                <Pressable
                  key={t.v}
                  onPress={() => setV({ ...v, orderType: t.v })}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 16, borderWidth: 2, borderColor: on ? colors.ink : colors.line, backgroundColor: pressed ? colors.sunk : colors.surface })}
                >
                  <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={t.icon} size={22} color={t.fg} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: fonts.uiExtra, fontSize: 17, color: colors.ink }}>{t.l}</Text>
                    <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint }}>{t.sub}</Text>
                  </View>
                  <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: on ? colors.ink : colors.lineHard, alignItems: 'center', justifyContent: 'center' }}>
                    {on ? <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: colors.ink }} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>

          {v.orderType === 'dine' ? (
            <>
              {heading('Guests')}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}>
                <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 14.5, color: colors.ink }}>People at the table</Text>
                {stepper(v.guests, (n) => setV({ ...v, guests: n }))}
              </View>
            </>
          ) : null}

          {heading(v.orderType === 'delivery' ? 'Deliver to' : 'Customer (optional)')}
          <Pressable
            onPress={() => { setQ(''); setPicking(true); }}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: pressed ? colors.sunk : colors.surface, marginBottom: 10 })}
          >
            <Icon name="user" size={19} color={colors.ink} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{customer ? customer.name : 'Walk-in customer'}</Text>
              <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
                {customer ? [customer.phone, customer.address].filter(Boolean).join(' · ') || 'From your customers' : 'Tap to choose a customer from your books'}
              </Text>
            </View>
            {customer ? (
              <Pressable hitSlop={8} onPress={() => setV({ ...v, partyId: undefined })}><Icon name="x" size={18} color={colors.faint} /></Pressable>
            ) : <Icon name="chev" size={16} color={colors.faint} />}
          </Pressable>
          {!customer && v.orderType !== 'dine' ? (
            <Field label={v.orderType === 'delivery' ? 'Name' : 'Name for the order'} value={v.name} onChangeText={(x) => setV({ ...v, name: x })} placeholder="John" />
          ) : null}
          {v.orderType === 'delivery' ? (
            <>
              <Field icon="phone" label="Phone" keyboard="phone-pad" value={v.phone || ''} onChangeText={(x) => setV({ ...v, phone: x })} placeholder="0772 123456" />
              <Field icon="pin" label="Address" multiline value={v.address || ''} onChangeText={(x) => setV({ ...v, address: x })} placeholder="Plot 12, Ntinda, near the church" />
            </>
          ) : null}
        </ScrollView>
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: 20 }}>
          <Button variant="pri" label={v.orderType === 'dine' ? 'Choose the table' : 'Go to the menu'} icon={<Icon name="arrow" size={17} color={colors.accentInk} />} onPress={next} />
        </View>

        <Sheet visible={picking} title="Choose the customer" icon="user" full onClose={() => setPicking(false)}>
          <Field icon="search" label="Search by name or phone" value={q} onChangeText={setQ} autoCorrect={false} />
          {customers
            .filter((c) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase()) || (c.phone || '').includes(q.trim()))
            .slice(0, 80)
            .map((c) => (
              <Pressable
                key={c.id}
                onPress={() => {
                  setV({ ...v, partyId: c.id, name: v.orderType === 'dine' ? v.name : c.name, phone: v.phone || c.phone || '', address: v.address || c.address || '' });
                  setPicking(false);
                }}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 6, borderRadius: 12, borderWidth: 1, borderColor: c.id === v.partyId ? colors.ink : colors.line, backgroundColor: pressed ? colors.sunk : colors.surface })}
              >
                <Icon name="user" size={18} color={colors.ink} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{c.name}</Text>
                  {c.phone || c.address ? <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{[c.phone, c.address].filter(Boolean).join(' · ')}</Text> : null}
                </View>
              </Pressable>
            ))}
          {!customers.length ? (
            <Text style={{ fontFamily: fonts.ui, fontSize: 14, color: colors.faint, textAlign: 'center', paddingVertical: 24 }}>No customers yet. Add regulars under Parties; until then, type a name.</Text>
          ) : null}
        </Sheet>
      </View>
    );
  }

  /* ---------------- step 2: the floor ---------------- */
  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <Pressable hitSlop={8} onPress={() => setStep('type')} style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: colors.sunk, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="back" size={18} color={colors.ink} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fonts.uiExtra, fontSize: 22, color: colors.ink }}>Choose the table</Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint }}>Party of {v.guests}{customer ? ' · ' + customer.name : ''}</Text>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 14, marginVertical: 10 }}>
          {[[colors.goodSoft, 'Free'], [colors.warnSoft, 'Busy'], [colors.dangerSoft, 'Over 90 min']].map(([c, l]) => (
            <View key={l} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 12, height: 12, borderRadius: 4, backgroundColor: c }} />
              <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.soft }}>{l}</Text>
            </View>
          ))}
        </View>

        {areas.map((a) => (
          <View key={a}>
            {areas.length > 1 || a !== NO_AREA ? heading(a) : <View style={{ height: 8 }} />}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {tables.filter((t) => areaOf(t) === a).map((tn) => {
                const t = (db.tickets || []).find((x) => x.status === 'open' && x.name.trim().toLowerCase() === tn.trim().toLowerCase());
                const mine = !t || seeAll || t.userId === db.session.userId;
                const mins = t ? Math.round((Date.now() - new Date(t.ts).getTime()) / 60000) : 0;
                const seats = info[tn]?.seats || 0;
                const small = !t && seats > 0 && v.guests > seats;
                const long = mins >= 90;
                return (
                  <Pressable
                    key={tn}
                    onPress={() => {
                      if (t && !mine) { error(tn + ' is being served by another waiter.'); return; }
                      if (t) { onOpenTicket(t); return; }
                      seat(tn);
                    }}
                    style={({ pressed }) => ({
                      width: '31%', minHeight: 92, padding: 10, borderRadius: 14, justifyContent: 'space-between',
                      backgroundColor: t ? (long ? colors.dangerSoft : colors.warnSoft) : colors.goodSoft,
                      opacity: !mine ? 0.5 : small ? 0.6 : pressed ? 0.75 : 1,
                    })}
                  >
                    <Text numberOfLines={1} style={{ fontFamily: fonts.uiExtra, fontSize: 15, color: colors.ink }}>{tn}</Text>
                    {t ? (
                      <>
                        {(db.kitchenOrders || []).some((k) => k.ticketId === t.id && k.status === 'ready') ? <Text style={{ fontFamily: fonts.uiExtra, fontSize: 11.5, color: colors.good }}>● READY</Text> : null}
                        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: long ? colors.danger : colors.warn }}>{money(t.lines.reduce((s, l) => s + l.qty * l.price, 0))}</Text>
                        <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.soft }}>{t.guests ? t.guests + ' guests · ' : ''}{mins < 60 ? mins + ' min' : Math.floor(mins / 60) + ' h ' + (mins % 60)}</Text>
                      </>
                    ) : (
                      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: small ? colors.warn : colors.good }}>
                        {seats ? seats + ' seats' : 'Free'}{small ? ' · small' : ''}
                      </Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}

        {/* no plan, or a table not on it (the garden, the bar counter) */}
        {heading(tables.length ? 'Or type a table' : 'Table')}
        {!tables.length ? (
          <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint, marginBottom: 10 }}>
            Set up your tables in Menu & modifiers → Settings to pick them from a floor plan.
          </Text>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
          <View style={{ flex: 1 }}><Field icon="chair" label="Table" value={tableName} onChangeText={setTableName} placeholder="Garden 2" /></View>
          <View style={{ marginTop: 6 }}>
            <Button label="Use" onPress={() => {
              const n = tableName.trim();
              if (!n) { error('Type the table name.'); return; }
              const t = (db.tickets || []).find((x) => x.status === 'open' && x.name.trim().toLowerCase() === n.toLowerCase());
              if (t) { if (seeAll || t.userId === db.session.userId) onOpenTicket(t); else error(n + ' is being served by another waiter.'); return; }
              onDone({ ...v, name: n });
            }} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
