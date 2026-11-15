/**
 * One renderer for every report.
 *
 * Reference SCREENS.report (2231) for the date chips, tableCard() (2245) for
 * the table and its `foot` totals row, and statsRow() (2258) for the stat band.
 * Everything beyond the prototype — sorting, a custom range, export and
 * tap-through — is driven generically off the `ReportResult`.
 */
import { groupNum } from '../data/helpers';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { withItemDetails, hasItemDetails } from '../data/reportItems';
import DetailedStatement, { DetailedKind } from '../components/DetailedStatement';
import { View, Text, ActivityIndicator, Alert, FlatList, TextInput, RefreshControl } from 'react-native';
import ScrollView from '../components/KeyScroll';
import { Pressable } from '../components/Press';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { bookForRange, needsOlder } from '../data/storage';
import type { DB } from '../data/types';
import { useGo } from '../nav/navigate';
import { PLAY_BUILD } from '../data/store';
import { canFor } from '../data/perms';
import { mayCreate } from '../data/logic';
import { isPremiumReport, groupOf, reportPermission, earliestRead } from '../data/reports';
import { listPeriod, ListPeriod } from '../components/DocList';
import { TabChips, PeriodPill, MoreRow, ReportRow, TotalBar, useReportPalette } from '../components/ReportList';
import { reportShape, plainCell, countLabel, shortRange } from '../data/reportShape';
import {
  runReport, reportById, sortRows, cellText, cellTone, stockMovementDrill, inventoryMetricDrill,
  ledgerDrill, partyDrill, voucherDrill, voucherTypeDrill, DETAIL_VIEW,
  INVENTORY_METRIC_REPORTS, InventoryMetricReport,
  Cell, CellTone, ReportResult, RowRef, SortDir,
} from '../data/reports';
import { arrangeColumns, arrangedIndexes } from '../data/reportColumns';
import { toPdf, preview, toExcel, shareTo, shareFile, fileNameFor, pickColumns, ExportMeta } from '../data/exporters';
import { EmptyState, Button, ListRow, InfoBanner } from '../components/ui';
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

const DEFAULT_HIDDEN: Record<string, { order: string[]; hidden: string[] }> = {
  'invoice-list': { order: [], hidden: ['Mode', 'Due'] },
};

