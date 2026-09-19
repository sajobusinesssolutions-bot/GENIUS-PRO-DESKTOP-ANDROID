/**
 * DASHBOARD
 *
 * The screen answers four questions in order, and nothing else:
 *
 *   1. How did we do?        — one figure, with the week behind it
 *   2. Where is the money?   — what is in the drawer, what is owed
 *   3. Is anything wrong?    — only when something is
 *   4. What just happened?   — the last few bills
 *
 * It used to carry a sync banner, a takings card, a period strip, an arc gauge
 * with four category tiles, a week-rings card, a four-stat grid, a five-column
 * quick-action grid, a to-do list and a bill list — nine blocks and better than
 * fifteen figures before a single tap. Everything dropped is one tap away: the
 * category split and the week detail live in Reports, which the takings card
 * opens, and the full quick-action catalogue is on the centre button of the tab
 * bar from every screen, which is where people already reach for it.
 *
 * Reference: the live definition at lines 6289-6381 (alertCount 6384, todoBlock
 * 6392), reorganised rather than ported line for line.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { canFor } from '../data/perms';
import { Card, Cap, Pill, Banner, Avatar, EmptyState } from '../components/ui';
import { AppBar, IconBtn } from '../components/AppBar';
import { Icon, IconName } from '../components/icons';
import { TrendBars } from '../components/charts';
import { useGo } from '../nav/navigate';
import {
  periodRange, plural, startOfDay, endOfDay, daysAgo, inRange, ageOfDays, fmtDate,
} from '../data/helpers';

type Period = 'today' | 'week' | 'month';
const PERIODS: { v: Period; l: string }[] = [
  { v: 'today', l: 'Today' },
  { v: 'week', l: 'Week' },
  { v: 'month', l: 'Month' },
];

/** How many of each list is worth showing before it becomes a page of its own. */
const TODO_SHOWN = 3;
const BILLS_SHOWN = 3;

/* ---------------------------------------------------------------- */

/**
 * A quiet period switch. The kit's SegPill is built for a decision inside a
 * form and is too loud for a control the eye should pass over on its way to
 * the figure underneath.
 */
function PeriodSwitch({ value, onChange }: { value: Period; onChange: (v: Period) => void }) {
  const { colors } = useTheme();
  return (
    <View style={{
      flexDirection: 'row', backgroundColor: colors.sunk,
      borderRadius: radius.pill, padding: 3,
    }}>
      {PERIODS.map((p) => {
        const on = p.v === value;
        return (
          <Pressable
            key={p.v}
            onPress={() => onChange(p.v)}
            style={{
              paddingVertical: 6, paddingHorizontal: 13, borderRadius: radius.pill,
              backgroundColor: on ? colors.surface : 'transparent',
            }}
          >
            <Text style={{
              fontFamily: on ? fonts.uiBold : fonts.uiSemi,
              fontSize: 12.5, color: on ? colors.ink : colors.faint,
            }}>
              {p.l}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** One figure with a name over it. Two of these sit side by side. */
function MoneyTile({ label, value, icon, tone, note, onPress }: {
  label: string; value: string; icon: IconName;
  tone: 'good' | 'warn'; note?: string; onPress: () => void;
}) {
  const { colors } = useTheme();
  const fg = tone === 'good' ? colors.good : colors.warn;
  const bg = tone === 'good' ? colors.goodSoft : colors.warnSoft;
  return (
    <Pressable onPress={onPress} style={{ flex: 1 }}>
      <Card style={{ paddingHorizontal: 14, paddingVertical: 14, gap: 9, borderRadius: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{
            width: 26, height: 26, borderRadius: 9, backgroundColor: bg,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name={icon} size={14} color={fg} />
          </View>
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 12, color: colors.faint }}>
            {label}
          </Text>
        </View>
        <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 19, color: colors.ink, letterSpacing: -0.4 }}>
          {value}
        </Text>
        {note ? (
          <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 11.5, color: colors.danger }}>
            {note}
          </Text>
        ) : null}
      </Card>
    </Pressable>
  );
}

/** A plain row: content on the left, chevron on the right. */
function Row({ children, onPress, last }: { children: React.ReactNode; onPress: () => void; last: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingVertical: 13, paddingHorizontal: 15,
        borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.line,
      }}
    >
      {children}
      <Icon name="chev" size={14} color={colors.faint} />
    </Pressable>
  );
}

function SectionHead({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
      marginBottom: 9, paddingHorizontal: 2,
    }}>
      <Cap>{title}</Cap>
      {action ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.accent }}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ---------------------------------------------------------------- */

