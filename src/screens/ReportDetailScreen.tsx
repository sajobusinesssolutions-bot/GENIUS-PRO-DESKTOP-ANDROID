/**
 * One renderer for every report.
 *
 * Reference SCREENS.report (2231) for the date chips, tableCard() (2245) for
 * the table and its `foot` totals row, and statsRow() (2258) for the stat band.
 * Everything beyond the prototype — sorting, a custom range, export and
 * tap-through — is driven generically off the `ReportResult`.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, Alert, useWindowDimensions } from 'react-native';
import { Pressable } from '../components/Press';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useGo } from '../nav/navigate';
import { PLAY_BUILD } from '../data/store';
import { canFor } from '../data/perms';
import { mayCreate } from '../data/logic';
import { isPremiumReport, groupOf, reportPermission } from '../data/reports';
import { startOfDay, endOfDay, daysAgo, fmtDay } from '../data/helpers';
import {
  runReport, reportById, sortRows, cellText, cellTone, stockMovementDrill, inventoryMetricDrill,
  ledgerDrill, partyDrill, voucherDrill, voucherTypeDrill, DETAIL_VIEW,
  INVENTORY_METRIC_REPORTS, InventoryMetricReport,
  Cell, CellTone, ReportResult, RowRef, SortDir,
} from '../data/reports';
import { toPdf, preview, toExcel, shareTo, shareFile, fileNameFor, pickColumns, ExportMeta } from '../data/exporters';
import { Card, Cap, Pad, EmptyState, Button, StatGrid, ListRow, InfoBanner } from '../components/ui';
import { Field, Checkbox } from '../components/form';
import { Sheet } from '../components/Sheet';
import { IconBtn } from '../components/AppBar';
import Icon from '../components/icons';
import type { RootStackParamList } from '../nav/types';

type Rt = RouteProp<RootStackParamList, 'ReportDetail'>;
type ExportKind = 'pdf' | 'preview' | 'excel' | 'whatsapp';

/** What was ticked last time for each report, so the next export starts from it. */
const CHOSEN = new Map<string, { keep: boolean[]; showGenerated: boolean; showTotals: boolean }>();
const ASK: Record<ExportKind, string> = {
  pdf: 'What to display on PDF?', preview: 'What to show?', excel: 'What to put in Excel?', whatsapp: 'What to send?',
};

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

/**
 * Widths that fit the screen. Each column starts at its natural width; a table
 * narrower than the phone grows its first text column, and one wider shrinks
 * every column towards a readable floor (text then wraps onto a second line)
 * before it resorts to sideways scrolling.
 */
export function fitWidths(result: ReportResult, avail: number): number[] {
  const natural = widthsFor(result, avail);
  const total = natural.reduce((a, b) => a + b, 0);
  if (total <= avail) return natural;
  const floor = result.cols.map((c) => (c.r ? 66 : 78));
  const room = natural.map((w, i) => w - floor[i]);
  const spare = room.reduce((a, b) => a + b, 0);
  const over = total - avail;
  if (spare <= 0) return floor;
  const k = Math.min(1, over / spare);
  return natural.map((w, i) => Math.round(w - room[i] * k));
}

