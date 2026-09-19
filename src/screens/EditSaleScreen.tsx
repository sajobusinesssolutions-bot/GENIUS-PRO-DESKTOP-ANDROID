import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Alert, Pressable, TextInput } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useToast } from '../components/Toast';
import {
  Button, Panel, SectionLabel, DetailRow, InfoBanner, StickyBar, Search, ListRow, EmptyBlock,
} from '../components/ui';
import { Icon } from '../components/icons';
import { Field } from '../components/form';
import { saleTotals } from '../data/logic';
import type { SaleLine, Product } from '../data/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'EditSale'>;

/**
 * Editing a raised bill — reference SCREENS.editSale (17509), its banner
 * ("Changing a raised bill reverses it and posts it again"), the Was /
 * Becomes / Difference card, and A.editSaleSave (17612) which does the
 * void-and-repost under the original number.
 */
export default function EditSaleScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const { db, money, party, editSale, canEditSale, can, logAudit } = useAppData();
  const { error, info } = useToast();
  const sale = db?.sales.find((s) => s.id === route.params.saleId);

  const [lines, setLines] = useState<SaleLine[]>(() => sale ? sale.lines.map((l) => ({ ...l })) : []);
  const [discount, setDiscount] = useState(String(sale?.discount || ''));
  const [ref, setRef] = useState(sale?.ref || '');
  const [note, setNote] = useState(sale?.note || '');
  const [q, setQ] = useState('');

  const products = useMemo(() => (db?.products || []).filter((p) => p.active &&
    (!q || p.name.toLowerCase().includes(q.toLowerCase()) || p.sku.toLowerCase().includes(q.toLowerCase()))).slice(0, 20), [db, q]);

  if (!sale) return null;
  const gate = canEditSale(sale.id);
  const t = saleTotals(lines, Number(discount) || 0);

  function setQty(id: string, qty: number) {
    setLines((prev) => qty <= 0 ? prev.filter((l) => l.productId !== id) : prev.map((l) => l.productId === id ? { ...l, qty } : l));
  }

  /** Reference SHEETS.pickEditLine / A.editAddPick, line 17556. */
  function addLine(p: Product) {
    setQ('');
    setLines((prev) => prev.find((l) => l.productId === p.id)
      ? prev.map((l) => l.productId === p.id ? { ...l, qty: l.qty + 1 } : l)
      : [...prev, { productId: p.id, name: p.name, sku: p.sku, unit: p.unit, qty: 1, price: p.price, cost: p.cost, taxRate: p.taxRate }]);
  }

  function save() {
    if (!can('sales.edit')) { error('Your role cannot change a raised bill.'); return; }
    const kept = lines.filter((l) => l.qty > 0);
    if (!kept.length) { error('A bill needs at least one line.'); return; }
    const fresh = canEditSale(sale!.id);
    if (!fresh.ok) { error(fresh.why); return; }
    if (t.total === sale!.total && !linesChanged(sale!.lines, kept) && ref === (sale!.ref || '') && note === (sale!.note || '')) {
      info('The bill is exactly as it was.');
      return;
    }
    Alert.alert(
      'Save the change to ' + sale!.no + '?',
      'The bill as it stands (' + money(sale!.total) + ') is reversed and reposted as ' + money(t.total) + ' under the same number. Both postings stay in the books.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save', onPress: () => {
            const out = editSale(sale!.id, { lines: kept, partyId: sale!.partyId, discount: Number(discount) || 0, ref, note }, 'Edited on the bill');
            if (!out) { error('That bill can no longer be changed.'); return; }
            logAudit('Sale edited', sale!.no + ' — ' + money(sale!.total) + ' to ' + money(out.total));
            navigation.replace('SaleDetail', { saleId: out.id });
          },
        },
      ],
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 180 }} keyboardShouldPersistTaps="handled">
        <InfoBanner
          tone="warn"
          text="Changing a raised bill reverses the original posting and posts it again under the same number. Both stay in the books."
        />

        <View style={{ height: 16 }} />
        <Panel>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
            <View style={{ width: 48, height: 48, borderRadius: 15, backgroundColor: colors.warnSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="pencil" size={22} color={colors.warn} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiExtra, fontSize: 19, color: colors.ink }}>{sale.no}</Text>
              <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                {sale.partyId ? party(sale.partyId)?.name : 'Walk-in'} · {new Date(sale.ts).toLocaleDateString()} · {sale.method}
              </Text>
            </View>
          </View>
        </Panel>

        <View style={{ height: 20 }} />
        <SectionLabel right={
          <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>
            {lines.length} line{lines.length === 1 ? '' : 's'}
          </Text>
        }>
          Lines
        </SectionLabel>

        {lines.map((l, i) => (
          <View
            key={l.productId + '-' + i}
            style={{
              backgroundColor: colors.surface, borderRadius: 16, padding: 14, marginBottom: 10,
              shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 3 }, elevation: 2,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: colors.accent }}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{l.name}</Text>
                <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 3 }}>
                  {money(l.price)} each{l.batchNo ? ' · batch ' + l.batchNo : ''}
                </Text>
              </View>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{money(l.qty * l.price)}</Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 13 }}>
              <Pressable onPress={() => setQty(l.productId, l.qty - 1)} style={stepper(colors)}>
                <Text style={{ color: colors.ink, fontFamily: fonts.uiBold, fontSize: 19 }}>−</Text>
              </Pressable>
              <Text style={{ flex: 1, textAlign: 'center', fontFamily: fonts.uiExtra, fontSize: 18, color: colors.ink }}>
                {l.qty} <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint }}>{l.unit}</Text>
              </Text>
              <Pressable onPress={() => setQty(l.productId, l.qty + 1)} style={stepper(colors)}>
                <Text style={{ color: colors.ink, fontFamily: fonts.uiBold, fontSize: 19 }}>+</Text>
              </Pressable>
              <Pressable
                onPress={() => setQty(l.productId, 0)}
                style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: colors.dangerSoft, alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name="trash" size={17} color={colors.danger} />
              </Pressable>
            </View>
          </View>
        ))}

        {!lines.length ? (
          <Panel style={{ marginBottom: 10 }}>
            <EmptyBlock icon="cart" title="Every line has been taken off" hint="Add at least one before saving." />
          </Panel>
        ) : null}

        <View style={{ height: 8 }} />
        <SectionLabel>Add a line</SectionLabel>
        <Search value={q} onChange={setQ} placeholder="Search name or code" />
        {q.length > 0 ? (
          <View style={{ marginTop: 10 }}>
            <Panel flush>
              {products.map((prod, i) => (
                <ListRow
                  key={prod.id}
                  icon="box"
                  title={prod.name}
                  subtitle={prod.sku}
                  value={money(prod.price)}
                  onPress={() => addLine(prod)}
                  last={i === products.length - 1}
                />
              ))}
              {!products.length ? <EmptyBlock icon="search" title="Nothing matches" /> : null}
            </Panel>
          </View>
        ) : null}

        <View style={{ height: 20 }} />
        <SectionLabel>Bill details</SectionLabel>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Field icon="tag" label="Discount" value={discount} onChangeText={setDiscount} numeric decimal />
          </View>
          <View style={{ flex: 1 }}>
            <Field icon="doc" label="Reference" value={ref} onChangeText={setRef} />
          </View>
        </View>
        <Field icon="pencil" label="Note" value={note} onChangeText={setNote} />

        <View style={{ height: 8 }} />
        <SectionLabel>What changes</SectionLabel>
        <Panel>
          <DetailRow label="Was" value={money(sale.total)} />
          <DetailRow label="Becomes" value={money(t.total)} bold last={t.total === sale.total} />
          {t.total !== sale.total ? (
            <DetailRow
              label={t.total > sale.total ? 'Customer owes more' : 'Customer owes less'}
              value={(t.total > sale.total ? '+' : '') + money(t.total - sale.total)}
              bold
              tone={t.total > sale.total ? colors.good : colors.danger}
              last
            />
          ) : null}
        </Panel>
      </ScrollView>

      <StickyBar>
        {!gate.ok ? (
          <View style={{ marginBottom: 10 }}>
            <InfoBanner tone="warn" text={gate.why} />
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}><Button label="Cancel" onPress={() => navigation.goBack()} /></View>
          <View style={{ flex: 2 }}>
            <Button
              label="Save change"
              variant="pri"
              disabled={!gate.ok}
              icon={<Icon name="check" size={17} color={colors.accentInk} />}
              onPress={save}
            />
          </View>
        </View>
      </StickyBar>
    </View>
  );
}

function linesChanged(before: SaleLine[], after: SaleLine[]) {
  if (before.length !== after.length) return true;
  return after.some((l, i) => before[i].productId !== l.productId || before[i].qty !== l.qty || before[i].price !== l.price);
}

function stepper(colors: any) {
  return { width: 36, height: 36, borderRadius: 12, borderWidth: 1.4, borderColor: colors.line, alignItems: 'center' as const, justifyContent: 'center' as const };
}
