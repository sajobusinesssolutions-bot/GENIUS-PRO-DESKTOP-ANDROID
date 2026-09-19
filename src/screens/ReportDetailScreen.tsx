/**
 * One renderer for every report.
 *
 * Reference SCREENS.report (2231) for the date chips, tableCard() (2245) for
 * the table and its `foot` totals row, and statsRow() (2258) for the stat band.
 * Everything beyond the prototype — sorting, a custom range, export and
 * tap-through — is driven generically off the `ReportResult`.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert, useWindowDimensions } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useGo } from '../nav/navigate';
import { canFor } from '../data/perms';
import { startOfDay, endOfDay, daysAgo, fmtDay } from '../data/helpers';
import {
  runReport, reportById, sortRows, cellText, cellTone,
  Cell, CellTone, ReportResult, RowRef, SortDir,
} from '../data/reports';
import { toPdf, preview, toExcel, shareTo, shareFile, fileNameFor } from '../data/exporters';
import { Card, Cap, Pad, EmptyState, Button, FilterChips, StatGrid, ListRow, InfoBanner } from '../components/ui';
import { Field } from '../components/form';
import { Sheet } from '../components/Sheet';
import { IconBtn } from '../components/AppBar';
import Icon from '../components/icons';
import type { RootStackParamList } from '../nav/types';

type Rt = RouteProp<RootStackParamList, 'ReportDetail'>;

/* --- date range ---------------------------------------------------- */

type RangeKey = 'today' | '7' | '30' | 'all' | 'custom';

const CHIPS: [RangeKey, string][] = [
  ['today', 'Today'], ['7', '7 days'], ['30', '30 days'], ['all', 'All time'],
];

interface Span { from: number; to: number; label: string }

function spanFor(key: RangeKey, custom: { from: number; to: number } | null): Span {
  if (key === 'custom' && custom) {
    return { from: custom.from, to: custom.to, label: fmtDay(custom.from) + ' – ' + fmtDay(custom.to) };
  }
  const to = endOfDay();
  if (key === 'today') return { from: startOfDay(), to, label: 'Today' };
  if (key === '7') return { from: startOfDay(daysAgo(6)), to, label: 'Last 7 days' };
  if (key === 'all') return { from: 0, to, label: 'All time' };
  return { from: startOfDay(daysAgo(29)), to, label: 'Last 30 days' };
}

function parseDay(s: string): number | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(d.getTime())) return null;
  return d.getTime();
}

