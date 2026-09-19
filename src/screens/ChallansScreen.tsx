import React, { useState } from 'react';
import { View, Text, FlatList, Pressable, ScrollView } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Empty, Button, Cap, Chip, DocCard, Badge, FAB, Field, InfoBanner } from '../components/ui';
import DocEntry from '../components/DocEntry';
import { LineEditor, CartLine } from '../components/LineEditor';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Challans'>;

export default function ChallansScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { db, party, markChallanDelivered } = useAppData();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={[...(db?.challans || [])].reverse()}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 96, flexGrow: 1 }}
        ListEmptyComponent={<Empty title="No delivery challans" subtitle="Dispatch goods without invoicing yet" actionLabel="New challan" onAction={() => navigation.navigate('ChallanNew', {})} />}
        renderItem={({ item }) => (
          <DocCard
            icon="swap"
            tone={item.status === 'delivered' ? 'good' : 'warn'}
            title={item.partyId ? party(item.partyId)?.name || 'Walk-in' : 'Walk-in'}
            subtitle={item.lines.length + ' item' + (item.lines.length === 1 ? '' : 's')}
            no={item.no}
            date={new Date(item.ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
            badges={<Badge label={item.status} tone={item.status === 'delivered' ? 'good' : 'warn'} />}
          >
            {item.status === 'dispatched' ? (
              <Button size="sm" label="Mark delivered" onPress={() => markChallanDelivered(item.id)} />
            ) : null}
          </DocCard>
        )}
      />
      <FAB label="New challan" icon="plus" tone="accent" onPress={() => navigation.navigate('ChallanNew', {})} />
    </View>
  );
}

export function ChallanNewScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'ChallanNew'>) {
  const { db, createChallan } = useAppData();
  const [partyId, setPartyId] = useState<string | null>(null);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [driver, setDriver] = useState('');
  const [vehicle, setVehicle] = useState('');

  return (
    <DocEntry
      kind="Delivery note"
      icon="swap"
      tone="warn"
      partyType="customer"
      partyLabel="Deliver to"
      partyId={partyId}
      onPartyChange={setPartyId}
      lines={lines}
      onLinesChange={setLines}
      linesLabel="Goods to dispatch"
      showTotals={false}
      saveLabel="Create delivery note"
      askWho="Who dispatched this?"
      summary={
        <InfoBanner
          tone="neutral"
          icon="bulb"
          text="A delivery note moves goods without invoicing. Raise the bill separately when the customer is charged."
        />
      }
      onSave={() => {
        createChallan({
          saleId: null,
          partyId,
          lines: lines.map((l) => {
            const prod = db!.products.find((x) => x.id === l.productId)!;
            return { productId: prod.id, name: prod.name, qty: l.qty, unit: prod.unit };
          }),
        });
        navigation.goBack();
      }}
    >
      <Field icon="user" label="Driver" value={driver} onChangeText={setDriver} placeholder="Who is carrying it" />
      <Field icon="taxi" label="Vehicle / plate" value={vehicle} onChangeText={setVehicle} placeholder="Optional" />
    </DocEntry>
  );
}
