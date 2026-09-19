import React, { useState } from 'react';
import { View, Text, FlatList, Pressable, ScrollView } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Empty, Button, Cap, Chip, DocCard, Badge, FAB } from '../components/ui';
import { LineEditor, CartLine } from '../components/LineEditor';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'PurchaseOrders'>;

export default function PurchaseOrdersScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { db, money, party, receivePurchaseOrder } = useAppData();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={[...(db?.purchaseOrders || [])].reverse()}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        ListEmptyComponent={<Empty title="No purchase orders" subtitle="Order stock before receiving it as a purchase" />}
        renderItem={({ item }) => {
          const total = item.lines.reduce((s, l) => s + l.qty * l.cost, 0);
          return (
            <DocCard
              icon="cart"
              tone={item.status === 'received' ? 'good' : 'warn'}
              title={party(item.partyId)?.name || 'Supplier'}
              subtitle={item.lines.length + ' item' + (item.lines.length === 1 ? '' : 's')}
              amount={money(total)}
              no={item.no}
              date={new Date(item.ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
              badges={<Badge label={item.status} tone={item.status === 'received' ? 'good' : 'warn'} />}
            >
              {item.status === 'open' ? (
                <Button size="sm" label="Receive as purchase (credit)" onPress={() => receivePurchaseOrder(item.id, 'credit')} />
              ) : null}
            </DocCard>
          );
        }}
      />
      <FAB label="New order" icon="plus" tone="accent" onPress={() => navigation.navigate('PurchaseOrderNew')} />
    </View>
  );
}

export function PurchaseOrderNewScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'PurchaseOrderNew'>) {
  const { colors } = useTheme();
  const { db, money, createPurchaseOrder } = useAppData();
  const [partyId, setPartyId] = useState<string | null>(db?.parties.find((p) => p.type === 'supplier')?.id || null);
  const [lines, setLines] = useState<CartLine[]>([]);

  function save() {
    if (!lines.length || !partyId) return;
    createPurchaseOrder({
      partyId,
      lines: lines.map((l) => { const p = db!.products.find((x) => x.id === l.productId)!; return { productId: p.id, name: p.name, qty: l.qty, cost: p.cost }; }),
    });
    navigation.goBack();
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: 16 }}>
      <ScrollView>
        <Cap>Supplier</Cap>
        <FlatList
          horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }} contentContainerStyle={{ gap: 6 }}
          data={(db?.parties || []).filter((p) => p.type === 'supplier')} keyExtractor={(p) => p.id}
          renderItem={({ item }) => <Chip label={item.name} on={item.id === partyId} onPress={() => setPartyId(item.id)} />}
        />
        <Cap>Items to order</Cap>
        <View style={{ marginTop: 8 }}>
          <LineEditor products={(db?.products || []).filter((p) => p.active)} lines={lines} setLines={setLines} priceOf={(p) => p.cost} money={money} />
        </View>
      </ScrollView>
      <Button label="Create purchase order" variant="pri" onPress={save} disabled={!lines.length || !partyId} />
    </View>
  );
}
