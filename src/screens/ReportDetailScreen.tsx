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
  runReport, reportById, sortRows, cellText, cellTone, stockMovementDrill, inventoryMetricDrill,
  INVENTORY_METRIC_REPORTS, InventoryMetricReport,
  Cell, CellTone, ReportResult, RowRef, SortDir,
} from '../data/reports';
import { toPdf, preview, toExcel, shareTo, shareFile, fileNameFor } from '../data/exporters';
import { Card, Cap, Pad, EmptyState, Button, StatGrid, ListRow, InfoBanner } from '../components/ui';
import { Field } from '../components/form';
import { Sheet } from '../components/Sheet';
import { IconBtn } from '../components/AppBar';
import Icon from '../components/icons';
import type { RootStackParamList } from '../nav/types';

type Rt = RouteProp<RootStackParamList, 'ReportDetail'>;

/* --- date range ---------------------------------------------------- */

type RangeKey = 'today' | '7' | '30' | 'all' | 'custom';

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
/**
 * Each column is sized to its own longest value, so a report with only two
 * or three narrow columns (a Z report — "Line" and "Amount") used to come out
 * far short of the phone's width. The bordered card around the table always
 * filled the screen; the table inside it did not, leaving a blank strip down
 * the right side rather than an oddly-cramped one. `minTotal`, when given, is
 * handed the leftover so the table actually fills the space the eye expects
 * a table to fill, the same as a table with enough columns already does.
 */
