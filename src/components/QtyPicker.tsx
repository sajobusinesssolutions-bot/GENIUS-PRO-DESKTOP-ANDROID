import React, { useState } from 'react';
import { View, Text, Pressable, Modal, TextInput } from 'react-native';
import { useTheme, fonts, spacing } from '../theme';
import { Button } from './ui';

interface QtyPickerProps {
  visible: boolean;
  productName: string;
  onConfirm: (qty: number) => void;
  onCancel: () => void;
  maxStock: number;
  money: (n: number) => string;
  price: number;
}

export default function QtyPicker({ visible, productName, onConfirm, onCancel, maxStock, money, price }: QtyPickerProps) {
  const { colors } = useTheme();
  const [qty, setQty] = useState('1');
  const qtyNum = Math.min(parseInt(qty) || 1, maxStock);
  const lineTotal = qtyNum * price;

  const addDigit = (d: string) => {
    const next = qty === '0' ? d : qty + d;
    setQty(next);
  };

  const confirm = () => {
    onConfirm(qtyNum);
    setQty('1');
  };

  const cancel = () => {
    setQty('1');
    onCancel();
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={cancel} />
      <View style={{
        backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
        padding: spacing.lg, gap: spacing.lg,
      }}>
        <View>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginBottom: 4 }}>Add to cart</Text>
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 16, color: colors.ink }}>{productName}</Text>
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.lg, alignItems: 'center' }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>Quantity</Text>
            <TextInput
              value={qty}
              onChangeText={setQty}
              keyboardType="numeric"
              style={{
                height: 44, borderRadius: 10, borderWidth: 1, borderColor: colors.lineHard,
                paddingHorizontal: spacing.md, fontFamily: fonts.monoSemi, fontSize: 18,
                backgroundColor: colors.sunk, color: colors.ink,
              }}
            />
          </View>
          <View style={{ gap: 4 }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>Total</Text>
            <Text style={{ fontFamily: fonts.monoSemi, fontSize: 18, color: colors.ink, textAlign: 'center' }}>{money(lineTotal)}</Text>
          </View>
        </View>

        {/* Number pad */}
        <View style={{ gap: spacing.sm }}>
          {[
            ['1', '2', '3'],
            ['4', '5', '6'],
            ['7', '8', '9'],
            ['0'],
          ].map((row, ri) => (
            <View key={ri} style={{ flexDirection: 'row', gap: spacing.sm }}>
              {row.map((d) => (
                <Pressable
                  key={d}
                  onPress={() => addDigit(d)}
                  style={{
                    flex: 1, height: 44, borderRadius: 10, backgroundColor: colors.sunk,
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 18, color: colors.ink }}>{d}</Text>
                </Pressable>
              ))}
              {ri === 3 && (
                <Pressable
                  onPress={() => setQty(qty.slice(0, -1) || '0')}
                  style={{
                    flex: 1, height: 44, borderRadius: 10, backgroundColor: colors.lineHard,
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 18, color: colors.ink }}>←</Text>
                </Pressable>
              )}
            </View>
          ))}
        </View>

        {/* Actions */}
        <View style={{ flexDirection: 'row', gap: spacing.lg }}>
          <View style={{ flex: 1 }}>
            <Button label="Cancel" onPress={cancel} />
          </View>
          <View style={{ flex: 1 }}>
            <Button label="Add" variant="pri" onPress={confirm} />
          </View>
        </View>
      </View>
    </Modal>
  );
}
