/**
 * Everything the shop has raised, in one feed.
 *
 * A shop does not think in separate ledgers — it thinks "what happened today".
 * Bills, receipts, quotations, delivery notes, returns and instalment plans all
 * land here in date order, filterable by kind, each with its own print, share
 * and more controls.
 */
import React, { useMemo, useState } from 'react';
import { View, FlatList, Pressable, Text } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import {
  Empty, Badge, StatGrid, Search, FilterChips, SectionLabel, FAB, TopTabs,
} from '../components/ui';
import { AppBar, IconBtn } from '../components/AppBar';
import { Icon, IconName } from '../components/icons';
import PartiesScreen from './PartiesScreen';
import { DocActions, useDocBuilder } from '../components/DocActions';
import type { DocMeta } from '../data/docPrint';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, any>;
type Kind = 'all' | 'sale' | 'payment' | 'quote' | 'note' | 'return' | 'plan';

interface Row {
  id: string;
  kind: Exclude<Kind, 'all'>;
  ts: string;
  title: string;
  sub: string;
  ref: string;
  amount: number;
  amountTone?: string;
  badge: { label: string; tone: 'good' | 'warn' | 'danger' | 'accent' | 'neutral' };
  dim?: boolean;
  phone?: string;
  open?: () => void;
  doc?: () => DocMeta;
}

const KIND_ICON: Record<Exclude<Kind, 'all'>, IconName> = {
  sale: 'receipt', payment: 'cash', quote: 'doc', note: 'swap', return: 'arrow', plan: 'calendar',
};
const KIND_TONE: Record<Exclude<Kind, 'all'>, 'good' | 'warn' | 'danger' | 'accent'> = {
  sale: 'accent', payment: 'good', quote: 'accent', note: 'warn', return: 'danger', plan: 'warn',
};

