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
import { View, Text, ScrollView, Alert } from 'react-native';
import { Pressable } from '../components/Press';
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
import { shiftVariance, shiftSales } from '../data/logic';
import { isRestaurant, menuSections } from '../data/restaurant';
import { activeBranchId } from '../data/branch';
import SendSheet from '../components/SendSheet';
import { daySummary } from '../data/daySummary';
import type { Shift } from '../data/types';

const num = (v: string) => Number(String(v).replace(/[^0-9.]/g, '')) || 0;
type Tab = 'mine' | 'day' | 'history';

export default function ShiftScreen({ route }: any) {
  const { colors } = useTheme();
  const go = useGo();
  const { db, money, cur, me, user, activeShift, openShift, closeShift, shiftTotals, lastClosedShift, can, closeDay, reopenDay, voidTicket } = useAppData();

  const seeAll = db?.session.role === 'owner' || db?.session.role === 'manager' || can('shifts.view_all');
  const [tab, setTab] = useState<Tab>(route?.params?.close && seeAll ? 'day' : 'mine');
  const shift = activeShift();
  const last = lastClosedShift();

  const [openSheet, setOpenSheet] = useState(!!route?.params?.open);
  const [floatAmt, setFloatAmt] = useState(String(last?.countedCash ?? 0));
  const [till, setTill] = useState(db?.session.till || 'Till 1');

  // closing: one or several shifts, each with its own count
  const [closing, setClosing] = useState<Shift[] | null>(null);
  /** The close came from Day close: the day is frozen once the drawers are closed. */
  const [closingDay, setClosingDay] = useState(false);
  const [summary, setSummary] = useState('');
  const [summaryOpen, setSummaryOpen] = useState(false);
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

  // day close is by person: every active member of staff, whether or not a shift is open
  const staff = db.users.filter((u) => u.active);
  const isPicked = (userId: string) => (picked ? !!picked[userId] : true);
  const chosen = openShifts.filter((s) => isPicked(s.userId));
  const sum = (list: Shift[]) => list.reduce((t, s) => {
    const z = shiftTotals(s);
    return {
      cash: t.cash + z.cash, momo: t.momo + z.momo, bank: t.bank + z.bank, credit: t.credit + z.credit,
      expected: t.expected + z.expected, total: t.total + z.total, count: t.count + z.count,
      recvAll: t.recvAll + (z.recvAll || 0), recvCount: t.recvCount + (z.recvCount || 0),
    };
  }, { cash: 0, momo: 0, bank: 0, credit: 0, expected: 0, total: 0, count: 0, recvAll: 0, recvCount: 0 });

  function startClose(list: Shift[]) {
    if (!list.length) return;
    const c: Record<string, string> = {};
    list.forEach((s) => { c[s.id] = String(shiftTotals(s).expected); });
    setCounts(c);
    setNote('');
    setClosing(list);
  }

  /**
   * Day close. Open tickets are tables still eating or orders never charged: the
   * day cannot be frozen with them hanging, so they are listed first and can be
   * cancelled, or charged on the order screen before coming back.
   */
  function startDayClose() {
    const open = (db?.tickets || []).filter((t) => t.status === 'open');
    const go2 = () => {
      setClosingDay(true);
      if (chosen.length) startClose(chosen);
      else finishDay();
    };
    if (isRestaurant(db) && open.length) {
      const amt = (t: typeof open[number]) => t.lines.reduce((n, l) => n + l.qty * l.price, 0);
      Alert.alert(
        open.length === 1 ? '1 ticket is still open' : open.length + ' tickets are still open',
        open.map((t) => '• ' + t.name + ' — ' + money(amt(t))).join('\n')
          + '\n\nCharge them on the order screen, or cancel them to close the day.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Charge them', onPress: () => go('Order' as any) },
          {
            text: 'Cancel them and close', style: 'destructive', onPress: () => {
              open.forEach((t) => voidTicket(t.id));
              go2();
            },
          },
        ],
      );
      return;
    }
    go2();
  }

  function finishDay() {
    closeDay();
    setClosingDay(false);
    // the owner's day in a message, ready to send
    const owner = db?.users.find((u) => u.role === 'owner');
    setSummary(daySummary(db!, money));
    Alert.alert('Day closed', 'Today\'s transactions are frozen. Only the owner can reopen the day to change them.', [
      { text: 'Done', style: 'cancel' },
      { text: 'Send summary to ' + (owner?.name || 'the owner'), onPress: () => setSummaryOpen(true) },
    ]);
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
      if (closingDay) finishDay();
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
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }} numberOfLines={1}>{k}</Text>
          <Text style={{ fontFamily: fonts.monoSemi, fontSize: 12.5, color: c, marginTop: 3 }} numberOfLines={1} adjustsFontSizeToFit>{money0(v)}</Text>
        </View>
      ))}
    </View>
  );

  const received = (z: { recvAll?: number; recvCount?: number }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.line }}>
      <Icon name="down" size={15} color={colors.good} />
      <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 12.5, color: colors.soft }}>
        Money received{z.recvCount ? ' · ' + z.recvCount + ' payment' + (z.recvCount === 1 ? '' : 's') : ''}
      </Text>
      <Text style={{ fontFamily: fonts.monoSemi, fontSize: 13, color: colors.good }}>{money0(z.recvAll || 0)}</Text>
    </View>
  );

  const mine = () => {
    if (!shift) {
      return (
        <Panel style={{ alignItems: 'center', paddingVertical: 28 }}>
          <View style={{ width: 64, height: 64, borderRadius: 22, backgroundColor: colors.sunk, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="till" size={30} color={colors.faint} />
          </View>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink, marginTop: 14 }}>Your till is closed</Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 6, textAlign: 'center', paddingHorizontal: 20 }}>
            Open a shift with the cash in the drawer. Every sale you make is counted to it.
          </Text>
          {last ? (
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 12 }}>
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
            <Text style={{ flex: 1, fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink }}>Till open</Text>
            <Badge label={shift.till} tone="good" />
          </View>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 6 }}>
            {user(shift.userId)?.name} · since {fmtDate(shift.openedAt)} · {z.count} bill{z.count === 1 ? '' : 's'}
          </Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 16 }}>Drawer should hold</Text>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 30, color: colors.ink, letterSpacing: -0.6 }}>{money(z.expected)}</Text>
          {money4(z)}
          {received(z)}
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

  const byMenu = (list: Shift[]) => {
    if (!isRestaurant(db) || !list.length) return null;
    const sections = menuSections(db);
    const menus = db.menus || [];
    const groups: { name: string; has: (cat: string) => boolean }[] = menus.length
      ? menus.map((mn) => ({ name: mn.name, has: (c: string) => mn.sections.includes(c) }))
      : sections.map((sc) => ({ name: sc.name, has: (c: string) => c === sc.name }));
    const totals = new Map<string, { qty: number; amount: number }>();
    const add = (k: string, q: number, a: number) => { const t = totals.get(k) || { qty: 0, amount: 0 }; t.qty += q; t.amount += a; totals.set(k, t); };
    list.forEach((sh) => shiftSales(db, sh).forEach((sale) => sale.lines.forEach((l) => {
      const cat = db.products.find((x) => x.id === l.productId)?.category || 'Other';
      const g = groups.find((x) => x.has(cat));
      add(g ? g.name : 'Not on a menu', l.qty, l.qty * l.price);
    })));
    const rows = [...totals.entries()].sort((a, b) => b[1].amount - a[1].amount);
    if (!rows.length) return null;
    const all = rows.reduce((n, [, t]) => n + t.amount, 0);
    return (
      <>
        <View style={{ height: 16 }} />
        <SectionLabel>{menus.length ? 'By menu' : 'By section'}</SectionLabel>
        <Panel flush>
          {rows.map(([k, t], i) => (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderBottomColor: colors.line }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }} numberOfLines={1}>{k}</Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 1 }}>
                  {t.qty} item{t.qty === 1 ? '' : 's'} · {all ? Math.round(t.amount / all * 100) : 0}%
                </Text>
              </View>
              <Text style={{ fontFamily: fonts.monoSemi, fontSize: 15, color: colors.ink }}>{money0(t.amount)}</Text>
            </View>
          ))}
        </Panel>
      </>
    );
  };

  const day = () => {
    if (!staff.length) {
      return <Panel><EmptyBlock icon="user" title="No staff yet" hint="Add people under Staff & roles." /></Panel>;
    }
    const all = sum(chosen);
    const allOn = !picked;
    const pickedStaff = staff.filter((u) => isPicked(u.id));
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const soldToday = (userId: string) => db.sales
      .filter((x) => x.userId === userId && x.status !== 'void' && new Date(x.ts).getTime() >= startOfToday.getTime()
        && (!branch || !x.warehouse || x.warehouse === branch))
      .reduce((t, x) => ({ n: t.n + 1, total: t.total + x.total }), { n: 0, total: 0 });
    const onShift = staff.filter((u) => openShifts.some((x) => x.userId === u.id)).length;

    const closedAt = db.settings.closedThrough;
    return (
      <>
        {closedAt ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: colors.sunk, marginBottom: 14 }}>
            <Icon name="lock" size={17} color={colors.ink} />
            <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 12.5, color: colors.soft }}>
              Closed through {fmtDate(closedAt)}. Everything before it is frozen.
            </Text>
            {db.session.role === 'owner' ? (
              <Pressable hitSlop={8} onPress={() => Alert.alert('Reopen the day?', 'Transactions up to ' + fmtDate(closedAt) + ' can be edited and deleted again.', [
                { text: 'Keep closed', style: 'cancel' },
                { text: 'Reopen', onPress: () => reopenDay() },
              ])}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: colors.accent }}>Reopen</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        <SectionLabel right={<Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{onShift} of {staff.length} on shift</Text>}>
          Who to close
        </SectionLabel>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          <Pressable
            onPress={() => setPicked(null)}
            style={{
              paddingVertical: 9, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1.4,
              borderColor: allOn ? colors.accent : colors.line, backgroundColor: allOn ? colors.accent : colors.surface,
            }}
          >
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: allOn ? colors.accentInk : colors.soft }}>All staff · {staff.length}</Text>
          </Pressable>
          {staff.map((u) => {
            const on = !allOn && isPicked(u.id);
            const open = openShifts.some((x) => x.userId === u.id);
            return (
              <Pressable
                key={u.id}
                onPress={() => {
                  const base: Record<string, boolean> = picked ? { ...picked } : {};
                  base[u.id] = !base[u.id];
                  setPicked(Object.values(base).some(Boolean) ? base : null);
                }}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  paddingVertical: 9, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1.4,
                  borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accentSoft : colors.surface,
                }}
              >
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: open ? colors.good : colors.lineHard }} />
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: on ? colors.accent : colors.soft }}>{u.name}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 18, borderWidth: 1, borderColor: colors.line }}>
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint }}>
            {allOn ? 'All staff' : pickedStaff.length + ' of ' + staff.length + ' staff'} · {all.count} sale{all.count === 1 ? '' : 's'} · sold {money(all.total)}
          </Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 12 }}>Drawers should hold</Text>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 28, color: colors.ink, letterSpacing: -0.6 }}>{money(all.expected)}</Text>
          {money4(all)}
          {received(all)}
        </View>

        {byMenu(chosen)}

        <View style={{ height: 16 }} />
        <SectionLabel>Each member of staff</SectionLabel>
        <Panel flush>
          {pickedStaff.map((u, i) => {
            const mineOpen = openShifts.filter((x) => x.userId === u.id);
            const z = sum(mineOpen);
            const today = soldToday(u.id);
            const since = mineOpen.map((x) => x.openedAt).sort()[0];
            return (
              <View key={u.id} style={{ padding: 14, borderBottomWidth: i === pickedStaff.length - 1 ? 0 : 1, borderBottomColor: colors.line }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Avatar name={u.name} id={u.id} size={34} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }} numberOfLines={1}>{u.name}</Text>
                    <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 1 }} numberOfLines={1}>
                      {mineOpen.length
                        ? 'On shift since ' + fmtDate(since) + ' · ' + z.count + ' sale' + (z.count === 1 ? '' : 's')
                        : 'Not on shift · ' + today.n + ' sale' + (today.n === 1 ? '' : 's') + ' today'}
                    </Text>
                  </View>
                  {mineOpen.length
                    ? <Text style={{ fontFamily: fonts.monoSemi, fontSize: 15, color: colors.ink }}>{money0(z.expected)}</Text>
                    : <Badge label="Closed" tone="neutral" />}
                </View>
                {mineOpen.length ? <>{money4(z)}{z.recvAll ? received(z) : null}</> : (
                  <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 8 }}>
                    Sold {money(today.total)} today. No drawer to count.
                  </Text>
                )}
              </View>
            );
          })}
        </Panel>
        {!chosen.length ? (
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, textAlign: 'center', marginTop: 12 }}>
            Nobody picked has a shift open, so there is nothing to close.
          </Text>
        ) : null}
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
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.ink }} numberOfLines={1}>{user(s.userId)?.name} · {s.till}</Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 1 }} numberOfLines={1}>
                  {fmtDate(s.openedAt)} → {fmtDate(s.closedAt as string)}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontFamily: fonts.monoSemi, fontSize: 12.5, color: colors.ink }}>{money(s.countedCash || 0)}</Text>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, marginTop: 1, color: balanced ? colors.good : v < 0 ? colors.danger : colors.warn }}>
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
    : tab === 'day'
      ? <Button
        variant="pri"
        label={chosen.length ? 'Close ' + (chosen.length === 1 ? '1 shift' : chosen.length + ' shifts') + ' and the day' : 'Close the day'}
        icon={<Icon name="lock" size={16} color={colors.accentInk} />}
        onPress={startDayClose}
      />
      : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TopTabs value={tab} onChange={setTab} options={tabs} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        {tab === 'mine' ? mine() : tab === 'day' ? day() : history()}
      </ScrollView>

      {footer ? <Foot>{footer}</Foot> : null}

      <SendSheet
        visible={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        title="Send the day's summary"
        to={db.users.find((u) => u.role === 'owner')?.name}
        phone={db.firm.phone}
        email={db.firm.email}
        subject={db.firm.name + ' — day summary'}
        text={summary}
      />

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
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{me()?.name}</Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 1 }}>{fmtDate(new Date().toISOString())}</Text>
          </View>
        </View>
        <Field big label={"Cash in the drawer now (" + cur() + ")"} value={floatAmt} onChangeText={setFloatAmt} numeric decimal />
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
        onClose={() => { setClosing(null); setClosingDay(false); }}
        footer={<Button variant="pri" label={closingDay ? 'Close and freeze the day' : 'Close and post'} onPress={confirmClose} />}
      >
        {(closing || []).map((s) => {
          const z = shiftTotals(s);
          const counted = num(counts[s.id] || '0');
          const v = shiftVariance(z.expected, counted);
          return (
            <View key={s.id} style={{ marginBottom: 16, padding: 14, borderRadius: 16, backgroundColor: colors.sunk }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{user(s.userId)?.name || 'Staff'}</Text>
              {money4(z)}
              {received(z)}
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
