import React, { useState } from 'react';
import { View, Text, FlatList, Pressable, ScrollView, TextInput } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Empty, Button, Cap, Chip, DocCard, Badge } from '../components/ui';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Offers'>;

export default function OffersScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { db, updateOffer, removeOffer } = useAppData();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={[...(db?.offers || [])].reverse()}
        keyExtractor={(o) => o.id}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        ListEmptyComponent={<Empty title="No offers" subtitle="Set up a discount or promo applied at POS" />}
        renderItem={({ item }) => (
          <DocCard
            icon="gift"
            tone={item.active ? 'good' : 'neutral'}
            dim={!item.active}
            title={item.name}
            subtitle={(item.kind === 'percent' ? item.value + '% off' : 'Sh ' + item.value + ' off') + ' · ' + item.scope + (item.target ? ' (' + item.target + ')' : '')}
            badges={<Badge label={item.active ? 'Active' : 'Off'} tone={item.active ? 'good' : 'neutral'} />}
          >
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Button size="sm" label={item.active ? 'Disable' : 'Enable'} onPress={() => updateOffer(item.id, { active: !item.active })} />
              </View>
              <View style={{ flex: 1 }}>
                <Button size="sm" label="Delete" variant="dngr" onPress={() => removeOffer(item.id)} />
              </View>
            </View>
          </DocCard>
        )}
      />
      <Pressable onPress={() => navigation.navigate('OfferNew')} style={{ position: 'absolute', right: 18, bottom: 18, width: 52, height: 52, borderRadius: 16, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.accentInk, fontSize: 24, fontFamily: fonts.uiBold }}>+</Text>
      </Pressable>
    </View>
  );
}

export function OfferNewScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'OfferNew'>) {
  const { colors } = useTheme();
  const { db, addOffer } = useAppData();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'percent' | 'fixed'>('percent');
  const [value, setValue] = useState('');
  const [scope, setScope] = useState<'product' | 'category' | 'all'>('all');
  const [target, setTarget] = useState<string | null>(null);

  const cats = Array.from(new Set((db?.products || []).map((p) => p.category)));

  function save() {
    if (!name || !value) return;
    const now = new Date();
    const to = new Date(now); to.setMonth(to.getMonth() + 3);
    addOffer({ name, kind, value: parseFloat(value) || 0, scope, target, from: now.toISOString(), to: to.toISOString(), active: true });
    navigation.goBack();
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: 16 }}>
      <ScrollView>
        <Cap>Name</Cap>
        <TextInput value={name} onChangeText={setName} placeholder="e.g. End of month sale" placeholderTextColor={colors.faint}
          style={{ height: 52, borderRadius: 13, borderWidth: 1.4, borderColor: colors.line, paddingHorizontal: 14, color: colors.ink, backgroundColor: colors.surface, fontFamily: fonts.ui, fontSize: 15, marginTop: 8, marginBottom: 14 }} />
        <Cap>Discount type</Cap>
        <View style={{ flexDirection: 'row', gap: 6, marginVertical: 8 }}>
          <Chip label="Percent %" on={kind === 'percent'} onPress={() => setKind('percent')} />
          <Chip label="Fixed amount" on={kind === 'fixed'} onPress={() => setKind('fixed')} />
        </View>
        <Cap>Value</Cap>
        <TextInput value={value} onChangeText={setValue} keyboardType="numeric" placeholder={kind === 'percent' ? '10' : '5000'} placeholderTextColor={colors.faint}
          style={{ height: 52, borderRadius: 13, borderWidth: 1.4, borderColor: colors.line, paddingHorizontal: 14, color: colors.ink, backgroundColor: colors.surface, fontFamily: fonts.ui, fontSize: 15, marginTop: 8, marginBottom: 14 }} />
        <Cap>Applies to</Cap>
        <View style={{ flexDirection: 'row', gap: 6, marginVertical: 8, flexWrap: 'wrap' }}>
          <Chip label="Whole cart" on={scope === 'all'} onPress={() => { setScope('all'); setTarget(null); }} />
          <Chip label="Category" on={scope === 'category'} onPress={() => setScope('category')} />
        </View>
        {scope === 'category' && (
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {cats.map((c) => <Chip key={c} label={c} on={c === target} onPress={() => setTarget(c)} />)}
          </View>
        )}
      </ScrollView>
      <Button label="Create offer" variant="pri" onPress={save} disabled={!name || !value} />
    </View>
  );
}
