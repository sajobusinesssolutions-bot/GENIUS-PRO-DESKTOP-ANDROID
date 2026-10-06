/**
 * The branch panel — owner only.
 *
 * Branches: a summary of where sales come from, one compact row per branch,
 * and the other businesses on the account. A row opens BranchDetail, which
 * replaces the old Manage sheet.
 *
 * Branch analysis: Finance (sales, cost of goods, expenses, purchases, net
 * profit) and Stock (cover, stock-out days, dead stock). Every figure is
 * derived per warehouse from the same records the rest of the app uses.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useToast } from '../components/Toast';
import {
  Panel, Badge, EmptyBlock, Button, Field, StickyBar, DetailRow, TopTabs,
} from '../components/ui';
import { Icon, IconName, CAT_COLOR } from '../components/icons';
import Sheet from '../components/Sheet';
import { useGo } from '../nav/navigate';
import { finRange, inRange } from '../data/helpers';
import { DateRangeButton, DateRange, last30 } from '../components/DateRangeButton';
import type { DB, Warehouse } from '../data/types';
import { useAuthSafe } from '../data/AuthContext';
import { refreshSession, requestPinCode, verifyCode } from '../data/authApi';
import { filterVisibleBusinesses, listBusinesses, downloadSnapshot, RemoteBusiness } from '../data/syncClient';

/* ================= shared ================= */

function useOwnerOnly() {
  const { can } = useAppData();
  return can('branches.view');
}

function Denied() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: 16, justifyContent: 'center' }}>
      <Panel>
        <EmptyBlock icon="lock" title="Owner only" hint="The branch panel changes where stock and money live, so it is kept to the owner account." />
      </Panel>
    </View>
  );
}

/** Icons are black in light mode; in dark mode black would vanish, so they take the ink colour. */
function useIconInk() {
  const { colors } = useTheme();
  return colors.surface === '#FFFFFF' ? '#000000' : colors.ink;
}

const DAY = 86400000;
const OUT_WINDOW = 30;
const DEAD_AFTER = 60;
const SELLING_WINDOW = 90;

const branchColor = (i: number, off?: boolean) => (off ? '#9AA3AE' : CAT_COLOR[i % CAT_COLOR.length]);

/** 18,450,000 → 18.5M — for narrow cells where the full figure will not fit. */
function short(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return Math.round(n / 1e3) + 'K';
  return String(Math.round(n));
}
const signed = (p: number | null) => (p == null ? '—' : (p > 0 ? '+' : p < 0 ? '−' : '') + Math.abs(Math.round(p)) + '%');

type Range = { from: number; to: number };

export type BranchFigures = {
  revenue: number; cogs: number; gross: number; exp: number; purch: number; net: number;
  /** Net profit per 100 of sales. */
  kept: number;
  due: number; bills: number;
  /** Sales change against the previous range of the same length; null when there is none. */
  growth: number | null;
  stockQty: number; stockCost: number; stockRetail: number; low: number;
  /** Stock at cost at the start and at the end of the range, walked back from today through the movements. */
  openStock: number; closeStock: number;
  /** Stock at cost that has not sold in DEAD_AFTER days. */
  dead: number;
  /** Days the stock on hand would last at the last 30 days' rate of cost of goods. */
  cover: number | null;
  /** Of the last OUT_WINDOW days, which had at least one selling line at zero. */
  outDays: boolean[];
  outCount: number;
  /** Sales likely missed on those days, from each line's average daily takings. */
  lost: number;
};

/**
 * One branch's figures. `mine(wh)` says whether a warehouse id belongs to the
 * branch: one id for a local branch, every id for another business's book.
 */
