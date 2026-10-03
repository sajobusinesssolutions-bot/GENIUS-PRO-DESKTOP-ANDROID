/**
 * A customer or supplier as the shop deals with them: what they owe, what they
 * have bought, and every document between you. Each transaction carries its own
 * print / share / more controls, and the quick bar closes the common jobs.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, Linking } from 'react-native';
import { Pressable } from '../components/Press';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import {
  Panel, Badge, StatGrid, SectionLabel, FilterChips, EmptyBlock, StickyBar, ActionGrid, DetailRow,
} from '../components/ui';
import { Icon, IconName } from '../components/icons';
import { IconBtn } from '../components/AppBar';
import { DocActions, useDocBuilder } from '../components/DocActions';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'PartyDetail'>;
type Kind = 'all' | 'sale' | 'purchase' | 'payment';

interface Row {
  id: string;
  kind: Exclude<Kind, 'all'>;
  ts: string;
  title: string;
  sub: string;
  amount: number;
  /** Positive increases what they owe you. */
  signed: number;
  due?: number;
  open: () => void;
  doc: () => ReturnType<ReturnType<typeof useDocBuilder>['saleDoc']>;
}

const KIND_ICON: Record<Exclude<Kind, 'all'>, IconName> = {
  sale: 'receipt', purchase: 'cart', payment: 'cash',
};