export default function ReportDetailScreen() {
  const { colors } = useTheme();
  const pal = useReportPalette();
  const nav = useNavigation<any>();
  const route = useRoute<Rt>();
  const go = useGo();
  const { db, setSetting } = useAppData();
  /* A report writes an amount as 12,500.00: two decimals and no currency in
     front, on screen and in what is exported from it. */
  const money = useCallback((n: number) => groupNum(n || 0, 2), []);

  const id = route.params?.id || 'invoice-list';
  const def = reportById(id);
  const group = groupOf(id);

  const [period, setPeriod] = useState<ListPeriod>(() => listPeriod(id === 'daybook' || id === 'day-close' ? 'today' : 'month'));
  const [rowFilter, setRowFilter] = useState<'all' | 'sale' | 'purchase' | 'payment' | 'entry' | 'creditNote' | 'product' | 'month'>('all');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ i: number; dir: SortDir } | null>(null);
  const [drillProductId, setDrillProductId] = useState<string | null>(null);
  const [drillMonthKey, setDrillMonthKey] = useState<string | null>(null);
  /** Ledgers, parties and vouchers opened from a row, deepest last; Back steps out one. */
  const [drill, setDrill] = useState<{ kind: 'ledger' | 'party' | 'voucher' | 'vouchertype'; id: string }[]>([]);
  /** The detailed form of a statement: every ledger under its group, with opening and closing. */
  const [detailed, setDetailed] = useState(!!(route.params as any)?.detailed);
  const top = drill[drill.length - 1];
  const [exportOpen, setExportOpen] = useState(false);
  /** Which sheet is open: More, the row filter, the sort, or every total. */
  const [pick, setPick] = useState<'more' | 'rows' | 'sort' | 'totals' | null>(null);
  /** The one row that is open, and where the list was, kept for each level so stepping back out of a ledger finds them. */
  const [openRow, setOpenRow] = useState<number | null>(null);
  const kept = useRef(new Map<string, { open: number | null; y: number }>());
  const listRef = useRef<FlatList<Cell[]>>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [ask, setAsk] = useState<ExportKind | null>(null);
  const [keep, setKeep] = useState<boolean[]>([]);
  const [showGenerated, setShowGenerated] = useState(true);
  const [showTotals, setShowTotals] = useState(true);
  /** Under each sale, bill or quotation, the items that were on it. */
  const [showItems, setShowItems] = useState(false);
  const [fileName, setFileName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [editingName, setEditingName] = useState(false);

  const role = db?.session.role;
  // money and profit reports each have their own switch in Users & roles
  const extra = reportPermission(id);
  const allowed = canFor(role, 'reports') && (!extra || canFor(role, extra));
  const canExport = canFor(role, 'exports.download');

  const span = useMemo(() => ({ from: period.from, to: period.to, label: period.label }), [period]);

  /* A range that starts before what the phone holds in memory is read from
     disk (storage.ts bookForRange). Until it arrives nothing is shown, so a
     figure is never read off the wrong book. */
  /* what the report actually reads back to (some sample a fixed span before 'to') */
  const readFrom = earliestRead(top ? 'drill' : detailed && DETAIL_VIEW[id] ? DETAIL_VIEW[id] : id, span.from, span.to);
  const needOld = needsOlder(db, readFrom);
  const [olderBook, setOlderBook] = useState<{ from: number; book: DB } | null>(null);
  const [olderFailed, setOlderFailed] = useState(false);
  useEffect(() => {
    if (!db || !needOld) { setOlderBook(null); return undefined; }
    let alive = true;
    setOlderFailed(false);
    bookForRange(db, readFrom)
      .then((b) => { if (alive) setOlderBook({ from: readFrom, book: b }); })
      .catch(() => { if (alive) setOlderFailed(true); });
    return () => { alive = false; };
  }, [db, needOld, readFrom]);
  const book = needOld ? (olderBook && olderBook.from === readFrom ? olderBook.book : null) : db;
  const readingOlder = needOld && !book && !olderFailed;

  const raw = useMemo<ReportResult | null>(() => {
    const db = book;
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
  }, [book, allowed, id, span.from, span.to, money, drillProductId, drillMonthKey, top, detailed]);

  /* the columns as the owner set them for this report — on screen and in every export */
  const richDetail = detailed && !top && (id === 'balance-sheet' || id === 'general-ledger' || id === 'pnl');
  const colKey = top ? 'drill:' + top.kind : detailed && DETAIL_VIEW[id] ? DETAIL_VIEW[id] : id;
  /* a few wide lists start with their less-read columns off, so they fit across a phone without scrolling sideways; Columns brings them back */
  const colChoice = db?.settings.reportCols?.[colKey] ?? DEFAULT_HIDDEN[colKey];
  const result = useMemo(() => (raw ? arrangeColumns(raw, colChoice) : null), [raw, colChoice]);
  const [colsOpen, setColsOpen] = useState(false);
  const [draft, setDraft] = useState<{ h: string; on: boolean }[]>([]);
  const openColumns = () => {
    if (!raw) return;
    const heads = raw.cols.map((c) => c.h).slice(1);
    const order = arrangedIndexes(raw.cols.map((c) => c.h), colChoice ? { ...colChoice, hidden: [] } : null).slice(1);
    setDraft(order.map((i) => ({ h: raw.cols[i].h, on: !colChoice?.hidden.includes(raw.cols[i].h) })).filter((x) => heads.includes(x.h)));
    setColsOpen(true);
  };
  const moveCol = (i: number, by: number) => setDraft((d) => {
    const j = i + by;
    if (j < 0 || j >= d.length) return d;
    const next = [...d];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const saveColumns = (reset?: boolean) => {
    const all = { ...(db?.settings.reportCols || {}) };
    if (reset) delete all[colKey];
    else all[colKey] = { order: draft.map((x) => x.h), hidden: draft.filter((x) => !x.on).map((x) => x.h) };
    setSetting({ reportCols: all });
    setSort(null);
    setColsOpen(false);
  };

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

  /* the bar: the report's name over a line saying what it is; Export, then More */
  useEffect(() => {
    const title = group ? group.name : def ? def.name : 'Report';
    nav.setOptions({
      title,
      subtitle: def?.sub,
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <IconBtn name="share" size={22} color={pal.primary} onPress={() => setExportOpen(true)} />
          <IconBtn name="dots" size={22} onPress={() => setPick('more')} />
        </View>
      ),
    });
  }, [nav, def, group, pal.primary]);   // eslint-disable-line react-hooks/exhaustive-deps

  /* each level of a report (the report, a ledger opened from it, a voucher under that) keeps its own open row and place */
  const viewKey = id + '|' + (detailed ? 'd' : '') + '|' + drill.map((d) => d.kind + ':' + d.id).join('>') + '|' + (drillProductId || '') + '|' + (drillMonthKey || '');
  useEffect(() => {
    const k = kept.current.get(viewKey);
    setOpenRow(k ? k.open : null);
    const t = setTimeout(() => { try { listRef.current?.scrollToOffset({ offset: k ? k.y : 0, animated: false }); } catch { /* not drawn yet */ } }, 0);
    return () => clearTimeout(t);
  }, [viewKey]);
  const toggleRow = useCallback((i: number) => {
    setOpenRow((cur) => {
      const next = cur === i ? null : i;
      kept.current.set(viewKey, { open: next, y: kept.current.get(viewKey)?.y || 0 });
      return next;
    });
  }, [viewKey]);
  useEffect(() => { setOpenRow(null); }, [search, rowFilter, sort]);

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
    if (showItems && db) picked = withItemDetails(db, picked, (n) => groupNum(n, 2, true), span);
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
    else if (ref.kind === 'estimate') go('EstimateDetail', { estimateId: ref.id });
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

  if (!db) return null;

  /* Switching between the views of one report — shown on the report and on its locked page alike. */
  const tabs = group && group.views.length > 1 ? group.views.map((v) => ({ id: v.id, label: v.label })) : [];
  const pickTab = (v: string) => { if (v !== id) { setSort(null); setSearch(''); nav.setParams({ id: v }); } };
  const viewChips = tabs.length ? (
    <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8, backgroundColor: pal.card, borderBottomWidth: 1, borderBottomColor: pal.section }}>
      <TabChips tabs={tabs} value={id} onPick={pickTab} />
    </View>
  ) : null;

  if (isPremiumReport(id) && !mayCreate(db)) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {viewChips}
      <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
        <View style={{ alignItems: 'center' }}>
          <View style={{ width: 64, height: 64, borderRadius: 4, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="lock" size={28} color={colors.accent} />
          </View>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 18, color: colors.ink, marginTop: 16, textAlign: 'center' }}>{def?.name || 'This report'} is a premium report</Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 14, lineHeight: 20, color: colors.faint, marginTop: 8, textAlign: 'center' }}>
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

  if (readingOlder || (needOld && olderFailed)) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 }}>
        {olderFailed ? (
          <>
            <EmptyState icon="alert" title="Older records could not be read" subtitle="Try again, or look at a more recent period." />
            <Button label="Show this month" onPress={() => setPeriod(listPeriod('month'))} />
          </>
        ) : (
          <>
            <ActivityIndicator color={colors.accent} />
            <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.soft }}>Reading older records…</Text>
          </>
        )}
      </View>
    );
  }

  if (!result || !view) return null;

  const drillProduct = drillProductId ? db.products.find((p) => p.id === drillProductId) : null;
  const isInventoryDrill = isInventoryReport && !!drillProduct;
  const sym = db.settings.currency || 'Sh';
  const shape = reportShape(result.cols);
  const isStatement = !richDetail && !!result.rowKinds && result.rows.length > 0;
  const asList = !richDetail && !isStatement;
  const hasSearch = asList && (!!result.searchable || result.rows.length > 15 || !!search);
  /* with more than three tabs the pill is the calendar alone, and the dates are on the line under the controls */
  const crowded = tabs.length > 3;
  const isFav = (db.settings.favReports || []).includes(id);
  const sortable = asList && result.rows.length > 1;

  /* The totals, kept at the foot: the figure the report is read for in bold,
     up to two more beside it, and every one of them a tap away. */
  const footText = (i: number) => plainCell(result.foot?.[i] ?? '', true, sym);
  const allTotals: { label: string; value: string }[] = [];
  let mainTotal: { label: string; value: string } | null = null;
  if (result.foot && !richDetail) {
    const nums = result.cols.map((c, i) => i).filter((i) => i > 0 && footText(i) !== '—');
    const main = isStatement ? nums[nums.length - 1] : shape.key >= 0 && footText(shape.key) !== '—' ? shape.key : nums[nums.length - 1];
    if (main !== undefined) {
      const lead = plainCell(result.foot[0] ?? '', false, sym);
      mainTotal = { label: isStatement && lead ? lead : 'Total ' + result.cols[main].h.toLowerCase(), value: footText(main) };
      nums.filter((i) => i !== main).forEach((i) => allTotals.push({ label: result.cols[i].h, value: footText(i) }));
    }
  }
  if (!richDetail) {
    (result.stats || []).forEach((st) => {
      const v = plainCell(st.v, false, sym);
      if (!mainTotal) mainTotal = { label: st.k, value: v };
      else if (v !== mainTotal.value && !allTotals.some((x) => x.value === v && x.label === st.k)) allTotals.push({ label: st.k, value: v });
    });
  }

  const actionFor = (ref: RowRef | null | undefined): string | undefined => {
    if (!ref) return undefined;
    switch (ref.kind) {
      case 'party': return 'View statement';
      case 'ledger': return 'View ledger';
      case 'sale': return 'View sale';
      case 'purchase': return 'View purchase';
      case 'payment': return 'View payment';
      case 'estimate': return 'View quotation';
      case 'creditNote': return 'View credit notes';
      case 'entry': return 'Open Money';
      case 'voucher': return 'View voucher';
      case 'vouchertype': return 'View vouchers';
      case 'product': return 'View movements';
      case 'month': return 'View this month';
      default: return 'Open';
    }
  };

  const searchBox = (
    <View style={{ flex: 1, height: 40, borderRadius: 20, backgroundColor: pal.chip, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14 }}>
      <Icon name="search" size={16} color={pal.muted} />
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder={top ? 'Search these postings' : 'Search this report'}
        placeholderTextColor={pal.faint}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        accessibilityLabel="Search this report"
        style={{ flex: 1, padding: 0, fontFamily: fonts.ui, fontSize: 15, color: pal.text }}
      />
      {search ? <Pressable onPress={() => setSearch('')} hitSlop={12} accessibilityLabel="Clear search"><Icon name="x" size={16} color={pal.muted} /></Pressable> : null}
    </View>
  );

  const banner = top ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: pal.card, borderBottomWidth: 1, borderBottomColor: pal.section }}>
      <Pressable onPress={() => setDrill((d) => d.slice(0, -1))} hitSlop={8} accessibilityLabel="Back to the report" style={{ width: 44, height: 44, marginLeft: -10, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="back" size={18} color={pal.text} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12, color: pal.muted }}>
          {top.kind === 'ledger' ? 'Ledger' : top.kind === 'party' ? 'Statement' : top.kind === 'vouchertype' ? 'Vouchers' : 'Voucher'} · {top.kind === 'voucher' ? 'all lines' : shortRange(span.from, span.to)}
        </Text>
        <Text numberOfLines={2} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: pal.text }}>{result.title}</Text>
      </View>
    </View>
  ) : isInventoryDrill ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: pal.card, borderBottomWidth: 1, borderBottomColor: pal.section }}>
      <Pressable onPress={() => { if (drillMonthKey) setDrillMonthKey(null); else setDrillProductId(null); setSort(null); }} hitSlop={8} accessibilityLabel="Back" style={{ width: 44, height: 44, marginLeft: -10, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="back" size={18} color={pal.text} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12, color: pal.muted }}>{drillMonthKey ? drillMonthKey + ' · ' : ''}{shortRange(span.from, span.to)}</Text>
        <Text numberOfLines={2} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: pal.text }}>{drillProduct?.name}</Text>
      </View>
    </View>
  ) : null;

  const metaLine = (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 }}>
      <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 12.5, color: pal.muted }}>
        {asList ? countLabel(filteredView.rows.length, result.cols, shape) + (search || rowFilter !== 'all' ? ' of ' + groupNum(result.rows.length, 0) : '') : result.title}
        {sort ? '  ·  by ' + result.cols[sort.i].h.toLowerCase() + (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
      </Text>
      {crowded ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: pal.muted }}>{shortRange(span.from, span.to)}</Text> : null}
    </View>
  );

  const underList = result.note ? (
    <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 17, color: pal.faint, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 }}>{result.note}</Text>
  ) : <View style={{ height: 16 }} />;

  const nothing = result.rows.length === 0 ? (
    <EmptyState
      icon={result.notImplemented ? 'clock' : result.error ? 'alert' : 'chart'}
      title={result.notImplemented ? 'Not built yet' : result.error ? 'Could not build this report' : 'Nothing to show'}
      subtitle={result.error || result.note || 'No data in this period. Try a wider date range.'}
    />
  ) : (
    <View style={{ alignItems: 'center', paddingHorizontal: 24, paddingVertical: 36, gap: 14 }}>
      <Text style={{ fontFamily: fonts.ui, fontSize: 14, color: pal.muted, textAlign: 'center' }}>
        {search ? 'No results for \u201C' + search + '\u201D' : 'Nothing matches this filter'}
      </Text>
      <Pressable onPress={() => { setSearch(''); setRowFilter('all'); }} accessibilityRole="button"
        style={{ height: 44, paddingHorizontal: 18, borderRadius: 8, borderWidth: 1, borderColor: pal.section, backgroundColor: pal.card, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: pal.text }}>{search ? 'Clear search' : 'Show every row'}</Text>
      </Pressable>
    </View>
  );

  /* the books are on the phone, so a pull only draws the report again from them */
  const pull = <RefreshControl refreshing={refreshing} colors={[pal.primary]} tintColor={pal.primary} onRefresh={() => { setRefreshing(true); setTimeout(() => setRefreshing(false), 350); }} />;

  return (
    <View style={{ flex: 1, backgroundColor: pal.bg }}>
      {/* the tabs, with Period held at the right; a report with no tabs has its search here */}
      <View style={{ backgroundColor: pal.card, borderBottomWidth: 1, borderBottomColor: pal.section }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 16, paddingRight: 12, paddingVertical: 8, minHeight: 52 }}>
          {tabs.length ? <TabChips tabs={tabs} value={id} onPick={pickTab} /> : hasSearch ? searchBox : <View style={{ flex: 1 }} />}
          <PeriodPill value={period} onChange={setPeriod} iconOnly={crowded} />
        </View>
        {tabs.length && hasSearch ? <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 8 }}>{searchBox}</View> : null}
      </View>
      {banner}

      {asList ? (
        <FlatList
          ref={listRef}
          data={filteredView.rows}
          keyExtractor={(_r, i) => String(i)}
          extraData={openRow}
          ListHeaderComponent={metaLine}
          ListFooterComponent={filteredView.rows.length ? underList : null}
          ListEmptyComponent={nothing}
          refreshControl={pull}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={14}
          windowSize={9}
          onScroll={(e) => { const k = kept.current.get(viewKey); kept.current.set(viewKey, { open: k ? k.open : openRow, y: e.nativeEvent.contentOffset.y }); }}
          scrollEventThrottle={64}
          renderItem={({ item, index }) => {
            const ref = filteredView.rowRefs ? filteredView.rowRefs[index] : null;
            return (
              <ReportRow
                row={item} cols={result.cols} shape={shape} sym={sym} index={index}
                open={openRow === index} onToggle={toggleRow}
                strong={cellText(item[1]) === 'Opening Balance'}
                action={actionFor(ref)} onAction={ref ? () => openRef(ref) : undefined}
              />
            );
          }}
        />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 18 }} showsVerticalScrollIndicator={false} refreshControl={pull}>
          {metaLine}
          {/* balance sheet, general ledger and profit & loss, detailed: grouped lines that open in place */}
          {richDetail && book ? (
            <View style={{ paddingHorizontal: 16, paddingBottom: 24 }}>
              <DetailedStatement kind={id as DetailedKind} db={book} from={span.from} to={span.to} focus={(route.params as any)?.focus}
                onOpenLedger={(acc) => go('ReportDetail', { id: 'general-ledger', detailed: true, focus: acc } as any)} />
            </View>
          ) : (
            <Statement result={result} refs={result.rowRefs} onOpen={openRef} sym={sym} />
          )}
        </ScrollView>
      )}

      {mainTotal ? (
        <Pressable onPress={allTotals.length > 2 ? () => setPick('totals') : undefined} accessibilityLabel={(mainTotal as { label: string; value: string }).label + ' ' + (mainTotal as { label: string; value: string }).value}>
          <TotalBar label={(mainTotal as { label: string; value: string }).label} value={(mainTotal as { label: string; value: string }).value} others={allTotals} />
        </Pressable>
      ) : null}

      {/* More: what used to be buttons above the table */}
      <Sheet visible={pick === 'more'} title="More" onClose={() => setPick(null)}>
        {rowFilterOptions.length > 1 && asList ? (
          <MoreRow icon="filter" label="Filter" sub={rowFilterOptions.find((x) => x.v === rowFilter)?.l} onPress={() => { setPick(null); setTimeout(() => setPick('rows'), 250); }} />
        ) : null}
        {sortable ? (
          <MoreRow icon="up" label="Sort by" sub={sort ? result.cols[sort.i].h + (sort.dir === 'asc' ? ', smallest first' : ', largest first') : 'As the report lists them'} onPress={() => { setPick(null); setTimeout(() => setPick('sort'), 250); }} />
        ) : null}
        {raw && raw.cols.length > 2 && !richDetail ? (
          <MoreRow icon="doc" label="Columns" sub={colChoice ? (result.cols.length - 1) + ' of ' + (raw.cols.length - 1) + ' shown' : undefined} onPress={() => { setPick(null); setTimeout(openColumns, 250); }} />
        ) : null}
        <MoreRow icon="chart" label="Export to Excel" onPress={() => { setPick(null); setTimeout(() => chooseColumns('excel'), 250); }} />
        {DETAIL_VIEW[id] && !top ? (
          <MoreRow icon="doc" label="Detailed" sub="Every ledger under its group, with opening and closing" checked={detailed} onCheck={(v) => { setDetailed(v); setSort(null); }} />
        ) : null}
        <MoreRow icon="star" last label={isFav ? 'Remove from favourites' : 'Add to favourites'}
          onPress={() => { const cur = db.settings.favReports || []; setSetting({ favReports: isFav ? cur.filter((x) => x !== id) : [...cur, id] }); setPick(null); }} />
      </Sheet>

      {/* every total, when there are more than fit on the bar */}
      <Sheet visible={pick === 'totals'} title="Totals" subtitle={shortRange(span.from, span.to)} onClose={() => setPick(null)}>
        {[...(mainTotal ? [mainTotal as { label: string; value: string }] : []), ...allTotals].map((x, i, arr) => (
          <View key={x.label + i} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: i === arr.length - 1 ? 0 : 1, borderBottomColor: pal.row }}>
            <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 14, color: pal.muted }}>{x.label}</Text>
            <Text style={{ fontFamily: i === 0 ? fonts.uiBold : fonts.ui, fontSize: 14, color: pal.text, fontVariant: ['tabular-nums'] }}>{x.value}</Text>
          </View>
        ))}
      </Sheet>

      {/* the dropdowns' choices */}
      <Sheet
        visible={pick === 'rows' || pick === 'sort'}
        title={pick === 'sort' ? 'Sort by' : 'Filter'}
        icon={pick === 'sort' ? 'up' : 'filter'}
        onClose={() => setPick(null)}
      >
        {(pick === 'sort'
          ? [{ v: '-1', l: 'As the report lists them' }, ...result.cols.map((c, i) => ({ v: String(i), l: c.h }))]
          : rowFilterOptions
        ).map((o) => {
          const on = pick === 'sort' ? (sort ? String(sort.i) === o.v : o.v === '-1') : o.v === rowFilter;
          return (
            <Pressable
              key={o.v}
              onPress={() => {
                if (pick === 'sort') {
                  /* a second tap on the column in use turns it the other way round */
                  if (o.v === '-1') { setSort(null); setPick(null); } else if (on) tapHeader(Number(o.v)); else { tapHeader(Number(o.v)); setPick(null); }
                } else { setPick(null); setRowFilter(o.v as typeof rowFilter); }
              }}
              style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, borderBottomWidth: 1, borderBottomColor: pal.row }}
            >
              <Text style={{ flex: 1, fontFamily: on ? fonts.uiSemi : fonts.ui, fontSize: 15, color: pal.text }}>{o.l}</Text>
              {on && pick === 'sort' && sort ? <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: pal.muted, marginRight: 8 }}>{sort.dir === 'asc' ? 'smallest first' : 'largest first'}</Text> : null}
              {on ? <Icon name="check" size={17} color={pal.primary} /> : null}
            </Pressable>
          );
        })}
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

      {/* which columns this report shows, and in what order */}
      <Sheet
        visible={colsOpen}
        title="Columns"
        subtitle={raw ? 'Always first: ' + raw.cols[0].h : undefined}
        onClose={() => setColsOpen(false)}
        footer={(
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Button label="Reset" onPress={() => saveColumns(true)} /></View>
            <View style={{ flex: 1 }}><Button variant="pri" label="Save" onPress={() => saveColumns()} /></View>
          </View>
        )}
      >
        {draft.map((c, i) => (
          <View key={c.h} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 52, borderBottomWidth: i === draft.length - 1 ? 0 : 1, borderBottomColor: colors.line }}>
            <Pressable
              onPress={() => setDraft((d) => d.map((x, k) => (k === i ? { ...x, on: !x.on } : x)))}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: c.on }}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}
            >
              <View style={{ width: 22, height: 22, borderRadius: 4, borderWidth: 1.5, borderColor: c.on ? colors.ink : colors.lineHard, backgroundColor: c.on ? colors.ink : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {c.on ? <Icon name="check" size={14} color={colors.bg} /> : null}
              </View>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: c.on ? colors.ink : colors.faint }}>{c.h}</Text>
            </Pressable>
            <Pressable onPress={() => moveCol(i, -1)} disabled={i === 0} hitSlop={6} accessibilityLabel={'Move ' + c.h + ' up'} style={{ padding: 8, opacity: i === 0 ? 0.3 : 1 }}>
              <Icon name="up" size={18} color={colors.ink} />
            </Pressable>
            <Pressable onPress={() => moveCol(i, 1)} disabled={i === draft.length - 1} hitSlop={6} accessibilityLabel={'Move ' + c.h + ' down'} style={{ padding: 8, opacity: i === draft.length - 1 ? 0.3 : 1 }}>
              <Icon name="down" size={18} color={colors.ink} />
            </Pressable>
          </View>
        ))}
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
          <View style={{ backgroundColor: colors.sunk, borderRadius: 4, paddingHorizontal: 12, paddingVertical: editingName ? 8 : 12, marginBottom: 6 }}>
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
            <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 14, color: colors.ink }}>{c.h}</Text>
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
            <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 14, color: colors.ink }}>Totals</Text>
            <Checkbox on={showTotals} size={22} onPress={() => setShowTotals((v) => !v)} />
          </Pressable>
        ) : null}
        {db && hasItemDetails(db, result, span) ? (
          <Pressable
            onPress={() => setShowItems((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: showItems }}
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: colors.line }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.ui, fontSize: 14, color: colors.ink }}>Item details</Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 2 }}>The items on each sale, bill or quotation, under its line</Text>
            </View>
            <Checkbox on={showItems} size={22} onPress={() => setShowItems((v) => !v)} />
          </Pressable>
        ) : null}
        {ask === 'pdf' || ask === 'preview' || ask === 'whatsapp' ? (
          <Pressable
            onPress={() => setShowGenerated((v) => !v)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: showGenerated }}
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 15 }}
          >
            <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 14, color: colors.ink }}>Date &amp; Time</Text>
            <Checkbox on={showGenerated} size={22} onPress={() => setShowGenerated((v) => !v)} />
          </Pressable>
        ) : null}
      </Sheet>
    </View>
  );
}

