/**
 * Everything the shop has raised, in one feed (redesign 2a).
 *
 *  - One totals strip (Sales · Collected · Due) in place of four stat cards.
 *  - Search + one date/filter control, then type chips with counts.
 *  - One plain list, newest first; each row carries its own date.
 *  - Every row has a ⋮ button that opens one actions sheet:
 *      Convert to sale (open quotes) · Receive payment (bills with money due)
 *      Print / Share / WhatsApp (DocActions) · Edit · Payment history (bills)
 *      Delete — kept apart, in red, with a confirm step.
 *  - Transactions / Parties switch sits in the header.
 */
import React, { useMemo, useState } from 'react';
import { View, FlatList, Text, RefreshControl } from 'react-native';
import { requestSync } from '../data/SyncKeeper';
import { Pressable } from '../components/Press';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { canFor } from '../data/perms';
import { Empty, Search, FAB, Button, SelectField, useHideOnScroll, FAB_COLORS } from '../components/ui';
import { AppBar } from '../components/AppBar';
import { Icon, IconName } from '../components/icons';
import { Sheet } from '../components/Sheet';
import SendSheet from '../components/SendSheet';
import { docMessage } from '../data/messages';
import { useToast } from '../components/Toast';
import PartiesScreen from './PartiesScreen';
import { DocActions, useDocBuilder } from '../components/DocActions';
import type { DocMeta } from '../data/docPrint';
import { DocRow, SummaryTiles } from '../components/DocList';
import { printDoc, shareDoc } from '../data/docPrint';
import { printOptsFor, docKindOf, shareOptsFor } from '../data/printSetup';
import type { PayMethod } from '../data/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';
import { listRange, inRange } from '../data/helpers';
import SegmentSlider from '../components/SegmentSlider';
import DateTimePicker from '@react-native-community/datetimepicker';

type Props = NativeStackScreenProps<RootStackParamList, any>;
type Kind = 'all' | 'sale' | 'purchase' | 'order' | 'payment' | 'quote' | 'note' | 'return' | 'plan';
type Tone = 'good' | 'warn' | 'danger' | 'accent' | 'neutral';
const day = (n: number) => new Date(n).toISOString().slice(0, 10);

interface Row {
  id: string;
  kind: Exclude<Kind, 'all'>;
  ts: string;
  title: string;
  sub: string;
  ref: string;
  amount: number;
  amountTone?: string;
  badge: { label: string; tone: Tone };
  userId?: string;
  partyId?: string | null;
  status?: string;
  dim?: boolean;
  phone?: string;
  due?: number;
  open?: () => void;
  edit?: () => void;
  doc?: () => DocMeta;
  convert?: () => void;
  duplicate?: () => void;
  /** What settling the balance is called and where it goes. */
  settle?: { label: string; run: () => void };
  remove?: { label: string; text: string; run: () => void };
}

const KIND_ICON: Record<Exclude<Kind, 'all'>, IconName> = {
  sale: 'receipt', purchase: 'cart', order: 'box', payment: 'cash', quote: 'doc', note: 'swap', return: 'arrow', plan: 'calendar',
};
/** The short word on a row's pill: "BILL · PAID". */
const KIND_WORD: Record<Exclude<Kind, 'all'>, string> = {
  sale: 'Sale', purchase: 'Bill', order: 'PO', payment: 'Payment', quote: 'Quote', note: 'Delivery', return: 'Return', plan: 'Plan',
};
const KIND_TONE: Record<Exclude<Kind, 'all'>, Exclude<Tone, 'neutral'>> = {
  sale: 'accent', purchase: 'warn', order: 'accent', payment: 'good', quote: 'accent', note: 'warn', return: 'danger', plan: 'warn',
};
const KINDS: [Kind, string][] = [
  ['all', 'All'], ['sale', 'Sales'], ['purchase', 'Bills'], ['order', 'Orders'], ['payment', 'Payments'], ['quote', 'Quotes'],
  ['note', 'Delivery'], ['return', 'Returns'], ['plan', 'Plans'],
];