export function widthsFor(result: ReportResult, minTotal = 0): number[] {
  const widths = result.cols.map((c, i) => {
    let longest = c.h.length;
    result.rows.slice(0, 120).forEach((r) => {
      const n = cellText(r[i]).length;
      if (n > longest) longest = n;
    });
    if (result.foot) longest = Math.max(longest, cellText(result.foot[i]).length);
    return Math.max(c.r ? 84 : 104, Math.min(210, longest * 7.6 + 22));
  });
  const shortBy = minTotal - widths.reduce((a, b) => a + b, 0);
  if (shortBy > 0) {
    // a left-aligned column stretching is a table growing to fit its page;
    // a right-aligned one stretching just strands its digits in empty space
    const target = result.cols.findIndex((c) => !c.r);
    widths[target >= 0 ? target : widths.length - 1] += shortBy;
  }
  return widths;
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
  const [rowFilter, setRowFilter] = useState<'all' | 'sale' | 'purchase' | 'payment' | 'entry' | 'creditNote' | 'product' | 'month'>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ i: number; dir: SortDir } | null>(null);
  const [drillProductId, setDrillProductId] = useState<string | null>(null);
  const [drillMonthKey, setDrillMonthKey] = useState<string | null>(null);
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
    if (id === 'stock-movement' && drillProductId) {
      return stockMovementDrill(db, drillProductId, span.from, span.to, drillMonthKey || undefined);
    }
    if (INVENTORY_METRIC_REPORTS.includes(id as InventoryMetricReport) && drillProductId) {
      return inventoryMetricDrill(db, id as InventoryMetricReport, drillProductId, span.from, span.to, drillMonthKey || undefined);
    }
    return runReport(db, id, span.from, span.to, money);
  }, [db, allowed, id, span.from, span.to, money, drillProductId, drillMonthKey]);

  const view = useMemo(() => {
    if (!result) return null;
    if (!sort) return { rows: result.rows, rowRefs: result.rowRefs };
    return sortRows(result, sort.i, sort.dir);
  }, [result, sort]);

  const rowFilterOptions = useMemo(() => {
    const kinds = new Set<string>();
    (view?.rowRefs || []).forEach((ref) => { if (ref) kinds.add(ref.kind); });
    const options: { v: string; l: string }[] = [{ v: 'all', l: 'All rows' }];
    if (kinds.has('sale')) options.push({ v: 'sale', l: 'Sales' });
    if (kinds.has('purchase')) options.push({ v: 'purchase', l: 'Purchases' });
    if (kinds.has('payment')) options.push({ v: 'payment', l: 'Payments' });
    if (kinds.has('entry')) options.push({ v: 'entry', l: 'Entries' });
    if (kinds.has('creditNote')) options.push({ v: 'creditNote', l: 'Credit notes' });
    if (kinds.has('product')) options.push({ v: 'product', l: 'Items' });
    if (kinds.has('month')) options.push({ v: 'month', l: 'Months' });
    return options.length > 1 ? options : [{ v: 'all', l: 'All rows' }];
  }, [view]);

  const filteredView = useMemo(() => {
    if (!view) return { rows: [], rowRefs: [] as (RowRef | null)[] };
    const rows = view.rows.filter((row, idx) => {
      const ref = view.rowRefs?.[idx];
      const passesFilter = rowFilter === 'all' || ref?.kind === rowFilter;
      if (!passesFilter) return false;
      if (!search.trim()) return true;
      const needle = search.toLowerCase();
      return row.some((cell) => cellText(cell).toLowerCase().includes(needle));
    });
    const rowRefs = (view.rowRefs || []).filter((_, idx) => rowFilter === 'all' || view.rowRefs?.[idx]?.kind === rowFilter).filter((_, idx) => {
      if (!search.trim()) return true;
      const cellList = view.rows[idx] || [];
      const needle = search.toLowerCase();
      return cellList.some((cell) => cellText(cell).toLowerCase().includes(needle));
    });
    return { rows, rowRefs };
  }, [view, rowFilter, search]);

  const meta = useMemo(
    () => ({ firm: db?.firm?.name, range: span.label }),
    [db?.firm?.name, span.label],
  );

  useEffect(() => { setSort(null); }, [id]);
  useEffect(() => {
    setDrillProductId(null);
    setDrillMonthKey(null);
  }, [id]);

  const isInventoryReport = id === 'stock-movement' || INVENTORY_METRIC_REPORTS.includes(id as InventoryMetricReport);

  useEffect(() => nav.addListener('beforeRemove', (event: { preventDefault: () => void }) => {
    if (!isInventoryReport) return;
    if (drillMonthKey) {
      event.preventDefault();
      setDrillMonthKey(null);
      setSort(null);
    } else if (drillProductId) {
      event.preventDefault();
      setDrillProductId(null);
      setSort(null);
    }
  }), [nav, isInventoryReport, drillMonthKey, drillProductId]);

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
    else if (ref.kind === 'product') {
      if (!db) return;
      setDrillProductId(ref.id);
      setDrillMonthKey(null);
      setSort(null);
      setRowFilter('all');
    } else if (ref.kind === 'month') {
      if (!drillProductId) return;
      setDrillMonthKey(ref.id);
      setSort(null);
      setRowFilter('all');
    }
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

  const applyRange = (nextFrom: string, nextTo: string) => {
    const f = parseDay(nextFrom);
    const t = parseDay(nextTo);
    if (f == null || t == null) return;
    if (f > t) {
      Alert.alert('Dates', 'The first date must come before the second.');
      return;
    }
    setCustom({ from: startOfDay(f), to: endOfDay(t) });
    setRangeKey('custom');
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

  // 16px of Pad on each side, 1px of card border on each side
  const widths = widthsFor(result, width - 34);
  const drillProduct = drillProductId ? db.products.find((p) => p.id === drillProductId) : null;
  const isInventoryDrill = isInventoryReport && !!drillProduct;
  const isAccountingLedger = true;
  const toneColor = (t?: CellTone) =>
    t === 'good' ? colors.good : t === 'warn' ? colors.warn : t === 'danger' ? colors.danger
      : t === 'accent' ? colors.accent : t === 'muted' ? colors.faint : colors.ink;

  const cellStyle = (i: number, bold?: boolean) => ({
    width: widths[i],
    paddingVertical: isAccountingLedger ? 8 : 9,
    paddingHorizontal: isAccountingLedger ? 8 : 9,
    textAlign: (result.cols[i].r ? 'right' : 'left') as 'right' | 'left',
    fontFamily: result.cols[i].r ? (bold ? fonts.monoSemi : fonts.mono) : (bold ? fonts.uiSemi : fonts.ui),
    fontSize: isAccountingLedger ? 11.5 : 12,
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
        <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 }}>
          <View style={{
            backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.line,
            paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontFamily: fonts.ui, fontSize: 10.5, color: colors.faint, letterSpacing: 0.65, textTransform: 'uppercase' }}>
                  {def?.cat || 'Report'}
                </Text>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 17, color: colors.ink, marginTop: 2 }} numberOfLines={1}>
                  {def?.name || result.title}
                </Text>
              </View>
              <Button
                label="Export"
                variant="pri"
                icon={<Icon name="print" size={15} color={colors.accentInk} />}
                onPress={() => setExportOpen(true)}
              />
            </View>

            {isInventoryDrill ? (
              <View style={{
                marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
              }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 10.5, color: colors.faint, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                    {drillMonthKey ? 'Item / month' : 'Item'}
                  </Text>
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 16, color: colors.ink, marginTop: 2 }} numberOfLines={1}>
                    {drillProduct?.name}
                  </Text>
                  {drillMonthKey ? (
                    <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 3 }}>
                      {drillMonthKey} · {span.label}
                    </Text>
                  ) : (
                    <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 3 }}>
                      Period · {span.label}
                    </Text>
                  )}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                  {drillMonthKey ? (
                    <Pressable
                      onPress={() => { setDrillMonthKey(null); setSort(null); }}
                      style={{ paddingHorizontal: 8, paddingVertical: 6 }}
                    >
                      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11, color: colors.accent }}>Back to months</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ) : null}

            <View style={{ marginTop: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, textTransform: 'uppercase', letterSpacing: 0.4 }}>Range</Text>
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 12, color: colors.ink }}>{span.label}</Text>
                  <Pressable
                    onPress={() => setRangeOpen(true)}
                    style={({ pressed }) => ({
                      minHeight: 30, paddingHorizontal: 8, borderRadius: 8,
                      borderWidth: 1, borderColor: colors.line,
                      backgroundColor: pressed ? colors.sunk : colors.surface,
                      flexDirection: 'row', alignItems: 'center', gap: 5,
                    })}
                  >
                    <Icon name="calendar" size={13} color={colors.faint} />
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11, color: colors.faint }}>Custom</Text>
                  </Pressable>
                </View>
                {rowFilterOptions.length > 1 ? (
                  <Pressable
                    onPress={() => {
                      const idx = rowFilterOptions.findIndex((x) => x.v === rowFilter);
                      const next = rowFilterOptions[(idx + 1) % rowFilterOptions.length];
                      setRowFilter(next.v as typeof rowFilter);
                    }}
                    style={{
                      paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999,
                      borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface,
                    }}
                  >
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11, color: colors.faint }}>
                      {rowFilterOptions.find((x) => x.v === rowFilter)?.l || 'All rows'}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          </View>
        </View>

        {result.stats && result.stats.length ? (
          <Pad style={{ paddingTop: 8, paddingBottom: 6 }}>
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
          <Pad style={{ paddingTop: 8, paddingBottom: 20 }}>
            <Card style={{
              overflow: 'hidden', borderWidth: 1, borderColor: isAccountingLedger ? colors.ink : colors.lineHard,
              borderRadius: isAccountingLedger ? 10 : 18,
            }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ width: widths.reduce((total, width) => total + width, 0), backgroundColor: isAccountingLedger ? colors.surface : undefined }}>
                  <View style={{
                    flexDirection: 'row', backgroundColor: isAccountingLedger ? colors.ink : colors.sunk,
                    borderBottomWidth: isAccountingLedger ? 2 : 1,
                    borderBottomColor: isAccountingLedger ? colors.ink : colors.lineHard,
                  }}>
                    {result.cols.map((c, i) => (
                      <Pressable
                        key={i}
                        onPress={() => tapHeader(i)}
                        style={{
                          width: widths[i], paddingVertical: 10, paddingHorizontal: 10,
                          flexDirection: 'row', alignItems: 'center', justifyContent: c.r ? 'flex-end' : 'flex-start',
                          gap: 4,
                        }}
                      >
                        <Text
                          numberOfLines={1}
                          style={{
                            fontFamily: fonts.uiBold, fontSize: 10, letterSpacing: 0.45,
                            textTransform: 'uppercase', color: isAccountingLedger ? colors.surface : (sort?.i === i ? colors.accent : colors.faint),
                          }}
                        >
                          {c.h}
                        </Text>
                        {sort?.i === i ? <Icon name={sort.dir === 'asc' ? 'up' : 'down'} size={11} color={colors.accent} /> : null}
                      </Pressable>
                    ))}
                  </View>

                  {filteredView.rows.map((r, ri) => {
                    const ref = filteredView.rowRefs ? filteredView.rowRefs[ri] : null;
                    const isOpening = isAccountingLedger && cellText(r[1]) === 'Opening Balance';
                    const row = (
                      <View style={{
                        flexDirection: 'row',
                        backgroundColor: isOpening ? colors.sunk : colors.surface,
                        borderBottomWidth: 1, borderBottomColor: colors.line,
                        alignItems: 'center',
                      }}>
                        {result.cols.map((_, i) => renderCell(r[i] ?? '', i, isOpening))}
                      </View>
                    );
                    if (!ref) return <View key={ri}>{row}</View>;
                    return (
                      <Pressable
                        key={ri}
                        onPress={() => openRef(ref)}
                        style={({ pressed }) => ({ backgroundColor: pressed ? colors.sunk : undefined })}
                      >
                        {row}
                      </Pressable>
                    );
                  })}

                  {result.foot ? (
                    <View style={{
                      flexDirection: 'row', backgroundColor: isAccountingLedger ? colors.ink : colors.sunk,
                      borderTopWidth: isAccountingLedger ? 2 : 1, borderTopColor: isAccountingLedger ? colors.ink : colors.lineHard,
                      alignItems: 'center',
                    }}>
                      {result.cols.map((_, i) => (
                        <Text
                          key={i}
                          numberOfLines={2}
                          style={[cellStyle(i, true), { color: isAccountingLedger ? colors.surface : colors.ink }]}
                        >
                          {cellText(result.foot![i] ?? '')}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                </View>
              </ScrollView>
            </Card>

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