export default function ReportDetailScreen() {
  const { colors } = useTheme();
  const nav = useNavigation<any>();
  const route = useRoute<Rt>();
  const go = useGo();
  const { db, money } = useAppData();

  const id = route.params?.id || 'sale-summary';
  const def = reportById(id);
  const group = groupOf(id);

  const [rangeKey, setRangeKey] = useState<RangeKey>('30');
  const [custom, setCustom] = useState<{ from: number; to: number } | null>(null);
  const [rowFilter, setRowFilter] = useState<'all' | 'sale' | 'purchase' | 'payment' | 'entry' | 'creditNote' | 'product' | 'month'>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ i: number; dir: SortDir } | null>(null);
  const [drillProductId, setDrillProductId] = useState<string | null>(null);
  const [drillMonthKey, setDrillMonthKey] = useState<string | null>(null);
  /** Ledgers, parties and vouchers opened from a row, deepest last; Back steps out one. */
  const [drill, setDrill] = useState<{ kind: 'ledger' | 'party' | 'voucher' | 'vouchertype'; id: string }[]>([]);
  /** The detailed form of a statement: every ledger under its group, with opening and closing. */
  const [detailed, setDetailed] = useState(false);
  const top = drill[drill.length - 1];
  const { width } = useWindowDimensions();
  const [layout, setLayout] = useState<'cards' | 'table'>(width < 520 ? 'cards' : 'table');
  const [exportOpen, setExportOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  /** Which one-button dropdown is open: the report's view, its dates, or its rows. */
  const [pick, setPick] = useState<'view' | 'range' | 'rows' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [fromText, setFromText] = useState(isoDay(startOfDay(daysAgo(29))));
  const [toText, setToText] = useState(isoDay(Date.now()));
  const [ask, setAsk] = useState<ExportKind | null>(null);
  const [keep, setKeep] = useState<boolean[]>([]);
  const [showGenerated, setShowGenerated] = useState(true);
  const [showTotals, setShowTotals] = useState(true);
  const [fileName, setFileName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [editingName, setEditingName] = useState(false);

  const role = db?.session.role;
  // money and profit reports each have their own switch in Users & roles
  const extra = reportPermission(id);
  const allowed = canFor(role, 'reports') && (!extra || canFor(role, extra));
  const canExport = canFor(role, 'exports.download');

  const span = useMemo(() => spanFor(rangeKey, custom), [rangeKey, custom]);

  const result = useMemo<ReportResult | null>(() => {
    if (!db || !allowed) return null;
    if (top) {
      return top.kind === 'ledger' ? ledgerDrill(db, top.id, span.from, span.to)
        : top.kind === 'party' ? partyDrill(db, top.id, span.from, span.to)
          : top.kind === 'vouchertype' ? voucherTypeDrill(db, top.id, span.from, span.to)
            : voucherDrill(db, top.id);
    }
    if (id === 'stock-movement' && drillProductId) {
      return stockMovementDrill(db, drillProductId, span.from, span.to, drillMonthKey || undefined);
    }
    if (INVENTORY_METRIC_REPORTS.includes(id as InventoryMetricReport) && drillProductId) {
      return inventoryMetricDrill(db, id as InventoryMetricReport, drillProductId, span.from, span.to, drillMonthKey || undefined);
    }
    return runReport(db, detailed && DETAIL_VIEW[id] ? DETAIL_VIEW[id] : id, span.from, span.to, money);
  }, [db, allowed, id, span.from, span.to, money, drillProductId, drillMonthKey, top, detailed]);

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
    // one pass decides which rows stay, so each row keeps its own tap target
    const needle = search.trim().toLowerCase();
    const keep = view.rows.map((row, idx) => {
      const ref = view.rowRefs?.[idx];
      if (rowFilter !== 'all' && ref?.kind !== rowFilter) return false;
      return !needle || row.some((cell) => cellText(cell).toLowerCase().includes(needle));
    });
    const rows = view.rows.filter((_, idx) => keep[idx]);
    const rowRefs = (view.rowRefs || view.rows.map(() => null)).filter((_, idx) => keep[idx]);
    return { rows, rowRefs };
  }, [view, rowFilter, search]);

  const meta = useMemo(
    (): ExportMeta => ({
      firm: db?.firm?.name, range: span.label, from: span.from, to: span.to, user: 'All Users',
      firmAddress: db?.firm?.address, firmPhone: db?.firm?.phone, firmEmail: db?.firm?.email,
    }),
    [db?.firm, span.label, span.from, span.to],
  );

  useEffect(() => { setSort(null); }, [id]);
  useEffect(() => {
    setDrillProductId(null);
    setDrillMonthKey(null);
    setDrill([]);
    setDetailed(false);
  }, [id]);
  useEffect(() => { setSearch(''); setSort(null); }, [top]);

  const isInventoryReport = id === 'stock-movement' || INVENTORY_METRIC_REPORTS.includes(id as InventoryMetricReport);

  useEffect(() => nav.addListener('beforeRemove', (event: { preventDefault: () => void }) => {
    // the phone's back steps out of a drill-down before it leaves the report
    if (drill.length) {
      event.preventDefault();
      setDrill((d) => d.slice(0, -1));
      return;
    }
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
  }), [nav, isInventoryReport, drillMonthKey, drillProductId, drill.length]);

  /* header export button */
  useEffect(() => {
    nav.setOptions({
      title: group ? group.name : def ? def.name : 'Report',
    });
  }, [nav, def, group]);

  const runExport = useCallback(async (what: ExportKind, result: ReportResult, meta: ExportMeta) => {
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
        const r = await shareFile(uri, 'application/pdf', result.title);
        if (!r.ok) {
          Alert.alert(
            'Could not open the share sheet',
            (r.reason ? r.reason + '\n\n' : '') + 'The PDF itself was created and saved to ' + uri + '.',
          );
        }
      } else if (what === 'excel') {
        const uri = await toExcel(result, meta);
        const r = await shareFile(
          uri,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          result.title,
        );
        if (!r.ok) {
          Alert.alert(
            'Could not open the share sheet',
            (r.reason ? r.reason + '\n\n' : '') + fileNameFor(result, 'xlsx', meta) + ' was still written to your documents.',
          );
        }
      } else {
        const r = await shareTo(result, 'whatsapp', meta);
        if (!r.ok) Alert.alert('Could not share', r.reason || 'No app on this phone accepted the report.');
      }
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [canExport]);

  /** Before anything is exported or printed, ask which columns to include. */
  const chooseColumns = (what: ExportKind) => {
    if (!result) return;
    if (!canExport && what !== 'preview') {
      Alert.alert('Not allowed', 'Your role cannot download or share reports.');
      return;
    }
    const key = id + ':' + result.cols.map((c) => c.h).join('|');
    const last = CHOSEN.get(key);
    setKeep(last && last.keep.length === result.cols.length ? last.keep : result.cols.map(() => true));
    setShowGenerated(last ? last.showGenerated : true);
    setShowTotals(last ? last.showTotals : true);
    if (!nameEdited) setFileName(fileNameFor(result, 'pdf', meta).replace(/.pdf$/, ''));
    setEditingName(false);
    setExportOpen(false);
    // one sheet closes before the next opens; two modals at once can leave the second hidden
    setTimeout(() => setAsk(what), 250);
  };

  const applyColumns = () => {
    if (!result || !ask) return;
    if (!keep.some(Boolean)) { Alert.alert('Choose a column', 'Tick at least one column to include.'); return; }
    CHOSEN.set(id + ':' + result.cols.map((c) => c.h).join('|'), { keep, showGenerated, showTotals });
    let picked = pickColumns(result, keep);
    if (!showTotals) picked = { ...picked, foot: undefined, stats: undefined };
    const what = ask;
    setAsk(null);
    void runExport(what, picked, { ...meta, fileName: nameEdited ? fileName : undefined, showGenerated, showTotals });
  };

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
    if (ref.kind === 'ledger' || ref.kind === 'party' || ref.kind === 'voucher' || ref.kind === 'vouchertype') {
      const kind = ref.kind;
      setDrill((d) => [...d, { kind, id: ref.id }]);
      return;
    }
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

  /* Switching between the views of one report — shown on the report and on its locked page alike. */
  const currentView = group?.views.find((v) => v.id === id);
  const viewChips = group && group.views.length > 1 ? (
    <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
      <DropBtn icon="doc" label={currentView?.label || 'View'} onPress={() => setPick('view')} />
    </View>
  ) : null;

  if (isPremiumReport(id) && !mayCreate(db)) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {viewChips}
      <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
        <View style={{ alignItems: 'center' }}>
          <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="lock" size={28} color={colors.accent} />
          </View>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink, marginTop: 16, textAlign: 'center' }}>{def?.name || 'This report'} is a premium report</Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 15, lineHeight: 20, color: colors.faint, marginTop: 8, textAlign: 'center' }}>
            It opens again with a plan. The everyday reports (end of day, sales, stock, balances) stay open.
          </Text>
        </View>
        <View style={{ height: 22 }} />
        <Button variant="pri" label={PLAY_BUILD ? 'Your plan' : 'See plans'} onPress={() => go('Licence')} />
      </View>
      </View>
    );
  }

  if (!allowed) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <EmptyState icon="lock" title="This report is not open to you" subtitle={extra === 'inventory.view_profit' ? 'It shows profit, and your role cannot see profit. Ask the owner.' : extra === 'reports.money' ? 'It is a money report, and your role cannot see those. Ask the owner.' : 'Ask the owner to give your role report access.'} />
      </View>
    );
  }

  if (!result || !view) return null;

  // the table runs edge to edge, so it is sized to the whole width of the phone
  const widths = fitWidths(result, width);
  const tableWidth = widths.reduce((a, b) => a + b, 0);
  const drillProduct = drillProductId ? db.products.find((p) => p.id === drillProductId) : null;
  const isInventoryDrill = isInventoryReport && !!drillProduct;
  const isAccountingLedger = true;
  const toneColor = (t?: CellTone) =>
    t === 'good' ? colors.good : t === 'warn' ? colors.warn : t === 'danger' ? colors.danger
      : t === 'accent' ? colors.accent : t === 'muted' ? colors.faint : colors.ink;

  const cellStyle = (i: number, bold?: boolean) => ({
    width: widths[i],
    paddingVertical: 9,
    paddingHorizontal: 8,
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
        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11.5, color: colors.faint, letterSpacing: 0.6, textTransform: 'uppercase' }}>
                {def?.cat || 'Report'}
              </Text>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 17, color: colors.ink, marginTop: 1 }} numberOfLines={1}>
                {def?.name || result.title}
              </Text>
            </View>
            <Pressable
              onPress={() => setExportOpen(true)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.accent }}
            >
              <Icon name="share" size={15} color={colors.accentInk} />
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 13.5, color: colors.accentInk }}>Export</Text>
            </Pressable>
          </View>

          {/* one dropdown each: which view, which dates, which rows */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {group && group.views.length > 1 ? (
              <DropBtn icon="doc" label={currentView?.label || 'View'} onPress={() => setPick('view')} />
            ) : null}
            <DropBtn icon="calendar" label={span.label} onPress={() => setPick('range')} />
            {DETAIL_VIEW[id] && !top ? (
              <Pressable
                onPress={() => { setDetailed((v) => !v); setSort(null); }}
                accessibilityRole="switch"
                accessibilityState={{ checked: detailed }}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: 10,
                  borderWidth: 1.2, borderColor: detailed ? colors.accent : colors.line, backgroundColor: detailed ? colors.accent : colors.surface,
                }}
              >
                <Icon name={detailed ? 'check' : 'doc'} size={14} color={detailed ? colors.accentInk : colors.accent} />
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: detailed ? colors.accentInk : colors.ink }}>Detailed</Text>
              </Pressable>
            ) : null}
            {rowFilterOptions.length > 1 ? (
              <DropBtn icon="filter" label={rowFilterOptions.find((x) => x.v === rowFilter)?.l || 'All rows'} onPress={() => setPick('rows')} />
            ) : null}
          </View>

          {top ? (
            <View style={{ marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, backgroundColor: colors.accentSoft }}>
              <Pressable onPress={() => setDrill((d) => d.slice(0, -1))} hitSlop={8} style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="back" size={16} color={colors.accent} />
              </Pressable>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.soft }}>
                  {top.kind === 'ledger' ? 'Ledger' : top.kind === 'party' ? 'Statement' : top.kind === 'vouchertype' ? 'Vouchers' : 'Voucher'} · {top.kind === 'voucher' ? 'all lines' : span.label}
                </Text>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 14.5, color: colors.ink }} numberOfLines={1}>{result.title}</Text>
              </View>
            </View>
          ) : null}

          {result.searchable || result.rows.length > 15 ? (
            <View style={{ marginTop: 6 }}>
              <Field
                icon="search"
                label={top ? 'Search these postings' : 'Search this report'}
                value={search}
                onChangeText={setSearch}
                autoCorrect={false}
                style={{ marginBottom: 0 }}
                trailing={search ? <Pressable onPress={() => setSearch('')} hitSlop={8}><Icon name="x" size={16} color={colors.faint} /></Pressable> : null}
              />
            </View>
          ) : null}

          {isInventoryDrill ? (
            <View style={{ marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, backgroundColor: colors.accentSoft }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: colors.ink }} numberOfLines={1}>{drillProduct?.name}</Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.soft, marginTop: 1 }}>
                  {drillMonthKey ? drillMonthKey + ' · ' + span.label : 'Period · ' + span.label}
                </Text>
              </View>
              {drillMonthKey ? (
                <Pressable onPress={() => { setDrillMonthKey(null); setSort(null); }} hitSlop={8}>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.accent }}>Back to months</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
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

        {result.rowKinds && result.rows.length ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 20 }}>
            <Statement result={result} refs={result.rowRefs} onOpen={openRef} />
          </View>
        ) : result.rows.length === 0 ? (
          <EmptyState
            icon={result.notImplemented ? 'clock' : result.error ? 'alert' : 'chart'}
            title={result.notImplemented ? 'Not built yet' : result.error ? 'Could not build this report' : 'Nothing to show'}
            subtitle={result.error || result.note || 'No data in this period. Try a wider date range.'}
          />
        ) : (
          <View style={{ paddingTop: 8, paddingBottom: 20 }}>
            <View style={{ borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line, backgroundColor: colors.surface }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} scrollEnabled={tableWidth > width + 1}>
                <View style={{ width: Math.max(tableWidth, width) }}>
                  <View style={{ flexDirection: 'row', backgroundColor: colors.accentSoft, borderBottomWidth: 1.4, borderBottomColor: colors.accent }}>
                    {result.cols.map((c, i) => (
                      <Pressable
                        key={i}
                        onPress={() => tapHeader(i)}
                        style={{
                          width: widths[i], paddingVertical: 10, paddingHorizontal: 8,
                          flexDirection: 'row', alignItems: 'center', justifyContent: c.r ? 'flex-end' : 'flex-start', gap: 3,
                        }}
                      >
                        <Text numberOfLines={2} style={{ fontFamily: fonts.uiBold, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.accent, textAlign: c.r ? 'right' : 'left' }}>
                          {c.h}
                        </Text>
                        {sort?.i === i ? <Icon name={sort.dir === 'asc' ? 'up' : 'down'} size={11} color={colors.accent} /> : null}
                      </Pressable>
                    ))}
                  </View>

                  {filteredView.rows.map((r, ri) => {
                    const ref = filteredView.rowRefs ? filteredView.rowRefs[ri] : null;
                    const isOpening = cellText(r[1]) === 'Opening Balance';
                    const row = (
                      <View style={{
                        flexDirection: 'row', alignItems: 'center',
                        backgroundColor: isOpening ? colors.sunk : ri % 2 ? colors.bg : colors.surface,
                        borderBottomWidth: 1, borderBottomColor: colors.line,
                      }}>
                        {result.cols.map((_, i) => renderCell(r[i] ?? '', i, isOpening))}
                        {ref ? <View style={{ position: 'absolute', left: 0, top: 6, bottom: 6, width: 2.5, borderRadius: 2, backgroundColor: colors.accent, opacity: 0.5 }} /> : null}
                      </View>
                    );
                    if (!ref) return <View key={ri}>{row}</View>;
                    return (
                      <Pressable key={ri} onPress={() => openRef(ref)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
                        {row}
                      </Pressable>
                    );
                  })}

                  {result.foot ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.accentSoft, borderTopWidth: 1.4, borderTopColor: colors.accent }}>
                      {result.cols.map((_, i) => (
                        <Text key={i} numberOfLines={2} style={[cellStyle(i, true), { color: colors.ink }]}>
                          {cellText(result.foot![i] ?? '')}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                </View>
              </ScrollView>
            </View>

            {result.note ? (
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 17, color: colors.faint, marginTop: 10, paddingHorizontal: 16 }}>
                {result.note}
              </Text>
            ) : null}
            {view.rowRefs && view.rowRefs.some(Boolean) ? (
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 6, paddingHorizontal: 16 }}>
                Rows marked on the left open the transaction.
              </Text>
            ) : null}
          </View>
        )}
      </ScrollView>

      {/* the dropdowns' choices */}
      <Sheet
        visible={!!pick}
        title={pick === 'view' ? 'Show' : pick === 'range' ? 'Date range' : 'Rows'}
        icon={pick === 'range' ? 'calendar' : pick === 'rows' ? 'filter' : 'doc'}
        onClose={() => setPick(null)}
      >
        {(pick === 'view' ? (group?.views || []).map((v) => ({ v: v.id, l: v.label }))
          : pick === 'range' ? [
            { v: 'today', l: 'Today' }, { v: '7', l: 'Last 7 days' }, { v: '30', l: 'Last 30 days' },
            { v: 'all', l: 'All time' }, { v: 'custom', l: 'Custom dates…' },
          ]
            : rowFilterOptions
        ).map((o) => {
          const on = pick === 'view' ? o.v === id : pick === 'range' ? o.v === rangeKey : o.v === rowFilter;
          return (
            <Pressable
              key={o.v}
              onPress={() => {
                const which = pick;
                setPick(null);
                if (which === 'view') { if (o.v !== id) { setSort(null); setSearch(''); nav.setParams({ id: o.v }); } }
                else if (which === 'range') { if (o.v === 'custom') setTimeout(() => setRangeOpen(true), 250); else setRangeKey(o.v as RangeKey); }
                else setRowFilter(o.v as typeof rowFilter);
              }}
              style={{ flexDirection: 'row', alignItems: 'center', minHeight: 50, borderBottomWidth: 1, borderBottomColor: colors.line }}
            >
              <Text style={{ flex: 1, fontFamily: on ? fonts.uiBold : fonts.ui, fontSize: 15, color: on ? colors.accent : colors.ink }}>{o.l}</Text>
              {on ? <Icon name="check" size={17} color={colors.accent} /> : null}
            </Pressable>
          );
        })}
      </Sheet>

      {/* custom range */}
      <Sheet visible={rangeOpen} title="Custom range" icon="calendar" onClose={() => setRangeOpen(false)}
        footer={<Button label="Apply range" variant="pri" onPress={applyCustom} />}>
        <Field label="From" icon="calendar" value={fromText} onChangeText={setFromText} placeholder="YYYY-MM-DD" />
        <Field label="To" icon="calendar" value={toText} onChangeText={setToText} placeholder="YYYY-MM-DD" />
        <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 4 }}>
          Both days are included. For example 2026-01-01 to 2026-01-31 covers the whole of January.
        </Text>
      </Sheet>

      {/* export */}
      <Sheet visible={exportOpen} title="Export report" subtitle={result.title} icon="share" onClose={() => setExportOpen(false)}>
        {([
          ['pdf', 'doc', 'accent', 'PDF', 'Save or send it as a PDF'],
          ['preview', 'image', 'accent', 'Preview', 'Open it in a PDF viewer of your choice'],
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
              onPress={busy ? undefined : () => chooseColumns(key)}
              right={busy === key ? <ActivityIndicator color={colors.accent} /> : undefined}
            />
          </View>
        ))}
        {!canExport ? (
          <InfoBanner tone="warn" text="Your role can preview but not download or share." />
        ) : null}
      </Sheet>

      {/* which columns go on the page */}
      <Sheet
        visible={!!ask}
        title={ask ? ASK[ask] : ''}
        onClose={() => setAsk(null)}
        footer={(
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Button label="Cancel" onPress={() => setAsk(null)} /></View>
            <View style={{ flex: 1 }}><Button variant="pri" label="Apply" onPress={applyColumns} /></View>
          </View>
        )}
      >
        {ask !== 'preview' ? (
          <View style={{ backgroundColor: colors.sunk, borderRadius: 10, paddingHorizontal: 12, paddingVertical: editingName ? 8 : 12, marginBottom: 6 }}>
            {editingName ? (
              <Field
                label="File name"
                value={fileName}
                autoFocus
                onChangeText={(v) => { setFileName(v); setNameEdited(true); }}
                onBlur={() => setEditingName(false)}
              />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.ui, fontSize: 12.5, color: colors.soft }}>{fileName}</Text>
                <Pressable hitSlop={8} onPress={() => setEditingName(true)}>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.accent }}>Edit Name</Text>
                </Pressable>
              </View>
            )}
          </View>
        ) : null}
        {result.cols.map((c, i) => (
          <Pressable
            key={c.h + i}
            onPress={() => setKeep((k) => k.map((v, j) => (j === i ? !v : v)))}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: !!keep[i] }}
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: colors.line }}
          >
            <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 15, color: colors.ink }}>{c.h}</Text>
            <Checkbox on={!!keep[i]} size={22} onPress={() => setKeep((k) => k.map((v, j) => (j === i ? !v : v)))} />
          </Pressable>
        ))}
        {result.foot || (result.stats && result.stats.length) ? (
          <Pressable
            onPress={() => setShowTotals((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: showTotals }}
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: colors.line }}
          >
            <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 15, color: colors.ink }}>Totals</Text>
            <Checkbox on={showTotals} size={22} onPress={() => setShowTotals((v) => !v)} />
          </Pressable>
        ) : null}
        {ask === 'pdf' || ask === 'preview' || ask === 'whatsapp' ? (
          <Pressable
            onPress={() => setShowGenerated((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: showGenerated }}
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 15 }}
          >
            <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 15, color: colors.ink }}>Date &amp; Time</Text>
            <Checkbox on={showGenerated} size={22} onPress={() => setShowGenerated((v) => !v)} />
          </Pressable>
        ) : null}
      </Sheet>
    </View>
  );
}