export function figuresFor(book: DB, mine: (wh?: string) => boolean, R: Range, withPrev: boolean): BranchFigures {
  const fallback = book.settings?.defaultWarehouse;
  const own = (wh?: string) => mine(wh || fallback);
  const now = Date.now();

  const allSales = (book.sales || []).filter((s) => s.status !== 'void' && own(s.warehouse));
  const sales = allSales.filter((s) => inRange(s.ts, R.from, R.to));
  const revenue = sales.reduce((n, s) => n + s.total, 0);
  const cogs = sales.reduce((n, s) => n + (s.cogs || 0), 0);
  const due = sales.reduce((n, s) => n + Math.max(0, s.due), 0);

  const exp = (book.entries || [])
    .filter((e) => e.direction === 'out' && own(e.branch) && inRange(e.ts, R.from, R.to))
    .reduce((n, e) => n + e.amount, 0);
  const purch = (book.purchases || [])
    .filter((p) => p.status !== 'void' && own(p.branch) && inRange(p.ts, R.from, R.to))
    .reduce((n, p) => n + p.total, 0);

  let growth: number | null = null;
  if (withPrev) {
    const len = R.to - R.from;
    const prev = allSales.filter((s) => inRange(s.ts, R.from - len - 1, R.from - 1)).reduce((n, s) => n + s.total, 0);
    growth = prev > 0 ? (revenue / prev - 1) * 100 : null;
  }

  // what each product sold here, for dead stock and missed-sales estimates
  const lastSold = new Map<string, number>();
  const takings90 = new Map<string, number>();
  allSales.forEach((s) => {
    const t = new Date(s.ts).getTime();
    s.lines.forEach((l) => {
      if (t > (lastSold.get(l.productId) || 0)) lastSold.set(l.productId, t);
      if (now - t <= SELLING_WINDOW * DAY) takings90.set(l.productId, (takings90.get(l.productId) || 0) + l.qty * l.price);
    });
  });

  const cogs30 = allSales.filter((s) => now - new Date(s.ts).getTime() <= 30 * DAY).reduce((n, s) => n + (s.cogs || 0), 0);

  const today0 = new Date(); today0.setHours(0, 0, 0, 0);
  const windowStart = today0.getTime() - (OUT_WINDOW - 1) * DAY;
  const dayEnd = (i: number) => windowStart + (i + 1) * DAY - 1;
  const outDays = Array.from({ length: OUT_WINDOW }, () => false);
  let lost = 0;

  const movesByProduct = new Map<string, { ts: number; qty: number }[]>();
  (book.movements || []).forEach((m) => {
    if (!own(m.wh)) return;
    const t = new Date(m.ts).getTime();
    if (t < windowStart) return;
    const list = movesByProduct.get(m.productId) || [];
    list.push({ ts: t, qty: m.qty });
    movesByProduct.set(m.productId, list);
  });

  // every movement here after the range began / after it ended, to walk today's stock back
  const afterFrom = new Map<string, number>();
  const afterTo = new Map<string, number>();
  (book.movements || []).forEach((m) => {
    if (!own(m.wh)) return;
    const t = new Date(m.ts).getTime();
    if (t >= R.from) afterFrom.set(m.productId, (afterFrom.get(m.productId) || 0) + m.qty);
    if (t > R.to) afterTo.set(m.productId, (afterTo.get(m.productId) || 0) + m.qty);
  });

  let stockQty = 0, stockCost = 0, stockRetail = 0, low = 0, dead = 0, openStock = 0, closeStock = 0;
  (book.products || []).forEach((p) => {
    if ((p as any).kind === 'service') return;
    const q = Object.entries(p.stock || {}).reduce((n, [wh, v]) => (own(wh) ? n + (Number(v) || 0) : n), 0);
    stockQty += q;
    stockCost += q * p.cost;
    stockRetail += q * p.price;
    openStock += Math.max(0, q - (afterFrom.get(p.id) || 0)) * p.cost;
    closeStock += Math.max(0, q - (afterTo.get(p.id) || 0)) * p.cost;
    if (p.active && q <= p.reorder) low += 1;
    const sold = lastSold.get(p.id) || 0;
    if (q > 0 && now - sold > DEAD_AFTER * DAY) dead += q * p.cost;

    // walk back from today's stock to each day's closing stock
    const daily = (takings90.get(p.id) || 0) / SELLING_WINDOW;
    if (!p.active || daily <= 0) return;
    const moves = (movesByProduct.get(p.id) || []).sort((a, b) => b.ts - a.ts);
    let qty = q, k = 0;
    for (let i = OUT_WINDOW - 1; i >= 0; i--) {
      while (k < moves.length && moves[k].ts > dayEnd(i)) { qty -= moves[k].qty; k++; }
      if (qty <= 0) { outDays[i] = true; lost += daily; }
    }
  });

  return {
    revenue, cogs, gross: revenue - cogs, exp, purch, net: revenue - cogs - exp,
    kept: revenue ? ((revenue - cogs - exp) / revenue) * 100 : 0,
    due, bills: sales.length, growth,
    stockQty, stockCost, stockRetail, low, dead, openStock, closeStock,
    cover: cogs30 > 0 ? stockCost / (cogs30 / 30) : null,
    outDays, outCount: outDays.filter(Boolean).length, lost,
  };
}

/** The other businesses on this account, and their downloaded books. */
function useAccountBooks(load: boolean) {
  const { db } = useAppData();
  const account = useAuthSafe()?.account;
  const [businesses, setBusinesses] = useState<RemoteBusiness[]>([]);
  const [books, setBooks] = useState<Record<string, DB>>({});

  useEffect(() => {
    const refresh = account?.refresh;
    if (!refresh) return;
    void (async () => {
      const token = await refreshSession(refresh);
      if (!token.ok) return;
      const result = await listBusinesses(token.value.access, true);
      if (result.ok) setBusinesses(result.value);
    })();
  }, [account?.refresh]);

  const others = useMemo(
    () => filterVisibleBusinesses(businesses, db?.sync.businessId, db?.firm.id).filter((b) => b.id !== db?.sync.businessId),
    [businesses, db?.sync.businessId, db?.firm.id],
  );

  useEffect(() => {
    if (!load || !account?.refresh) return;
    const missing = others.filter((b) => !books[b.id]);
    if (!missing.length) return;
    void (async () => {
      const token = await refreshSession(account.refresh!);
      if (!token.ok) return;
      const loaded = await Promise.all(missing.map(async (b) => {
        const snap = await downloadSnapshot(token.value.access, b.id);
        return snap.ok ? [b.id, snap.value.data] as const : null;
      }));
      setBooks((prev) => {
        const next = { ...prev };
        loaded.forEach((x) => { if (x) next[x[0]] = x[1]; });
        return next;
      });
    })();
  }, [load, account?.refresh, others, books]);

  return { others, books };
}

function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: 3, backgroundColor: color }} />;
}

function Caps({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, letterSpacing: 0.7, color: colors.faint, textTransform: 'uppercase', marginTop: 22, marginBottom: 10 }}>
      {children}
    </Text>
  );
}

/* ================= the branch list ================= */