function dayLabel(ts: string) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((t.getTime() - d.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
}

export default function SalesListScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { db, money, party, deleteSale, deletePayment, deletePurchase, convertEstimate, canEditSale, can } = useAppData();
  const { saleDoc, paymentDoc, purchaseDoc } = useDocBuilder();
  /** A document being sent as a message, and to whom. */
  const [sending, setSending] = useState<{ doc: DocMeta; phone?: string; email?: string } | null>(null);
  const { success, error } = useToast();

  /** Print or share a row's document straight from the list, with the same printer and template rules as its own screen. */
  async function quickDoc(r: Row, what: 'print' | 'share') {
    if (!r.doc) return;
    try {
      const d = r.doc();
      const opts = printOptsFor(db, d.docKind || docKindOf(d.kind));
      if (what === 'print') await printDoc(d, money, opts);
      else if (!(await shareDoc(d, money, shareOptsFor(db, d.docKind || docKindOf(d.kind))))) error('Sharing is not available on this phone.');
    } catch (e: any) {
      error(e?.message || 'That could not be ' + (what === 'print' ? 'printed' : 'shared') + '.');
    }
  }

  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [tab, setTab] = useState<'txn' | 'parties'>('txn');
  const initialRange = listRange('month');
  const [from, setFrom] = useState(day(initialRange.from));
  const [to, setTo] = useState(day(initialRange.to));
  const [userFilter, setUserFilter] = useState('all');
  const [partyFilter, setPartyFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [period, setPeriod] = useState('month');
  const [refreshing, setRefreshing] = useState(false);
  const fab = useHideOnScroll();
  async function refresh() {
    setRefreshing(true);
    try { await requestSync(true); } finally { setRefreshing(false); }
  }
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [datePick, setDatePick] = useState<'from' | 'to' | null>(null);
  const [menu, setMenu] = useState<Row | null>(null);
  const [confirm, setConfirm] = useState(false);

  const tone = (t: Tone) => {
    if (t === 'good') return { fg: colors.good, bg: colors.goodSoft };
    if (t === 'warn') return { fg: colors.warn, bg: colors.warnSoft };
    if (t === 'danger') return { fg: colors.danger, bg: colors.dangerSoft };
    if (t === 'accent') return { fg: colors.accent, bg: colors.accentSoft };
    return { fg: colors.faint, bg: colors.sunk };
  };

  const nameOf = (id: string | null | undefined) => (id ? party(id)?.name || 'Walk-in' : 'Walk-in');
  const phoneOf = (id: string | null | undefined) => (id ? party(id)?.phone : undefined);

  const rows = useMemo<Row[]>(() => {
    if (!db) return [];
    const out: Row[] = [];

    // Without "See other staff's sales", a person sees the sales they made.
    const mineOnly = !canFor(db.session.role, 'sales.view_all');
    db.sales.forEach((s) => {
      if (mineOnly && s.userId !== db.session.userId) return;
      const void_ = s.status === 'void';
      out.push({
        id: s.id, kind: 'sale', ts: s.ts,
        title: nameOf(s.partyId),
        sub: s.lines.length + ' item' + (s.lines.length === 1 ? '' : 's') + ' · ' + s.method,
        ref: s.no,
        amount: s.total,
        dim: void_,
        due: void_ ? 0 : s.due,
        badge: void_ ? { label: 'Void', tone: 'neutral' }
          : s.due <= 0.01 ? { label: 'Paid', tone: 'good' }
            : s.due < s.total ? { label: 'Part paid', tone: 'accent' }
              : { label: 'Unpaid', tone: 'danger' },
        phone: phoneOf(s.partyId),
        userId: s.userId, partyId: s.partyId, status: void_ ? 'void' : s.due <= 0.01 ? 'paid' : s.paid > 0 ? 'partial' : 'unpaid',
        open: () => navigation.navigate('SaleDetail', { saleId: s.id }),
        edit: void_ ? undefined : () => {
          const ok = canEditSale(s.id);
          if (!ok.ok) { error(ok.why || 'This sale can no longer be edited.'); return; }
          navigation.navigate('EditSale', { saleId: s.id });
        },
        doc: () => saleDoc(s),
        duplicate: can('sales.create') ? () => navigation.navigate('NewSale', { copyFromId: s.id }) : undefined,
        settle: !void_ && s.due > 0.01 ? { label: 'Receive payment', run: () => navigation.navigate('PaymentNew', { direction: 'in', partyId: s.partyId || undefined }) } : undefined,
        remove: can('sales.delete') && !void_ ? {
          label: 'Delete sale',
          text: 'The sale will be reversed and stay in the audit trail.',
          run: () => { if (deleteSale(s.id, 'Deleted from sales overview')) success(s.no + ' deleted'); },
        } : undefined,
      });
    });

    // what was bought sits beside what was sold, for those allowed to see it
    if (can('purchases.view')) {
      db.purchases.forEach((pu) => {
        const void_ = pu.status === 'void';
        out.push({
          id: pu.id, kind: 'purchase', ts: pu.ts,
          title: pu.partyId ? party(pu.partyId)?.name || 'Supplier' : 'No supplier',
          sub: pu.lines.length + ' item' + (pu.lines.length === 1 ? '' : 's') + ' bought · ' + pu.method,
          ref: pu.ref || pu.no,
          amount: pu.total,
          amountTone: colors.danger,
          dim: void_,
          badge: void_ ? { label: 'Void', tone: 'neutral' }
            : pu.due <= 0.01 ? { label: 'Paid', tone: 'good' }
              : { label: pu.paid > 0 ? 'Part paid' : 'Unpaid', tone: 'warn' },
          userId: pu.userId, partyId: pu.partyId,
          status: void_ ? 'void' : pu.due <= 0.01 ? 'paid' : pu.paid > 0 ? 'partial' : 'unpaid',
          phone: phoneOf(pu.partyId),
          open: () => navigation.navigate('PurchaseDetail', { purchaseId: pu.id }),
          doc: () => purchaseDoc(pu),
          due: void_ ? 0 : pu.due,
          duplicate: can('purchases.create') ? () => navigation.navigate('PurchaseNew', { copyFromId: pu.id }) : undefined,
          settle: !void_ && pu.due > 0.01 ? { label: 'Pay this bill', run: () => navigation.navigate('PaymentNew', { direction: 'out', partyId: pu.partyId || undefined }) } : undefined,
          edit: void_ || !can('purchases.edit') ? undefined : () => navigation.navigate('PurchaseNew', { editPurchaseId: pu.id }),
          remove: can('purchases.delete') && !void_ ? {
            label: 'Delete sale',
            text: 'The stock and money will be reversed and it stays in the audit trail.',
            run: () => { if (deletePurchase(pu.id, 'Deleted from transactions')) success(pu.no + ' deleted'); },
          } : undefined,
        });
      });
      (db.purchaseOrders || []).forEach((po) => {
        const total = po.lines.reduce((t: number, l: any) => t + (l.qty || 0) * (l.cost || 0), 0);
        out.push({
          id: po.id, kind: 'order', ts: po.ts,
          title: party(po.partyId)?.name || 'Supplier',
          sub: po.lines.length + ' item' + (po.lines.length === 1 ? '' : 's') + ' ordered',
          ref: po.no,
          amount: total,
          partyId: po.partyId,
          badge: { label: po.status === 'received' ? 'Received' : 'Open', tone: po.status === 'received' ? 'good' : 'accent' },
          open: () => navigation.navigate('PurchaseOrders'),
          edit: () => navigation.navigate('PurchaseOrders'),
        });
      });
    }

    db.payments.forEach((p) => {
      out.push({
        id: p.id, kind: 'payment', ts: p.ts,
        title: nameOf(p.partyId),
        sub: p.note || (p.direction === 'in' ? 'Money received' : 'Money paid out'),
        ref: p.direction === 'in' ? 'Receipt' : 'Payment',
        amount: p.amount,
        amountTone: p.direction === 'in' ? colors.good : colors.danger,
        badge: { label: p.direction === 'in' ? 'Received' : 'Paid out', tone: p.direction === 'in' ? 'good' : 'danger' },
        phone: phoneOf(p.partyId),
        partyId: p.partyId,
        open: () => navigation.navigate('PaymentDetail', { paymentId: p.id }),
        edit: () => navigation.navigate('PaymentDetail', { paymentId: p.id }),
        doc: () => paymentDoc(p),
        remove: can('finance.delete') ? {
          label: 'Delete payment',
          text: 'The payment will be reversed and stay in the audit trail.',
          run: () => { if (deletePayment(p.id, 'Deleted from sales overview')) success('Payment deleted'); },
        } : undefined,
      });
    });

    (db.estimates || []).forEach((e) => {
      const open = e.status === 'open';
      out.push({
        id: e.id, kind: 'quote', ts: e.ts,
        title: nameOf(e.partyId),
        sub: e.lines.length + ' item' + (e.lines.length === 1 ? '' : 's') + ' quoted',
        ref: e.no,
        amount: e.total,
        dim: e.status === 'void',
        partyId: e.partyId,
        phone: phoneOf(e.partyId),
        badge: { label: e.status, tone: e.status === 'converted' ? 'good' : open ? 'accent' : 'neutral' },
        open: () => navigation.navigate('Estimates'),
        // a quotation prints and sends like a sale, under its own name
        doc: () => saleDoc({
          ...(e as any), gross: e.lines.reduce((a, l) => a + l.qty * l.price, 0) , tax: 0, additionalCharges: 0,
          paid: 0, due: 0, method: 'cash', userId: db.session.userId,
        } as any, 'Quotation'),
        edit: open ? () => navigation.navigate('Estimates') : undefined,
        convert: open && can('sales.create') ? () => {
          const sale = convertEstimate(e.id, (db.settings.defaultMethod as PayMethod) || 'cash');
          if (!sale) { error('This quotation could not be converted.'); return; }
          success(e.no + ' converted to ' + sale.no);
          navigation.navigate('SaleDetail', { saleId: sale.id });
        } : undefined,
      });
    });

    (db.challans || []).forEach((c) => {
      out.push({
        id: c.id, kind: 'note', ts: c.ts,
        title: nameOf(c.partyId),
        sub: c.lines.length + ' item' + (c.lines.length === 1 ? '' : 's') + ' dispatched',
        ref: c.no,
        amount: 0,
        partyId: c.partyId,
        badge: { label: c.status, tone: c.status === 'delivered' ? 'good' : 'warn' },
        open: () => navigation.navigate('Challans'),
        edit: () => navigation.navigate('Challans'),
      });
    });

    (db.creditNotes || []).forEach((c) => {
      out.push({
        id: c.id, kind: 'return', ts: c.ts,
        title: nameOf(c.partyId),
        sub: c.reason || 'Goods returned',
        ref: c.no,
        amount: c.total,
        amountTone: colors.danger,
        partyId: c.partyId,
        badge: { label: 'Return', tone: 'danger' },
        open: () => navigation.navigate('CreditNotes'),
        edit: () => navigation.navigate('CreditNotes'),
      });
    });

    (db.instalmentPlans || []).forEach((pl) => {
      const done = pl.schedule.filter((x) => x.paidAt).length;
      out.push({
        id: pl.id, kind: 'plan', ts: pl.createdAt,
        title: nameOf(pl.partyId),
        sub: done + ' of ' + pl.schedule.length + ' payments made',
        ref: pl.no,
        amount: pl.total,
        partyId: pl.partyId,
        badge: { label: done === pl.schedule.length ? 'Cleared' : 'Running', tone: done === pl.schedule.length ? 'good' : 'warn' },
        open: () => navigation.navigate('PlanDetail', { planId: pl.id }),
        edit: () => navigation.navigate('PlanDetail', { planId: pl.id }),
      });
    });

    out.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
    return out;
  }, [db, colors, navigation, saleDoc, paymentDoc]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    rows.forEach((r) => { c[r.kind] = (c[r.kind] || 0) + 1; });
    return c;
  }, [rows]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const range = { from: new Date(from + 'T00:00:00').getTime(), to: new Date(to + 'T23:59:59').getTime() };
    return rows.filter((r) => {
      if (!inRange(r.ts, range.from, range.to)) return false;
      if (kind !== 'all' && r.kind !== kind) return false;
      if (userFilter !== 'all' && r.userId !== userFilter) return false;
      if (partyFilter !== 'all' && r.partyId !== partyFilter) return false;
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!needle) return true;
      return r.ref.toLowerCase().includes(needle) || r.title.toLowerCase().includes(needle);
    });
  }, [rows, kind, q, from, to, userFilter, partyFilter, statusFilter]);

  /** One plain list — no day headings or day totals, which the owner found cluttering. */
  const items = useMemo(
    () => list.map((r, i) => ({ type: 'row' as const, key: r.kind + r.id, row: r, first: i === 0, last: i === list.length - 1 })),
    [list],
  );

  const PERIOD_LABEL: Record<string, string> = {
    today: 'Today', week: 'Last 7 days', month: 'Last 30 days', quarter: 'Last 90 days', year: 'This year', all: 'All time',
  };
  function pickPeriod(p: string) {
    setPeriod(p);
    if (p === 'custom') return;
    const r = listRange(p);
    setFrom(day(r.from)); setTo(day(r.to));
  }
  const periodLabel = period === 'custom'
    ? new Date(from).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' – ' + new Date(to).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
    : PERIOD_LABEL[period] || 'Last 30 days';

  const STATUS_LABEL: Record<string, string> = { paid: 'Paid', partial: 'Part paid', unpaid: 'Unpaid', void: 'Void' };
  const userName = (id: string) => db?.users.find((u) => u.id === id)?.name || 'Staff';
  /** What is narrowing the list, each with a way to drop it. */
  const active: { key: string; label: string; clear: () => void }[] = [
    ...(kind !== 'all' ? [{ key: 'k', label: KINDS.find((k) => k[0] === kind)?.[1] || kind, clear: () => setKind('all') }] : []),
    ...(statusFilter !== 'all' ? [{ key: 's', label: STATUS_LABEL[statusFilter] || statusFilter, clear: () => setStatusFilter('all') }] : []),
    ...(userFilter !== 'all' ? [{ key: 'u', label: userName(userFilter), clear: () => setUserFilter('all') }] : []),
    ...(partyFilter !== 'all' ? [{ key: 'p', label: nameOf(partyFilter), clear: () => setPartyFilter('all') }] : []),
  ];
  function resetFilters() {
    setKind('all'); setStatusFilter('all'); setUserFilter('all'); setPartyFilter('all'); pickPeriod('month');
  }

  // the two figures follow the dates chosen, so they answer "how did this period go"
  const range = { from: new Date(from + 'T00:00:00').getTime(), to: new Date(to + 'T23:59:59').getTime() };
  const sales = (db?.sales || []).filter((s) => s.status !== 'void' && inRange(s.ts, range.from, range.to));
  const totalSales = sales.reduce((sum, s) => sum + s.total, 0);
  const balanceDue = sales.reduce((sum, s) => sum + Math.max(0, s.due), 0);

  const openMenu = (r: Row) => { setConfirm(false); setMenu(r); };
  const closeMenu = () => { setMenu(null); setConfirm(false); };
  const after = (fn: () => void) => () => { closeMenu(); setTimeout(fn, 120); };

  const header = (
    <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 12 }}>
      {/* the period's takings and what is still owed on them */}
      <View style={{
        flexDirection: 'row', borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, overflow: 'hidden',
      }}>
        <View style={{ flex: 1, padding: 14, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="receipt" size={14} color={colors.accent} />
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint }}>Total sales</Text>
          </View>
          <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink }}>{money(totalSales)}</Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{sales.length} sale{sales.length === 1 ? '' : 's'} · {periodLabel}</Text>
        </View>
        <View style={{ width: 1, backgroundColor: colors.line, marginVertical: 12 }} />
        <View style={{ flex: 1, padding: 14, gap: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Icon name="alert" size={14} color={balanceDue ? colors.danger : colors.good} />
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint }}>Balance due</Text>
          </View>
          <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: balanceDue ? colors.danger : colors.good }}>{money(balanceDue)}</Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{balanceDue ? 'Still to collect' : 'All collected'}</Text>
        </View>
      </View>

      {/* search, and one button for every filter */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1 }}><Search value={q} onChange={setQ} placeholder="Search number or name" /></View>
        <Pressable
          onPress={() => setFiltersOpen(true)}
          accessibilityLabel="Filters"
          style={{
            width: 56, height: 56, marginTop: 6, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
            backgroundColor: active.length ? colors.accent : colors.surface, borderWidth: 1.4, borderColor: active.length ? colors.accent : colors.line,
          }}
        >
          <Icon name="filter" size={20} color={active.length ? colors.accentInk : colors.ink} />
          {active.length ? (
            <View style={{ position: 'absolute', top: -6, right: -6, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.bg }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 11, color: '#fff' }}>{active.length}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      {/* the period, then each active filter as a chip that clears with one tap */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
        <Pressable
          onPress={() => setFiltersOpen(true)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: colors.accentSoft }}
        >
          <Icon name="calendar" size={14} color={colors.accent} />
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.accent }}>{periodLabel}</Text>
          <Icon name="down" size={13} color={colors.accent} />
        </Pressable>
        {active.map((a) => (
          <Pressable
            key={a.key}
            onPress={a.clear}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}
          >
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink }}>{a.label}</Text>
            <Icon name="x" size={13} color={colors.faint} />
          </Pressable>
        ))}
        <Text style={{ alignSelf: 'center', marginLeft: 'auto', fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
          {list.length} result{list.length === 1 ? '' : 's'}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AppBar brand title="Activity" />
      <View style={{ paddingHorizontal: 16, paddingTop: 10, backgroundColor: colors.bg }}>
        <SegmentSlider
          value={tab}
          onChange={setTab}
          style={{ marginBottom: 0 }}
          options={[
            { v: 'txn', l: 'Transactions', i: 'receipt' },
            { v: 'parties', l: 'Parties', i: 'user' },
          ]}
        />
      </View>

      {tab === 'parties' ? (
        <PartiesScreen navigation={navigation} route={{ key: 'p', name: 'Parties' } as any} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(x) => x.key}
          contentContainerStyle={{ paddingBottom: 96, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          onScroll={fab.onScroll}
          scrollEventThrottle={64}
          ListHeaderComponent={header}
          // pull down: ask the cloud for what other phones recorded, now
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} colors={[colors.accent]} tintColor={colors.accent} />}
          ListEmptyComponent={
            <Empty
              title={q || kind !== 'all' ? 'Nothing matches' : 'No transactions yet'}
              subtitle={q || kind !== 'all' ? 'Try another search or filter.' : 'Sales, purchases, payments and quotations will collect here.'}
              actionLabel="New sale"
              onAction={() => navigation.navigate('NewSale')}
            />
          }
          renderItem={({ item }) => {
            const r = item.row;
            return (
              <View style={{ marginTop: item.first ? 12 : 0 }}>
                <TxnRow
                  r={r}
                  money={money}
                  tone={tone(r.badge.tone)}
                  onPrint={r.doc ? () => void quickDoc(r, 'print') : undefined}
                  onShare={r.doc ? () => void quickDoc(r, 'share') : undefined}
                  onMore={() => openMenu(r)}
                />
              </View>
            );
          }}
        />
      )}

      {/* every filter in one place */}
      <Sheet
        visible={filtersOpen}
        title="Filter transactions"
        icon="filter"
        full
        onClose={() => setFiltersOpen(false)}
        footer={
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}><Button label="Reset" onPress={resetFilters} /></View>
            <View style={{ flex: 2 }}><Button label={'Show ' + list.length + ' result' + (list.length === 1 ? '' : 's')} variant="pri" onPress={() => setFiltersOpen(false)} /></View>
          </View>
        }
      >
        <FilterGroup title="Date">
          {[...Object.keys(PERIOD_LABEL), 'custom'].map((p) => (
            <FilterChip key={p} label={p === 'custom' ? 'Custom' : PERIOD_LABEL[p]} on={period === p} onPress={() => pickPeriod(p)} />
          ))}
        </FilterGroup>
        {period === 'custom' ? (
          <View style={{ flexDirection: 'row', gap: 10, marginTop: -4, marginBottom: 14 }}>
            {(['from', 'to'] as const).map((w) => (
              <Pressable
                key={w}
                onPress={() => setDatePick(w)}
                style={{ flex: 1, height: 48, borderRadius: 12, borderWidth: 1.4, borderColor: colors.line, backgroundColor: colors.surface, paddingHorizontal: 12, justifyContent: 'center' }}
              >
                <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint }}>{w === 'from' ? 'From' : 'To'}</Text>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink }}>
                  {new Date(w === 'from' ? from : to).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {datePick ? (
          <DateTimePicker
            value={new Date(datePick === 'from' ? from : to)}
            mode="date"
            onDismiss={() => setDatePick(null)}
            onValueChange={(_e, d) => {
              const which = datePick;
              setDatePick(null);
              if (!d) return;
              if (which === 'from') setFrom(day(d.getTime())); else setTo(day(d.getTime()));
            }}
          />
        ) : null}

        <FilterGroup title="Type">
          {KINDS.map(([v, l]) => (
            <FilterChip key={v} label={l + ' ' + (v === 'all' ? rows.length : counts[v] || 0)} on={kind === v} onPress={() => setKind(v)} />
          ))}
        </FilterGroup>

        <FilterGroup title="Status">
          {(['all', 'paid', 'partial', 'unpaid', 'void'] as const).map((v) => (
            <FilterChip key={v} label={v === 'all' ? 'Any' : STATUS_LABEL[v]} on={statusFilter === v} onPress={() => setStatusFilter(v)} />
          ))}
        </FilterGroup>

        <SelectField
          label="Staff"
          value={userFilter}
          onChange={setUserFilter}
          options={[{ v: 'all', l: 'Everyone' }, ...(db?.users || []).map((u) => ({ v: u.id, l: u.name }))]}
        />
        <SelectField
          label="Customer or supplier"
          value={partyFilter}
          onChange={setPartyFilter}
          options={[{ v: 'all', l: 'Anyone' }, ...(db?.parties || []).filter((p) => p.active).map((p) => ({ v: p.id, l: p.name }))]}
        />
      </Sheet>

      {/* ⋮ actions sheet */}
      <Sheet
        visible={!!menu}
        title={menu ? KIND_WORD[menu.kind] + ' #' + menu.ref : ''}
        subtitle={menu ? menu.title + (menu.amount ? ' · ' + money(menu.amount) : '') : ''}
        onClose={closeMenu}
      >
        {menu && confirm && menu.remove ? (
          <View style={{ backgroundColor: colors.dangerSoft, borderRadius: 14, padding: 14 }}>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.danger }}>{menu.remove.label}?</Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.soft, marginTop: 4 }}>{menu.remove.text}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
              <View style={{ flex: 1 }}><Button label="Keep it" onPress={() => setConfirm(false)} /></View>
              <View style={{ flex: 1 }}><Button variant="dngr" label="Delete" onPress={() => { const run = menu.remove!.run; closeMenu(); run(); }} /></View>
            </View>
          </View>
        ) : menu ? (
          <View>
            {menu.edit ? <MenuRow title="Edit" onPress={after(menu.edit)} /> : null}
            {menu.duplicate ? <MenuRow title="Duplicate" onPress={after(menu.duplicate)} /> : null}
            {menu.doc ? <MenuRow title="Send as message" sub="WhatsApp, SMS, email…" onPress={after(() => { const doc = menu.doc!(); setSending({ doc, phone: menu.phone || doc.partyPhone, email: menu.partyId ? party(menu.partyId)?.email : undefined }); })} /> : null}
            {menu.doc ? <MenuRow title="Share as PDF" onPress={after(() => void quickDoc(menu, 'share'))} /> : null}
            {menu.doc ? <MenuRow title="Print" onPress={after(() => void quickDoc(menu, 'print'))} /> : null}
            {menu.settle ? <MenuRow title={menu.settle.label} sub={money(menu.due || 0) + ' still due'} onPress={after(menu.settle.run)} /> : null}
            {menu.convert ? <MenuRow title="Convert to sale" onPress={after(menu.convert)} /> : null}
            {menu.kind === 'sale' ? <MenuRow title="Payment history" onPress={after(menu.open!)} /> : null}
            {menu.open && menu.kind !== 'sale' ? <MenuRow title="Open" onPress={after(menu.open)} /> : null}
            {menu.remove ? <MenuRow title={menu.remove.label} danger onPress={() => setConfirm(true)} /> : null}
          </View>
        ) : null}
      </Sheet>

      <SendSheet
        visible={!!sending}
        onClose={() => setSending(null)}
        title={sending ? 'Send ' + sending.doc.kind.toLowerCase() + ' ' + sending.doc.no : 'Send'}
        to={sending?.doc.partyName}
        phone={sending?.phone}
        email={sending?.email}
        subject={sending ? sending.doc.kind + ' ' + sending.doc.no + ' from ' + sending.doc.firmName : undefined}
        text={sending ? docMessage(sending.doc, money) : ''}
      />

      {tab === 'txn' ? (
        <FAB label="New sale" icon="plus" color={FAB_COLORS.newSale} hidden={fab.hidden} onPress={() => navigation.navigate('NewSale')} />
      ) : null}
    </View>
  );
}