/** A compact button that shows the current choice and opens the list of the others. */
function DropBtn({ icon, label, onPress }: { icon: 'doc' | 'calendar' | 'filter'; label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12,
        borderRadius: 10, borderWidth: 1.2, borderColor: colors.line, backgroundColor: colors.surface, maxWidth: '100%',
      }}
    >
      <Icon name={icon} size={14} color={colors.accent} />
      <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink }}>{label}</Text>
      <Icon name="down" size={13} color={colors.faint} />
    </Pressable>
  );
}

/**
 * A financial statement: each section a card, its ledgers as lines that open
 * their postings, a subtotal at the foot of each card, and the bottom line in
 * a card of its own.
 */
function Statement({ result, refs, onOpen }: { result: ReportResult; refs?: (RowRef | null)[]; onOpen: (r: RowRef | null | undefined) => void }) {
  const { colors } = useTheme();
  const kinds = result.rowKinds || [];
  // the amount columns are everything after the label; a section column (the balance sheet's) is skipped
  const labelAt = result.cols.length > 2 && result.cols[0].h === 'Section' ? 1 : 0;
  const amountCols = result.cols.map((c, i) => i).filter((i) => i > labelAt);
  const sections: { head?: Cell[]; items: { row: Cell[]; kind: string; ref: RowRef | null }[] }[] = [];
  result.rows.forEach((row, i) => {
    const kind = kinds[i] || 'line';
    if (kind === 'head' || !sections.length) sections.push({ head: kind === 'head' ? row : undefined, items: [] });
    if (kind !== 'head') sections[sections.length - 1].items.push({ row, kind, ref: refs?.[i] || null });
  });
  const amount = (c: Cell, strong?: boolean) => (
    <Text style={{ minWidth: 86, textAlign: 'right', fontFamily: strong ? fonts.monoSemi : fonts.mono, fontSize: strong ? 14 : 13.5, color: strong ? colors.ink : cellTone(c) === 'muted' ? colors.soft : colors.ink }}>
      {cellText(c)}
    </Text>
  );
  return (
    <View style={{ gap: 12 }}>
      {amountCols.length > 1 ? (
        <View style={{ flexDirection: 'row', paddingHorizontal: 14 }}>
          <View style={{ flex: 1 }} />
          {amountCols.map((i) => (
            <Text key={i} style={{ minWidth: 86, textAlign: 'right', fontFamily: fonts.uiBold, fontSize: 11, letterSpacing: 0.5, color: colors.faint, textTransform: 'uppercase' }}>{result.cols[i].h}</Text>
          ))}
        </View>
      ) : null}
      {sections.map((sec, si) => (
        <View key={si} style={{ borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' }}>
          {sec.head ? (
            <Text style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6, fontFamily: fonts.uiBold, fontSize: 11.5, letterSpacing: 0.7, textTransform: 'uppercase', color: colors.accent }}>
              {cellText(sec.head[labelAt])}
            </Text>
          ) : null}
          {sec.items.map((it, ii) => {
            const sub = it.kind === 'sub' || it.kind === 'total';
            const body = (
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: sub ? 12 : 10,
                backgroundColor: sub ? colors.accentSoft : undefined,
                borderTopWidth: ii === 0 && !sec.head ? 0 : 1, borderTopColor: colors.line,
              }}>
                <Text numberOfLines={2} style={{ flex: 1, fontFamily: sub ? fonts.uiBold : fonts.ui, fontSize: 14, color: colors.ink }}>
                  {cellText(it.row[labelAt])}
                </Text>
                {amountCols.map((i) => <React.Fragment key={i}>{amount(it.row[i] ?? '', sub)}</React.Fragment>)}
                {it.ref ? <Icon name="chev" size={13} color={colors.faint} /> : <View style={{ width: 13 }} />}
              </View>
            );
            return it.ref
              ? <Pressable key={ii} onPress={() => onOpen(it.ref)} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>{body}</Pressable>
              : <View key={ii}>{body}</View>;
          })}
        </View>
      ))}
      {result.foot ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 16, borderRadius: 16, backgroundColor: colors.accent }}>
          <Text style={{ flex: 1, fontFamily: fonts.uiExtra, fontSize: 16, color: colors.accentInk }}>
            {cellText(result.foot[0])}{labelAt && cellText(result.foot[labelAt]) ? ' · ' + cellText(result.foot[labelAt]) : ''}
          </Text>
          {amountCols.map((i) => (
            <Text key={i} style={{ minWidth: 86, textAlign: 'right', fontFamily: fonts.monoSemi, fontSize: 16, color: colors.accentInk }}>{cellText(result.foot![i] ?? '')}</Text>
          ))}
          <View style={{ width: 13 }} />
        </View>
      ) : null}
      {result.note ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{result.note}</Text> : null}
    </View>
  );
}