export default function PartyDetailScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const { db, money, party, partyBalance } = useAppData();
  const { saleDoc, purchaseDoc, paymentDoc } = useDocBuilder();

  const id = route.params.partyId;
  const pt = id ? party(id) : undefined;
  const [kind, setKind] = useState<Kind>('all');

  useEffect(() => {
    navigation.setOptions({
      title: pt?.name || 'Party',
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {pt?.phone ? (
            <IconBtn name="phone" size={20} color={colors.good} onPress={() => Linking.openURL('tel:' + pt.phone)} />
          ) : null}
          <IconBtn name="pencil" size={20} color={colors.accent} onPress={() => navigation.navigate('PartyEdit', { partyId: id })} />
        </View>
      ),
    });
  }, [navigation, pt?.name, pt?.phone, id, colors]);

  const rows = useMemo<Row[]>(() => {
    if (!db || !pt) return [];
    const out: Row[] = [];

    db.sales.forEach((s) => {
      if (s.partyId !== pt.id) return;
      out.push({
        id: s.id, kind: 'sale', ts: s.ts,
        title: s.no,
        sub: s.lines.length + ' item' + (s.lines.length === 1 ? '' : 's') + ' · ' + s.method
          + (s.status === 'void' ? ' · voided' : ''),
        amount: s.total,
        signed: s.status === 'void' ? 0 : s.due,
        due: s.due,
        open: () => navigation.navigate('SaleDetail', { saleId: s.id }),
        doc: () => saleDoc(s),
      });
    });

    db.purchases.forEach((x) => {
      if (x.partyId !== pt.id) return;
      out.push({
        id: x.id, kind: 'purchase', ts: x.ts,
        title: x.no,
        sub: x.lines.length + ' line' + (x.lines.length === 1 ? '' : 's') + ' · ' + x.method,
        amount: x.total,
        signed: -x.due,
        due: x.due,
        open: () => navigation.navigate('PurchaseDetail', { purchaseId: x.id }),
        doc: () => purchaseDoc(x),
      });
    });

    db.payments.forEach((p) => {
      if (p.partyId !== pt.id) return;
      out.push({
        id: p.id, kind: 'payment', ts: p.ts,
        title: p.direction === 'in' ? 'Receipt' : 'Payment',
        sub: p.note || (p.direction === 'in' ? 'Money received' : 'Money paid out'),
        amount: p.amount,
        signed: p.direction === 'in' ? -p.amount : p.amount,
        open: () => navigation.navigate('PaymentDetail', { paymentId: p.id }),
        doc: () => paymentDoc(p),
      });
    });

    out.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
    return kind === 'all' ? out : out.filter((r) => r.kind === kind);
  }, [db, pt, kind, navigation, saleDoc, purchaseDoc, paymentDoc]);

  const stats = useMemo(() => {
    if (!db || !pt) return { bought: 0, paid: 0, docs: 0, overdue: 0 };
    const sales = db.sales.filter((s) => s.partyId === pt.id && s.status !== 'void');
    const pays = db.payments.filter((p) => p.partyId === pt.id && p.direction === 'in');
    return {
      bought: sales.reduce((s, x) => s + x.total, 0),
      paid: pays.reduce((s, x) => s + x.amount, 0),
      docs: sales.length,
      overdue: sales.reduce((s, x) => s + Math.max(0, x.due), 0),
    };
  }, [db, pt]);

  if (!db || !pt) return null;

  const balance = partyBalance(pt.id);
  const owes = balance > 0.01;
  const credit = balance < -0.01;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.kind + r.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 190, flexGrow: 1 }}
        ListHeaderComponent={
          <View style={{ paddingTop: 14, marginBottom: 14 }}>
            <Panel>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
                <View style={{
                  width: 56, height: 56, borderRadius: 28,
                  backgroundColor: pt.type === 'customer' ? colors.accentSoft : colors.warnSoft,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 20, color: pt.type === 'customer' ? colors.accent : colors.warn }}>
                    {pt.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink }}>{pt.name}</Text>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                    {pt.phone || 'No phone'}{pt.address ? ' · ' + pt.address : ''}
                  </Text>
                </View>
                <Badge label={pt.type === 'customer' ? 'Customer' : 'Supplier'} tone={pt.type === 'customer' ? 'accent' : 'warn'} />
              </View>

              <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 14 }} />

              <View style={{ alignItems: 'center', gap: 4 }}>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
                  {owes ? 'Owes you' : credit ? 'In credit' : 'Settled up'}
                </Text>
                <Text style={{ fontFamily: fonts.uiExtra, fontSize: 32, letterSpacing: -0.8, color: owes ? colors.danger : credit ? colors.good : colors.ink }}>
                  {money(Math.abs(balance))}
                </Text>
                {pt.creditLimit > 0 ? (
                  <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>
                    Credit limit {money(pt.creditLimit)}
                    {balance > pt.creditLimit ? ' · over the limit' : ''}
                  </Text>
                ) : null}
              </View>
            </Panel>

            <View style={{ height: 16 }} />
            <StatGrid
              items={[
                { icon: 'receipt', label: 'Bought all time', value: money(stats.bought), tone: 'accent' },
                { icon: 'cash', label: 'Paid you', value: money(stats.paid), tone: 'good' },
                { icon: 'doc', label: 'Documents', value: String(stats.docs), tone: 'warn' },
                { icon: 'alert', label: 'Unpaid', value: money(stats.overdue), tone: stats.overdue ? 'danger' : 'good' },
              ]}
            />

            <View style={{ height: 20 }} />
            <SectionLabel right={<Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{rows.length} shown</Text>}>
              Transactions
            </SectionLabel>
            <View style={{ marginBottom: 12 }}>
              <FilterChips
                value={kind}
                onChange={setKind}
                options={[
                  { v: 'all', l: 'All' },
                  { v: 'sale', l: 'Sales' },
                  { v: 'purchase', l: 'Purchases' },
                  { v: 'payment', l: 'Payments' },
                ]}
              />
            </View>
          </View>
        }
        ListEmptyComponent={
          <Panel>
            <EmptyBlock icon="doc" title="Nothing recorded yet" hint="Sales and payments for this contact will appear here." />
          </Panel>
        }
        renderItem={({ item }) => {
          const tone = item.kind === 'sale' ? 'accent' : item.kind === 'purchase' ? 'warn' : 'good';
          const fg = tone === 'accent' ? colors.accent : tone === 'warn' ? colors.warn : colors.good;
          const bg = tone === 'accent' ? colors.accentSoft : tone === 'warn' ? colors.warnSoft : colors.goodSoft;
          return (
            <View
              style={{
                backgroundColor: colors.surface, borderRadius: 16, paddingHorizontal: 15, paddingVertical: 14, marginBottom: 10,
                shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2,
              }}
            >
              <Pressable onPress={item.open} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={KIND_ICON[item.kind]} size={20} color={fg} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{item.title}</Text>
                  <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                    {item.sub}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 3 }}>
                  <Text style={{ fontFamily: fonts.uiExtra, fontSize: 15, color: colors.ink }}>{money(item.amount)}</Text>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
                    {new Date(item.ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}
                  </Text>
                </View>
              </Pressable>

              <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 12 }} />

              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {item.due && item.due > 0 ? (
                  <Badge label={money(item.due) + ' due'} tone="danger" />
                ) : (
                  <Badge label="Settled" tone="good" />
                )}
                <View style={{ flex: 1 }} />
                <DocActions doc={item.doc} phone={pt.phone} compact />
              </View>
            </View>
          );
        }}
      />

      <StickyBar>
        <ActionGrid
          actions={[
            { label: 'Record payment', icon: 'cash', tone: 'good', onPress: () => navigation.navigate('PaymentNew', { partyId: pt.id }) },
            { label: 'Ledger', icon: 'doc', tone: 'accent', onPress: () => navigation.navigate('PartyLedger', { partyId: pt.id }) },
            { label: 'New sale', icon: 'cart', tone: 'accent', filled: true, onPress: () => navigation.navigate('NewSale') },
            { label: 'Edit', icon: 'pencil', tone: 'warn', onPress: () => navigation.navigate('PartyEdit', { partyId: pt.id }) },
          ]}
        />
      </StickyBar>
    </View>
  );
}
