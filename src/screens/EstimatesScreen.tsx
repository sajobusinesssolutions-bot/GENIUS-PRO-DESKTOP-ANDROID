import React from 'react';
import { View, Text, FlatList, Pressable, Alert } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Empty, Button, DocCard, Badge, FAB } from '../components/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Estimates'>;

export default function EstimatesScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { db, money, party, convertEstimate, voidEstimate } = useAppData();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={[...(db?.estimates || [])].reverse()}
        keyExtractor={(e) => e.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 96, flexGrow: 1 }}
        ListEmptyComponent={<Empty title="No estimates" subtitle="Create a quotation for a customer" actionLabel="New estimate" onAction={() => navigation.navigate('EstimateNew')} />}
        renderItem={({ item }) => (
          <DocCard
            icon="doc"
            tone={item.status === 'open' ? 'accent' : item.status === 'converted' ? 'good' : 'neutral'}
            dim={item.status === 'void'}
            title={item.partyId ? party(item.partyId)?.name || 'Walk-in' : 'Walk-in'}
            subtitle={item.lines.length + ' item' + (item.lines.length === 1 ? '' : 's')}
            amount={money(item.total)}
            no={item.no}
            date={new Date(item.ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
            badges={<Badge label={item.status} tone={item.status === 'open' ? 'accent' : item.status === 'converted' ? 'good' : 'danger'} />}
          >
            {item.status === 'open' ? (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 2 }}>
                  <Button size="sm" label="Convert to sale" variant="pri" onPress={() => {
                    const sale = convertEstimate(item.id, 'cash');
                    if (sale) navigation.navigate('Receipt', { saleId: sale.id });
                  }} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button size="sm" label="Void" variant="dngr" onPress={() => Alert.alert('Void estimate', 'Are you sure?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Void', style: 'destructive', onPress: () => voidEstimate(item.id) }])} />
                </View>
              </View>
            ) : null}
          </DocCard>
        )}
      />
      <FAB label="New estimate" icon="plus" tone="accent" onPress={() => navigation.navigate('EstimateNew')} />
    </View>
  );
}
