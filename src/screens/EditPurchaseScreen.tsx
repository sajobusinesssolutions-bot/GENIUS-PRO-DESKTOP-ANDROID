import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Alert, Pressable, TextInput } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import {
  Button, Panel, SectionLabel, DetailRow, InfoBanner, StickyBar, Search, ListRow, EmptyBlock,
} from '../components/ui';
import { Icon } from '../components/icons';
import { Field } from '../components/form';
import type { PurchaseLine, Product } from '../data/types';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'EditPurchase'>;

/**
 * The purchase counterpart of SCREENS.editSale (17509) — same shape, same
 * rule: the bill is reversed and reposted under its own number, never
 * rewritten in place (A.editSaleSave, 17612).
 */
export default function EditPurchaseScreen({ route, navigation }: Props) {
  const { colors } = useTheme();
  const { db, money, party, product, editPurchase, canEditPurchase, can, logAudit } = useAppData();
  const x = db?.purchases.find((p) => p.id === route.params.purchaseId);

  const [lines, setLines] = useState<PurchaseLine[]>(() => x ? x.lines.map((l) => ({ ...l })) : []);
  const [ref, setRef] = useState(x?.ref || '');
  const [note, setNote] = useState(x?.note || '');
  const [q, setQ] = useState('');

  const products = useMemo(() => (db?.products || []).filter((p) => p.active &&
    (!q || p.name.toLowerCase().includes(q.toLowerCase()) || p.sku.toLowerCase().includes(q.toLowerCase()))).slice(0, 20), [db, q]);

  if (!x) return null;
  const gate = canEditPurchase(x.id);
  const total = lines.reduce((s, l) => s + l.qty * l.cost, 0);

  function setQty(id: string, qty: number) {
    setLines((prev) => qty <= 0 ? prev.filter((l) => l.productId !== id) : prev.map((l) => l.productId === id ? { ...l, qty } : l));
  }
  function addLine(p: Product) {
    setQ('');
    setLines((prev) => prev.find((l) => l.productId === p.id)
      ? prev.map((l) => l.productId === p.id ? { ...l, qty: l.qty + 1 } : l)
      : [...prev, { productId: p.id, qty: 1, cost: p.cost }]);
  }

  function save() {
    if (!can('purchases.edit')) { Alert.alert('Not allowed', 'Your role cannot change a purchase.'); return; }
    const kept = lines.filter((l) => l.qty > 0);
    if (!kept.length) { Alert.alert('Nothing to receive', 'A purchase needs at least one line.'); return; }
    const fresh = canEditPurchase(x!.id);
    if (!fresh.ok) { Alert.alert('Cannot change this purchase', fresh.why); return; }
    Alert.alert(
      'Save the change to ' + x!.no + '?',
      'The purchase as it stands (' + money(x!.total) + ') is reversed and reposted as ' + money(total) + ' under the same number. Both postings stay in the books.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save', onPress: () => {
            const out = editPurchase(x!.id, { partyId: x!.partyId, lines: kept, method: x!.method, ref, note }, 'Edited on the purchase');
            if (!out) { Alert.alert('Not saved', 'That purchase can no longer be changed.'); return; }
            logAudit('Purchase edited', x!.no + ' — ' + money(x!.total) + ' to ' + money(out.total));
            navigation.replace('PurchaseDetail', { purchaseId: out.id });
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
          text="Changing a received purchase reverses the original posting and posts it again under the same number. Both stay in the books."
        />

        <View style={{ height: 16 }} />
        <Panel>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
            <View style={{ width: 48, height: 48, borderRadius: 15, backgroundColor: colors.warnSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="cart" size={22} color={colors.warn} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiExtra, fontSize: 19, color: colors.ink }}>{x.no}</Text>
              <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                {party(x.partyId)?.name || 'Supplier'} · {new Date(x.ts).toLocaleDateString()} · {x.method}
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
          Goods received
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
              <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: colors.warnSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: colors.warn }}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>
                  {product(l.productId)?.name || l.productId}
                </Text>
                <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 3 }}>
                  {money(l.cost)} each
                </Text>
              </View>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{money(l.qty * l.cost)}</Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 13 }}>
              <Pressable onPress={() => setQty(l.productId, l.qty - 1)} style={stepper(colors)}>
                <Text style={{ color: colors.ink, fontFamily: fonts.uiBold, fontSize: 19 }}>−</Text>
              </Pressable>
              <Text style={{ flex: 1, textAlign: 'center', fontFamily: fonts.uiExtra, fontSize: 18, color: colors.ink }}>{l.qty}</Text>
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
                  tone="warn"
                  title={prod.name}
                  subtitle={prod.sku}
                  value={money(prod.cost)}
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
        <Field icon="doc" label="Your reference" value={ref} onChangeText={setRef} />
        <Field icon="pencil" label="Note" value={note} onChangeText={setNote} />

        <View style={{ height: 8 }} />
        <SectionLabel>What changes</SectionLabel>
        <Panel>
          <DetailRow label="Was" value={money(x.total)} />
          <DetailRow label="Becomes" value={money(total)} bold last={total === x.total} />
          {total !== x.total ? (
            <DetailRow
              label={total > x.total ? 'You owe more' : 'You owe less'}
              value={(total > x.total ? '+' : '') + money(total - x.total)}
              bold
              tone={total > x.total ? colors.danger : colors.good}
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

function stepper(colors: any) {
  return { width: 36, height: 36, borderRadius: 12, borderWidth: 1.4, borderColor: colors.line, alignItems: 'center' as const, justifyContent: 'center' as const };
}
