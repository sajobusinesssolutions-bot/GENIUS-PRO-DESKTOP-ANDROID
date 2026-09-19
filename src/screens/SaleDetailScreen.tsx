import React from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useToast } from '../components/Toast';
import {
  Panel, Badge, DetailRow, ActionGrid, StickyBar, InfoBanner, SectionLabel, StatGrid,
} from '../components/ui';
import { Icon } from '../components/icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'SaleDetail'>;

/**
 * A raised bill, with the things you can still do to it at the bottom.
 * Reference SCREENS.saleDetail (1892) for the paper, and the action row of
 * A.editSale (17496) / A.deleteSale (17654) for Edit and Delete.
 *
 * Neither Edit nor Delete rewrites the record: an edit voids and reposts,
 * a delete reverses. Both are gated on the edit window and on permissions.
 */
export default function SaleDetailScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const { db, money, party, voidSale, deleteSale, canEditSale, can, logAudit } = useAppData();
  const { error } = useToast();
  const sale = db?.sales.find((s) => s.id === route.params.saleId);
  if (!sale) return null;

  const live = sale.status !== 'void';
  const gate = canEditSale(sale.id);

  function refuse(why: string) {
    error(why);
  }

  function onEdit() {
    if (!can('sales.edit')) return refuse('Your role cannot change a raised bill.');
    if (!gate.ok) return refuse(gate.why);
    navigation.navigate('EditSale', { saleId: sale!.id });
  }

  function onDelete() {
    if (!can('sales.delete')) return refuse('Your role cannot delete a bill.');
    if (!gate.ok) return refuse(gate.why);
    Alert.alert(
      'Delete ' + sale!.no + '?',
      'The bill is reversed, not erased: ' + money(sale!.total) + ' comes off the books and the stock goes back on the shelf. The reversal stays in the audit log.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: () => {
            deleteSale(sale!.id, 'Deleted from the bill');
            logAudit('Sale deleted', sale!.no + ' — ' + money(sale!.total) + ' reversed');
            navigation.goBack();
          },
        },
      ],
    );
  }

  function onVoid() {
    Alert.alert('Void ' + sale!.no + '?', 'This reverses stock and ledger entries.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Void', style: 'destructive', onPress: () => {
          voidSale(sale!.id, 'Voided by user');
          logAudit('Sale voided', sale!.no);
          navigation.goBack();
        },
      },
    ]);
  }

  const customer = sale.partyId ? party(sale.partyId)?.name || 'Walk-in' : 'Walk-in';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 190 }}>
        {/* the bill head */}
        <Panel>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{
              width: 48, height: 48, borderRadius: 15,
              backgroundColor: live ? colors.goodSoft : colors.dangerSoft,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Icon name="receipt" size={23} color={live ? colors.good : colors.danger} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink }}>{sale.no}</Text>
              <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                {customer} · {new Date(sale.ts).toLocaleString()}
              </Text>
            </View>
            <Badge label={live ? 'Complete' : 'Void'} tone={live ? 'good' : 'danger'} />
          </View>
        </Panel>

        {sale.editedFrom ? (
          <View style={{ marginTop: 12 }}>
            <InfoBanner tone="warn" text="This bill was corrected — the original posting was reversed." />
          </View>
        ) : null}

        <View style={{ height: 16 }} />
        <StatGrid
          items={[
            { icon: 'coins', label: 'Total', value: money(sale.total), tone: 'accent' },
            { icon: sale.due > 0 ? 'alert' : 'check', label: sale.due > 0 ? 'Balance due' : 'Settled', value: money(sale.due), tone: sale.due > 0 ? 'danger' : 'good' },
          ]}
        />

        <View style={{ height: 20 }} />
        <SectionLabel right={<Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{sale.lines.length} line{sale.lines.length === 1 ? '' : 's'}</Text>}>
          Items
        </SectionLabel>
        <Panel>
          {sale.lines.map((l, i) => (
            <View
              key={`${l.productId}-${l.batchNo || ''}-${i}`}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11,
                borderBottomWidth: i === sale.lines.length - 1 ? 0 : 1, borderBottomColor: colors.line,
              }}
            >
              <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 12, color: colors.accent }}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 14.5, color: colors.ink }}>{l.name}</Text>
                <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 2 }}>
                  {l.qty} {l.unit} × {money(l.price)}
                  {l.batchNo ? ' · ' + l.batchNo : ''}
                </Text>
              </View>
              <Text style={{ fontFamily: fonts.monoSemi, fontSize: 14, color: colors.ink }}>{money(l.qty * l.price)}</Text>
            </View>
          ))}
        </Panel>

        <View style={{ height: 20 }} />
        <SectionLabel>Summary</SectionLabel>
        <Panel>
          <DetailRow label="Subtotal" value={money(sale.gross)} />
          <DetailRow label="Discount" value={money(sale.discount)} tone={sale.discount ? colors.good : undefined} />
          <DetailRow label="Tax" value={money(sale.tax)} />
          {sale.additionalCharges ? <DetailRow label="Additional charges" value={money(sale.additionalCharges)} /> : null}
          <DetailRow label="Total" value={money(sale.total)} bold />
          <DetailRow label="Paid" value={money(sale.paid)} tone={colors.good} />
          <DetailRow
            label="Balance due"
            value={money(sale.due)}
            bold
            tone={sale.due > 0 ? colors.danger : colors.good}
            last={!sale.note && !sale.ref}
          />
          {sale.note ? <DetailRow label="Note" value={sale.note} last={!sale.ref} /> : null}
          {sale.ref ? <DetailRow label="Reference" value={sale.ref} last /> : null}
        </Panel>

        {!live && sale.voidReason ? (
          <View style={{ marginTop: 14 }}>
            <InfoBanner tone="danger" text={'Reversed — ' + sale.voidReason} />
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
            { label: 'Receipt', icon: 'print', tone: 'accent', onPress: () => navigation.navigate('Receipt', { saleId: sale.id }) },
            { label: 'History', icon: 'clock', tone: 'accent', onPress: () => navigation.navigate('Versions', { coll: 'sales', recordId: sale.id }) },
            ...(live ? [
              { label: 'Void', icon: 'alert' as const, tone: 'warn' as const, onPress: onVoid },
              { label: 'Edit', icon: 'pencil' as const, tone: 'accent' as const, filled: true, onPress: onEdit },
              { label: 'Delete', icon: 'trash' as const, tone: 'danger' as const, filled: true, onPress: onDelete },
            ] : []),
          ]}
        />
      </StickyBar>
    </View>
  );
}
