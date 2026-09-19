/**
 * The "Books" menu group's destinations — reference MENU_GROUPS id 'books'
 * (lines 6549-6557) and the Finance "Go to" grid.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import {
  Card, Cap, KV, Grid, Stat, ChipStrip, EmptyState,
  Panel, DetailRow, StatGrid, FilterChips, AccentHead, InfoBanner,
} from '../components/ui';
import { finRange, FIN_PERIODS, inRange, fmtDate, money0 } from '../data/helpers';

/** Accounting — ledgers, P&L and a trial balance from the journal. */
export function AccountingScreen() {
  const { colors } = useTheme();
  const { db, money } = useAppData();
  const [period, setPeriod] = useState('month');

  const d = useMemo(() => {
    if (!db) return null;
    const R = finRange(period);
    const ss = db.sales.filter((s) => s.status !== 'void' && inRange(s.ts, R.from, R.to));
    const revenue = ss.reduce((a, s) => a + (s.total - s.tax), 0);
    const cogs = ss.reduce((a, s) => a + s.cogs, 0);
    const expenses = db.entries.filter((e) => e.direction === 'out' && inRange(e.ts, R.from, R.to)).reduce((a, e) => a + e.amount, 0);
    const other = db.entries.filter((e) => e.direction === 'in' && inRange(e.ts, R.from, R.to)).reduce((a, e) => a + e.amount, 0);
    const purchases = db.purchases.filter((p) => inRange(p.ts, R.from, R.to)).reduce((a, p) => a + p.total, 0);

    // trial balance across every account touched by the journal
    const tb: Record<string, { dr: number; cr: number }> = {};
    db.journal.forEach((e) => {
      if (!inRange(e.ts, R.from, R.to)) return;
      e.lines.forEach((l) => {
        const row = tb[l.acc] || (tb[l.acc] = { dr: 0, cr: 0 });
        row.dr += l.dr || 0; row.cr += l.cr || 0;
      });
    });
    const rows = Object.keys(tb).map((k) => ({ acc: k, ...tb[k] })).sort((a, b) => (b.dr + b.cr) - (a.dr + a.cr));
    return { R, revenue, cogs, expenses, other, purchases, rows, profit: revenue - cogs - expenses + other };
  }, [db, period]);

  if (!db || !d) return null;
  const accName = (id: string) => db.accounts.find((a) => a.id === id)?.name || id;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 24 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
        <FilterChips value={period} onChange={setPeriod} options={FIN_PERIODS.map(([v, l]) => ({ v, l }))} />
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
        <StatGrid
          items={[
            { icon: 'chart', label: 'Revenue · ' + d.R.label, value: money(d.revenue), tone: 'good' },
            { icon: d.profit >= 0 ? 'up' : 'down', label: 'Net profit', value: money(d.profit), tone: d.profit >= 0 ? 'good' : 'danger' },
            { icon: 'cart', label: 'Purchases', value: money(d.purchases), tone: 'accent' },
            { icon: 'doc', label: 'Journal entries', value: String(d.rows.length), tone: 'warn' },
          ]}
        />
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
        <AccentHead title={'Profit and loss · ' + d.R.label} tone="good" />
        <Panel>
          <DetailRow label="Revenue" value={money(d.revenue)} tone={colors.good} />
          <DetailRow label="Cost of goods sold" value={'(' + money0(d.cogs) + ')'} tone={colors.danger} />
          <DetailRow label="Gross profit" value={money(d.revenue - d.cogs)} bold />
          <DetailRow label="Expenses" value={'(' + money0(d.expenses) + ')'} tone={colors.danger} />
          <DetailRow label="Other income" value={money(d.other)} tone={colors.good} />
          <DetailRow label="Net profit" value={money(d.profit)} bold tone={d.profit >= 0 ? colors.good : colors.danger} last />
        </Panel>
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
        <AccentHead title="Trial balance" tone="accent" />
        <Panel>
          {d.rows.length ? d.rows.map((r, i) => (
            <DetailRow key={r.acc} label={accName(r.acc)} value={money(r.dr - r.cr)} last={i === d.rows.length - 1} />
          )) : (
            <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint, paddingVertical: 8 }}>
              Nothing posted in this period.
            </Text>
          )}
        </Panel>
        <View style={{ height: 14 }} />
        <InfoBanner
          tone="neutral"
          text="These figures are computed from the journal for the selected period. Consult your accountant for statutory accounts."
        />
      </View>
    </ScrollView>
  );
}

