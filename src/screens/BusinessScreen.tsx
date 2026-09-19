import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Panel, Badge, ListRow, SectionLabel, DetailRow } from '../components/ui';
import { Icon } from '../components/icons';

export default function BusinessScreen() {
  const { colors } = useTheme();
  const { db, setWarehouse } = useAppData();
  const warehouses = db?.warehouses || [];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
      <Panel>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
          <View style={{ width: 52, height: 52, borderRadius: 17, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="factory" size={25} color={colors.accent} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontFamily: fonts.uiExtra, fontSize: 19, color: colors.ink }}>{db?.firm.name}</Text>
            <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
              {db?.firm.address || 'No address set'}
            </Text>
          </View>
        </View>
        <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 14 }} />
        <DetailRow label="TIN" value={db?.firm.tin || '—'} />
        <DetailRow label="Phone" value={db?.firm.phone || '—'} last />
      </Panel>

      <View style={{ height: 20 }} />
      <SectionLabel right={<Badge label={warehouses.length + ' branches'} tone="neutral" />}>Branches</SectionLabel>
      <Panel flush>
        {warehouses.map((w, i) => {
          const current = w.id === db?.session.warehouse;
          return (
            <ListRow
              key={w.id}
              icon="home"
              tone={current ? 'good' : 'neutral'}
              title={w.name}
              subtitle={current ? 'Stock is sold from here' : 'Tap to sell from this branch'}
              badge={current ? <Badge label="Current" tone="good" /> : undefined}
              right={current ? <Icon name="check" size={20} color={colors.good} /> : <Icon name="chev" size={17} color={colors.faint} />}
              onPress={current ? undefined : () => setWarehouse(w.id)}
              last={i === warehouses.length - 1}
            />
          );
        })}
      </Panel>
    </ScrollView>
  );
}
