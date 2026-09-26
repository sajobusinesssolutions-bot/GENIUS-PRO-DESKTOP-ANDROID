/**
 * The branch panel — owner only.
 *
 * One screen to open, rename, disable or remove a branch, and one to compare
 * them: money, stock and trading side by side with a grand total. Every figure
 * is derived per warehouse from the same records the rest of the app uses, so a
 * branch column and the shop total can never disagree.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Alert } from 'react-native';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useToast } from '../components/Toast';
import {
  Panel, Badge, StatGrid, SectionLabel, EmptyBlock, InfoBanner, Button, Field,
  StickyBar, DetailRow, TopTabs, ListRow, ProgressBar, FilterChips,
} from '../components/ui';
import { Icon, IconName } from '../components/icons';
import Sheet from '../components/Sheet';
import { useGo } from '../nav/navigate';
import { finRange, FIN_PERIODS, inRange } from '../data/helpers';
import type { DB, Warehouse } from '../data/types';
import { useAuthSafe } from '../data/AuthContext';
import { refreshSession } from '../data/authApi';
import { filterVisibleBusinesses, listBusinesses, downloadSnapshot, RemoteBusiness } from '../data/syncClient';

/** Owner-only gate, used by both screens in this module. */
function useOwnerOnly() {
  const { db } = useAppData();
  return db?.session.role === 'owner';
}

function Denied() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: 16, justifyContent: 'center' }}>
      <Panel>
        <EmptyBlock
          icon="lock"
          title="Owner only"
          hint="The branch panel changes where stock and money live, so it is kept to the owner account."
        />
      </Panel>
    </View>
  );
}

type AnalysisRange = { from: number; to: number };