function MenuRow({ title, sub, onPress, danger }: { title: string; sub?: string; onPress: () => void; danger?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 4,
        borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: pressed ? colors.sunk : 'transparent',
      })}
    >
      <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 15, color: danger ? colors.danger : colors.ink }}>{title}</Text>
      {sub ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{sub}</Text> : null}
    </Pressable>
  );
}

/**
 * One transaction: who, what kind and how it stands on the left with its
 * total (and balance, when something is still owed); its number and when on
 * the right, over print, share and more.
 */
function TxnRow({ r, money, tone, onPrint, onShare, onMore }: {
  r: Row; money: (n: number) => string; tone: { fg: string; bg: string };
  onPrint?: () => void; onShare?: () => void; onMore: () => void;
}) {
  const { colors } = useTheme();
  const d = new Date(r.ts);
  const owing = (r.due || 0) > 0.01;
  const icon = (name: IconName, label: string, onPress: () => void) => (
    <Pressable
      key={label}
      onPress={onPress}
      hitSlop={4}
      accessibilityLabel={label}
      style={({ pressed }) => ({ width: 40, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.sunk : 'transparent' })}
    >
      <Icon name={name} size={20} color={colors.faint} />
    </Pressable>
  );
  return (
    <Pressable
      onPress={r.open}
      disabled={!r.open}
      style={({ pressed }) => ({
        flexDirection: 'row', gap: 10, marginHorizontal: 16, marginBottom: 10, borderRadius: 16,
        paddingTop: 13, paddingBottom: 10, paddingLeft: 15, paddingRight: 8,
        backgroundColor: pressed ? colors.sunk : colors.surface, borderWidth: 1, borderColor: colors.line, opacity: r.dim ? 0.55 : 1,
      })}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 15.5, color: colors.ink }}>{r.title}</Text>
        <View style={{ alignSelf: 'flex-start', marginTop: 6, paddingVertical: 3, paddingHorizontal: 10, borderRadius: 999, backgroundColor: tone.bg }}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 11.5, letterSpacing: 0.4, color: tone.fg }}>
            {(KIND_WORD[r.kind] + ' : ' + r.badge.label).toUpperCase()}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 22, marginTop: 10 }}>
          {r.amount ? (
            <View>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>Total</Text>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: r.amountTone || colors.ink, marginTop: 1 }}>{money(r.amount)}</Text>
            </View>
          ) : null}
          {owing ? (
            <View>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>Balance</Text>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.danger, marginTop: 1 }}>{money(r.due!)}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <View style={{ alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View style={{ alignItems: 'flex-end', paddingRight: 7 }}>
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.soft }}>#{r.ref}</Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 3 }}>
            {d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })} · {d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', marginTop: 8 }}>
          {onPrint ? icon('print', 'Print', onPrint) : null}
          {onShare ? icon('share', 'Share', onShare) : null}
          {icon('dots', 'More actions', onMore)}
        </View>
      </View>
    </Pressable>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ fontFamily: fonts.uiBold, fontSize: 12, letterSpacing: 0.6, color: colors.faint, textTransform: 'uppercase', marginBottom: 8 }}>{title}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>
    </View>
  );
}

function FilterChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        height: 38, paddingHorizontal: 14, borderRadius: 19, justifyContent: 'center',
        backgroundColor: on ? colors.accent : colors.surface, borderWidth: 1.2, borderColor: on ? colors.accent : colors.line,
      }}
    >
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: on ? colors.accentInk : colors.ink }}>{label}</Text>
    </Pressable>
  );
}
