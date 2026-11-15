/**
 * Who sold what.
 *
 * Every sale carries the person who recorded it, so this reads back as a
 * scoreboard: takings, bills, average bill and the share of the shop's total,
 * over a period you choose. Each person is one row (name, sales and share,
 * takings) that opens to the rest of their figures; the shop's totals stay on
 * the bar at the foot.
 */
import React, { useMemo, useState } from 'react';
import { useCan, Denied } from '../components/Gate';
import { View, Text, FlatList } from 'react-native';
import { fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useBookFrom } from '../data/useBookFrom';
import { inRange } from '../data/helpers';
import { roleName } from '../data/perms';
import { listPeriod, ListPeriod } from '../components/DocList';
import { ControlRow, SearchBox, PeriodPill, MetaLine, FactRow, TotalBar, NothingHere, amt, useReportPalette } from '../components/ReportList';
import { shortRange } from '../data/reportShape';

export default function StaffReportScreen(p: any) {
  // checked before the body runs, so nothing inside it can post first
  const allowed = useCan('profiles.view');
  if (!allowed) return <Denied title="Staff reports are closed to you" hint="This report shows what each member of staff posted, so it is kept to people who manage profiles." />;
  return <StaffReportScreenBody  />;
}

function StaffReportScreenBody() {
  const pal = useReportPalette();
  const { db, user } = useAppData();
  const [period, setPeriod] = useState<ListPeriod>(() => listPeriod('month'));
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  /* figures for the chosen period, read from disk when it starts before what is in memory */
  const { book: rangeBook } = useBookFrom(db, period.from);

  const d = useMemo(() => {
    const db = rangeBook;
    if (!db) return null;
    const R = period;
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

    return { rows, grand, bills: sales.length, staff: rows.length };
  }, [rangeBook, period, user]);

  if (!db || !d) return null;

  const needle = q.trim().toLowerCase();
  const rows = needle ? d.rows.filter((r) => r.name.toLowerCase().includes(needle)) : d.rows;
  const top = d.rows[0];

  return (
    <View style={{ flex: 1, backgroundColor: pal.bg }}>
      <ControlRow>
        <SearchBox value={q} onChange={setQ} placeholder="Search staff" />
        <PeriodPill value={period} onChange={setPeriod} />
      </ControlRow>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        extraData={open}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={<MetaLine left={rows.length + ' staff' + (needle ? ' of ' + d.rows.length : '') + ' · by takings'} right={shortRange(period.from, period.to)} />}
        ListEmptyComponent={needle
          ? <NothingHere text={'No results for “' + q + '”'} clear="Clear search" onClear={() => setQ('')} />
          : <NothingHere text="Nothing sold in this period. Sales are credited to whoever records them." />}
        ListFooterComponent={top && d.rows.length > 1 ? (
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 18, color: pal.faint, paddingHorizontal: 16, paddingVertical: 14 }}>
            {top.name} took {Math.round(top.share)}% of the money in this period. A high share can mean a strong seller, or simply the person who works the busiest shift. Check bills and hours before drawing a conclusion about anyone.
          </Text>
        ) : <View style={{ height: 16 }} />}
        renderItem={({ item: r }) => (
          <FactRow
            title={r.name}
            sub={roleName(db, r.role || undefined) + ' · ' + r.count + ' sale' + (r.count === 1 ? '' : 's') + ' · ' + Math.round(r.share) + '% of takings'}
            value={amt(r.total)} valueLabel="Takings"
            zero={!r.total && !r.collected && !r.adjusts}
            open={open === r.id} onToggle={() => setOpen((o) => (o === r.id ? null : r.id))}
            lines={[
              { label: 'Sales', value: String(r.count) },
              { label: 'Average bill', value: amt(r.avg) },
              { label: 'Units sold', value: r.items ? String(Math.round(r.items)) : '—' },
              { label: 'Discount given', value: amt(r.discount) },
              { label: 'Cash collected', value: amt(r.collected) },
              { label: 'Stock corrections', value: r.adjusts ? r.adjusts + ' · ' + Math.round(r.adjustQty) + ' units' : '—' },
              { label: 'Left unpaid', value: amt(r.due) },
              { label: 'Share of takings', value: Math.round(r.share * 10) / 10 + '%' },
              { label: 'Takings', value: amt(r.total), bold: true },
            ]}
          />
        )}
      />
      <TotalBar label="Total takings" value={amt(d.grand)} others={[
        { label: 'Sales', value: String(d.bills) },
        { label: 'Average sale', value: amt(d.bills ? d.grand / d.bills : 0) },
      ]} />
    </View>
  );
}
