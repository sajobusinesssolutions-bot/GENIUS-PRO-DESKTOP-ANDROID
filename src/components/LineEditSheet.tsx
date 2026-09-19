import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable } from 'react-native';
import { useTheme, fonts } from '../theme';
import { Button } from './ui';
import { Icon } from './icons';
import Sheet from './Sheet';
import type { SaleLine } from '../data/types';

export default function LineEditSheet({ visible, line, maxStock, money, onSave, onRemove, onClose }: {
  visible: boolean;
  line: SaleLine | null;
  maxStock: number;
  money: (n: number) => string;
  onSave: (patch: { qty: number; price: number; discountPct: number; listPrice: number }) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const [qty, setQty] = useState('1');
  const [listPrice, setListPrice] = useState('0');
  const [discountPct, setDiscountPct] = useState('0');

  useEffect(() => {
    if (visible && line) {
      setQty(String(line.qty));
      setListPrice(String(line.listPrice ?? line.price));
      setDiscountPct(String(line.discountPct ?? 0));
    }
  }, [visible, line]);

  if (!line) return null;

  const qtyNum = Math.max(0, Number(qty) || 0);
  const listNum = Math.max(0, Number(listPrice) || 0);
  const discNum = Math.min(100, Math.max(0, Number(discountPct) || 0));
  const netPrice = listNum * (1 - discNum / 100);
  const lineTotal = qtyNum * netPrice;
  const overStock = qtyNum > maxStock;

  function step(by: number) {
    setQty(String(Math.max(0, qtyNum + by)));
  }

  return (
    <Sheet
      visible={visible}
      title="Edit item"
      onClose={onClose}
      footer={
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button label="Remove" variant="dngr" icon={<Icon name="trash" size={15} color={colors.danger} />} onPress={onRemove} />
          </View>
          <View style={{ flex: 2 }}>
            <Button
              label={'Save · ' + money(lineTotal)}
              variant="pri"
              disabled={qtyNum <= 0 || overStock}
              onPress={() => onSave({ qty: qtyNum, price: netPrice, discountPct: discNum, listPrice: listNum })}
            />
          </View>
        </View>
      }
    >
      <View style={{ gap: 16 }}>
        <View>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 17, color: colors.ink }}>{line.name}</Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 3 }}>
            {line.sku}{line.batchNo ? ' · Batch ' + line.batchNo : ''} · {maxStock} {line.unit} available
          </Text>
        </View>

        <View style={{ gap: 6 }}>
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11.5, color: colors.faint, letterSpacing: 0.3 }}>QUANTITY</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Pressable onPress={() => step(-1)} style={{ width: 48, height: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.lineHard, backgroundColor: colors.sunk, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 22, color: colors.ink }}>−</Text>
            </Pressable>
            <TextInput
              value={qty}
              onChangeText={setQty}
              keyboardType="numeric"
              selectTextOnFocus
              style={{ flex: 1, height: 48, textAlign: 'center', borderRadius: 14, borderWidth: 1, borderColor: overStock ? colors.danger : colors.lineHard, backgroundColor: colors.sunk, color: overStock ? colors.danger : colors.ink, fontFamily: fonts.uiBold, fontSize: 19 }}
            />
            <Pressable onPress={() => step(1)} style={{ width: 48, height: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.lineHard, backgroundColor: colors.sunk, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 22, color: colors.ink }}>+</Text>
            </Pressable>
          </View>
          {overStock ? <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.danger }}>Only {maxStock} {line.unit} in stock.</Text> : null}
        </View>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11.5, color: colors.faint, letterSpacing: 0.3 }}>UNIT PRICE</Text>
            <TextInput
              value={listPrice}
              onChangeText={setListPrice}
              keyboardType="numeric"
              selectTextOnFocus
              style={{ height: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.lineHard, backgroundColor: colors.sunk, paddingHorizontal: 12, color: colors.ink, fontFamily: fonts.monoSemi, fontSize: 15 }}
            />
          </View>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11.5, color: colors.faint, letterSpacing: 0.3 }}>DISCOUNT %</Text>
            <TextInput
              value={discountPct}
              onChangeText={setDiscountPct}
              keyboardType="numeric"
              selectTextOnFocus
              style={{ height: 46, borderRadius: 12, borderWidth: 1, borderColor: colors.lineHard, backgroundColor: colors.sunk, paddingHorizontal: 12, color: colors.ink, fontFamily: fonts.monoSemi, fontSize: 15 }}
            />
          </View>
        </View>

        <View style={{ backgroundColor: colors.sunk, borderRadius: 14, padding: 14, gap: 8 }}>
          <Row label={'Net price × ' + qtyNum} value={money(netPrice)} colors={colors} />
          {discNum > 0 ? <Row label="You save" value={'− ' + money(qtyNum * (listNum - netPrice))} colors={colors} tone={colors.good} /> : null}
          <View style={{ height: 1, backgroundColor: colors.line }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: colors.ink }}>Line total</Text>
            <Text style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink }}>{money(lineTotal)}</Text>
          </View>
        </View>
      </View>
    </Sheet>
  );
}

function Row({ label, value, colors, tone }: { label: string; value: string; colors: any; tone?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{label}</Text>
      <Text style={{ fontFamily: fonts.monoSemi, fontSize: 12.5, color: tone || colors.ink }}>{value}</Text>
    </View>
  );
}