export default function SalesListScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { db, money, party } = useAppData();
  const { saleDoc, paymentDoc } = useDocBuilder();

  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [tab, setTab] = useState<'txn' | 'parties'>('txn');

  const nameOf = (id: string | null | undefined) => (id ? party(id)?.name || 'Walk-in' : 'Walk-in');
  const phoneOf = (id: string | null | undefined) => (id ? party(id)?.phone : undefined);

  const rows = useMemo<Row[]>(() => {
    if (!db) return [];
    const out: Row[] = [];

    db.sales.forEach((s) => {
      const void_ = s.status === 'void';
      out.push({
        id: s.id, kind: 'sale', ts: s.ts,
        title: nameOf(s.partyId),
        sub: s.lines.length + ' item' + (s.lines.length === 1 ? '' : 's') + ' · ' + s.method,
        ref: s.no,
        amount: s.total,
        dim: void_,
        badge: void_ ? { label: 'Void', tone: 'neutral' }
          : s.due <= 0.01 ? { label: 'Paid', tone: 'good' }
            : s.due < s.total ? { label: money(s.due) + ' due', tone: 'accent' }
              : { label: 'Unpaid', tone: 'danger' },
        phone: phoneOf(s.partyId),
        open: () => navigation.navigate('SaleDetail', { saleId: s.id }),
        doc: () => saleDoc(s),
      });
    });

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
        open: () => navigation.navigate('PaymentDetail', { paymentId: p.id }),
        doc: () => paymentDoc(p),
      });
    });

    (db.estimates || []).forEach((e) => {
      out.push({
        id: e.id, kind: 'quote', ts: e.ts,
        title: nameOf(e.partyId),
        sub: e.lines.length + ' item' + (e.lines.length === 1 ? '' : 's') + ' quoted',
        ref: e.no,
        amount: e.total,
        dim: e.status === 'void',
        badge: { label: e.status, tone: e.status === 'converted' ? 'good' : e.status === 'open' ? 'accent' : 'neutral' },
        open: () => navigation.navigate('Estimates'),
      });
    });

    (db.challans || []).forEach((c) => {
      out.push({
        id: c.id, kind: 'note', ts: c.ts,
        title: nameOf(c.partyId),
        sub: c.lines.length + ' item' + (c.lines.length === 1 ? '' : 's') + ' dispatched',
        ref: c.no,
        amount: 0,
        badge: { label: c.status, tone: c.status === 'delivered' ? 'good' : 'warn' },
        open: () => navigation.navigate('Challans'),
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
        badge: { label: 'Return', tone: 'danger' },
        open: () => navigation.navigate('CreditNotes'),
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
        badge: { label: done === pl.schedule.length ? 'Cleared' : 'Running', tone: done === pl.schedule.length ? 'good' : 'warn' },
        open: () => navigation.navigate('PlanDetail', { planId: pl.id }),
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
    return rows.filter((r) => {
      if (kind !== 'all' && r.kind !== kind) return false;
      if (!needle) return true;
      return r.ref.toLowerCase().includes(needle) || r.title.toLowerCase().includes(needle);
    });
  }, [rows, kind, q]);

  const sales = db?.sales || [];
  const totalSales = sales.reduce((sum, s) => sum + (s.status === 'void' ? 0 : s.total), 0);
  const balanceDue = sales.reduce((sum, s) => sum + Math.max(0, s.due), 0);
  const collected = (db?.payments || []).filter((p) => p.direction === 'in').reduce((s, p) => s + p.amount, 0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AppBar
        title="Sales"
        right={<IconBtn name="plus" size={22} color={colors.accent} onPress={() => navigation.navigate('NewSale')} />}
      />

      <TopTabs
        value={tab}
        onChange={setTab}
        options={[
          { v: 'txn', l: 'Transactions', i: 'receipt' },
          { v: 'parties', l: 'Party details', i: 'user' },
        ]}
      />

      {tab === 'parties' ? (
        <PartiesScreen navigation={navigation} route={{ key: 'p', name: 'Parties' } as any} />
      ) : (
        <FlatList
          data={list}
          keyExtractor={(r) => r.kind + r.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 96, flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={{ paddingTop: 14, gap: 14, marginBottom: 14 }}>
              <StatGrid
                items={[
                  { icon: 'receipt', label: 'Total sales', value: money(totalSales), tone: 'good' },
                  { icon: 'alert', label: 'Balance due', value: money(balanceDue), tone: balanceDue ? 'danger' : 'good' },
                  { icon: 'cash', label: 'Collected', value: money(collected), tone: 'accent' },
                  { icon: 'doc', label: 'Records', value: String(rows.length), tone: 'warn' },
                ]}
              />
              <Search value={q} onChange={setQ} placeholder="Search number or name" />
              <FilterChips
                value={kind}
                onChange={setKind}
                options={[
                  { v: 'all', l: 'All ' + rows.length },
                  { v: 'sale', l: 'Bills ' + (counts.sale || 0) },
                  { v: 'payment', l: 'Payments ' + (counts.payment || 0) },
                  { v: 'quote', l: 'Quotations ' + (counts.quote || 0) },
                  { v: 'plan', l: 'Instalments ' + (counts.plan || 0) },
                  { v: 'note', l: 'Delivery ' + (counts.note || 0) },
                  { v: 'return', l: 'Returns ' + (counts.return || 0) },
                ]}
              />
              {list.length ? (
                <SectionLabel right={<Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{list.length} shown</Text>}>
                  Newest first
                </SectionLabel>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <Empty
              title={q || kind !== 'all' ? 'Nothing matches' : 'No transactions yet'}
              subtitle={q || kind !== 'all' ? 'Try another search or filter.' : 'Bills, receipts and quotations will collect here.'}
              actionLabel="New sale"
              onAction={() => navigation.navigate('NewSale')}
            />
          }
          renderItem={({ item }) => {
            const tone = KIND_TONE[item.kind];
            const fg = tone === 'good' ? colors.good : tone === 'warn' ? colors.warn : tone === 'danger' ? colors.danger : colors.accent;
            const bg = tone === 'good' ? colors.goodSoft : tone === 'warn' ? colors.warnSoft : tone === 'danger' ? colors.dangerSoft : colors.accentSoft;
            return (
              <View
                style={{
                  backgroundColor: colors.surface, borderRadius: 16, paddingHorizontal: 15, paddingVertical: 14, marginBottom: 10,
                  shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2,
                  opacity: item.dim ? 0.6 : 1,
                }}
              >
                <Pressable onPress={item.open} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name={KIND_ICON[item.kind]} size={20} color={fg} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 15.5, color: colors.ink }}>{item.title}</Text>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>{item.sub}</Text>
                  </View>
                  {item.amount ? (
                    <Text style={{ fontFamily: fonts.uiExtra, fontSize: 17, color: item.amountTone || colors.ink }}>
                      {money(item.amount)}
                    </Text>
                  ) : null}
                </Pressable>

                <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 12 }} />

                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                  <Text style={{ fontFamily: fonts.monoSemi, fontSize: 12, color: colors.faint }}>{item.ref}</Text>
                  <Badge label={item.badge.label} tone={item.badge.tone} />
                  <View style={{ flex: 1 }} />
                  <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>
                    {new Date(item.ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}
                  </Text>
                </View>

                {item.doc ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
                    <View style={{ flex: 1 }} />
                    <DocActions doc={item.doc} phone={item.phone} compact />
                  </View>
                ) : null}
              </View>
            );
          }}
        />
      )}

      {tab === 'txn' ? (
        <FAB label="New sale" icon="plus" tone="accent" onPress={() => navigation.navigate('NewSale')} />
      ) : null}
    </View>
  );
}
