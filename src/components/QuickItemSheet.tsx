/**
 * A NEW ITEM WITHOUT LEAVING THE PURCHASE.
 *
 * A delivery often brings something the shop has never stocked. Going to Items,
 * adding it, and coming back meant losing the place in the purchase. This asks
 * only what a delivery needs — name, unit, cost, selling price, and whether it
 * is tracked by batch — and everything else can be filled in later on the item.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Sheet } from './Sheet';
import { Field, ToggleRow } from './form';
import { Button } from './ui';
import { useTheme, fonts, radius } from '../theme';

export interface QuickItem {
  name: string; unit: string; category: string;
  cost: number; price: number; trackBatches: boolean;
}

export function QuickItemSheet({ visible, initialName, units, categories, batchesDefault, onClose, onSave }: {
  visible: boolean;
  initialName: string;
  units: string[];
  categories: string[];
  batchesDefault: boolean;
  onClose: () => void;
  onSave: (item: QuickItem) => void;
}) {
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('pcs');
  const [category, setCategory] = useState('');
  const [cost, setCost] = useState('');
  const [price, setPrice] = useState('');
  const [batches, setBatches] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setName(initialName);
    setUnit(units[0] || 'pcs');
    setCategory(categories[0] || 'General');
    setCost(''); setPrice('');
    setBatches(batchesDefault);
  }, [visible]);

  const c = Number(cost.replace(/,/g, '')) || 0;
  const p = Number(price.replace(/,/g, '')) || 0;
  const below = p > 0 && c > 0 && p < c;

  const chips = (list: string[], value: string, set: (v: string) => void) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
      {list.map((u) => {
        const on = u === value;
        return (
          <Pressable
            key={u}
            onPress={() => set(u)}
            style={{
              paddingVertical: 8, paddingHorizontal: 13, borderRadius: radius.pill, borderWidth: 1.4,
              borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accentSoft : colors.surface,
            }}
          >
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: on ? colors.accent : colors.soft }}>{u}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      icon="box"
      title="New item"
      subtitle="Added to Items and to this purchase"
      full
      footer={
        <Button
          variant="pri"
          label="Add to the purchase"
          disabled={!name.trim()}
          onPress={() => onSave({ name: name.trim(), unit, category, cost: c, price: p, trackBatches: batches })}
        />
      }
    >
      <Field label="Item name *" value={name} onChangeText={setName} icon="box" autoCapitalize="words" />
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint, marginBottom: 8 }}>Unit</Text>
      {chips(units.length ? units : ['pcs'], unit, setUnit)}
      {categories.length > 1 ? (
        <>
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint, marginBottom: 8 }}>Category</Text>
          {chips(categories, category, setCategory)}
        </>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Field label="Cost price" value={cost} onChangeText={setCost} decimal icon="coins" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Selling price" value={price} onChangeText={setPrice} decimal icon="tag"
            error={below ? 'Below the cost' : undefined} />
        </View>
      </View>
      <ToggleRow
        label="Track by batch"
        sub="Lot numbers and expiry dates, for medicine, food and the like"
        on={batches}
        onChange={setBatches}
      />
    </Sheet>
  );
}

export default QuickItemSheet;
