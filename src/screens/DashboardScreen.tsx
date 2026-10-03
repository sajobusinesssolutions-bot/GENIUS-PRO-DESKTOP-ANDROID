/**
 * HOME
 *
 * The screen answers, in order:
 *
 *   1. How did we do?        — one figure, with the week behind it
 *   2. What do I do next?    — the four things a shop does most
 *   3. Where is the money?   — drawer, bank, owed to us, owed by us
 *   4. Did it pay?           — profit for the period after costs and expenses
 *   5. Is anything wrong?    — only when something is
 *   6. What is selling?      — the best sellers, and stock at a glance
 *   7. What just happened?   — the last few sales
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
import { View, Text, ScrollView } from 'react-native';
import { Pressable } from '../components/Press';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { canFor } from '../data/perms';
import { Card, Cap, Pill, Banner, Avatar, EmptyState } from '../components/ui';
import { AppBar, IconBtn } from '../components/AppBar';
import { Icon, IconName } from '../components/icons';
import { TrendLine } from '../components/charts';
import { useGo } from '../nav/navigate';
import { QuickSheet } from '../components/Quick';
import { useDueReminders, ReminderRow, RemindSheet } from '../components/Reminders';
import { FAB } from '../components/ui';
import { access, accessDaysLeft } from '../data/logic';
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
const REMIND_SHOWN = 4;
const RECENT_SHOWN = 3;

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
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint }}>
            {label}
          </Text>
        </View>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ fontFamily: fonts.uiBold, fontSize: 16, color: colors.ink, letterSpacing: -0.2 }}>
          {value}
        </Text>
        {note ? (
          <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.danger }}>
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
  const plan = db ? access(db) : 'paid';
  const daysLeft = db ? accessDaysLeft(db) : null;
  const [period, setPeriod] = useState<Period>('today');
  /** A day picked on the bar graph; its figures replace the period's until cleared. */
  const [dayPick, setDayPick] = useState<number | null>(null);
  const [quick, setQuick] = useState(false);
  /** The customer a payment reminder is being written for. */
  const [remind, setRemind] = useState<string | null>(null);
  /** Who has invoices open, as the reminder settings say. */
  const dueList = useDueReminders();

  const role = db?.session.role;
  const can = (k: any) => canFor(role, k);
  /** A Home figure: the role must see Home, and that figure, in Users & roles. */
  const see = (k: string) => can('dashboard.view') && can(k);

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
    const lateSales = db.sales.filter((s) => s.due > 0 && s.status !== 'void' && ageOfDays(s.ts) > 30);
    const overdue = lateSales.reduce((a, s) => a + s.due, 0);
    const cash = accountBalance('acc_cash');
    // the other places money sits, and what the shop itself owes
    const banked = (db.accounts || []).filter((a) => a.id !== 'acc_cash').reduce((t, a) => t + accountBalance(a.id), 0);
    let owing = 0;
    (db.parties || []).forEach((p) => { const b = partyBalance(p.id); if (b < 0) owing += -b; });

    // did the period pay: what was sold, less what it cost and what was spent
    const revenue = ss.reduce((a, s) => a + (s.total - (s.tax || 0)), 0);
    const cogs = ss.reduce((a, s) => a + (s.cogs || 0), 0);
    const spent = (db.entries || [])
      .filter((e) => e.direction === 'out' && e.category !== 'Transfer' && inRange(e.ts, R.from, R.to))
      .reduce((a, e) => a + e.amount, 0);
    const gross = revenue - cogs;
    const net = gross - spent;
    const bought = (db.purchases || []).filter((p) => p.status !== 'void' && inRange(p.ts, R.from, R.to))
      .reduce((a, p) => a + p.total, 0);

    // what sold best in the period, by takings
    const byItem = new Map<string, { name: string; qty: number; value: number }>();
    ss.forEach((s) => (s.lines || []).forEach((l: any) => {
      const k = l.productId || l.name;
      const x = byItem.get(k) || { name: l.name || (db.products || []).find((p) => p.id === l.productId)?.name || 'Item', qty: 0, value: 0 };
      x.qty += l.qty || 0;
      x.value += (l.qty || 0) * (l.price || 0);
      byItem.set(k, x);
    }));
    const top = [...byItem.values()].sort((a, b) => b.value - a.value).slice(0, 3);

    const stocked = (db.products || []).filter((p) => p.active && p.kind !== 'service');
    const stockValue = stocked.reduce((a, p) => a + Math.max(0, stockOf(p)) * (p.cost || 0), 0);
    const outOf = stocked.filter((p) => stockOf(p) <= 0).length;

    // the last seven days, each with what it takes to show it on its own
    const days: { v: number; idx: number; n: number; at: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const day = daysAgo(i);
      const those = live.filter((s) => inRange(s.ts, startOfDay(day), endOfDay(day)));
      days.push({ v: those.reduce((a, s) => a + s.total, 0), idx: new Date(day).getDay(), n: those.length, at: startOfDay(day) });
    }

    // Settings → "Warn when stock runs low"; services have no shelf to run low
    const low = db.settings.lowStockAlerts === false
      ? [] : db.products.filter((p) => p.active && p.kind !== 'service' && stockOf(p) <= p.reorder);
    const openPO = (db.purchaseOrders || []).filter((p) => p.status === 'open');
    const openCounts = (db.stockTakes || []).filter((s) => s.status === 'open').length;
    const openQuotes = (db.estimates || []).filter((e) => e.status === 'open');
    const due = dueRecurring();

    // ordered by what costs the shop most to leave alone
    const todo: { t: string; route: string }[] = [];
    if (lateSales.length) todo.push({ t: plural(lateSales.length, 'sale') + ' over 30 days', route: 'Sales' });
    if (due.length) todo.push({ t: plural(due.length, 'recurring sale') + ' due', route: 'Recurring' });
    if (low.length) todo.push({ t: plural(low.length, 'item') + ' to restock', route: 'ItemsTab' });
    if (openCounts) todo.push({ t: 'A stock count is still open', route: 'StockTakes' });
    if (openQuotes.length) todo.push({ t: plural(openQuotes.length, 'quotation') + ' open', route: 'Estimates' });


    const alerts = low.length + lateSales.length
      + db.claims.filter((c) => c.status === 'open').length + due.length;

    return {
      R, count: ss.length, total, prevTotal, delta,
      owed, overdue, cash, days, todo, alerts,
      banked, owing, revenue, cogs, spent, gross, net, bought, top, stockValue, outOf,
      stockedCount: stocked.length, lowCount: low.length,
      recent: live.slice(-RECENT_SHOWN).reverse(),
    };
  }, [db, period]);

  if (!db || !d) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  const online = db.session.online !== false;
  const queued = db.queue.length;
  const user = me();
  const picked = dayPick != null ? d.days[dayPick] : null;
  const shownTotal = picked ? picked.v : d.total;
  const shownCount = picked ? picked.n : d.count;
  const average = shownCount ? shownTotal / shownCount : 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AppBar
        brand
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
                  <Text style={{ color: '#fff', fontFamily: fonts.uiBold, fontSize: 12.5 }}>
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

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 96 }}>
        {/*
          Shown only when it is something to act on. A standing "all synced"
          line is a banner the eye learns to skip, which is exactly what a
          banner must not be.
        */}
        {plan === 'trialOver' || plan === 'lapsed' ? (
          <Pressable onPress={() => go('Licence')} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, margin: 16, marginBottom: 2, padding: 14, borderRadius: 16, backgroundColor: colors.dangerSoft }}>
            <Icon name="lock" size={18} color={colors.danger} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.danger }}>{plan === 'trialOver' ? 'Your free trial has ended' : 'Your plan has run out'}</Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.danger, marginTop: 2 }}>Nothing new can be added and sync is paused. Tap to choose a plan.</Text>
            </View>
            <Icon name="chev" size={17} color={colors.danger} />
          </Pressable>
        ) : plan === 'trial' && daysLeft !== null && daysLeft <= 3 ? (
          <Pressable onPress={() => go('Licence')} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, margin: 16, marginBottom: 2, padding: 14, borderRadius: 16, backgroundColor: colors.accentSoft }}>
            <Icon name="gift" size={18} color={colors.accent} />
            <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.accent }}>
              {daysLeft <= 0 ? 'Your trial ends today' : plural(daysLeft, 'day') + ' left of your free trial'}. Choose a plan to keep adding sales.
            </Text>
            <Icon name="chev" size={17} color={colors.accent} />
          </Pressable>
        ) : null}
        {!online ? (
          <Banner tone="w" icon="cloud" text={'Offline — ' + plural(queued, 'change') + ' waiting'} />
        ) : queued ? (
          <Banner tone="g" icon="cloud" text={plural(queued, 'change') + ' waiting to go up'} />
        ) : null}

        {/* 1 — how did we do */}
        {see('dashboard.view_total_sales') ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
          <Card style={{ paddingHorizontal: 16, paddingTop: 15, paddingBottom: 15, borderRadius: 18 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Cap>{picked ? 'Sales · ' + new Date(picked.at).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : 'Sales'}</Cap>
              <PeriodSwitch value={period} onChange={(p) => { setPeriod(p); setDayPick(null); }} />
            </View>

            <View>
              <Text testID="takings" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{
                fontFamily: fonts.uiExtra, fontSize: 26, color: colors.ink,
                letterSpacing: -0.6, marginTop: 8,
              }}>
                {money(shownTotal)}
              </Text>

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 7 }}>
                {d.prevTotal && !picked ? (
                  <Pill
                    tone={d.delta >= 0 ? 'g' : 'd'}
                    label={Math.abs(d.delta) + '%'}
                    icon={<Icon name={d.delta >= 0 ? 'up' : 'down'} size={12} color={d.delta >= 0 ? colors.good : colors.danger} />}
                  />
                ) : null}
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
                  {shownCount ? plural(shownCount, 'sale') + (see('dashboard.view_avg_price') ? ' · ' + money(average) + ' average' : '') : picked ? 'No sales that day' : 'No sales yet'}
                </Text>
              </View>

              <View style={{ height: 1, backgroundColor: colors.line, marginTop: 15, marginBottom: 13 }} />
              <TrendLine days={d.days} selected={dayPick} onSelect={(i) => setDayPick(i === dayPick ? null : i)} format={money} />
              {picked ? (
                <Pressable onPress={() => setDayPick(null)} style={{ alignSelf: 'center', marginTop: 10, paddingVertical: 5, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.accentSoft }}>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.accent }}>Back to {PERIODS.find((p) => p.v === period)!.l.toLowerCase()}</Text>
                </Pressable>
              ) : null}
            </View>
          </Card>
        </View>
        ) : null}

        {/* 2 — what to do next */}
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 11 }}>
          {([
            { l: 'New sale', i: 'till', r: 'NewSale', p: undefined, ok: can('sales.create') },
            { l: 'Purchase', i: 'cart', r: 'PurchaseNew', p: undefined, ok: can('purchases.create') },
            { l: 'Expense', i: 'up', r: 'EntryNew', p: { direction: 'out' }, ok: can('expenses.create') },
            { l: 'Payment', i: 'down', r: 'PaymentNew', p: { direction: 'in' }, ok: can('finance.create') },
          ] as { l: string; i: IconName; r: string; p?: Record<string, unknown>; ok: boolean }[]).filter((a) => a.ok).map((a) => (
            <Pressable
              key={a.l}
              onPress={() => go(a.r, a.p)}
              style={{ flex: 1, alignItems: 'center', gap: 6, paddingVertical: 11, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}
            >
              <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={a.i} size={18} color={colors.accent} />
              </View>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: colors.ink }}>{a.l}</Text>
            </Pressable>
          ))}
        </View>

        {/* 3 — where is the money */}
        {see('dashboard.view_total_amount') ? (<>
        <View style={{ flexDirection: 'row', gap: 11, paddingHorizontal: 16, paddingTop: 11 }}>
          <MoneyTile
            label="In the drawer" value={money(d.cash)} icon="cash" tone="good"
            onPress={() => go('Shift')}
          />
          <MoneyTile
            label="Bank & mobile" value={money(d.banked)} icon="bank" tone="good"
            onPress={() => go('Money')}
          />
        </View>
        <View style={{ flexDirection: 'row', gap: 11, paddingHorizontal: 16, paddingTop: 11 }}>
          <MoneyTile
            label="Owed to you" value={money(d.owed)} icon="clock" tone="warn"
            // the overdue share earns a line only when there is one
            note={d.overdue ? money(d.overdue) + ' late' : undefined}
            onPress={() => go('Parties')}
          />
          <MoneyTile
            label="You owe" value={money(d.owing)} icon="factory" tone="warn"
            onPress={() => go('Parties')}
          />
        </View>
        </>) : null}

        {/* 4 — did the period pay */}
        {can('reports') && see('dashboard.view_gross_profit') && can('inventory.view_profit') ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 22 }}>
            <SectionHead title={'Profit · ' + PERIODS.find((p) => p.v === period)!.l} action="Profit & loss" onAction={() => go('ReportDetail', { id: 'pnl' })} />
            <Card style={{ borderRadius: 16, paddingHorizontal: 15, paddingVertical: 13, gap: 7 }}>
              {[
                { l: 'Sales (net of tax)', v: d.revenue },
                { l: 'Cost of goods', v: -d.cogs },
                ...(see('dashboard.view_total_expenses') ? [{ l: 'Expenses', v: -d.spent }] : []),
              ].map((x) => (
                <View key={x.l} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 13.5, color: colors.soft }}>{x.l}</Text>
                  <Text style={{ fontFamily: fonts.monoSemi, fontSize: 13.5, color: x.v < 0 ? colors.soft : colors.ink }}>
                    {x.v < 0 ? '(' + money(-x.v) + ')' : money(x.v)}
                  </Text>
                </View>
              ))}
              <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 2 }} />
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{see('dashboard.view_total_expenses') ? 'Net profit' : 'Gross profit'}</Text>
                <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: fonts.uiBold, fontSize: 15, color: (see('dashboard.view_total_expenses') ? d.net : d.gross) >= 0 ? colors.good : colors.danger }}>{money(see('dashboard.view_total_expenses') ? d.net : d.gross)}</Text>
              </View>
              {d.revenue ? (
                <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>
                  {Math.round((d.gross / d.revenue) * 100)}% gross margin · {money(d.bought)} bought in
                </Text>
              ) : null}
            </Card>
          </View>
        ) : null}

        {/* 5 — notifications: what needs doing, and who to remind */}
        {d.todo.length || dueList.length ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 22 }}>
            <SectionHead
              title="Notifications"
              action={d.todo.length + dueList.length > TODO_SHOWN + REMIND_SHOWN ? 'See all' : undefined}
              onAction={() => go('Notifications')}
            />
            {d.todo.length ? (
              <Card style={{ borderRadius: 16, marginBottom: dueList.length ? 10 : 0 }}>
                {d.todo.slice(0, TODO_SHOWN).map((x, i, a) => (
                  <Row key={x.t} onPress={() => go(x.route)} last={i === a.length - 1}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.warn }} />
                    <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.ink }}>
                      {x.t}
                    </Text>
                  </Row>
                ))}
              </Card>
            ) : null}
            {dueList.length ? (
              <Card style={{ borderRadius: 16 }}>
                <Text style={{ paddingHorizontal: 15, paddingTop: 12, fontFamily: fonts.uiBold, fontSize: 11.5, letterSpacing: 0.6, color: colors.faint, textTransform: 'uppercase' }}>
                  Payment reminders
                </Text>
                {dueList.slice(0, REMIND_SHOWN).map((r, i, a) => (
                  <ReminderRow
                    key={r.partyId}
                    r={r}
                    last={i === a.length - 1}
                    onOpen={() => go('PartyDetail', { partyId: r.partyId })}
                    onRemind={() => setRemind(r.partyId)}
                  />
                ))}
              </Card>
            ) : null}
          </View>
        ) : null}

        {/* 6 — what is selling, and what is on the shelf */}
        {see('dashboard.view_sales_types') || see('dashboard.view_inventory_value') ? (
        <View style={{ flexDirection: 'row', gap: 11, paddingHorizontal: 16, paddingTop: 22 }}>
          {see('dashboard.view_sales_types') ? (
          <Pressable onPress={() => go('ReportDetail', { id: 'item-sales' })} style={{ flex: 1.35 }}>
            <Card style={{ borderRadius: 16, paddingHorizontal: 14, paddingVertical: 13, gap: 8, flex: 1 }}>
              <Cap>Best sellers</Cap>
              {d.top.length ? d.top.map((t, i) => (
                <View key={t.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ width: 16, fontFamily: fonts.uiBold, fontSize: 13, color: colors.accent }}>{i + 1}</Text>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>{t.name}</Text>
                    <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint }}>{t.qty} sold · {money(t.value)}</Text>
                  </View>
                </View>
              )) : (
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>Nothing sold in this period yet.</Text>
              )}
            </Card>
          </Pressable>
          ) : null}
          {see('dashboard.view_inventory_value') ? (
          <Pressable onPress={() => go('ItemsTab')} style={{ flex: 1 }}>
            <Card style={{ borderRadius: 16, paddingHorizontal: 14, paddingVertical: 13, gap: 6, flex: 1 }}>
              <Cap>Stock</Cap>
              <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{money(d.stockValue)}</Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>at cost · {plural(d.stockedCount, 'item')}</Text>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                {d.lowCount ? <Pill tone="w" label={d.lowCount + ' low'} /> : null}
                {d.outOf ? <Pill tone="d" label={d.outOf + ' out'} /> : null}
                {!d.lowCount && !d.outOf ? <Pill tone="g" label="All stocked" /> : null}
              </View>
            </Card>
          </Pressable>
          ) : null}
        </View>
        ) : null}

        {/* 7 — what just happened */}
        {can('sales') ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 22 }}>
            <SectionHead title="Latest sales" action="See all" onAction={() => go('Sales')} />
            <Card style={{ borderRadius: 16 }}>
              {d.recent.length ? d.recent.map((s, i, a) => (
                <Row key={s.id} onPress={() => go('SaleDetail', { saleId: s.id })} last={i === a.length - 1}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>
                      {(s.partyId ? party(s.partyId)?.name : 'Walk-in') || 'Walk-in'}
                    </Text>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>
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

      {/* everything that can be added, from the one place people look for it */}
      <FAB label="Quick add" icon="plus" tone="accent" onPress={() => setQuick(true)} />
      <QuickSheet visible={quick} onClose={() => setQuick(false)} />
      {remind ? <RemindSheet target={dueList.find((x) => x.partyId === remind) || null} onClose={() => setRemind(null)} /> : null}
    </View>
  );
}
