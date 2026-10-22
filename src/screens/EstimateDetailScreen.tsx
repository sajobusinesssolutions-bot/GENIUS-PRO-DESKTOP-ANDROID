/**
 * ONE QUOTATION — what was quoted and to whom, with what can still be done to
 * it: share or print it, change it, turn it into a sale, or delete it. A quote
 * that became a sale links to that sale instead.
 */
import React from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useOnDisk } from '../data/useOnDisk';
import { useToast } from '../components/Toast';
import { Panel, Badge, DetailRow, ActionGrid, StickyBar, SectionLabel, StatGrid, InfoBanner } from '../components/ui';
import { Icon } from '../components/icons';
import BilledItems from '../components/BilledItems';
import { BalanceTag } from '../components/CustomerSheets';
import { useDocBuilder } from '../components/DocActions';
import { printDoc, shareDoc } from '../data/docPrint';
import { printOptsFor, docKindOf, shareOptsFor } from '../data/printSetup';
import type { PayMethod } from '../data/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'EstimateDetail'>;

export default function EstimateDetailScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const { db, money, party, partyBalance, voidEstimate, can } = useAppData();
  const { success, error } = useToast();
  const { saleDoc } = useDocBuilder();
  const est = db?.estimates.find((e) => e.id === route.params.estimateId);
  const soldAs = est?.convertedSaleId;
  useOnDisk('sales', soldAs, !soldAs || !db || db.sales.some((s) => s.id === soldAs));
  useOnDisk('estimates', route.params.estimateId, !!est || !db);
  if (!db || !est) return null;

  const open = est.status === 'open';
  const customer = est.partyId ? party(est.partyId) : undefined;
  const gross = est.lines.reduce((s, l) => s + l.qty * l.price, 0);
  const sale = est.convertedSaleId ? db.sales.find((s) => s.id === est.convertedSaleId) : undefined;
  const statusLabel = open ? 'Open' : est.status === 'converted' ? 'Converted' : 'Deleted';

  function doc() {
    return saleDoc({
      ...(est as any), gross, tax: 0, additionalCharges: 0,
      // nothing is paid on a quotation, so no "Paid" line
      paid: undefined, due: 0, method: '', userId: db!.session.userId,
    } as any, 'Quotation');
  }

  async function send(what: 'print' | 'share') {
    try {
      const d = doc();
      if (what === 'print') await printDoc(d, money, printOptsFor(db, d.docKind || docKindOf(d.kind)));
      else if (!(await shareDoc(d, money, shareOptsFor(db, d.docKind || docKindOf(d.kind))))) error('Sharing is not available on this phone.');
    } catch (e: any) {
      error(e?.message || 'That could not be ' + (what === 'print' ? 'printed' : 'shared') + '.');
    }
  }

  function convert() {
    navigation.navigate('NewSale', { fromEstimateId: est!.id });
  }

  function remove() {
    Alert.alert('Delete ' + est!.no + '?', 'The quotation is closed and kept in the audit log. Nothing was posted, so no stock or money moves.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: () => {
          voidEstimate(est!.id);
          success(est!.no + ' deleted');
          navigation.goBack();
        },
      },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 200 }}>
        <Panel>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 48, height: 48, borderRadius: 4, backgroundColor: open ? colors.accentSoft : colors.sunk, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="doc" size={23} color={open ? colors.accent : colors.faint} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink }}>{est.no}</Text>
              <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                {new Date(est.ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
            <Badge label={statusLabel} tone={open ? 'accent' : est.status === 'converted' ? 'good' : 'danger'} />
          </View>
        </Panel>

        <View style={{ height: 12 }} />
        <Panel>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>Customer</Text>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink, marginTop: 3 }}>{customer?.name || 'Walk-in customer'}</Text>
              {customer?.phone ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>{customer.phone}</Text> : null}
            </View>
            {customer ? <BalanceTag balance={partyBalance(customer.id)} money={money} /> : null}
          </View>
        </Panel>

        <View style={{ height: 16 }} />
        <StatGrid
          items={[
            { icon: 'coins', label: 'Quoted total', value: money(est.total), tone: 'accent' },
            { icon: 'cart', label: 'Items', value: String(est.lines.length), tone: 'accent' },
          ]}
        />

        <View style={{ height: 20 }} />
        <BilledItems lines={est.lines} money={money} />

        <View style={{ height: 20 }} />
        <SectionLabel>Summary</SectionLabel>
        <Panel>
          <DetailRow label="Subtotal" value={money(gross)} />
          <DetailRow label="Discount" value={money(est.discount)} tone={est.discount ? colors.good : undefined} />
          <DetailRow label="Total" value={money(est.total)} bold last={!sale} />
          {sale ? <DetailRow label="Became sale" value={sale.no} tone={colors.accent} last /> : null}
        </Panel>

        {est.status === 'void' ? (
          <View style={{ marginTop: 14 }}>
            <InfoBanner tone="danger" text="This quotation was deleted. It is kept here for the record." />
          </View>
        ) : null}
      </ScrollView>

      <StickyBar>
        <ActionGrid
          actions={[
            { label: 'Share', icon: 'share', tone: 'accent', onPress: () => void send('share') },
            { label: 'Print', icon: 'print', tone: 'accent', onPress: () => void send('print') },
            ...(open ? [
              { label: 'Edit', icon: 'pencil' as const, tone: 'accent' as const, onPress: () => navigation.navigate('EstimateNew', { editEstimateId: est.id }) },
              { label: 'Delete', icon: 'trash' as const, tone: 'danger' as const, filled: true, onPress: remove },
              ...(can('quotes.convert') && can('sales.create') ? [{ label: 'Convert to sale', icon: 'receipt' as const, tone: 'good' as const, filled: true, onPress: convert }] : []),
            ] : []),
            ...(sale ? [{ label: 'Open sale ' + sale.no, icon: 'receipt' as const, tone: 'good' as const, filled: true, onPress: () => navigation.navigate('SaleDetail', { saleId: sale.id }) }] : []),
          ]}
        />
      </StickyBar>
    </View>
  );
}
