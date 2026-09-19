import React, { useState } from 'react';
import { View, ScrollView } from 'react-native';
import { useTheme } from '../theme';
import { useAppData } from '../data/AppDataContext';
import {
  Panel, Button, Field, Badge, ListRow, SectionLabel, InfoBanner,
} from '../components/ui';
import { Icon } from '../components/icons';

export default function FirmsScreen() {
  const { colors } = useTheme();
  const { db, switchFirm, addFirm } = useAppData();
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);

  const firms = db?.firms || [];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
      <SectionLabel right={<Badge label={firms.length + ' total'} tone="neutral" />}>Your businesses</SectionLabel>
      <Panel flush>
        {firms.map((f, i) => {
          const active = f.id === db?.activeFirmId;
          return (
            <ListRow
              key={f.id}
              icon="factory"
              tone={active ? 'good' : 'neutral'}
              title={f.name}
              subtitle={f.tin ? 'TIN ' + f.tin : f.address || 'No details yet'}
              badge={active ? <Badge label="Active" tone="good" /> : undefined}
              right={active ? <Icon name="check" size={20} color={colors.good} /> : <Icon name="chev" size={17} color={colors.faint} />}
              onPress={active ? undefined : () => switchFirm(f.id)}
              last={i === firms.length - 1}
            />
          );
        })}
      </Panel>

      <View style={{ height: 16 }} />
      <InfoBanner
        tone="neutral"
        icon="doc"
        text="Each business keeps its own name and TIN on receipts and reports. This is separate from Business & Branches, which manages warehouses inside the active business."
      />

      <View style={{ height: 20 }} />
      {!adding ? (
        <Button
          label="Add another business"
          icon={<Icon name="plus" size={17} color={colors.ink} />}
          onPress={() => setAdding(true)}
        />
      ) : (
        <>
          <SectionLabel>New business</SectionLabel>
          <Field icon="factory" label="Business name" value={name} onChangeText={setName} placeholder="Required" />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button label="Cancel" onPress={() => { setName(''); setAdding(false); }} />
            </View>
            <View style={{ flex: 2 }}>
              <Button
                label="Create business"
                variant="pri"
                disabled={!name.trim()}
                onPress={() => {
                  const f = addFirm({ name: name.trim(), tin: '', address: '', phone: '' });
                  switchFirm(f.id);
                  setName('');
                  setAdding(false);
                }}
              />
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}
