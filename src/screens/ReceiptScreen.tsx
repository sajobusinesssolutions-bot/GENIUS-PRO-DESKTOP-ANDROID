import React, { useEffect, useRef } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Button, Panel, ActionGrid, StickyBar, SectionLabel } from '../components/ui';
import { Icon } from '../components/icons';
import { DocActions, useDocBuilder } from '../components/DocActions';
import { printDoc } from '../data/docPrint';
import { printOptsFor, docKindOf } from '../data/printSetup';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Receipt'>;

export default function ReceiptScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const { db, money, party, product } = useAppData();
  const { saleDoc } = useDocBuilder();
  const sale = db?.sales.find((s) => s.id === route.params.saleId);

  // Settings, Printing → "Print automatically after a sale". Saved, and never
  // acted on; now the receipt goes to the default printer as this screen opens.
  const printed = useRef(false);
  useEffect(() => {
    if (printed.current || !sale || !db?.printer?.autoPrint) return;
    printed.current = true;
    const d = saleDoc(sale);
    printDoc(d, money, printOptsFor(db, d.docKind || docKindOf(d.kind))).catch(() => { /* the buttons are still there */ });
  }, [sale?.id]);

  if (!sale) return null;
  const pt = sale.partyId ? party(sale.partyId) : null;

  /** The expiry printed under a line, read off the product's batch. */
  const expiryOf = (batchNo?: string, productId?: string) => {
    if (!batchNo) return '';
    const b = (product(productId || '')?.batches || []).find((x) => x.no === batchNo);
    return b?.expiry ? new Date(b.expiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '';
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 150 }}>
        {/* the confirmation head — reference 10 */}
        <Panel style={{ marginBottom: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
            <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.goodSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="check" size={26} color={colors.good} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink }}>Sale saved</Text>
              <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                Invoice {sale.no} · {money(sale.total)}
              </Text>
            </View>
          </View>

          <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 14 }} />

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.soft }}>
              Print, share or send it
            </Text>
            <DocActions doc={() => saleDoc(sale)} phone={pt?.phone} />
          </View>
        </Panel>

        <View style={{ backgroundColor: colors.surface, borderRadius: 18, padding: 20, shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2 }}>
          <Text style={{ textAlign: 'center', fontFamily: fonts.uiExtra, fontSize: 18, color: colors.ink, letterSpacing: 0.4 }}>{db?.firm.name}</Text>
          <Text style={{ textAlign: 'center', fontFamily: fonts.ui, fontSize: 10.5, color: colors.faint, marginTop: 8 }}>{db?.firm.address}</Text>
          <Text style={{ textAlign: 'center', fontFamily: fonts.ui, fontSize: 10, color: colors.faint, marginBottom: 12 }}>TIN {db?.firm.tin}</Text>

          <View style={{ borderTopWidth: 1, borderTopColor: colors.line, borderStyle: 'dashed', marginVertical: 8 }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>Receipt</Text>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11, color: colors.ink }}>{sale.no}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>Date</Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.ink }}>{new Date(sale.ts).toLocaleString()}</Text>
          </View>
          {pt ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>Customer</Text>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11, color: colors.ink }}>{pt.name}</Text>
            </View>
          ) : null}

          <View style={{ borderTopWidth: 1, borderTopColor: colors.line, borderStyle: 'dashed', marginVertical: 8 }} />

          {sale.lines.map((l, idx) => {
            const exp = expiryOf(l.batchNo, l.productId);
            return (
              <View key={`${l.productId}-${l.batchNo || ''}-${idx}`} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.ink, flex: 1 }} numberOfLines={1}>{l.name}</Text>
                  <Text style={{ fontFamily: fonts.monoSemi, fontSize: 12.5, color: colors.ink }}>{money(l.qty * l.price)}</Text>
                </View>
                <Text style={{ fontFamily: fonts.ui, fontSize: 10.5, color: colors.faint }}>
                  {l.qty} {l.unit} × {money(l.price)}
                </Text>
                {l.batchNo ? (
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 10.5, color: colors.accent, marginTop: 2 }}>
                    Batch {l.batchNo}{exp ? ' · exp ' + exp : ''}
                  </Text>
                ) : null}
              </View>
            );
          })}

          <View style={{ borderTopWidth: 1, borderTopColor: colors.line, borderStyle: 'dashed', marginVertical: 8 }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: colors.ink }}>TOTAL</Text>
            <Text style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink }}>{money(sale.total)}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 10.5, color: colors.faint }}>Paid via</Text>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 10.5, color: colors.ink }}>{sale.method.toUpperCase()}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 10.5, color: colors.faint }}>Due</Text>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 10.5, color: sale.due > 0 ? colors.warn : colors.good }}>{money(sale.due)}</Text>
          </View>
          {sale.additionalCharges ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
              <Text style={{ fontFamily: fonts.ui, fontSize: 10.5, color: colors.faint }}>Additional charges</Text>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 10.5, color: colors.ink }}>{money(sale.additionalCharges)}</Text>
            </View>
          ) : null}
          {sale.note ? <Text style={{ fontFamily: fonts.ui, fontSize: 10.5, color: colors.faint, marginTop: 9 }}>Note: {sale.note}</Text> : null}
          {sale.terms ? <Text style={{ fontFamily: fonts.ui, fontSize: 10.5, color: colors.faint, marginTop: 4 }}>Terms: {sale.terms}</Text> : null}
          {sale.fdn ? <Text style={{ fontFamily: fonts.ui, fontSize: 9.5, color: colors.faint, marginTop: 8 }}>EFRIS FDN {sale.fdn}</Text> : null}
          <Text style={{ textAlign: 'center', fontFamily: fonts.ui, fontSize: 10.5, color: colors.faint, marginTop: 12 }}>Thank you for shopping with us!</Text>
        </View>
      </ScrollView>

      <StickyBar>
        <ActionGrid
          actions={[
            { label: 'Bill details', icon: 'doc', tone: 'accent', onPress: () => navigation.replace('SaleDetail', { saleId: sale.id }) },
            { label: 'New sale', icon: 'plus', tone: 'accent', onPress: () => navigation.replace('NewSale') },
            { label: 'Done', icon: 'check', tone: 'good', filled: true, onPress: () => navigation.navigate('Main') },
          ]}
        />
      </StickyBar>
    </View>
  );
}
