import React, { useState } from 'react';
import { View, Text, FlatList, TextInput, Alert } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Empty, Button, Cap, Panel, AccentHead, SectionLabel, Field, ListRow, EmptyBlock } from '../components/ui';
import { Icon } from '../components/icons';

export default function ProductionScreen() {
  const { colors } = useTheme();
  const { db, money, stockOf, product, runProduction } = useAppData();
  const [qtys, setQtys] = useState<Record<string, string>>({});

  const assemblies = (db?.products || []).filter((p) => p.bom && p.bom.length > 0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={[...(db?.productionRuns || [])].reverse().slice(0, 10)}
        ListHeaderComponent={
          <View style={{ padding: 16 }}>
            <AccentHead title="Assemblies" tone="accent" />
            {!assemblies.length ? (
              <Panel>
                <EmptyBlock
                  icon="factory"
                  title="No assemblies yet"
                  hint="Give a product a bill of materials and it can be built from its components here."
                />
              </Panel>
            ) : null}
            {assemblies.map((p) => (
              <Panel key={p.id} style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 20 }}>{p.emoji || '🧩'}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{p.name}</Text>
                    <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                      {stockOf(p)} {p.unit} in stock
                    </Text>
                  </View>
                </View>

                <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 12 }} />

                <SectionLabel>Needs per unit</SectionLabel>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 19, color: colors.soft, marginBottom: 14 }}>
                  {(p.bom || []).map((b) => `${b.qty} × ${product(b.productId)?.name || b.productId}`).join(' · ')}
                </Text>

                <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <Field
                      icon="box"
                      numeric
                      placeholder="Qty to make"
                      value={qtys[p.id] || ''}
                      onChangeText={(v) => setQtys((s) => ({ ...s, [p.id]: v }))}
                      style={{ marginBottom: 0 }}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      label="Run"
                      variant="pri"
                      icon={<Icon name="factory" size={16} color={colors.accentInk} />}
                      onPress={() => {
                        const qty = parseFloat(qtys[p.id] || '0');
                        if (!qty) return;
                        const run = runProduction(p.id, qty);
                        if (!run) Alert.alert('Not enough stock', 'One or more components do not have enough stock for this run.');
                        else setQtys((s) => ({ ...s, [p.id]: '' }));
                      }}
                    />
                  </View>
                </View>
              </Panel>
            ))}

            <View style={{ height: 8 }} />
            <AccentHead title="Recent runs" tone="good" />
          </View>
        }
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
        ListEmptyComponent={
          <View style={{ paddingHorizontal: 16 }}>
            <Panel>
              <EmptyBlock icon="clock" title="No production runs yet" hint="Runs you make will be listed here." />
            </Panel>
          </View>
        }
        renderItem={({ item }) => (
          <View
            style={{
              backgroundColor: colors.surface, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 13,
              marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12,
              shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2,
            }}
          >
            <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: colors.goodSoft, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="factory" size={19} color={colors.good} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>
                {product(item.productId)?.name || 'Item'}
              </Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
                {new Date(item.ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
              </Text>
            </View>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.good }}>+{item.qty}</Text>
          </View>
        )}
      />
    </View>
  );
}
