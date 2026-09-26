import React from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useToast } from '../components/Toast';
import {
  Button, Card, Cap, KV, Pill, Banner,
  Panel, Badge, DetailRow, StatGrid, SectionLabel, InfoBanner, ActionGrid, StickyBar,
} from '../components/ui';
import { Icon } from '../components/icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'PurchaseDetail'>;

/**
 * A received purchase bill — reference SCREENS.purchaseDetail (18382):
 * the paper with its lines, the Payable / Paid / Still owing totals, the
 * overdue banner, then the actions. Edit and Delete follow the same
 * void-and-repost rule as a sale (A.editSaleSave 17612, A.deleteSale 17654).
 */
export default function PurchaseDetailScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const { db, money, party, product, deletePurchase, canEditPurchase, can, logAudit } = useAppData();
  const { error } = useToast();
  const x = db?.purchases.find((p) => p.id === route.params.purchaseId);
  if (!x) return null;

  const live = x.status !== 'void';
  const gate = canEditPurchase(x.id);
  const supplier = party(x.partyId);

  function refuse(why: string) { error(why); }

  function onEdit() {
    if (!can('purchases.edit')) return refuse('Your role cannot change a purchase.');
    if (!gate.ok) return refuse(gate.why);
    navigation.navigate('PurchaseNew', { editPurchaseId: x!.id });
  }

  function onDelete() {
    if (!can('purchases.delete')) return refuse('Your role cannot delete a purchase.');
    if (!gate.ok) return refuse(gate.why);
    Alert.alert(
      'Delete ' + x!.no + '?',
      'The purchase is reversed, not erased: the goods come back off the shelf and ' + money(x!.total) + ' comes off what you owe ' + (supplier?.name || 'them') + '. The reversal stays in the audit log.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: () => {
            deletePurchase(x!.id, 'Deleted from the purchase');
            logAudit('Purchase deleted', x!.no + ' — ' + money(x!.total) + ' reversed');
            navigation.goBack();
          },
        },
      ],
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 190 }}>
        <Panel>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{
              width: 48, height: 48, borderRadius: 15,
              backgroundColor: !live ? colors.dangerSoft : x.due > 0 ? colors.warnSoft : colors.goodSoft,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name="cart" size={23} color={!live ? colors.danger : x.due > 0 ? colors.warn : colors.good} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink }}>{x.no}</Text>
              <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                {supplier?.name || 'Supplier'} · received {new Date(x.ts).toLocaleDateString()}
              </Text>
            </View>
            <Badge
              label={!live ? 'Reversed' : x.due > 0 ? 'Owing' : 'Paid'}
              tone={!live ? 'danger' : x.due > 0 ? 'warn' : 'good'}
            />
          </View>
        </Panel>

        {x.editedFrom ? (
          <View style={{ marginTop: 12 }}>
            <InfoBanner tone="warn" text="This purchase was corrected — the original posting was reversed." />
          </View>
        ) : null}

        <View style={{ height: 16 }} />
        <StatGrid
          items={[
            { icon: 'coins', label: 'Payable', value: money(x.total), tone: 'accent' },
            { icon: x.due > 0 ? 'alert' : 'check', label: x.due > 0 ? 'Still owing' : 'Settled', value: money(x.due), tone: x.due > 0 ? 'danger' : 'good' },
          ]}
        />

        <View style={{ height: 20 }} />
        <SectionLabel right={<Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{x.lines.length} line{x.lines.length === 1 ? '' : 's'}</Text>}>
          Goods received
        </SectionLabel>
        <Panel>
          {x.lines.map((l, i) => (
            <View
              key={l.productId + String(i)}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11,
                borderBottomWidth: i === x.lines.length - 1 ? 0 : 1, borderBottomColor: colors.line,
              }}
            >
              <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: colors.warnSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 12, color: colors.warn }}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 14.5, color: colors.ink }}>
                  {product(l.productId)?.name || l.productId}
                </Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 2 }}>
                  {l.qty} × {money(l.cost)}
                </Text>
              </View>
              <Text style={{ fontFamily: fonts.monoSemi, fontSize: 14, color: colors.ink }}>{money(l.qty * l.cost)}</Text>
            </View>
          ))}
        </Panel>

        <View style={{ height: 20 }} />
        <SectionLabel>Summary</SectionLabel>
        <Panel>
          <DetailRow label="Payable" value={money(x.total)} bold />
          <DetailRow label="Paid" value={money(x.paid)} tone={colors.good} />
          <DetailRow label="Still owing" value={money(x.due)} tone={x.due > 0 ? colors.danger : colors.good} bold />
          <DetailRow label="Paid by" value={x.method} />
          {x.ref ? <DetailRow label="Your reference" value={x.ref} /> : null}
          <DetailRow label="Note" value={x.note || '—'} last />
        </Panel>

        {!live && x.voidReason ? (
          <View style={{ marginTop: 14 }}>
            <InfoBanner tone="danger" text={'Reversed — ' + x.voidReason} />
          </View>
        ) : null}
      </ScrollView>

      <StickyBar>
        {live && !gate.ok ? (
          <View style={{ marginBottom: 10 }}>
            <InfoBanner tone="warn" text={gate.why} />
          </View>
        ) : null}
        <ActionGrid
          actions={[
            { label: 'Their account', icon: 'doc', tone: 'accent', onPress: () => navigation.navigate('PartyLedger', { partyId: x.partyId }) },
            ...(live && x.due > 0 ? [{ label: 'Pay them', icon: 'cash' as const, tone: 'good' as const, onPress: () => navigation.navigate('PaymentNew', { direction: 'out' }) }] : []),
            ...(live ? [
              { label: 'Edit', icon: 'pencil' as const, tone: 'accent' as const, filled: true, onPress: onEdit },
              { label: 'Delete', icon: 'trash' as const, tone: 'danger' as const, filled: true, onPress: onDelete },
            ] : []),
          ]}
        />
      </StickyBar>
    </View>
  );
}