function isoDay(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => (n < 10 ? '0' + n : String(n));
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* --- table --------------------------------------------------------- */

/** Column widths from content, so header, body and the pinned totals line up. */
function widthsFor(result: ReportResult): number[] {
  return result.cols.map((c, i) => {
    let longest = c.h.length;
    result.rows.slice(0, 120).forEach((r) => {
      const n = cellText(r[i]).length;
      if (n > longest) longest = n;
    });
    if (result.foot) longest = Math.max(longest, cellText(result.foot[i]).length);
    return Math.max(c.r ? 84 : 104, Math.min(210, longest * 7.6 + 22));
  });
}

export default function ReportDetailScreen() {
  const { colors } = useTheme();
  const nav = useNavigation<any>();
  const route = useRoute<Rt>();
  const go = useGo();
  const { db, money } = useAppData();

  const id = route.params?.id || 'sale-summary';
  const def = reportById(id);

  const [rangeKey, setRangeKey] = useState<RangeKey>('30');
  const [custom, setCustom] = useState<{ from: number; to: number } | null>(null);
  const [sort, setSort] = useState<{ i: number; dir: SortDir } | null>(null);
  const { width } = useWindowDimensions();
  const [layout, setLayout] = useState<'cards' | 'table'>(width < 520 ? 'cards' : 'table');
  const [exportOpen, setExportOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [fromText, setFromText] = useState(isoDay(startOfDay(daysAgo(29))));
  const [toText, setToText] = useState(isoDay(Date.now()));

  const role = db?.session.role;
  const allowed = canFor(role, 'reports');
  const canExport = canFor(role, 'exports.download');

  const span = useMemo(() => spanFor(rangeKey, custom), [rangeKey, custom]);

  const result = useMemo<ReportResult | null>(() => {
    if (!db || !allowed) return null;
    return runReport(db, id, span.from, span.to, money);
  }, [db, allowed, id, span.from, span.to, money]);

  const view = useMemo(() => {
    if (!result) return null;
    if (!sort) return { rows: result.rows, rowRefs: result.rowRefs };
    return sortRows(result, sort.i, sort.dir);
  }, [result, sort]);

  const meta = useMemo(
    () => ({ firm: db?.firm?.name, range: span.label }),
    [db?.firm?.name, span.label],
  );

  useEffect(() => { setSort(null); }, [id]);

  /* header export button */
  useEffect(() => {
    nav.setOptions({
      title: def ? def.name : 'Report',
      headerRight: () => (
        <IconBtn name="print" size={18} onPress={() => setExportOpen(true)} />
      ),
    });
  }, [nav, def]);

  const runExport = useCallback(async (what: 'pdf' | 'preview' | 'excel' | 'whatsapp') => {
    if (!result) return;
    if (!canExport && what !== 'preview') {
      Alert.alert('Not allowed', 'Your role cannot download or share reports.');
      return;
    }
    setBusy(what);
    try {
      if (what === 'preview') {
        await preview(result, meta);
      } else if (what === 'pdf') {
        const uri = await toPdf(result, meta);
        const ok = await shareFile(uri, 'application/pdf', result.title);
        if (!ok) Alert.alert('Saved', 'PDF written to ' + uri);
      } else if (what === 'excel') {
        const uri = await toExcel(result, meta);
        const ok = await shareFile(
          uri,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          result.title,
        );
        if (!ok) Alert.alert('Saved', fileNameFor(result, 'xlsx') + ' written to your documents.');
      } else {
        const r = await shareTo(result, 'whatsapp', meta);
        if (!r.ok) Alert.alert('Could not share', 'No app on this phone accepted the report.');
      }
      setExportOpen(false);
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [result, meta, canExport]);

  const tapHeader = (i: number) => {
    setSort((s) => {
      if (!s || s.i !== i) return { i, dir: result?.cols[i]?.r ? 'desc' : 'asc' };
      if (s.dir === 'asc') return { i, dir: 'desc' };
      if (s.dir === 'desc') return null;
      return { i, dir: 'asc' };
    });
  };

  const openRef = (ref: RowRef | null | undefined) => {
    if (!ref) return;
    if (ref.kind === 'sale') go('SaleDetail', { saleId: ref.id });
    else if (ref.kind === 'purchase') go('PurchaseDetail', { purchaseId: ref.id });
    else if (ref.kind === 'creditNote') go('CreditNotes');
    else if (ref.kind === 'payment') go('PaymentDetail', { paymentId: ref.id });
    else if (ref.kind === 'entry') go('Money');
  };

  const applyCustom = () => {
    const f = parseDay(fromText);
    const t = parseDay(toText);
    if (f == null || t == null) {
      Alert.alert('Dates', 'Use the form YYYY-MM-DD, for example 2026-01-31.');
      return;
    }
    if (f > t) { Alert.alert('Dates', 'The first date must come before the second.'); return; }
    setCustom({ from: startOfDay(f), to: endOfDay(t) });
    setRangeKey('custom');
    setRangeOpen(false);
  };

  if (!db) return null;

  if (!allowed) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <EmptyState icon="lock" title="Reports are not open to you" subtitle="Ask the owner to give your role report access." />
      </View>
    );
  }

  if (!result || !view) return null;

  const widths = widthsFor(result);
  const toneColor = (t?: CellTone) =>
    t === 'good' ? colors.good : t === 'warn' ? colors.warn : t === 'danger' ? colors.danger
      : t === 'accent' ? colors.accent : t === 'muted' ? colors.faint : colors.ink;

  const cellStyle = (i: number, bold?: boolean) => ({
    width: widths[i],
    paddingVertical: 9,
    paddingHorizontal: 9,
    textAlign: (result.cols[i].r ? 'right' : 'left') as 'right' | 'left',
    fontFamily: result.cols[i].r ? (bold ? fonts.monoSemi : fonts.mono) : (bold ? fonts.uiSemi : fonts.ui),
    fontSize: 12,
  });

  const renderCell = (c: Cell, i: number, bold?: boolean) => (
    <Text
      key={i}
      numberOfLines={2}
      style={[cellStyle(i, bold), { color: bold ? colors.ink : toneColor(cellTone(c)) }]}
    >
      {cellText(c)}
    </Text>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 18 }}>
        {/* date range — the reference's pill filter strip sits on the page, not in a bar */}
        <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 }}>
          <FilterChips
            value={rangeKey}
            onChange={(k) => {
              if (k === 'custom') { setRangeOpen(true); return; }
              setRangeKey(k); setCustom(null);
            }}
            options={[
              ...CHIPS.map(([v, l]) => ({ v, l })),
              { v: 'custom' as RangeKey, l: rangeKey === 'custom' ? span.label : 'Custom', i: 'calendar' as const },
            ]}
          />
        </View>

        {result.stats && result.stats.length ? (
          <Pad style={{ paddingTop: 12, paddingBottom: 6 }}>
            <StatGrid
              items={result.stats.map((s) => ({
                label: s.k,
                value: s.v,
                tone: s.tone === 'g' ? 'good' : s.tone === 'w' ? 'warn' : s.tone === 'd' ? 'danger' : 'accent',
                icon: s.tone === 'd' ? 'arrow' : s.tone === 'g' ? 'chart' : 'coins',
              }))}
            />
          </Pad>
        ) : null}

        {result.rows.length === 0 ? (
          <EmptyState
            icon={result.notImplemented ? 'clock' : result.error ? 'alert' : 'chart'}
            title={result.notImplemented ? 'Not built yet' : result.error ? 'Could not build this report' : 'Nothing to show'}
            subtitle={result.error || result.note || 'No data in this period. Try a wider date range.'}
          />
        ) : (
          <Pad style={{ paddingTop: 12, paddingBottom: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <Cap style={{ flex: 1 }}>{span.label} — {result.rows.length} row{result.rows.length === 1 ? '' : 's'}</Cap>
              {/* a wide table cannot be read on a phone, so cards are the default */}
              <Pressable
                onPress={() => setLayout(layout === 'cards' ? 'table' : 'cards')}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6,
                  paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
                  borderWidth: 1.4, borderColor: colors.line, backgroundColor: colors.surface,
                }}
              >
                <Icon name={layout === 'cards' ? 'chart' : 'doc'} size={15} color={colors.accent} />
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: colors.accent }}>
                  {layout === 'cards' ? 'Table' : 'Cards'}
                </Text>
              </Pressable>
            </View>

            {layout === 'cards' ? (
              <>
                {/* sort is still reachable without a header row */}
                <View style={{ marginBottom: 12 }}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {result.cols.map((c, i) => {
                      const on = sort?.i === i;
                      return (
                        <Pressable
                          key={i}
                          onPress={() => tapHeader(i)}
                          style={{
                            flexDirection: 'row', alignItems: 'center', gap: 5,
                            paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
                            borderWidth: 1.4,
                            borderColor: on ? colors.accent : colors.line,
                            backgroundColor: on ? colors.accentSoft : colors.surface,
                          }}
                        >
                          <Text style={{ fontFamily: on ? fonts.uiBold : fonts.uiSemi, fontSize: 12.5, color: on ? colors.accent : colors.soft }}>
                            {c.h}
                          </Text>
                          {on ? <Icon name={sort!.dir === 'asc' ? 'up' : 'down'} size={13} color={colors.accent} /> : null}
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>

                {view.rows.map((r, ri) => {
                  const ref = view.rowRefs ? view.rowRefs[ri] : null;
                  // the first column reads as the card's title; the rest are label/value lines
                  const head = cellText(r[0] ?? '');
                  const rest = result.cols.map((c, i) => ({ c, i })).slice(1)
                    .filter(({ i }) => cellText(r[i] ?? '') !== '');
                  const Wrap: any = ref ? Pressable : View;
                  return (
                    <Wrap
                      key={ri}
                      onPress={ref ? () => openRef(ref) : undefined}
                      style={{
                        backgroundColor: colors.surface, borderRadius: 16,
                        paddingHorizontal: 15, paddingVertical: 14, marginBottom: 10,
                        shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2,
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                        <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 15.5, color: colors.ink }} numberOfLines={2}>
                          {head}
                        </Text>
                        {ref ? <Icon name="chev" size={17} color={colors.faint} /> : null}
                      </View>

                      {rest.length ? <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 12 }} /> : null}

                      {rest.map(({ c, i }) => (
                        <View
                          key={i}
                          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14, paddingVertical: 6 }}
                        >
                          <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint, flexShrink: 1 }}>{c.h}</Text>
                          <Text
                            style={{
                              fontFamily: c.r ? fonts.monoSemi : fonts.uiSemi,
                              fontSize: 13.5,
                              color: toneColor(cellTone(r[i])),
                              textAlign: 'right',
                            }}
                          >
                            {cellText(r[i] ?? '')}
                          </Text>
                        </View>
                      ))}
                    </Wrap>
                  );
                })}

                {/* the totals line, as its own emphasised card */}
                {result.foot ? (
                  <View style={{ backgroundColor: colors.sunk, borderRadius: 16, paddingHorizontal: 15, paddingVertical: 14, borderWidth: 1.4, borderColor: colors.lineHard }}>
                    <Text style={{ fontFamily: fonts.uiBold, fontSize: 11, letterSpacing: 0.7, color: colors.faint, textTransform: 'uppercase', marginBottom: 8 }}>
                      Total
                    </Text>
                    {result.cols.map((c, i) => {
                      const t = cellText(result.foot![i] ?? '');
                      if (!t) return null;
                      return (
                        <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 14, paddingVertical: 5 }}>
                          <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint }}>{c.h}</Text>
                          <Text style={{ fontFamily: c.r ? fonts.monoSemi : fonts.uiBold, fontSize: 14, color: colors.ink }}>{t}</Text>
                        </View>
                      );
                    })}
                  </View>
                ) : null}
              </>
            ) : (
            <Card>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View>
                  {/* header */}
                  <View style={{ flexDirection: 'row', backgroundColor: colors.sunk, borderBottomWidth: 1, borderBottomColor: colors.lineHard }}>
                    {result.cols.map((c, i) => (
                      <Pressable
                        key={i}
                        onPress={() => tapHeader(i)}
                        style={{
                          width: widths[i], paddingVertical: 8, paddingHorizontal: 9,
                          flexDirection: 'row', alignItems: 'center', gap: 3,
                          justifyContent: c.r ? 'flex-end' : 'flex-start',
                        }}
                      >
                        <Text
                          numberOfLines={1}
                          style={{
                            fontFamily: fonts.uiBold, fontSize: 9.5, letterSpacing: 0.55,
                            textTransform: 'uppercase',
                            color: sort?.i === i ? colors.accent : colors.faint,
                          }}
                        >
                          {c.h}
                        </Text>
                        {sort?.i === i ? (
                          <Icon name={sort.dir === 'asc' ? 'up' : 'down'} size={11} color={colors.accent} />
                        ) : null}
                      </Pressable>
                    ))}
                  </View>

                  {/* body */}
                  {view.rows.map((r, ri) => {
                    const ref = view.rowRefs ? view.rowRefs[ri] : null;
                    const body = (
                      <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.line, alignItems: 'center' }}>
                        {result.cols.map((_, i) => renderCell(r[i] ?? '', i))}
                      </View>
                    );
                    if (!ref) return <View key={ri}>{body}</View>;
                    return (
                      <Pressable
                        key={ri}
                        onPress={() => openRef(ref)}
                        style={({ pressed }) => ({ backgroundColor: pressed ? colors.sunk : 'transparent' })}
                      >
                        {body}
                      </Pressable>
                    );
                  })}

                  {result.foot ? (
                    <View style={{
                      flexDirection: 'row', backgroundColor: colors.sunk,
                      borderTopWidth: 1, borderTopColor: colors.lineHard, alignItems: 'center',
                    }}>
                      {result.cols.map((_, i) => renderCell(result.foot![i] ?? '', i, true))}
                    </View>
                  ) : null}
                </View>
              </ScrollView>
            </Card>
            )}
            {result.note ? (
              <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, lineHeight: 17, color: colors.faint, marginTop: 10 }}>
                {result.note}
              </Text>
            ) : null}
            {view.rowRefs && view.rowRefs.some(Boolean) ? (
              <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 6 }}>
                Tap a row to open the transaction.
              </Text>
            ) : null}
          </Pad>
        )}
      </ScrollView>

      {/* custom range */}
      <Sheet visible={rangeOpen} title="Custom range" icon="calendar" onClose={() => setRangeOpen(false)}
        footer={<Button label="Apply range" variant="pri" onPress={applyCustom} />}>
        <Field label="From" icon="calendar" value={fromText} onChangeText={setFromText} placeholder="YYYY-MM-DD" />
        <Field label="To" icon="calendar" value={toText} onChangeText={setToText} placeholder="YYYY-MM-DD" />
        <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 4 }}>
          Both days are included. For example 2026-01-01 to 2026-01-31 covers the whole of January.
        </Text>
      </Sheet>

      {/* export */}
      <Sheet visible={exportOpen} title="Export report" subtitle={result.title} icon="print" onClose={() => setExportOpen(false)}>
        {([
          ['pdf', 'print', 'accent', 'PDF', 'Save or send a printed sheet'],
          ['preview', 'doc', 'accent', 'Preview', 'See it before you print'],
          ['excel', 'chart', 'good', 'Excel', 'An .xlsx you can open in a spreadsheet'],
          ['whatsapp', 'phone', 'good', 'WhatsApp', 'Send the figures as a message'],
        ] as const).map(([key, icon, tone, label, sub]) => (
          <View key={key} style={{ opacity: busy && busy !== key ? 0.5 : 1 }}>
            <ListRow
              card
              icon={icon}
              tone={tone}
              title={label}
              subtitle={sub}
              onPress={busy ? undefined : () => runExport(key)}
              right={busy === key ? <ActivityIndicator color={colors.accent} /> : undefined}
            />
          </View>
        ))}
        {!canExport ? (
          <InfoBanner tone="warn" text="Your role can preview but not download or share." />
        ) : null}
      </Sheet>
    </View>
  );
}
