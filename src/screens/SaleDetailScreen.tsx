import React from 'react';
import { View, Text, ScrollView, Alert, Image } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useToast } from '../components/Toast';
import { useOwnerPin } from '../components/OwnerPin';
import { Pressable } from '../components/Press';
import {
  Panel, Badge, DetailRow, ActionGrid, StickyBar, InfoBanner, SectionLabel, StatGrid,
} from '../components/ui';
import { Icon } from '../components/icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { orderTypeWord } from '../data/restaurant';
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
  const { db, money, party, deleteSale, canEditSale, can, logAudit } = useAppData();
  const { error } = useToast();
  // asked before an edit or delete when Settings require a PIN for it
  const ownerPin = useOwnerPin();
  const sale = db?.sales.find((s) => s.id === route.params.saleId);
  // History sits in the header as a clock, as on the design
  React.useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable hitSlop={10} accessibilityLabel="History" onPress={() => navigation.navigate('Versions', { coll: 'sales', recordId: route.params.saleId })} style={{ padding: 8 }}>
          <Icon name="clock" size={20} color={colors.soft} />
        </Pressable>
      ),
    });
  }, [navigation, route.params.saleId, colors.soft]);
  if (!sale) return null;

  const live = sale.status !== 'void';
  const gate = canEditSale(sale.id);

  function refuse(why: string) {
    error(why);
  }

  function onEdit() {
    if (!can('sales.edit')) return refuse('Your role cannot change a raised sale.');
    if (!gate.ok) return refuse(gate.why);
    const open = () => navigation.navigate('NewSale', { editSaleId: sale!.id });
    // Settings → "A PIN is needed to edit a transaction"
    if (db?.settings.requirePinToEdit) { ownerPin.ask('Edit ' + sale!.no, open); return; }
    open();
  }

  function onDelete() {
    if (!can('sales.delete')) return refuse('Your role cannot delete a sale.');
    if (!gate.ok) return refuse(gate.why);
    // Settings → "A PIN is needed to delete one"
    if (db?.settings.requirePinToDelete) { ownerPin.ask('Delete ' + sale!.no, confirmDelete); return; }
    confirmDelete();
  }

  function confirmDelete() {
    Alert.alert(
      'Delete ' + sale!.no + '?',
      'The sale is reversed, not erased: ' + money(sale!.total) + ' comes off the books and the stock goes back on the shelf. The reversal stays in the audit log.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: () => {
            deleteSale(sale!.id, 'Deleted from the sale');
            logAudit('Sale deleted', sale!.no + ' — ' + money(sale!.total) + ' reversed');
            navigation.goBack();
          },
        },
      ],
    );
  }

  const customer = sale.partyId ? party(sale.partyId)?.name || 'Walk-in' : 'Walk-in';

  const paidPct = sale.total > 0 ? Math.min(1, sale.paid / sale.total) : 1;
  const when = new Date(sale.ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  const statusTone = !live ? colors.danger : sale.due > 0.01 ? colors.warn : colors.good;
  const statusBg = !live ? colors.dangerSoft : sale.due > 0.01 ? colors.warnSoft : colors.goodSoft;
  const statusText = !live ? 'Void' : sale.due > 0.01 ? (sale.paid > 0 ? 'Part paid' : 'Unpaid') : 'Complete';
  const card = { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.line } as const;
  const head = (title: string, right?: string) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 22, marginBottom: 8, paddingHorizontal: 4 }}>
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.soft }}>{title}</Text>
      {right ? <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint }}>{right}</Text> : null}
    </View>
  );
  const row = (label: string, value: string, o: { bold?: boolean; tone?: string } = {}) => (
    <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7 }}>
      <Text style={{ fontFamily: o.bold ? fonts.uiBold : fonts.ui, fontSize: o.bold ? 15 : 14, color: o.bold ? colors.ink : colors.soft }}>{label}</Text>
      <Text style={{ fontFamily: o.bold ? fonts.uiBold : fonts.uiSemi, fontSize: o.bold ? 15 : 14, color: o.tone || colors.ink }}>{value}</Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 130 }}>
        {/* the bill at a glance: number, status, total, who and when, how much is paid */}
        <View style={{ ...card, padding: 18 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: fonts.mono, fontSize: 13.5, letterSpacing: 0.5, color: colors.soft }}>{sale.no}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: statusBg }}>
              <Icon name={live ? 'check' : 'x'} size={12} color={statusTone} />
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: statusTone }}>{statusText}</Text>
            </View>
          </View>
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 32, color: colors.ink, marginTop: 14, letterSpacing: -0.5 }}>{money(sale.total)}</Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint, marginTop: 4 }}>{customer} · {when}</Text>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.sunk, marginTop: 16, overflow: 'hidden' }}>
            <View style={{ width: `${paidPct * 100}%`, height: 6, backgroundColor: colors.good }} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.good }}>Paid {money(sale.paid)}</Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: sale.due > 0.01 ? colors.danger : colors.faint }}>Balance {money(sale.due)}</Text>
          </View>
        </View>

        {sale.editedFrom ? <View style={{ marginTop: 12 }}><InfoBanner tone="warn" text="This bill was corrected — the original posting was reversed." /></View> : null}

        {head('Items', sale.lines.length + ' line' + (sale.lines.length === 1 ? '' : 's'))}
        <View style={card}>
          {sale.lines.map((l, i) => (
            <View key={`${l.productId}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderBottomWidth: i === sale.lines.length - 1 ? 0 : 1, borderBottomColor: colors.line }}>
              <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: colors.sunk, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="box" size={18} color={colors.faint} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={2} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{l.name}</Text>
                <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 2 }}>
                  {l.qty} {(l.unit || '').toUpperCase()} × {money(l.price)}{l.batchNo ? ' · ' + l.batchNo : ''}
                </Text>
                {l.modifiers?.length ? <Text numberOfLines={3} style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.soft, marginTop: 2 }}>+ {l.modifiers.map((m) => m.name).join(', ')}</Text> : null}
                {l.note ? <Text numberOfLines={2} style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.warn, marginTop: 2 }}>* {l.note}</Text> : null}
              </View>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{money(l.qty * l.price)}</Text>
            </View>
          ))}
          {/* the order as a whole: its table and how it was eaten (its note is in the summary) */}
          {sale.ticketName || sale.orderType ? (
            <View style={{ padding: 14, borderTopWidth: 1, borderTopColor: colors.line, gap: 4 }}>
              {sale.ticketName || sale.orderType ? (
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 13.5, color: colors.ink }}>{[sale.ticketName, orderTypeWord(sale.orderType)].filter(Boolean).join(' · ')}</Text>
              ) : null}
            </View>
          ) : null}
        </View>

        {sale.rx ? (
          <>
            {head('Prescription')}
            <View style={card}>
              <View style={{ padding: 14, gap: 4 }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 14.5, color: colors.ink }}>Prescribed by {sale.rx.prescriber}</Text>
                {sale.rx.number ? <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.soft }}>No. {sale.rx.number}</Text> : null}
                {sale.rx.patient ? <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.soft }}>Patient: {sale.rx.patient}</Text> : null}
                {sale.rx.facility ? <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.soft }}>{sale.rx.facility}</Text> : null}
                <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>Seen by {sale.rx.seenBy} · {new Date(sale.rx.seenAt).toLocaleString('en-GB')}</Text>
                {sale.rx.photo ? <Image source={{ uri: sale.rx.photo }} style={{ width: '100%', height: 180, borderRadius: 12, marginTop: 8 }} resizeMode="contain" /> : null}
              </View>
            </View>
          </>
        ) : null}

        {head('Summary')}
        <View style={{ ...card, paddingHorizontal: 16, paddingVertical: 8 }}>
          {row('Subtotal', money(sale.gross))}
          {row('Discount', money(sale.discount))}
          {db?.settings.taxEnabled === false && !sale.tax ? null : row('Tax', money(sale.tax))}
          {sale.additionalCharges ? row('Additional charges', money(sale.additionalCharges)) : null}
          <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 6 }} />
          {row('Total', money(sale.total), { bold: true })}
          {row('Paid', money(sale.paid), { tone: colors.good })}
          {row('Balance due', money(sale.due), { tone: sale.due > 0.01 ? colors.danger : colors.good })}
          {sale.note ? row('Note', sale.note) : null}
        </View>

        {(sale.receipts || []).length ? (
          <>
            {head('Payments against this invoice')}
            <View style={card}>
              {(sale.receipts || []).map((r, i, arr) => (
                <Text key={r.paymentId + i} onPress={() => navigation.navigate('PaymentDetail', { paymentId: r.paymentId } as any)}
                  style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.accent, padding: 14, borderBottomWidth: i === arr.length - 1 ? 0 : 1, borderBottomColor: colors.line }}>
                  {new Date(r.ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} · {money(r.amount)}
                </Text>
              ))}
            </View>
          </>
        ) : null}

        {!live && sale.voidReason ? <View style={{ marginTop: 14 }}><InfoBanner tone="danger" text={'Reversed — ' + sale.voidReason} /></View> : null}
        {live && !gate.ok ? <View style={{ marginTop: 14 }}><InfoBanner tone="warn" text={gate.why} /></View> : null}
        {live ? (
          <Text onPress={onDelete} style={{ textAlign: 'center', fontFamily: fonts.uiSemi, fontSize: 14, color: colors.danger, marginTop: 22, padding: 8 }}>Delete sale</Text>
        ) : null}
      </ScrollView>

      {/* Receipt beside Edit sale, as on the design */}
      <StickyBar>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable
            onPress={() => navigation.navigate('Receipt', { saleId: sale.id })}
            style={{ flex: 1, height: 50, borderRadius: 14, borderWidth: 1.4, borderColor: colors.lineHard, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            <Icon name="print" size={17} color={colors.ink} />
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>Receipt</Text>
          </Pressable>
          {live ? (
            <Pressable
              onPress={onEdit}
              style={{ flex: 1, height: 50, borderRadius: 14, backgroundColor: colors.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            >
              <Icon name="pencil" size={16} color={colors.accentInk} />
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.accentInk }}>Edit sale</Text>
            </Pressable>
          ) : null}
        </View>
      </StickyBar>
      {ownerPin.sheet}
    </View>
  );
}
