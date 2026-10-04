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
import { FilterChips, EmptyBlock, StickyBar, ActionGrid } from '../components/ui';
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


  if (!db || !pt) return null;

  const balance = partyBalance(pt.id);
  const owes = balance > 0.01;
  const credit = balance < -0.01;

  const date = (ts: string) => new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
  const contact = [pt.type === 'customer' ? 'Customer' : 'Supplier', pt.phone, pt.address].filter(Boolean).join(' · ');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.kind + r.id}
        contentContainerStyle={{ paddingBottom: 120, flexGrow: 1 }}
        ListHeaderComponent={
          <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
            {/* the name is the title; here only what the title cannot say */}
            <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint }}>{contact}</Text>

            <View style={{ paddingVertical: 18, gap: 2 }}>
              <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint }}>
                {owes ? 'Owes you' : credit ? (pt.type === 'supplier' ? 'You owe' : 'In credit') : 'Settled up'}
              </Text>
              <Text style={{ fontFamily: fonts.uiExtra, fontSize: 30, letterSpacing: -0.6, color: owes ? colors.danger : credit ? colors.good : colors.ink }}>
                {money(Math.abs(balance))}
              </Text>
              {pt.creditLimit > 0 ? (
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: balance > pt.creditLimit ? colors.danger : colors.faint }}>
                  Limit {money(pt.creditLimit)}{balance > pt.creditLimit ? ' · over' : ''}
                </Text>
              ) : null}
            </View>

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
            <View style={{ height: 8 }} />
          </View>
        }
        ListEmptyComponent={
          <EmptyBlock icon="doc" title="Nothing recorded yet" hint="Sales and payments will appear here." />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={item.open}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13,
              borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: pressed ? colors.sunk : 'transparent',
            })}
          >
            <Icon name={KIND_ICON[item.kind]} size={19} color={colors.soft} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{item.title}</Text>
              <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>{date(item.ts)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{money(item.amount)}</Text>
              {item.due && item.due > 0 ? (
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.danger }}>{money(item.due)} due</Text>
              ) : null}
            </View>
          </Pressable>
        )}
      />

      <StickyBar>
        <ActionGrid
          actions={[
            { label: 'Payment', icon: 'cash', tone: 'good', onPress: () => navigation.navigate('PaymentNew', { partyId: pt.id }) },
            { label: 'Ledger', icon: 'doc', tone: 'accent', onPress: () => navigation.navigate('PartyLedger', { partyId: pt.id }) },
            { label: pt.type === 'supplier' ? 'Purchase' : 'New sale', icon: 'cart', tone: 'accent', filled: true,
              onPress: () => (pt.type === 'supplier' ? navigation.navigate('PurchaseNew') : navigation.navigate('NewSale')) },
          ]}
        />
      </StickyBar>
    </View>
  );
}