export function BranchesScreen() {
  const { colors } = useTheme();
  const ink = useIconInk();
  const { db, money } = useAppData();
  const go = useGo();
  const owner = useOwnerOnly();
  const { others } = useAccountBooks(false);

  const branches = db?.warehouses || [];
  const R = useMemo(() => finRange('month'), []);

  const figures = useMemo(() => {
    const m = new Map<string, BranchFigures>();
    if (!db) return m;
    branches.forEach((w) => m.set(w.id, figuresFor(db, (wh) => wh === w.id, R, false)));
    return m;
  }, [db, branches, R]);

  if (!db) return null;
  if (!owner) return <Denied />;

  const totalSales = [...figures.values()].reduce((n, f) => n + f.revenue, 0);
  const totalStock = [...figures.values()].reduce((n, f) => n + f.stockCost, 0);
  const live = branches.filter((w) => w.active !== false).length;
  const shares = branches
    .map((w, i) => ({ w, i, v: figures.get(w.id)?.revenue || 0 }))
    .filter((x) => x.v > 0 && x.w.active !== false);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        <Panel flush>
          <View style={{ padding: 16, paddingBottom: 14, gap: 4 }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>Sales across branches · 30 days</Text>
            <Text style={{ fontFamily: fonts.uiExtra, fontSize: 30, letterSpacing: -0.8, color: colors.ink }}>{money(totalSales)}</Text>
            {shares.length ? (
              <>
                <View style={{ flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2, marginTop: 10, backgroundColor: colors.sunk }}>
                  {shares.map((s) => <View key={s.w.id} style={{ flex: s.v, backgroundColor: branchColor(s.i) }} />)}
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 6, marginTop: 8 }}>
                  {shares.map((s) => (
                    <View key={s.w.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Dot color={branchColor(s.i)} size={8} />
                      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint }}>
                        {s.w.name} {Math.round((s.v / totalSales) * 100)}%
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', borderTopWidth: 1, borderColor: colors.line }}>
            {[
              { l: 'Branches', v: String(branches.length), c: colors.ink },
              { l: 'Trading', v: String(live), c: colors.good },
              { l: 'Stock at cost', v: short(totalStock), c: colors.ink },
            ].map((x, i) => (
              <View key={x.l} style={{ flex: 1, paddingVertical: 12, paddingHorizontal: 16, borderLeftWidth: i ? 1 : 0, borderColor: colors.line }}>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{x.l}</Text>
                <Text style={{ fontFamily: fonts.uiExtra, fontSize: 17, color: x.c, marginTop: 3 }}>{x.v}</Text>
              </View>
            ))}
          </View>
          <Pressable
            onPress={() => go('BranchAnalysis')}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, paddingHorizontal: 16, borderTopWidth: 1, borderColor: colors.line, backgroundColor: colors.accentSoft }}
          >
            <Icon name="chart" size={17} color={ink} />
            <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 15, color: colors.accent }}>Branch analysis</Text>
            <Icon name="chev" size={17} color={ink} />
          </Pressable>
        </Panel>

        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          <View style={{ flex: 1 }}><Caps>In this book</Caps></View>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>sales · 30 days</Text>
        </View>
        <Panel flush>
          {branches.map((w, i) => {
            const f = figures.get(w.id);
            const off = w.active === false;
            const here = db.session.warehouse === w.id;
            return (
              <Pressable
                key={w.id}
                onPress={() => go('BranchDetail', { id: w.id })}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingLeft: 16, paddingRight: 14,
                  borderBottomWidth: i === branches.length - 1 ? 0 : 1, borderColor: colors.line, opacity: off ? 0.6 : 1,
                }}
              >
                <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: off ? colors.sunk : here ? colors.goodSoft : colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="home" size={20} color={ink} weight="duotone" />
                  <View style={{ position: 'absolute', right: -2, bottom: -2, width: 11, height: 11, borderRadius: 4, backgroundColor: branchColor(i, off), borderWidth: 2, borderColor: colors.surface }} />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 }}>
                    <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{w.name}</Text>
                    {here ? <Badge label="Active" tone="good" /> : null}
                    {off ? <Badge label="Disabled" tone="neutral" /> : null}
                  </View>
                  {f && f.low > 0 && !off ? (
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: colors.warn }}>{f.low} running low</Text>
                  ) : null}
                </View>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink }}>{off || !f ? '—' : short(f.revenue)}</Text>
                <Icon name="chev" size={16} color={ink} />
              </Pressable>
            );
          })}
        </Panel>

        {others.length ? (
          <>
            <Caps>Other branches on your account</Caps>
            <Panel flush>
              {others.map((b, i) => {
                const off = b.active === false;
                return (
                  <View key={b.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingLeft: 16, paddingRight: 14, borderBottomWidth: i === others.length - 1 ? 0 : 1, borderColor: colors.line, opacity: off ? 0.6 : 1 }}>
                    <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: off ? colors.sunk : colors.warnSoft, alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="factory" size={20} color={ink} weight="duotone" />
                      <View style={{ position: 'absolute', right: -2, bottom: -2, width: 11, height: 11, borderRadius: 4, backgroundColor: branchColor(branches.length + i, off), borderWidth: 2, borderColor: colors.surface }} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 }}>
                      <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{b.name}</Text>
                      {off ? <Badge label="Disabled" tone="neutral" /> : <Badge label={b.role ? b.role.charAt(0).toUpperCase() + b.role.slice(1) : 'Account'} tone="accent" />}
                    </View>
                    <Pressable
                      onPress={() => go('Businesses')}
                      style={{ height: 36, paddingHorizontal: 13, borderRadius: 10, borderWidth: 1.4, borderColor: colors.lineHard, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                    >
                      <Icon name="swap" size={14} color={ink} />
                      <Text style={{ fontFamily: fonts.uiBold, fontSize: 13.5, color: colors.ink }}>Open</Text>
                    </Pressable>
                  </View>
                );
              })}
            </Panel>
          </>
        ) : null}
      </ScrollView>

      <StickyBar>
        <Button label="Open a new branch" variant="pri" icon={<Icon name="plus" size={17} color={colors.accentInk} />} onPress={() => go('NewBranch')} />
      </StickyBar>
    </View>
  );
}