function businessMetrics(book: DB, business: { id: string; name: string; active?: boolean }, range: AnalysisRange) {
  const sales = (book.sales || []).filter((s) => s.status !== 'void' && inRange(s.ts, range.from, range.to));
  const revenue = sales.reduce((n, s) => n + s.total, 0);
  const cogs = sales.reduce((n, s) => n + s.cogs, 0);
  const due = sales.reduce((n, s) => n + Math.max(0, s.due), 0);
  const units = sales.reduce((n, s) => n + s.lines.reduce((q, l) => q + l.qty, 0), 0);
  let stockQty = 0;
  let stockCost = 0;
  let stockRetail = 0;
  let lowLines = 0;
  (book.products || []).forEach((p) => {
    const q = Object.values(p.stock || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
    stockQty += q;
    stockCost += q * p.cost;
    stockRetail += q * p.price;
    if (p.active && q <= p.reorder) lowLines += 1;
  });
  const moves = (book.movements || []).filter((m) => inRange(m.ts, range.from, range.to));
  return {
    w: { id: business.id, name: business.name, active: business.active !== false } as Warehouse,
    revenue, cogs, gross: revenue - cogs,
    margin: revenue ? ((revenue - cogs) / revenue) * 100 : 0,
    due, bills: sales.length, avg: sales.length ? revenue / sales.length : 0, units,
    stockQty, stockCost, stockRetail, lowLines,
    movesIn: moves.filter((m) => m.qty > 0).reduce((n, m) => n + m.qty, 0),
    movesOut: moves.filter((m) => m.qty < 0).reduce((n, m) => n - m.qty, 0),
  };
}

/* ================= the branch list ================= */

export function BranchesScreen() {
  const { colors } = useTheme();
  const { db, money, stockOf, updateWarehouse, removeWarehouse } = useAppData();
  const account = useAuthSafe()?.account;
  const { success, error } = useToast();
  const go = useGo();
  const owner = useOwnerOnly();

  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [businesses, setBusinesses] = useState<RemoteBusiness[]>([]);

  const branches = db?.warehouses || [];
  const accountBranches = businesses.filter((business) => business.id !== db?.sync.businessId && (business as any).local_id !== db?.firm.id);

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

  /** Per-branch figures, from the same records the reports read. */
  const figures = useMemo(() => {
    if (!db) return new Map<string, { stock: number; value: number; sales: number; bills: number }>();
    const m = new Map<string, { stock: number; value: number; sales: number; bills: number }>();
    branches.forEach((w) => m.set(w.id, { stock: 0, value: 0, sales: 0, bills: 0 }));
    db.products.forEach((p) => {
      branches.forEach((w) => {
        const q = p.stock?.[w.id] || 0;
        const e = m.get(w.id)!;
        e.stock += q;
        e.value += q * p.cost;
      });
    });
    db.sales.forEach((s) => {
      if (s.status === 'void') return;
      const e = m.get(s.warehouse);
      if (!e) return;
      e.sales += s.total;
      e.bills += 1;
    });
    return m;
  }, [db, branches]);

  if (!db) return null;
  if (!owner) return <Denied />;

  function confirmDelete(w: Warehouse) {
    Alert.alert(
      'Delete ' + w.name + '?',
      'This cannot be undone. A branch can only be deleted while it holds no stock and has never traded.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            const r = removeWarehouse(w.id);
            if (!r.ok) { error(r.why); return; }
            setEditing(null);
            success(w.name + ' deleted');
          },
        },
      ],
    );
  }

  const totalStock = [...figures.values()].reduce((s, f) => s + f.value, 0);
  const totalSales = [...figures.values()].reduce((s, f) => s + f.sales, 0);
  const live = branches.filter((w) => w.active !== false).length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        <StatGrid
          items={[
            { icon: 'home', label: 'Branches', value: String(branches.length), tone: 'accent' },
            { icon: 'check', label: 'Trading', value: String(live), tone: 'good' },
            { icon: 'box', label: 'Stock at cost', value: money(totalStock), tone: 'warn' },
            { icon: 'coins', label: 'Sales all time', value: money(totalSales), tone: 'good' },
          ]}
        />

        <View style={{ height: 16 }} />
        <Panel flush>
          <ListRow
            icon="chart"
            tone="accent"
            title="Compare businesses"
            subtitle="Money, stock and trading side by side"
            onPress={() => go('BranchAnalysis')}
            last
          />
        </Panel>

        <View style={{ height: 20 }} />
        <SectionLabel right={<Badge label={branches.length + ' total'} tone="neutral" />}>Branches</SectionLabel>

        {branches.map((w) => {
          const f = figures.get(w.id) || { stock: 0, value: 0, sales: 0, bills: 0 };
          const off = w.active === false;
          const here = db.session.warehouse === w.id;
          return (
            <Panel key={w.id} style={{ marginBottom: 12, opacity: off ? 0.6 : 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
                <View style={{
                  width: 46, height: 46, borderRadius: 15,
                  backgroundColor: off ? colors.sunk : here ? colors.goodSoft : colors.accentSoft,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon name="home" size={21} color={off ? colors.faint : here ? colors.good : colors.accent} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.uiBold, fontSize: 16, color: colors.ink }}>{w.name}</Text>
                    {here ? <Badge label="Selling here" tone="good" /> : null}
                    {off ? <Badge label="Disabled" tone="neutral" /> : null}
                  </View>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                    {w.address || 'No address'}{w.phone ? ' · ' + w.phone : ''}
                  </Text>
                </View>
              </View>

              <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 13 }} />

              <DetailRow label="Stock on hand" value={Math.round(f.stock) + ' units'} />
              <DetailRow label="Stock at cost" value={money(f.value)} />
              <DetailRow label="Sales all time" value={money(f.sales)} tone={colors.good} />
              <DetailRow label="Bills raised" value={String(f.bills)} last />

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    size="sm"
                    label="Manage"
                    icon={<Icon name="cog" size={15} color={colors.ink} />}
                    onPress={() => { setEditing(w); setName(w.name); setAddress(w.address || ''); setPhone(w.phone || ''); }}
                  />
                </View>
              </View>
            </Panel>
          );
        })}

        {accountBranches.length ? (
          <>
            <SectionLabel style={{ marginTop: 8 }} right={<Badge label={accountBranches.length + ' account branches'} tone="neutral" />}>Other branches on your account</SectionLabel>
            <Panel flush>
              {accountBranches.map((b, i) => (
                <ListRow
                  key={b.id}
                  icon="factory"
                  tone={b.active === false ? 'neutral' : 'accent'}
                  title={b.name}
                  subtitle={'Account branch · ID ' + b.id.slice(0, 8).toUpperCase() + (b.active === false ? ' · Disabled' : ' · Available to compare')}
                  badge={b.active === false ? <Badge label="Disabled" tone="neutral" /> : <Badge label="Business" tone="accent" />}
                  last={i === businesses.length - 1}
                />
              ))}
            </Panel>
          </>
        ) : null}
      </ScrollView>

      <StickyBar>
        <Button
          label="Open a new branch"
          variant="pri"
          icon={<Icon name="plus" size={17} color={colors.accentInk} />}
          onPress={() => go('NewBranch')}
        />
      </StickyBar>

      {/* manage */}
      <Sheet
        visible={!!editing}
        title={editing?.name || 'Branch'}
        subtitle={editing?.active === false ? 'Disabled' : 'Trading'}
        icon="cog"
        onClose={() => setEditing(null)}
        footer={
          <Button
            label="Save changes"
            variant="pri"
            onPress={() => {
              if (!editing) return;
              if (!name.trim()) { error('A branch needs a name.'); return; }
              updateWarehouse(editing.id, { name: name.trim(), address: address.trim(), phone: phone.trim() });
              setEditing(null);
              success('Branch updated');
            }}
          />
        }
      >
        {editing ? (
          <>
            <Field icon="home" label="Branch name" value={name} onChangeText={setName} />
            <Field icon="doc" label="Address" value={address} onChangeText={setAddress} multiline />
            <Field icon="phone" label="Phone" value={phone} onChangeText={setPhone} />

            <SectionLabel>Status</SectionLabel>
            <Panel flush>
              <ListRow
                icon={editing.active === false ? 'check' : 'lock'}
                tone={editing.active === false ? 'good' : 'warn'}
                title={editing.active === false ? 'Enable this branch' : 'Disable this branch'}
                subtitle={editing.active === false
                  ? 'It can be sold from again'
                  : 'It keeps its history but cannot be sold from'}
                onPress={() => {
                  const next = editing.active === false;
                  updateWarehouse(editing.id, { active: next });
                  setEditing({ ...editing, active: next });
                  success(next ? 'Branch enabled' : 'Branch disabled');
                }}
              />
              <ListRow
                icon="swap"
                tone="accent"
                title="Move stock out"
                subtitle="Transfer what it holds to another branch"
                onPress={() => { setEditing(null); go('StockTransfer'); }}
                last
              />
            </Panel>

            <View style={{ height: 8 }} />
            <Button
              label="Delete this branch"
              variant="dngr"
              icon={<Icon name="trash" size={16} color={colors.danger} />}
              onPress={() => confirmDelete(editing)}
            />
            <View style={{ height: 10 }} />
            <InfoBanner
              tone="warn"
              text="A branch that holds stock or has ever traded cannot be deleted — disable it instead, so its history stays intact."
            />
          </>
        ) : null}
      </Sheet>
    </View>
  );
}

