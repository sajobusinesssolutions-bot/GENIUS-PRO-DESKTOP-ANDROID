import React, { useState } from 'react';
import { ToastHost } from './Toast';
import { View, Text, Modal, TextInput } from 'react-native';
import { Pressable } from './Press';
import { useTheme, fonts, spacing } from '../theme';
import { Button, Field } from './ui';
import KeyboardSafe from './KeyboardSafe';

interface QtyPickerProps {
  visible: boolean;
  /** What the quantity starts at: '' (typed by the cashier) unless the item fills it in. */
  start?: string;
  productName: string;
  onConfirm: (qty: number) => void;
  onCancel: () => void;
  maxStock: number;
  money: (n: number) => string;
  price: number;
}

export default function QtyPicker({ visible, productName, onConfirm, onCancel, maxStock, money, price, start = '' }: QtyPickerProps) {
  const { colors } = useTheme();
  const [qty, setQty] = useState(start);
  React.useEffect(() => { if (visible) setQty(start); }, [visible, start]);
  // maxStock is Infinity for a service, or when the shop allows selling below zero
  const qtyNum = Math.min(parseFloat(qty) || 0, maxStock);
  const lineTotal = qtyNum * price;

  const addDigit = (d: string) => {
    const next = qty === '0' ? d : qty + d;
    setQty(next);
  };

  const confirm = () => {
    if (qtyNum <= 0) return;
    onConfirm(qtyNum);
    setQty(start);
  };

  const cancel = () => {
    setQty(start);
    onCancel();
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <KeyboardSafe>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={cancel} />
          <View style={{
            backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
            padding: spacing.lg, gap: spacing.lg,
          }}>
        <View>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginBottom: 4 }}>Add to cart</Text>
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{productName}</Text>
        </View>

        <View style={{ flexDirection: 'row', gap: spacing.lg, alignItems: 'center' }}>
          <Field style={{ flex: 1, marginBottom: 0 }} label="Quantity" value={qty} onChangeText={setQty} numeric decimal autoFocus={!start} />
          <View style={{ gap: 4 }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>Total</Text>
            <Text style={{ fontFamily: fonts.monoSemi, fontSize: 20, color: colors.ink, textAlign: 'center' }}>{money(lineTotal)}</Text>
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
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 20, color: colors.ink }}>{d}</Text>
                </Pressable>
              ))}
              {ri === 3 && (
                <Pressable
                  onPress={() => setQty(qty.slice(0, -1))}
                  style={{
                    flex: 1, height: 44, borderRadius: 10, backgroundColor: colors.lineHard,
                    alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 20, color: colors.ink }}>←</Text>
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
            <Button label="Add" variant="pri" disabled={qtyNum <= 0} onPress={confirm} />
          </View>
        </View>
          </View>
        </View>
      </KeyboardSafe>
      <ToastHost />
    </Modal>
  );
}