/* ================= one branch (replaces the Manage sheet) ================= */

export function BranchDetailScreen() {
  const { colors } = useTheme();
  const ink = useIconInk();
  const { db, money, updateWarehouse, removeWarehouse } = useAppData();
  const { success, error } = useToast();
  const go = useGo();
  const nav = useNavigation<any>();
  const owner = useOwnerOnly();
  const id = (useRoute().params as { id?: string } | undefined)?.id;

  const account = useAuthSafe()?.account;
  const [range, setRange] = useState<DateRange>(last30);
  // deleting a branch is for good, so the owner proves it with a code sent to their email
  const [del, setDel] = useState<null | 'ask' | 'code'>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const index = db ? db.warehouses.findIndex((w) => w.id === id) : -1;
  const w: Warehouse | undefined = db && index >= 0 ? db.warehouses[index] : undefined;
  const R = range;
  const f = useMemo(() => (db && w ? figuresFor(db, (wh) => wh === w.id, R, true) : null), [db, w, R]);
  const allSales = useMemo(
    () => (db ? db.warehouses.reduce((n, x) => n + figuresFor(db, (wh) => wh === x.id, R, false).revenue, 0) : 0),
    [db, R],
  );

  useEffect(() => { if (w) nav.setOptions({ title: w.name }); }, [nav, w?.name]);

  if (!db) return null;
  if (!owner) return <Denied />;
  if (!w || !f) return null;

  const off = w.active === false;
  const here = db.session.warehouse === w.id;

  async function sendCode() {
    if (!account?.email) { error('Sign in to your account first — the code goes to its email.'); return; }
    setBusy(true);
    const r = await requestPinCode(account.email);
    setBusy(false);
    if (!r.ok) { error(r.error.message); return; }
    setCode('');
    setDel('code');
  }

  async function deleteWithCode() {
    if (!account?.email) return;
    setBusy(true);
    const ok = await verifyCode(account.email, code.trim(), 'pin');
    setBusy(false);
    if (!ok.ok) { error(ok.error.message); return; }
    const r = removeWarehouse(w!.id);
    if (!r.ok) { setDel(null); error(r.why); return; }
    setDel(null);
    success(w!.name + ' deleted');
    nav.goBack();
  }

  function toggleTrading() {
    Alert.alert(off ? 'Enable ' + w!.name + '?' : 'Disable ' + w!.name + '?', off
      ? 'It can sell and hold stock again.'
      : 'It stops selling and is left out of the figures. Its records are kept, and it can be enabled again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: off ? 'Enable' : 'Disable', style: off ? 'default' : 'destructive', onPress: () => { updateWarehouse(w!.id, { active: off }); success(off ? 'Branch enabled' : 'Branch disabled'); } },
    ]);
  }

  const stats = [
    { l: 'Sales', v: money(f.revenue), c: colors.ink, b: colors.goodSoft },
    { l: 'Net profit', v: money(f.net), c: f.net >= 0 ? colors.good : colors.danger, b: colors.goodSoft },
    { l: 'Expenses', v: money(f.exp), c: colors.ink, b: colors.warnSoft },
    { l: 'Left unpaid', v: money(f.due), c: f.due ? colors.danger : colors.ink, b: colors.dangerSoft },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
        <Panel>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
            <View style={{ width: 46, height: 46, borderRadius: 15, backgroundColor: off ? colors.sunk : here ? colors.goodSoft : colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="home" size={21} color={ink} weight="duotone" />
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7 }}>
                <Badge label={off ? 'Disabled' : 'Active'} tone={off ? 'neutral' : 'good'} />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Dot color={branchColor(index, off)} size={8} />
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint }}>
                    {allSales && f.revenue ? Math.round((f.revenue / allSales) * 100) + '% of sales' : 'No sales'}
                  </Text>
                </View>
              </View>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
                {w.address || 'No address'}{w.phone ? ' · ' + w.phone : ''}
              </Text>
            </View>
          </View>
        </Panel>

        <View style={{ marginTop: 16 }}><DateRangeButton value={range} onChange={setRange} /></View>
        <Caps>{range.label}</Caps>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {stats.map((s) => (
            <View key={s.l} style={{ flexBasis: '47%', flexGrow: 1 }}>
              <Panel style={{ borderWidth: 1, borderColor: s.b, padding: 14 }}>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{s.l}</Text>
                <Text style={{ fontFamily: fonts.uiExtra, fontSize: 19, color: s.c, marginTop: 8 }} adjustsFontSizeToFit numberOfLines={1}>{s.v}</Text>
              </Panel>
            </View>
          ))}
        </View>

        <Caps>Stock held</Caps>
        <Panel style={{ paddingVertical: 4 }}>
          <DetailRow label="Opening stock" value={money(f.openStock)} />
          <DetailRow label="Closing stock" value={money(f.closeStock)} />
          <DetailRow label="On hand now, at cost" value={money(f.stockCost)} />
          <DetailRow label="Days of stock" value={f.cover == null ? '—' : String(Math.round(f.cover))} />
          <DetailRow label="Out-of-stock days" value={String(f.outCount)} tone={f.outCount >= 5 ? colors.danger : undefined} />
          <DetailRow label="Unsold 60+ days" value={money(f.dead)} />
          <DetailRow label="Lines running low" value={String(f.low)} tone={f.low ? colors.warn : undefined} last />
        </Panel>

        <Caps>Manage</Caps>
        <Button
          label={off ? 'Enable this branch' : 'Disable this branch'}
          icon={<Icon name="lock" size={16} color={colors.ink} />}
          onPress={toggleTrading}
        />
        <View style={{ height: 10 }} />
        <Button label="Delete this branch" variant="dngr" icon={<Icon name="trash" size={16} color={colors.danger} />} onPress={() => setDel('ask')} />
      </ScrollView>

      <Sheet
        visible={!!del}
        title={'Delete ' + w.name}
        icon="trash"
        onClose={() => setDel(null)}
        footer={del === 'ask'
          ? <Button label={busy ? 'Sending…' : 'Email me a code'} variant="dngr" onPress={() => void sendCode()} />
          : <Button label={busy ? 'Checking…' : 'Delete for good'} variant="dngr" onPress={() => void deleteWithCode()} />}
      >
        {del === 'ask' ? (
          <Text style={{ fontFamily: fonts.ui, fontSize: 14, lineHeight: 20, color: colors.soft }}>
            This cannot be undone. A branch can only be deleted while it holds no stock and has never traded.
            {'\n\n'}To be sure it is you, a six-digit code goes to {account?.email || 'your account email'}.
          </Text>
        ) : (
          <>
            <Text style={{ fontFamily: fonts.ui, fontSize: 14, lineHeight: 20, color: colors.soft, marginBottom: 6 }}>
              Enter the code sent to {account?.email}.
            </Text>
            <Field label="Six-digit code" value={code} onChangeText={(v: string) => setCode(v.replace(/[^0-9]/g, '').slice(0, 6))} numeric />
            <Button label="Send a new code" onPress={() => void sendCode()} />
          </>
        )}
      </Sheet>
    </View>
  );
}