/* ================= branch analysis ================= */

type Lens = 'finance' | 'stock' | 'trade';

export function BranchAnalysisScreen() {
  const { colors } = useTheme();
  const { db, money } = useAppData();
  const account = useAuthSafe()?.account;
  const owner = useOwnerOnly();
  const [lens, setLens] = useState<Lens>('finance');
  const [period, setPeriod] = useState('month');
  const [accountBusinesses, setAccountBusinesses] = useState<RemoteBusiness[]>([]);
  const [remoteBooks, setRemoteBooks] = useState<Record<string, DB>>({});

  useEffect(() => {
    const refresh = account?.refresh;
    if (!refresh) return;
    void (async () => {
      const token = await refreshSession(refresh);
      if (!token.ok) return;
      const result = await listBusinesses(token.value.access);
      if (result.ok) setAccountBusinesses(result.value);
    })();
  }, [account?.refresh]);

  useEffect(() => {
    if (!account?.refresh || !accountBusinesses.length) return;
    const currentId = db?.sync.businessId;
    const otherBusinesses = filterVisibleBusinesses(accountBusinesses, currentId, db?.firm.id)
      .filter((business) => business.id !== currentId && !remoteBooks[business.id]);
    if (!otherBusinesses.length) return;
    void (async () => {
      const token = await refreshSession(account.refresh!);
      if (!token.ok) return;
      const loaded = await Promise.all(otherBusinesses.map(async (business) => {
        const snapshot = await downloadSnapshot(token.value.access, business.id);
        return snapshot.ok ? [business.id, snapshot.value.data] as const : null;
      }));
      setRemoteBooks((previous) => {
        const next = { ...previous };
        loaded.forEach((item) => { if (item) next[item[0]] = item[1]; });
        return next;
      });
    })();
  }, [account?.refresh, accountBusinesses, db?.sync.businessId, db?.firm.id, remoteBooks]);

  const d = useMemo(() => {
    if (!db) return null;
    const R = finRange(period);
    const branches = db.warehouses;

    const rows = branches.map((w) => {
      const sales = db.sales.filter((s) => s.status !== 'void' && s.warehouse === w.id && inRange(s.ts, R.from, R.to));
      const revenue = sales.reduce((n, s) => n + s.total, 0);
      const cogs = sales.reduce((n, s) => n + s.cogs, 0);
      const due = sales.reduce((n, s) => n + Math.max(0, s.due), 0);
      const units = sales.reduce((n, s) => n + s.lines.reduce((q, l) => q + l.qty, 0), 0);

      let stockQty = 0;
      let stockCost = 0;
      let stockRetail = 0;
      let lowLines = 0;
      db.products.forEach((p) => {
        const q = p.stock?.[w.id] || 0;
        stockQty += q;
        stockCost += q * p.cost;
        stockRetail += q * p.price;
        if (p.active && q <= p.reorder) lowLines += 1;
      });

      const moves = db.movements.filter((m) => m.wh === w.id && inRange(m.ts, R.from, R.to));

      return {
        w,
        revenue,
        cogs,
        gross: revenue - cogs,
        margin: revenue ? ((revenue - cogs) / revenue) * 100 : 0,
        due,
        bills: sales.length,
        avg: sales.length ? revenue / sales.length : 0,
        units,
        stockQty,
        stockCost,
        stockRetail,
        lowLines,
        movesIn: moves.filter((m) => m.qty > 0).reduce((n, m) => n + m.qty, 0),
        movesOut: moves.filter((m) => m.qty < 0).reduce((n, m) => n - m.qty, 0),
      };
    });

    const localBusinessId = db.sync.businessId;
    const remoteRows = filterVisibleBusinesses(accountBusinesses, localBusinessId, db.firm.id)
      .filter((business) => business.id !== localBusinessId)
      .map((business) => remoteBooks[business.id] ? businessMetrics(remoteBooks[business.id], business, R) : null)
      .filter((row): row is NonNullable<typeof row> => !!row);
    const allRows = [...rows, ...remoteRows];
    const sum = (k: keyof typeof allRows[number]) => allRows.reduce((n, r) => n + (Number(r[k]) || 0), 0);
    return {
      R,
      rows: allRows,
      total: {
        revenue: sum('revenue'), cogs: sum('cogs'), gross: sum('gross'), due: sum('due'),
        bills: sum('bills'), units: sum('units'),
        stockQty: sum('stockQty'), stockCost: sum('stockCost'), stockRetail: sum('stockRetail'),
        lowLines: sum('lowLines'), movesIn: sum('movesIn'), movesOut: sum('movesOut'),
      },
    };
  }, [db, period, accountBusinesses, remoteBooks]);

  if (!db) return null;
  if (!owner) return <Denied />;
  if (!d) return null;

  const compareValue = (r: typeof d.rows[number]) => lens === 'stock' ? r.stockCost : lens === 'trade' ? r.bills : r.revenue;
  const best = [...d.rows].sort((a, b) => compareValue(b) - compareValue(a))[0];

  /** The figures shown per branch, by lens. */
  const lines = (r: typeof d.rows[number]): Array<{ l: string; v: string; tone?: string; bold?: boolean }> => {
    if (lens === 'stock') {
      return [
        { l: 'Units on hand', v: String(Math.round(r.stockQty)) },
        { l: 'At cost', v: money(r.stockCost) },
        { l: 'At retail', v: money(r.stockRetail) },
        { l: 'Potential margin', v: money(r.stockRetail - r.stockCost), tone: colors.good },
        { l: 'Lines running low', v: String(r.lowLines), tone: r.lowLines ? colors.warn : undefined, bold: true },
      ];
    }
    if (lens === 'trade') {
      return [
        { l: 'Bills raised', v: String(r.bills) },
        { l: 'Units sold', v: String(Math.round(r.units)) },
        { l: 'Average bill', v: money(r.avg) },
        { l: 'Stock in', v: String(Math.round(r.movesIn)), tone: colors.good },
        { l: 'Stock out', v: String(Math.round(r.movesOut)), tone: colors.danger, bold: true },
      ];
    }
    return [
      { l: 'Revenue', v: money(r.revenue), tone: colors.good },
      { l: 'Cost of sales', v: money(r.cogs), tone: colors.danger },
      { l: 'Gross profit', v: money(r.gross), bold: true },
      { l: 'Margin', v: Math.round(r.margin) + '%' },
      { l: 'Left unpaid', v: money(r.due), tone: r.due ? colors.danger : undefined },
    ];
  };

  const headline = (r: typeof d.rows[number]) =>
    lens === 'stock' ? money(r.stockCost) : lens === 'trade' ? String(r.bills) : money(r.revenue);

  const grandHeadline = lens === 'stock' ? money(d.total.stockCost)
    : lens === 'trade' ? String(d.total.bills) : money(d.total.revenue);

  const shareOf = (r: typeof d.rows[number]) => {
    const base = lens === 'stock' ? d.total.stockCost : lens === 'trade' ? d.total.bills : d.total.revenue;
    const mine = lens === 'stock' ? r.stockCost : lens === 'trade' ? r.bills : r.revenue;
    return base ? (mine / base) * 100 : 0;
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <TopTabs
        value={lens}
        onChange={setLens}
        options={[
          { v: 'finance', l: 'Finance', i: 'coins' },
          { v: 'stock', l: 'Stock', i: 'box' },
          { v: 'trade', l: 'Transactions', i: 'receipt' },
        ]}
      />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
        <FilterChips value={period} onChange={setPeriod} options={FIN_PERIODS.map(([v, l]) => ({ v, l }))} />

        <View style={{ height: 16 }} />
        {accountBusinesses.length > 1 ? (
          <InfoBanner
            tone="accent"
            icon="cloud"
            text={(accountBusinesses.length - 1) + ' other account branch' + (accountBusinesses.length - 1 === 1 ? '' : 'es') + ' are included when saved snapshots finish loading.'}
          />
        ) : null}
        {accountBusinesses.length > 1 ? <View style={{ height: 12 }} /> : null}
        <Panel>
          <View style={{ alignItems: 'center', gap: 4 }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
              {lens === 'stock' ? 'Stock at cost, all branches'
                : lens === 'trade' ? 'Bills raised, all branches'
                  : 'Revenue, all branches · ' + d.R.label}
            </Text>
            <Text style={{ fontFamily: fonts.uiExtra, fontSize: 32, letterSpacing: -0.8, color: colors.ink }}>
              {grandHeadline}
            </Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 2 }}>
              across {d.rows.length} business{d.rows.length === 1 ? '' : 'es'}
            </Text>
          </View>
        </Panel>

        <View style={{ height: 16 }} />
        <StatGrid
          items={lens === 'stock'
            ? [
              { icon: 'box', label: 'Units held', value: String(Math.round(d.total.stockQty)), tone: 'accent' },
              { icon: 'coins', label: 'At retail', value: money(d.total.stockRetail), tone: 'good' },
              { icon: 'chart', label: 'Potential margin', value: money(d.total.stockRetail - d.total.stockCost), tone: 'good' },
              { icon: 'alert', label: 'Lines low', value: String(d.total.lowLines), tone: d.total.lowLines ? 'warn' : 'good' },
            ]
            : lens === 'trade'
              ? [
                { icon: 'receipt', label: 'Bills', value: String(d.total.bills), tone: 'accent' },
                { icon: 'cart', label: 'Units sold', value: String(Math.round(d.total.units)), tone: 'good' },
                { icon: 'down', label: 'Stock in', value: String(Math.round(d.total.movesIn)), tone: 'good' },
                { icon: 'up', label: 'Stock out', value: String(Math.round(d.total.movesOut)), tone: 'danger' },
              ]
              : [
                { icon: 'coins', label: 'Revenue', value: money(d.total.revenue), tone: 'good' },
                { icon: 'money', label: 'Cost of sales', value: money(d.total.cogs), tone: 'danger' },
                { icon: 'chart', label: 'Gross profit', value: money(d.total.gross), tone: 'good' },
                { icon: 'alert', label: 'Left unpaid', value: money(d.total.due), tone: d.total.due ? 'danger' : 'good' },
              ]}
        />

        <View style={{ height: 20 }} />
        <SectionLabel right={<Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>share of total · ranked</Text>}>
          Branch comparison
        </SectionLabel>

        {d.rows.map((r) => {
          const share = shareOf(r);
          const top = best && r.w.id === best.w.id && r.revenue > 0;
          const accountBranch = accountBusinesses.some((business) => business.id === r.w.id);
          return (
            <Panel key={r.w.id} style={{ marginBottom: 12, opacity: r.w.active === false ? 0.6 : 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{
                  width: 44, height: 44, borderRadius: 14,
                  backgroundColor: top ? colors.goodSoft : colors.accentSoft,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon name="home" size={20} color={top ? colors.good : colors.accent} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.uiBold, fontSize: 15.5, color: colors.ink }}>{r.w.name}</Text>
                    {accountBranch ? <Badge label="Account branch" tone="accent" /> : null}
                    {r.w.active === false ? <Badge label="Disabled" tone="neutral" /> : null}
                  </View>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                    {Math.round(share)}% of the total
                  </Text>
                </View>
                <Text style={{ fontFamily: fonts.uiExtra, fontSize: 17, color: colors.ink }}>{headline(r)}</Text>
              </View>

              <View style={{ marginTop: 13, marginBottom: 13 }}>
                <ProgressBar pct={share} tone={top ? colors.good : colors.accent} />
              </View>

              {lines(r).map((x, i, arr) => (
                <DetailRow key={x.l} label={x.l} value={x.v} tone={x.tone} bold={x.bold} last={i === arr.length - 1} />
              ))}
            </Panel>
          );
        })}

        {/* the grand total, as its own emphasised card */}
        <Panel style={{ borderWidth: 1.5, borderColor: colors.accent }}>
          <SectionLabel>All branches</SectionLabel>
          {lens === 'finance' ? (
            <>
              <DetailRow label="Revenue" value={money(d.total.revenue)} tone={colors.good} />
              <DetailRow label="Cost of sales" value={money(d.total.cogs)} tone={colors.danger} />
              <DetailRow label="Gross profit" value={money(d.total.gross)} bold />
              <DetailRow
                label="Margin"
                value={(d.total.revenue ? Math.round((d.total.gross / d.total.revenue) * 100) : 0) + '%'}
              />
              <DetailRow label="Left unpaid" value={money(d.total.due)} tone={d.total.due ? colors.danger : colors.good} last />
            </>
          ) : lens === 'stock' ? (
            <>
              <DetailRow label="Units on hand" value={String(Math.round(d.total.stockQty))} />
              <DetailRow label="At cost" value={money(d.total.stockCost)} />
              <DetailRow label="At retail" value={money(d.total.stockRetail)} />
              <DetailRow label="Potential margin" value={money(d.total.stockRetail - d.total.stockCost)} bold tone={colors.good} />
              <DetailRow label="Lines running low" value={String(d.total.lowLines)} tone={d.total.lowLines ? colors.warn : undefined} last />
            </>
          ) : (
            <>
              <DetailRow label="Bills raised" value={String(d.total.bills)} />
              <DetailRow label="Units sold" value={String(Math.round(d.total.units))} />
              <DetailRow label="Stock in" value={String(Math.round(d.total.movesIn))} tone={colors.good} />
              <DetailRow label="Stock out" value={String(Math.round(d.total.movesOut))} tone={colors.danger} bold last />
            </>
          )}
        </Panel>

        {d.rows.length > 1 && best && best.revenue > 0 ? (
          <View style={{ marginTop: 14 }}>
            <InfoBanner
              tone="neutral"
              icon="bulb"
              text={best.w.name + ' took ' + Math.round(shareOf(best)) + '% of revenue this period. Before reading that as performance, check whether the businesses carry comparable stock and opening hours.'}
            />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
