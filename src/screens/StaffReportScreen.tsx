/**
 * Who sold what.
 *
 * Every sale carries the person who recorded it, so this reads back as a
 * scoreboard: takings, bills, average bill and the share of the shop's total,
 * over a period you choose. The bar under each name is the share, because a
 * ranked list without proportion flatters whoever happens to be top.
 */
import React, { useMemo, useState } from 'react';
import { useCan, Denied } from '../components/Gate';
import { View, Text, ScrollView } from 'react-native';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import {
  Panel, Badge, StatGrid, SectionLabel, FilterChips, EmptyBlock, Avatar, DetailRow, ProgressBar,
} from '../components/ui';
import { finRange, FIN_PERIODS, inRange } from '../data/helpers';

export default function StaffReportScreen(p: any) {
  // checked before the body runs, so nothing inside it can post first
  const allowed = useCan('profiles.view');
  if (!allowed) return <Denied title="Staff reports are closed to you" hint="This report shows what each member of staff posted, so it is kept to people who manage profiles." />;
  return <StaffReportScreenBody  />;
}

function StaffReportScreenBody() {
  const { colors } = useTheme();
  const { db, money, user } = useAppData();
  const [period, setPeriod] = useState('month');

  const d = useMemo(() => {
    if (!db) return null;
    const R = finRange(period);
    const sales = db.sales.filter((s) => s.status !== 'void' && inRange(s.ts, R.from, R.to));

    const by = new Map<string, { total: number; count: number; items: number; due: number; discount: number; collected: number; adjusts: number; adjustQty: number }>();
    const blank = () => ({ total: 0, count: 0, items: 0, due: 0, discount: 0, collected: 0, adjusts: 0, adjustQty: 0 });
    sales.forEach((s) => {
      const k = s.userId || 'unknown';
      const e = by.get(k) || blank();
      e.total += s.total;
      e.count += 1;
      e.items += s.lines.reduce((n, l) => n + l.qty, 0);
      e.due += Math.max(0, s.due);
      e.discount += s.discount;
      by.set(k, e);
    });
    // money collected and stock corrected are part of the same picture
    db.payments.forEach((p) => {
      if (p.direction !== 'in' || !inRange(p.ts, R.from, R.to)) return;
      const k = p.userId || 'unknown';
      const e = by.get(k) || blank();
      e.collected += p.amount;
      by.set(k, e);
    });

    // stock corrections now carry a name, so they can sit beside the selling figures
    (db.movements || []).forEach((m) => {
      if (m.type !== 'adjust' || !inRange(m.ts, R.from, R.to)) return;
      const k = m.userId || 'unknown';
      const e = by.get(k) || blank();
      e.adjusts += 1;
      e.adjustQty += Math.abs(m.qty);
      by.set(k, e);
    });

    const grand = sales.reduce((n, s) => n + s.total, 0);
    const rows = [...by.entries()]
      .map(([id, e]) => ({
        id,
        name: user(id)?.name || 'Unknown',
        role: user(id)?.role || '',
        ...e,
        avg: e.count ? e.total / e.count : 0,
        share: grand ? (e.total / grand) * 100 : 0,
      }))
      .sort((a, b) => b.total - a.total);

    return { R, rows, grand, bills: sales.length, staff: rows.length };
  }, [db, period, user]);

  if (!db || !d) return null;

  const top = d.rows[0];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
      <FilterChips value={period} onChange={setPeriod} options={FIN_PERIODS.map(([v, l]) => ({ v, l }))} />

      <View style={{ height: 16 }} />
      <StatGrid
        items={[
          { icon: 'coins', label: 'Takings · ' + d.R.label, value: money(d.grand), tone: 'good' },
          { icon: 'receipt', label: 'Sales', value: String(d.bills), tone: 'accent' },
          { icon: 'user', label: 'Staff selling', value: String(d.staff), tone: 'warn' },
          { icon: 'chart', label: 'Average sale', value: money(d.bills ? d.grand / d.bills : 0), tone: 'accent' },
        ]}
      />

      <View style={{ height: 20 }} />
      <SectionLabel right={<Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>by takings</Text>}>
        Scoreboard
      </SectionLabel>

      {!d.rows.length ? (
        <Panel>
          <EmptyBlock icon="user" title="Nothing sold in this period" hint="Sales are credited to whoever records them." />
        </Panel>
      ) : null}

      {d.rows.map((r, i) => (
        <Panel key={r.id} style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
            <View>
              <Avatar name={r.name} id={r.id} size={48} />
              {i === 0 && r.total > 0 ? (
                <View style={{
                  position: 'absolute', right: -4, bottom: -4,
                  backgroundColor: colors.good, borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2,
                }}>
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: colors.accentInk }}>1st</Text>
                </View>
              ) : null}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{r.name}</Text>
              <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                {r.role ? r.role.charAt(0).toUpperCase() + r.role.slice(1) : 'Staff'} · {r.count} sale{r.count === 1 ? '' : 's'}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 3 }}>
              <Text style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink }}>{money(r.total)}</Text>
              <Badge label={Math.round(r.share) + '% of takings'} tone={i === 0 ? 'good' : 'neutral'} />
            </View>
          </View>

          <View style={{ marginTop: 14, marginBottom: 12 }}>
            <ProgressBar pct={r.share} tone={i === 0 ? colors.good : colors.accent} />
          </View>

          <DetailRow label="Average bill" value={money(r.avg)} />
          <DetailRow label="Units sold" value={String(Math.round(r.items))} />
          <DetailRow label="Discount given" value={money(r.discount)} tone={r.discount ? colors.warn : undefined} />
          <DetailRow label="Cash collected" value={money(r.collected)} tone={r.collected ? colors.good : undefined} />
          <DetailRow
            label="Stock corrections"
            value={r.adjusts ? r.adjusts + ' · ' + Math.round(r.adjustQty) + ' units' : 'none'}
            tone={r.adjusts ? colors.warn : undefined}
          />
          <DetailRow
            label="Left unpaid"
            value={money(r.due)}
            tone={r.due ? colors.danger : colors.good}
            last
          />
        </Panel>
      ))}

      {top && d.rows.length > 1 ? (
        <Panel>
          <SectionLabel>Read this carefully</SectionLabel>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 19, color: colors.soft }}>
            {top.name} took {Math.round(top.share)}% of the money in this period. A high share can mean a strong
            seller, or simply the person who works the busiest shift — check bills and hours before drawing a
            conclusion about anyone.
          </Text>
        </Panel>
      ) : null}
    </ScrollView>
  );
}