/* ================= branch analysis ================= */

type Lens = 'finance' | 'stock';
type MetricType = 'money' | 'pct' | 'signed' | 'days' | 'num';
type MetricKey = keyof Omit<BranchFigures, 'outDays'>;
type Metric = { k: MetricKey; l: string; t: MetricType; lowerIsBetter?: boolean };

const METRICS: Record<Lens, Metric[]> = {
  finance: [
    { k: 'net', l: 'Net profit', t: 'money' },
    { k: 'revenue', l: 'Sales', t: 'money' },
    { k: 'cogs', l: 'Cost of goods', t: 'money' },
    { k: 'exp', l: 'Expenses', t: 'money', lowerIsBetter: true },
    { k: 'purch', l: 'Purchases', t: 'money' },
    { k: 'kept', l: 'Kept per 100', t: 'pct' },
    { k: 'growth', l: 'Sales growth', t: 'signed' },
  ],
  stock: [
    { k: 'openStock', l: 'Opening stock', t: 'money' },
    { k: 'closeStock', l: 'Closing stock', t: 'money' },
    { k: 'stockCost', l: 'On hand now', t: 'money' },
    { k: 'cover', l: 'Days of stock', t: 'days', lowerIsBetter: true },
    { k: 'outCount', l: 'Out-of-stock days', t: 'num', lowerIsBetter: true },
    { k: 'lost', l: 'Sales missed', t: 'money', lowerIsBetter: true },
    { k: 'dead', l: 'Unsold 60+ days', t: 'money', lowerIsBetter: true },
    { k: 'low', l: 'Lines running low', t: 'num', lowerIsBetter: true },
  ],
};

const OVERSTOCK_DAYS = 110;
const UNDERSTOCK_DAYS = 30;

function show(v: number | null, t: MetricType): string {
  if (v == null) return '—';
  if (t === 'pct') return Math.round(v) + '%';
  if (t === 'signed') return signed(v);
  if (t === 'days') return Math.round(v) + 'd';
  if (t === 'money') return short(v);
  return String(Math.round(v));
}

type Row = { id: string; name: string; color: string; off: boolean; account: boolean; f: BranchFigures };
type Insight = { icon: IconName; tone: 'good' | 'warn' | 'danger'; text: string; value: string };