/** Journal entries — every posting the app has made. */
export function JournalsScreen() {
  const { colors } = useTheme();
  const { db, money } = useAppData();
  if (!db) return null;
  const entries = [...db.journal].reverse();

  if (!entries.length) return <EmptyState icon="doc" title="No entries yet" subtitle="Every sale, purchase and payment posts here automatically." />;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, gap: 9 }}>
      {entries.map((e) => (
        <Card key={e.id} style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink, flex: 1 }} numberOfLines={1}>{e.memo}</Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>{fmtDate(e.ts)}</Text>
          </View>
          {e.lines.map((l, i) => (
            <KV
              key={i}
              label={db.accounts.find((a) => a.id === l.acc)?.name || l.acc}
              value={(l.dr ? 'Dr ' : 'Cr ') + money(l.dr || l.cr || 0)}
              last={i === e.lines.length - 1}
            />
          ))}
        </Card>
      ))}
    </ScrollView>
  );
}

/** Tax — the rate in use and what has been collected. */
export function TaxScreen() {
  const { colors } = useTheme();
  const { db, money } = useAppData();
  const [period, setPeriod] = useState('month');
  if (!db) return null;

  const R = finRange(period);
  const ss = db.sales.filter((s) => s.status !== 'void' && inRange(s.ts, R.from, R.to));
  const collected = ss.reduce((a, s) => a + s.tax, 0);
  const net = ss.reduce((a, s) => a + (s.total - s.tax), 0);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 24 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
        <ChipStrip plain options={FIN_PERIODS} value={period} onChange={setPeriod} />
      </View>
      <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
        <Grid cols={2}>
          <Stat tone="w" label="Tax collected" value={money(collected)} />
          <Stat label="Sales, net" value={money(net)} />
        </Grid>
      </View>
      <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
        <Cap style={{ marginBottom: 8 }}>Setup</Cap>
        <Card style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
          <KV label="Default rate" value={db.settings.taxRate + '%'} />
          <KV label="Bills in period" value={String(ss.length)} />
          <KV label="TIN" value={db.firm.tin || '—'} last />
        </Card>
        <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 10, lineHeight: 16 }}>
          Change the default rate under Settings. Electronic fiscalisation is not part of this build.
        </Text>
      </View>
    </ScrollView>
  );
}

/** Account detail — reference SCREENS.accountDetail, line 12707. */
export function AccountDetailScreen({ route }: any) {
  const { colors } = useTheme();
  const { db, money, accountBalance } = useAppData();
  if (!db) return null;
  const id = route?.params?.accountId;
  const acc = db.accounts.find((a) => a.id === id);
  if (!acc) return <EmptyState icon="card" title="Account not found" />;

  const rows: { ts: string; memo: string; delta: number }[] = [];
  db.journal.forEach((e) => {
    e.lines.forEach((l) => {
      if (l.acc !== acc.id) return;
      rows.push({ ts: e.ts, memo: e.memo, delta: (l.dr || 0) - (l.cr || 0) });
    });
  });
  rows.reverse();

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 24 }}>
      <View style={{ padding: 16 }}>
        <Card style={{ paddingVertical: 15, paddingHorizontal: 16 }}>
          <Cap>Balance</Cap>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 30, color: colors.ink, marginTop: 6, letterSpacing: -1 }}>{money(accountBalance(acc.id))}</Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 4 }}>
            {acc.type === 'cash' ? 'Cash' : acc.type === 'bank' ? 'Bank' : 'Mobile wallet'} · opening {money(acc.opening)}
          </Text>
        </Card>
      </View>
      <View style={{ paddingHorizontal: 16 }}>
        <Cap style={{ marginBottom: 8 }}>Movements</Cap>
        <Card>
          {rows.length ? rows.map((r, i) => (
            <View key={i} style={{
              flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, paddingHorizontal: 16,
              borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderBottomColor: colors.line,
            }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>{r.memo}</Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 1 }}>{fmtDate(r.ts)}</Text>
              </View>
              <Text style={{ fontFamily: fonts.monoSemi, fontSize: 13.5, color: r.delta >= 0 ? colors.good : colors.danger }}>
                {(r.delta >= 0 ? '+' : '−') + ' ' + money0(Math.abs(r.delta))}
              </Text>
            </View>
          )) : <EmptyState icon="card" title="Nothing yet" subtitle="Transactions on this account will show here." />}
        </Card>
      </View>
    </ScrollView>
  );
}