/**
 * A financial statement: each section under its heading, its ledgers as lines
 * that open their postings, and a bold total with a rule above it at the end
 * of each. No colour: the bottom line is on the totals bar at the foot.
 */
function Statement({ result, refs, onOpen, sym }: { result: ReportResult; refs?: (RowRef | null)[]; onOpen: (r: RowRef | null | undefined) => void; sym: string }) {
  const pal = useReportPalette();
  const kinds = result.rowKinds || [];
  // the amount columns are everything after the label; a section column (the balance sheet's) is skipped
  const labelAt = result.cols.length > 2 && result.cols[0].h === 'Section' ? 1 : 0;
  const amountCols = result.cols.map((c, i) => i).filter((i) => i > labelAt);
  const many = amountCols.length > 1;
  return (
    <View style={{ backgroundColor: pal.card, borderTopWidth: 1, borderBottomWidth: 1, borderColor: pal.section }}>
      {result.rows.map((row, i) => {
        const kind = kinds[i] || 'line';
        const ref = refs?.[i] || null;
        if (kind === 'head') {
          return (
            <Text key={i} style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6, fontFamily: fonts.uiSemi, fontSize: 12, letterSpacing: 0.7, textTransform: 'uppercase', color: pal.text }}>
              {cellText(row[labelAt])}
            </Text>
          );
        }
        const sub = kind === 'sub' || kind === 'total';
        const vals = amountCols.map((c) => plainCell(row[c] ?? '', true, sym));
        const zero = !sub && vals.every((v) => v === '—');
        const ink = zero ? pal.faint : pal.text;
        const body = (
          <View style={{ minHeight: 48, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: sub ? pal.section : pal.row }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={2} style={{ fontFamily: sub ? fonts.uiBold : fonts.ui, fontSize: 15, lineHeight: 20, color: ink }}>{cellText(row[labelAt])}</Text>
              {many ? (
                <Text numberOfLines={2} style={{ fontFamily: fonts.ui, fontSize: 12, color: zero ? pal.faint : pal.muted, marginTop: 2, fontVariant: ['tabular-nums'] }}>
                  {amountCols.slice(0, -1).map((c, k) => result.cols[c].h + ' ' + vals[k]).join(' · ')}
                </Text>
              ) : null}
            </View>
            <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: sub ? fonts.uiBold : fonts.uiSemi, fontSize: 15, color: ink, fontVariant: ['tabular-nums'] }}>{vals[vals.length - 1]}</Text>
              {many ? <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: pal.faint, marginTop: 1 }}>{result.cols[amountCols[amountCols.length - 1]].h}</Text> : null}
            </View>
            {ref ? <Icon name="chev" size={14} color={pal.faint} /> : <View style={{ width: 14 }} />}
          </View>
        );
        return ref
          ? <Pressable key={i} onPress={() => onOpen(ref)} style={({ pressed }) => ({ backgroundColor: pressed ? pal.open : pal.card })}>{body}</Pressable>
          : <View key={i}>{body}</View>;
      })}
      {result.note ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: pal.faint, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: pal.row }}>{result.note}</Text> : null}
    </View>
  );
}