function insightsFor(lens: Lens, live: Row[], periodLabel: string): Insight[] {
  if (!live.length) return [];
  const top = (fn: (r: Row) => number) => [...live].sort((a, b) => fn(b) - fn(a))[0];
  const ratio = (r: Row) => (r.f.cogs ? r.f.purch / r.f.cogs : 1);
  const out: Insight[] = [];
  if (lens === 'finance') {
    const withSales = live.filter((r) => r.f.revenue > 0);
    if (!withSales.length) return [];
    const best = [...withSales].sort((a, b) => b.f.kept - a.f.kept)[0];
    out.push({ icon: 'up', tone: 'good', text: `${best.name} keeps ${Math.round(best.f.kept)} of every 100 sold`, value: short(best.f.net) });
    const spender = [...withSales].sort((a, b) => b.f.exp / b.f.revenue - a.f.exp / a.f.revenue)[0];
    if (spender.f.exp > 0) out.push({ icon: 'receipt', tone: 'danger', text: `${spender.name} spends ${Math.round((spender.f.exp / spender.f.revenue) * 100)} of every 100 on expenses`, value: short(spender.f.exp) });
    const buyer = [...withSales].sort((a, b) => Math.abs(ratio(b) - 1) - Math.abs(ratio(a) - 1))[0];
    if (Math.abs(ratio(buyer) - 1) > 0.15) {
      const heavy = buyer.f.cover != null && buyer.f.cover > OVERSTOCK_DAYS;
      out.push({ icon: 'cart', tone: 'warn', text: `${buyer.name} bought ${ratio(buyer).toFixed(1)}× what it sold${heavy ? ` while holding ${Math.round(buyer.f.cover!)} days of stock` : ''}`, value: short(buyer.f.purch) });
    }
    const fell = withSales.filter((r) => r.f.growth != null && r.f.growth < 0).sort((a, b) => a.f.growth! - b.f.growth!)[0];
    if (fell) out.push({ icon: 'down', tone: 'danger', text: `${fell.name} sales fell vs the previous ${periodLabel.toLowerCase().replace('last ', '')}`, value: signed(fell.f.growth) });
  } else {
    const so = top((r) => r.f.outCount);
    if (so.f.outCount > 0) out.push({ icon: 'alert', tone: 'danger', text: `${so.name} had lines out of stock on ${so.f.outCount} of the last ${OUT_WINDOW} days`, value: '~' + short(so.f.lost) });
    const hc = top((r) => r.f.cover ?? 0);
    if (hc.f.cover != null && hc.f.cover > OVERSTOCK_DAYS) {
      out.push({ icon: 'box', tone: 'warn', text: `${hc.name} holds ${Math.round(hc.f.cover)} days of stock`, value: short(hc.f.stockCost) });
      if (so.f.outCount > 0 && so.id !== hc.id) out.push({ icon: 'swap', tone: 'good', text: `Move stock from ${hc.name} to ${so.name} before reordering`, value: '' });
    }
    const dd = top((r) => r.f.dead);
    if (dd.f.dead > 0) out.push({ icon: 'clock', tone: 'warn', text: `${dd.name} has stock unsold for ${DEAD_AFTER}+ days`, value: short(dd.f.dead) });
  }
  return out;
}

