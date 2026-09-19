/**
 * SHIFTS & DAY CLOSE.
 *
 * Three views of one thing, the drawer:
 *
 *  · My till — your own shift: open it with the float, see what it has taken
 *    by cash, mobile money and bank, and close it with a count.
 *  · Day close — every shift still open in this branch. Pick all staff or just
 *    some, see their cash, mobile money, bank and credit side by side and in
 *    total, count each drawer and close them together. Before, a day close
 *    could only close the shift of whoever was holding the phone, so a manager
 *    ending the day had to sign in as every cashier in turn.
 *  · History — closed shifts, with their over/short.
 *
 * Closing somebody else's shift needs "See every shift" (shifts.view_all).
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Alert, Pressable } from 'react-native';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import {
  Button, Avatar, BigAmount, Field, FieldNote, ActionChip, Badge, DetailRow,
  Panel, SectionLabel, TopTabs, EmptyBlock,
} from '../components/ui';
import { useGo } from '../nav/navigate';
import { Icon } from '../components/icons';
import { Sheet } from '../components/Sheet';
import { Foot } from '../components/AppBar';
import { fmtDate, money0 } from '../data/helpers';
import { shiftVariance } from '../data/logic';
import { activeBranchId } from '../data/branch';
import type { Shift } from '../data/types';

const num = (v: string) => Number(String(v).replace(/[^0-9.]/g, '')) || 0;
type Tab = 'mine' | 'day' | 'history';

export default function ShiftScreen({ route }: any) {
  const { colors } = useTheme();
  const go = useGo();
  const { db, money, cur, me, user, activeShift, openShift, closeShift, shiftTotals, lastClosedShift, can } = useAppData();

  const seeAll = db?.session.role === 'owner' || db?.session.role === 'manager' || can('shifts.view_all');
  const [tab, setTab] = useState<Tab>(route?.params?.close && seeAll ? 'day' : 'mine');
  const shift = activeShift();
  const last = lastClosedShift();

  const [openSheet, setOpenSheet] = useState(!!route?.params?.open);
  const [floatAmt, setFloatAmt] = useState(String(last?.countedCash ?? 0));
  const [till, setTill] = useState(db?.session.till || 'Till 1');

  // closing: one or several shifts, each with its own count
  const [closing, setClosing] = useState<Shift[] | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');

  // day close: who is included
  const [picked, setPicked] = useState<Record<string, boolean> | null>(null);

  const branch = db ? activeBranchId(db) : undefined;
  const openShifts = useMemo(
    () => (db?.shifts || []).filter((s) => !s.closedAt && (!branch || !s.branch || s.branch === branch)),
    [db?.shifts, branch],
  );

  if (!db) return null;

  const isPicked = (id: string) => (picked ? !!picked[id] : true);
  const chosen = openShifts.filter((s) => isPicked(s.id));
  const sum = (list: Shift[]) => list.reduce((t, s) => {
    const z = shiftTotals(s);
    return {
      cash: t.cash + z.cash, momo: t.momo + z.momo, bank: t.bank + z.bank, credit: t.credit + z.credit,
      expected: t.expected + z.expected, total: t.total + z.total, count: t.count + z.count,
    };
  }, { cash: 0, momo: 0, bank: 0, credit: 0, expected: 0, total: 0, count: 0 });

  function startClose(list: Shift[]) {
    if (!list.length) return;
    const c: Record<string, string> = {};
    list.forEach((s) => { c[s.id] = String(shiftTotals(s).expected); });
    setCounts(c);
    setNote('');
    setClosing(list);
  }

  function confirmClose() {
    if (!closing) return;
    const off = closing
      .map((s) => ({ s, v: shiftVariance(shiftTotals(s).expected, num(counts[s.id] || '0')) }))
      .filter((x) => x.v.state !== 'balanced');
    const doIt = () => {
      closing.forEach((s) => closeShift(s.id, num(counts[s.id] || '0'), note));
      setClosing(null);
      setPicked(null);
    };
    if (!off.length) { doIt(); return; }
    Alert.alert(
      off.length === 1 ? 'A drawer does not balance' : off.length + ' drawers do not balance',
      off.map((x) => (user(x.s.userId)?.name || 'Staff') + ': ' + x.v.state + ' ' + money(Math.abs(x.v.diff))).join('\n')
        + '\n\nShort is posted as an expense and over as other income, so the books tie out.',
      [{ text: 'Recount', style: 'cancel' }, { text: 'Close and post', onPress: doIt }],
    );
  }

  /* ---------- pieces ---------- */

  const money4 = (z: { cash: number; momo: number; bank: number; credit: number }) => (
    <View style={{ flexDirection: 'row', marginTop: 12 }}>
      {([
        ['Cash', z.cash, colors.good],
        ['Mobile money', z.momo, colors.accent],
        ['Bank', z.bank, colors.accent],
        ['Credit', z.credit, colors.warn],
      ] as Array<[string, number, string]>).map(([k, v, c], i) => (
        <View key={k} style={{ flex: 1, paddingHorizontal: 4, borderLeftWidth: i ? 1 : 0, borderLeftColor: colors.line }}>
          <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint }} numberOfLines={1}>{k}</Text>
          <Text style={{ fontFamily: fonts.monoSemi, fontSize: 13.5, color: c, marginTop: 3 }} numberOfLines={1} adjustsFontSizeToFit>{money0(v)}</Text>
        </View>
      ))}
    </View>
  );

  const mine = () => {
    if (!shift) {
      return (
        <Panel style={{ alignItems: 'center', paddingVertical: 28 }}>
          <View style={{ width: 64, height: 64, borderRadius: 22, backgroundColor: colors.sunk, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="till" size={30} color={colors.faint} />
          </View>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 19, color: colors.ink, marginTop: 14 }}>Your till is closed</Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint, marginTop: 6, textAlign: 'center', paddingHorizontal: 20 }}>
            Open a shift with the cash in the drawer. Every sale you make is counted to it.
          </Text>
          {last ? (
            <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 12 }}>
              Last closed {fmtDate(last.closedAt as string)} with {money(last.countedCash || 0)}
            </Text>
          ) : null}
        </Panel>
      );
    }
    const z = shiftTotals(shift);
    return (
      <>
        <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 18, borderWidth: 1, borderColor: colors.line }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.good }} />
            <Text style={{ flex: 1, fontFamily: fonts.uiExtra, fontSize: 18, color: colors.ink }}>Till open</Text>
            <Badge label={shift.till} tone="good" />
          </View>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 6 }}>
            {user(shift.userId)?.name} · since {fmtDate(shift.openedAt)} · {z.count} bill{z.count === 1 ? '' : 's'}
          </Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 16 }}>Drawer should hold</Text>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 30, color: colors.ink, letterSpacing: -0.6 }}>{money(z.expected)}</Text>
          {money4(z)}
        </View>

        <View style={{ height: 14 }} />
        <Panel>
          <DetailRow label="Opening float" value={money(shift.openingFloat)} />
          <DetailRow label="Cash sales" value={money(z.cash)} />
          <DetailRow label="Money received in cash" value={money(z.recv)} />
          <DetailRow label="Cash paid out" value={'− ' + money(z.paidOut)} tone={colors.danger} />
          <DetailRow label="Expected in drawer" value={money(z.expected)} bold last />
        </Panel>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
          <View style={{ flex: 1 }}>
            <Button label="Cash in" icon={<Icon name="down" size={16} color={colors.good} />} onPress={() => go('EntryNew', { direction: 'in' })} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Cash out" icon={<Icon name="up" size={16} color={colors.danger} />} onPress={() => go('EntryNew', { direction: 'out' })} />
          </View>
        </View>
      </>
    );
  };

  const day = () => {
    if (!openShifts.length) {
      return <Panel><EmptyBlock icon="clock" title="No shifts are open" hint="Every till in this branch is closed." /></Panel>;
    }
    const all = sum(chosen);
    const allOn = chosen.length === openShifts.length;
    return (
      <>
        <SectionLabel>Who to close</SectionLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          <Pressable
            onPress={() => setPicked(null)}
            style={{
              paddingVertical: 9, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1.4,
              borderColor: allOn ? colors.accent : colors.line, backgroundColor: allOn ? colors.accent : colors.surface,
            }}
          >
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: allOn ? colors.accentInk : colors.soft }}>All staff · {openShifts.length}</Text>
          </Pressable>
          {openShifts.map((s) => {
            const on = isPicked(s.id) && !allOn;
            return (
              <Pressable
                key={s.id}
                onPress={() => {
                  const base: Record<string, boolean> = picked && !allOn ? { ...picked } : {};
                  base[s.id] = !base[s.id];
                  setPicked(Object.values(base).some(Boolean) ? base : null);
                }}
                style={{
                  paddingVertical: 9, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1.4,
                  borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accentSoft : colors.surface,
                }}
              >
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: on ? colors.accent : colors.soft }}>
                  {user(s.userId)?.name || 'Staff'} · {s.till}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 18, borderWidth: 1, borderColor: colors.line }}>
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint }}>
            {allOn ? 'Everyone' : chosen.length + ' of ' + openShifts.length + ' tills'} · {all.count} bill{all.count === 1 ? '' : 's'} · sold {money(all.total)}
          </Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 12 }}>Drawers should hold</Text>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 28, color: colors.ink, letterSpacing: -0.6 }}>{money(all.expected)}</Text>
          {money4(all)}
        </View>

        <View style={{ height: 16 }} />
        <SectionLabel>Each till</SectionLabel>
        <Panel flush>
          {chosen.map((s, i) => {
            const z = shiftTotals(s);
            return (
              <View key={s.id} style={{ padding: 14, borderBottomWidth: i === chosen.length - 1 ? 0 : 1, borderBottomColor: colors.line }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Avatar name={user(s.userId)?.name || '?'} id={s.userId} size={34} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink }} numberOfLines={1}>{user(s.userId)?.name || 'Staff'} · {s.till}</Text>
                    <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 1 }}>since {fmtDate(s.openedAt)} · {z.count} bills</Text>
                  </View>
                  <Text style={{ fontFamily: fonts.monoSemi, fontSize: 14, color: colors.ink }}>{money0(z.expected)}</Text>
                </View>
                {money4(z)}
              </View>
            );
          })}
        </Panel>
      </>
    );
  };

  const history = () => {
    const past = db.shifts.filter((s) => s.closedAt && (!branch || !s.branch || s.branch === branch)).slice().reverse().slice(0, 60);
    if (!past.length) return <Panel><EmptyBlock icon="clock" title="No closed shifts yet" /></Panel>;
    return (
      <Panel flush>
        {past.map((s, i) => {
          const v = s.variance ?? ((s.countedCash || 0) - (s.expected || 0));
          const balanced = Math.abs(v) < 1;
          return (
            <View key={s.id} style={{
              flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14,
              borderBottomWidth: i === past.length - 1 ? 0 : 1, borderBottomColor: colors.line,
            }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }} numberOfLines={1}>{user(s.userId)?.name} · {s.till}</Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 1 }} numberOfLines={1}>
                  {fmtDate(s.openedAt)} → {fmtDate(s.closedAt as string)}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontFamily: fonts.monoSemi, fontSize: 13, color: colors.ink }}>{money(s.countedCash || 0)}</Text>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11, marginTop: 1, color: balanced ? colors.good : v < 0 ? colors.danger : colors.warn }}>
                  {balanced ? 'Balanced' : v < 0 ? 'Short ' + money0(-v) : 'Over ' + money0(v)}
                </Text>
              </View>
            </View>
          );
        })}
      </Panel>
    );
  };

  /* ---------- the screen ---------- */

  const tabs: Array<{ v: Tab; l: string; i: any }> = [
    { v: 'mine', l: 'My till', i: 'till' },
    ...(seeAll ? [{ v: 'day' as Tab, l: 'Day close', i: 'lock' }] : []),
    { v: 'history', l: 'History', i: 'clock' },
  ];

  const footer = tab === 'mine'
    ? (shift
      ? <Button variant="pri" label="Close my shift" icon={<Icon name="lock" size={16} color={colors.accentInk} />} onPress={() => startClose([shift])} />
      : <Button variant="pri" label="Open my shift" icon={<Icon name="till" size={16} color={colors.accentInk} />} onPress={() => setOpenSheet(true)} />)
    : tab === 'day' && chosen.length
      ? <Button variant="pri" label={chosen.length === 1 ? 'Close 1 shift' : 'Close ' + chosen.length + ' shifts'} icon={<Icon name="lock" size={16} color={colors.accentInk} />} onPress={() => startClose(chosen)} />
      : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TopTabs value={tab} onChange={setTab} options={tabs} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        {tab === 'mine' ? mine() : tab === 'day' ? day() : history()}
      </ScrollView>

      {footer ? <Foot>{footer}</Foot> : null}

      {/* open */}
      <Sheet
        visible={openSheet}
        title="Open a shift"
        icon="till"
        onClose={() => setOpenSheet(false)}
        footer={<Button variant="pri" label="Start selling" onPress={() => { openShift(num(floatAmt), till); setOpenSheet(false); setTab('mine'); }} />}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 14 }}>
          <Avatar name={me()?.name || ''} id={me()?.id} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink }}>{me()?.name}</Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 1 }}>{fmtDate(new Date().toISOString())}</Text>
          </View>
        </View>
        <BigAmount caption="Cash in the drawer now" value={floatAmt} onChangeText={setFloatAmt} currency={cur()} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 14 }}>
          {last?.countedCash ? <ActionChip label={'Last count ' + money0(last.countedCash)} onPress={() => setFloatAmt(String(last.countedCash))} /> : null}
          {[0, 50000, 100000, 200000].map((v) => <ActionChip key={v} label={money0(v)} onPress={() => setFloatAmt(String(v))} />)}
        </View>
        <Field label="Till" value={till} onChangeText={setTill} icon="till" />
        <FieldNote>Count the float before you start. Closing compares the count with what the till says.</FieldNote>
      </Sheet>

      {/* close one or several */}
      <Sheet
        visible={!!closing}
        title={closing && closing.length > 1 ? 'Close ' + closing.length + ' shifts' : 'Close the shift'}
        icon="lock"
        full={!!closing && closing.length > 1}
        onClose={() => setClosing(null)}
        footer={<Button variant="pri" label="Close and post" onPress={confirmClose} />}
      >
        {(closing || []).map((s) => {
          const z = shiftTotals(s);
          const counted = num(counts[s.id] || '0');
          const v = shiftVariance(z.expected, counted);
          return (
            <View key={s.id} style={{ marginBottom: 16, padding: 14, borderRadius: 16, backgroundColor: colors.sunk }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 14.5, color: colors.ink }}>{user(s.userId)?.name} · {s.till}</Text>
              {money4(z)}
              <View style={{ height: 12 }} />
              <Field
                icon="cash"
                label={'Counted cash · should be ' + money0(z.expected)}
                value={counts[s.id] || ''}
                onChangeText={(t) => setCounts((c) => ({ ...c, [s.id]: t }))}
                numeric decimal
                style={{ marginBottom: 6 }}
              />
              <Text style={{
                fontFamily: fonts.uiSemi, fontSize: 12.5,
                color: v.state === 'balanced' ? colors.good : v.state === 'short' ? colors.danger : colors.warn,
              }}>
                {v.state === 'balanced' ? 'Balanced' : (v.state === 'short' ? 'Short ' : 'Over ') + money(Math.abs(v.diff))}
              </Text>
            </View>
          );
        })}
        <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="Anything that explains a difference" />
      </Sheet>
    </View>
  );
}