export default function DashboardScreen() {
  const { colors } = useTheme();
  const go = useGo();
  const {
    db, money, me, stockOf, party, partyBalance, accountBalance, dueRecurring,
  } = useAppData();
  const [period, setPeriod] = useState<Period>('today');

  const role = db?.session.role;
  const can = (k: any) => canFor(role, k);

  const d = useMemo(() => {
    if (!db) return null;
    const R = periodRange(period);
    const live = db.sales.filter((s) => s.status !== 'void');
    const ss = live.filter((s) => inRange(s.ts, R.from, R.to));
    const prev = live.filter((s) => inRange(s.ts, R.prev.from, R.prev.to));
    const total = ss.reduce((a, s) => a + s.total, 0);
    const prevTotal = prev.reduce((a, s) => a + s.total, 0);
    const delta = prevTotal ? Math.round(((total - prevTotal) / prevTotal) * 100) : 0;

    let owed = 0;
    db.parties.forEach((p) => { const b = partyBalance(p.id); if (b > 0) owed += b; });
    const lateBills = db.sales.filter((s) => s.due > 0 && s.status !== 'void' && ageOfDays(s.ts) > 30);
    const overdue = lateBills.reduce((a, s) => a + s.due, 0);
    const cash = accountBalance('acc_cash');

    const days: { v: number; idx: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const day = daysAgo(i);
      const v = live
        .filter((s) => inRange(s.ts, startOfDay(day), endOfDay(day)))
        .reduce((a, s) => a + s.total, 0);
      days.push({ v, idx: new Date(day).getDay() });
    }

    const low = db.products.filter((p) => p.active && stockOf(p) <= p.reorder);
    const openPO = (db.purchaseOrders || []).filter((p) => p.status === 'open');
    const openCounts = (db.stockTakes || []).filter((s) => s.status === 'open').length;
    const openQuotes = (db.estimates || []).filter((e) => e.status === 'open');
    const due = dueRecurring();

    // ordered by what costs the shop most to leave alone
    const todo: { t: string; route: string }[] = [];
    if (lateBills.length) todo.push({ t: plural(lateBills.length, 'bill') + ' over 30 days', route: 'Sales' });
    if (due.length) todo.push({ t: plural(due.length, 'recurring bill') + ' due', route: 'Recurring' });
    if (low.length) todo.push({ t: plural(low.length, 'item') + ' to restock', route: 'ItemsTab' });
    if (openCounts) todo.push({ t: 'A stock count is still open', route: 'StockTakes' });
    if (openQuotes.length) todo.push({ t: plural(openQuotes.length, 'quotation') + ' open', route: 'Estimates' });

    const alerts = low.length + lateBills.length
      + db.claims.filter((c) => c.status === 'open').length + due.length;

    return {
      R, bills: ss.length, total, prevTotal, delta,
      owed, overdue, cash, days, todo, alerts,
      recent: live.slice(-BILLS_SHOWN).reverse(),
    };
  }, [db, period]);

  if (!db || !d) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  const online = db.session.online !== false;
  const queued = db.queue.length;
  const user = me();
  const average = d.bills ? d.total / d.bills : 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AppBar
        title={db.firm.name}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <View>
              <IconBtn name="alert" onPress={() => go('Notifications')} color={colors.soft} />
              {d.alerts ? (
                <View style={{
                  position: 'absolute', top: -1, right: -2, minWidth: 15, height: 15, paddingHorizontal: 4,
                  borderRadius: 99, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ color: '#fff', fontFamily: fonts.uiBold, fontSize: 9 }}>
                    {d.alerts > 9 ? '9+' : d.alerts}
                  </Text>
                </View>
              ) : null}
            </View>
            <IconBtn onPress={() => go('PinLock')}>
              <Avatar name={user?.name || '?'} id={user?.id} size={28} />
            </IconBtn>
          </View>
        }
      />

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 28 }}>
        {/*
          Shown only when it is something to act on. A standing "all synced"
          line is a banner the eye learns to skip, which is exactly what a
          banner must not be.
        */}
        {!online ? (
          <Banner tone="w" icon="cloud" text={'Offline — ' + plural(queued, 'change') + ' waiting'} />
        ) : queued ? (
          <Banner tone="g" icon="cloud" text={plural(queued, 'change') + ' waiting to go up'} />
        ) : null}

        {/* 1 — how did we do */}
        <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
          <Card style={{ paddingHorizontal: 16, paddingTop: 15, paddingBottom: 15, borderRadius: 18 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Cap>Sales</Cap>
              <PeriodSwitch value={period} onChange={setPeriod} />
            </View>

            <Pressable onPress={() => go('Reports')}>
              <Text testID="takings" style={{
                fontFamily: fonts.uiExtra, fontSize: 34, color: colors.ink,
                letterSpacing: -1.2, marginTop: 10,
              }}>
                {money(d.total)}
              </Text>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 7 }}>
                {d.prevTotal ? (
                  <Pill
                    tone={d.delta >= 0 ? 'g' : 'd'}
                    label={Math.abs(d.delta) + '%'}
                    icon={<Icon name={d.delta >= 0 ? 'up' : 'down'} size={12} color={d.delta >= 0 ? colors.good : colors.danger} />}
                  />
                ) : null}
                <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>
                  {d.bills ? plural(d.bills, 'bill') + ' · ' + money(average) + ' average' : 'No bills yet'}
                </Text>
              </View>

              <View style={{ height: 1, backgroundColor: colors.line, marginTop: 15, marginBottom: 13 }} />
              <TrendBars days={d.days} />
            </Pressable>
          </Card>
        </View>

        {/* 2 — where is the money */}
        <View style={{ flexDirection: 'row', gap: 11, paddingHorizontal: 16, paddingTop: 11 }}>
          <MoneyTile
            label="In the drawer" value={money(d.cash)} icon="cash" tone="good"
            onPress={() => go('Shift')}
          />
          <MoneyTile
            label="Owed to you" value={money(d.owed)} icon="clock" tone="warn"
            // the overdue share earns a line only when there is one
            note={d.overdue ? money(d.overdue) + ' late' : undefined}
            onPress={() => go('Parties')}
          />
        </View>

        {/* 3 — is anything wrong */}
        {d.todo.length ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 22 }}>
            <SectionHead
              title="Needs you"
              action={d.todo.length > TODO_SHOWN ? (d.todo.length - TODO_SHOWN) + ' more' : undefined}
              onAction={() => go('Notifications')}
            />
            <Card style={{ borderRadius: 16 }}>
              {d.todo.slice(0, TODO_SHOWN).map((x, i, a) => (
                <Row key={x.t} onPress={() => go(x.route)} last={i === a.length - 1}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.warn }} />
                  <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>
                    {x.t}
                  </Text>
                </Row>
              ))}
            </Card>
          </View>
        ) : null}

        {/* 4 — what just happened */}
        {can('sales') ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 22 }}>
            <SectionHead title="Latest bills" action="See all" onAction={() => go('Sales')} />
            <Card style={{ borderRadius: 16 }}>
              {d.recent.length ? d.recent.map((s, i, a) => (
                <Row key={s.id} onPress={() => go('SaleDetail', { saleId: s.id })} last={i === a.length - 1}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink }}>
                      {(s.partyId ? party(s.partyId)?.name : 'Walk-in') || 'Walk-in'}
                    </Text>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 2 }}>
                      {s.no} · {fmtDate(s.ts)}
                      {s.due > 0 ? ' · ' + money(s.due) + ' due' : ''}
                    </Text>
                  </View>
                  <Text style={{
                    fontFamily: fonts.uiBold, fontSize: 15,
                    color: s.due > 0 ? colors.warn : colors.ink,
                  }}>
                    {money(s.total)}
                  </Text>
                </Row>
              )) : (
                <EmptyState icon="doc" title="No sales yet" subtitle="Tap the + button to ring one up." />
              )}
            </Card>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