export function BranchAnalysisScreen() {
  const { colors } = useTheme();
  const ink = useIconInk();
  const { db, money } = useAppData();
  const owner = useOwnerOnly();
  const [lens, setLens] = useState<Lens>('finance');
  const [range, setRange] = useState<DateRange>(last30);
  const [metric, setMetric] = useState<MetricKey | null>(null);
  const { others, books } = useAccountBooks(true);

  const d = useMemo(() => {
    if (!db) return null;
    const R = range;
    const withPrev = true;
    const rows: Row[] = db.warehouses.map((w, i) => ({
      id: w.id, name: w.name, color: branchColor(i, w.active === false), off: w.active === false, account: false,
      f: figuresFor(db, (wh) => wh === w.id, R, withPrev),
    }));
    others.forEach((b, i) => {
      const book = books[b.id];
      if (!book) return;
      rows.push({
        id: b.id, name: b.name, color: branchColor(db.warehouses.length + i, b.active === false), off: b.active === false, account: true,
        f: figuresFor(book, () => true, R, withPrev),
      });
    });
    const live = rows.filter((r) => !r.off);
    const sum = (k: MetricKey) => rows.reduce((n, r) => n + (Number(r.f[k]) || 0), 0);
    const t = {
      revenue: sum('revenue'), cogs: sum('cogs'), exp: sum('exp'), purch: sum('purch'), net: sum('net'),
      stockCost: sum('stockCost'), lost: sum('lost'), dead: sum('dead'), low: sum('low'),
      openStock: sum('openStock'), closeStock: sum('closeStock'),
    };
    const cogs30 = live.reduce((n, r) => n + (r.f.cover ? r.f.stockCost / r.f.cover : 0), 0);
    const total: Partial<Record<MetricKey, number | null>> = {
      ...t,
      kept: t.revenue ? (t.net / t.revenue) * 100 : 0,
      growth: null,
      cover: cogs30 ? t.stockCost / cogs30 : null,
      outCount: Math.max(0, ...live.map((r) => r.f.outCount)),
    };
    return { R, rows, live, total, pending: others.length - Object.keys(books).length };
  }, [db, range, others, books]);

  if (!db) return null;
  if (!owner) return <Denied />;
  if (!d) return null;

  const metrics = METRICS[lens];
  const active = metrics.find((m) => m.k === metric)?.k ?? metrics[0].k;
  const insights = insightsFor(lens, d.live, d.R.label);
  const toneColor = { good: [colors.goodSoft, colors.good], warn: [colors.warnSoft, colors.warn], danger: [colors.dangerSoft, colors.danger] } as const;

  const hero = lens === 'finance'
    ? {
      label: 'Net profit, all branches · ' + d.R.label,
      value: money(d.total.net ?? 0),
      stats: [
        { l: 'Sales', v: short(d.total.revenue ?? 0), c: colors.ink },
        { l: 'Expenses', v: short(d.total.exp ?? 0), c: colors.warn },
        { l: 'Purchases', v: short(d.total.purch ?? 0), c: colors.ink },
      ],
    }
    : {
      label: 'Closing stock at cost, all branches · ' + d.R.label,
      value: money(d.total.closeStock ?? 0),
      stats: [
        { l: 'Opening stock', v: short(d.total.openStock ?? 0), c: colors.ink },
        { l: 'Days of stock', v: d.total.cover == null ? '—' : String(Math.round(d.total.cover)), c: colors.ink },
        { l: 'Unsold 60+ d', v: short(d.total.dead ?? 0), c: colors.warn },
      ],
    };

  const withSales = d.live.filter((r) => r.f.revenue > 0);
  const ratio = (r: Row) => (r.f.cogs ? r.f.purch / r.f.cogs : 1);
  const maxCover = Math.max(1, ...d.live.map((r) => r.f.cover ?? 0));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TopTabs
        value={lens}
        onChange={(v) => { setLens(v); setMetric(null); }}
        options={[{ v: 'finance', l: 'Finance', i: 'coins' }, { v: 'stock', l: 'Stock', i: 'box' }]}
      />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
        <View style={{ marginBottom: 12 }}>
          <DateRangeButton value={range} onChange={setRange} />
        </View>

        <Panel>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{hero.label}</Text>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 30, letterSpacing: -0.8, color: colors.ink, marginTop: 4 }}>{hero.value}</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderColor: colors.line }}>
            {hero.stats.map((s) => (
              <View key={s.l} style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{s.l}</Text>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: s.c, marginTop: 2 }}>{s.v}</Text>
              </View>
            ))}
          </View>
          {d.pending > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
              <Icon name="cloud" size={14} color={ink} />
              <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>Loading {d.pending} more</Text>
            </View>
          ) : null}
        </Panel>

        {insights.length ? (
          <>
            <Caps>What stands out</Caps>
            <Panel flush>
              {insights.map((x, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: i === insights.length - 1 ? 0 : 1, borderColor: colors.line }}>
                  <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: toneColor[x.tone][0], alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={x.icon} size={18} color={ink} />
                  </View>
                  <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 14, lineHeight: 19, color: colors.ink }}>{x.text}</Text>
                  {x.value ? <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: toneColor[x.tone][1] }}>{x.value}</Text> : null}
                </View>
              ))}
            </Panel>
          </>
        ) : null}

        {lens === 'finance' && withSales.length ? (
          <>
            <Caps>Of every 100 sold</Caps>
            <Panel style={{ paddingTop: 12, paddingBottom: 4 }}>
              <View style={{ flexDirection: 'row', gap: 14, paddingBottom: 10, borderBottomWidth: 1, borderColor: colors.line }}>
                {[['Cost of goods', '#C9CFD8'], ['Expenses', '#E9A55A'], ['Kept', colors.good]].map(([l, c]) => (
                  <View key={l} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Dot color={c} />
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: colors.ink }}>{l}</Text>
                  </View>
                ))}
              </View>
              {[...withSales].sort((a, b) => b.f.kept - a.f.kept).map((r, i, arr) => {
                const cg = Math.round((r.f.cogs / r.f.revenue) * 100);
                const ex = Math.round((r.f.exp / r.f.revenue) * 100);
                const kept = Math.max(0, 100 - cg - ex);
                return (
                  <View key={r.id} style={{ paddingVertical: 12, gap: 8, borderBottomWidth: i === arr.length - 1 ? 0 : 1, borderColor: colors.line }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Dot color={r.color} />
                      <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 14.5, color: colors.ink }}>{r.name}</Text>
                      <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: r.f.kept >= 15 ? colors.good : r.f.kept >= 8 ? colors.ink : colors.danger }}>{Math.round(r.f.kept)} kept</Text>
                    </View>
                    <View style={{ flexDirection: 'row', height: 14, borderRadius: 4, overflow: 'hidden', gap: 2 }}>
                      <View style={{ flex: cg, backgroundColor: '#C9CFD8', justifyContent: 'center', paddingLeft: 6 }}>
                        <Text style={{ fontFamily: fonts.uiBold, fontSize: 10.5, color: '#27313C' }}>{cg}</Text>
                      </View>
                      <View style={{ flex: ex, backgroundColor: '#E9A55A', alignItems: 'center', justifyContent: 'center' }}>
                        {ex >= 6 ? <Text style={{ fontFamily: fonts.uiBold, fontSize: 10.5, color: '#27313C' }}>{ex}</Text> : null}
                      </View>
                      <View style={{ flex: kept, backgroundColor: colors.good }} />
                    </View>
                  </View>
                );
              })}
            </Panel>

            <Caps>Buying vs selling</Caps>
            <Panel style={{ paddingVertical: 4 }}>
              {[...withSales].sort((a, b) => ratio(b) - ratio(a)).map((r, i, arr) => {
                const q = ratio(r);
                const dlt = Math.max(-1, Math.min(1, (q - 1) / 0.8)) * 50;
                const [bg, fg, tag] = q > 1.15 ? [colors.warnSoft, colors.warn, 'Stocking up'] : q < 0.9 ? [colors.accentSoft, colors.accent, 'Running down'] : [colors.goodSoft, colors.good, 'Balanced'];
                return (
                  <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: i === arr.length - 1 ? 0 : 1, borderColor: colors.line }}>
                    <Dot color={r.color} />
                    <View style={{ flex: 1, minWidth: 0, gap: 7 }}>
                      <Text style={{ fontFamily: fonts.uiBold, fontSize: 14.5, color: colors.ink }}>{r.name}</Text>
                      <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.sunk }}>
                        <View style={{ position: 'absolute', left: '50%', top: -3, bottom: -3, width: 2, backgroundColor: colors.lineHard }} />
                        <View style={{ position: 'absolute', top: 0, bottom: 0, left: `${dlt >= 0 ? 50 : 50 + dlt}%`, width: `${Math.max(2, Math.abs(dlt))}%`, borderRadius: 3, backgroundColor: fg }} />
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 4, minWidth: 86 }}>
                      <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: colors.ink }}>{q.toFixed(1)}×</Text>
                      <View style={{ backgroundColor: bg, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8 }}>
                        <Text style={{ fontFamily: fonts.uiBold, fontSize: 11.5, color: fg }}>{tag}</Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </Panel>
          </>
        ) : null}

        {lens === 'stock' && d.live.length ? (
          <>
            <Caps>Out of stock · last {OUT_WINDOW} days</Caps>
            <Panel style={{ paddingVertical: 4 }}>
              {[...d.live].sort((a, b) => b.f.outCount - a.f.outCount).map((r, i, arr) => (
                <View key={r.id} style={{ paddingVertical: 12, gap: 8, borderBottomWidth: i === arr.length - 1 ? 0 : 1, borderColor: colors.line }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Dot color={r.color} />
                    <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 14.5, color: colors.ink }}>{r.name}</Text>
                    <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: r.f.outCount >= 5 ? colors.danger : colors.ink }}>
                      {r.f.outCount} {r.f.outCount === 1 ? 'day' : 'days'}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 2 }}>
                    {r.f.outDays.map((out, k) => (
                      <View key={k} style={{ flex: 1, height: 14, borderRadius: 2, backgroundColor: out ? colors.danger : colors.line }} />
                    ))}
                  </View>
                </View>
              ))}
            </Panel>

            <Caps>Days of stock</Caps>
            <Panel style={{ paddingVertical: 4 }}>
              {[...d.live].sort((a, b) => (b.f.cover ?? 0) - (a.f.cover ?? 0)).map((r, i, arr) => {
                const c = r.f.cover;
                const fg = c == null ? colors.faint : c > OVERSTOCK_DAYS ? colors.warn : c < UNDERSTOCK_DAYS ? colors.danger : colors.good;
                return (
                  <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: i === arr.length - 1 ? 0 : 1, borderColor: colors.line }}>
                    <Dot color={r.color} />
                    <Text style={{ width: 112, fontFamily: fonts.uiBold, fontSize: 14, color: colors.ink }}>{r.name}</Text>
                    <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.sunk, overflow: 'hidden' }}>
                      <View style={{ height: '100%', width: `${((c ?? 0) / maxCover) * 100}%`, borderRadius: 3, backgroundColor: fg }} />
                    </View>
                    <Text style={{ width: 46, textAlign: 'right', fontFamily: fonts.uiBold, fontSize: 14, color: fg }}>{c == null ? '—' : Math.round(c) + 'd'}</Text>
                  </View>
                );
              })}
            </Panel>
          </>
        ) : null}

        <Caps>Side by side</Caps>
        <Panel flush>
          <View style={{ flexDirection: 'row' }}>
            {/* fixed label column */}
            <View style={{ width: 118, borderRightWidth: 1, borderColor: colors.line }}>
              <View style={{ height: 52, borderBottomWidth: 1, borderColor: colors.line }} />
              {metrics.map((m, i) => {
                const on = m.k === active;
                return (
                  <Pressable key={m.k} onPress={() => setMetric(m.k)} style={{ height: 40, justifyContent: 'center', paddingLeft: 14, backgroundColor: on ? colors.accentSoft : 'transparent', borderBottomWidth: i === metrics.length - 1 ? 0 : 1, borderColor: colors.line }}>
                    <Text style={{ fontFamily: on ? fonts.uiBold : fonts.ui, fontSize: 12.5, color: on ? colors.accent : colors.faint }}>{m.l}</Text>
                  </Pressable>
                );
              })}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {[...d.rows, null].map((r) => (
                <View key={r ? r.id : 'total'} style={{ width: 96, backgroundColor: r ? 'transparent' : colors.sunk }}>
                  <View style={{ height: 52, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'flex-end', gap: 5, paddingTop: 10, paddingRight: 10, borderBottomWidth: 1, borderColor: colors.line }}>
                    <View style={{ marginTop: 4 }}><Dot color={r ? r.color : colors.ink} size={7} /></View>
                    <Text numberOfLines={2} style={{ flexShrink: 1, textAlign: 'right', fontFamily: fonts.uiBold, fontSize: 11.5, lineHeight: 15, color: colors.ink }}>{r ? r.name : 'Total'}</Text>
                  </View>
                  {metrics.map((m, i) => {
                    const on = m.k === active;
                    const vals = d.live.map((x) => Number(x.f[m.k] ?? 0));
                    const best = Math.max(...vals);
                    const v = r ? (r.f[m.k] as number | null) : (d.total[m.k] ?? null);
                    const top = !!r && !r.off && v === best && v !== 0;
                    return (
                      <Pressable key={m.k} onPress={() => setMetric(m.k)} style={{ height: 40, justifyContent: 'center', paddingRight: 10, backgroundColor: on ? colors.accentSoft : 'transparent', borderBottomWidth: i === metrics.length - 1 ? 0 : 1, borderColor: colors.line }}>
                        <Text style={{ textAlign: 'right', fontFamily: top || !r ? fonts.uiBold : fonts.ui, fontSize: 12.5, color: top ? (m.lowerIsBetter ? colors.danger : colors.good) : colors.ink }}>
                          {r && r.off ? '—' : show(v, m.t)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          </View>
        </Panel>
      </ScrollView>
    </View>
  );
}
