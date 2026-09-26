import React, { useState, useMemo } from 'react';
import { View, Text, Pressable, FlatList } from 'react-native';
import { useTheme, fonts, spacing } from '../theme';
import { Button, Field } from './ui';
import { Sale } from '../data/types';

interface PaymentAllocationSheetProps {
  amount: number;
  money: (n: number) => string;
  bills: Sale[];
  onConfirm: (allocations: Array<{ saleId: string; amount: number }>) => void;
  onCancel: () => void;
}

export default function PaymentAllocationSheet({ amount, money, bills, onConfirm, onCancel }: PaymentAllocationSheetProps) {
  const { colors } = useTheme();
  const [allocations, setAllocations] = useState<Record<string, number>>(
    bills.reduce((acc, b) => ({ ...acc, [b.id]: 0 }), {})
  );

  const allocated = Object.values(allocations).reduce((s, a) => s + a, 0);
  const remaining = Math.max(0, amount - allocated);

  const smartAllocate = () => {
    const sorted = [...bills].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    let left = amount;
    const result: Record<string, number> = {};
    for (const bill of sorted) {
      const toAllocate = Math.min(left, bill.due);
      result[bill.id] = toAllocate;
      left -= toAllocate;
      if (left === 0) break;
    }
    setAllocations(result);
  };

  const handleConfirm = () => {
    const result = Object.entries(allocations)
      .filter(([_, amt]) => amt > 0)
      .map(([saleId, amt]) => ({ saleId, amount: amt }));
    onConfirm(result);
  };

  return (
    <View style={{ backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line, padding: spacing.lg, gap: spacing.lg, maxHeight: '80%' }}>
      <View>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 11, color: colors.faint, marginBottom: 4 }}>Allocate payment</Text>
        <Text style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink }}>{money(amount)}</Text>
      </View>

      {bills.length === 0 ? (
        <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint, textAlign: 'center', paddingVertical: 20 }}>
          No open bills
        </Text>
      ) : (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint }}>
              Allocated: {money(allocated)} · Remaining: {money(remaining)}
            </Text>
            <Pressable onPress={smartAllocate}>
              <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.accent }}>Auto-allocate</Text>
            </Pressable>
          </View>

          <FlatList
            data={bills}
            keyExtractor={(b) => b.id}
            scrollEnabled={bills.length > 3}
            renderItem={({ item }) => {
              const alloc = allocations[item.id] || 0;
              return (
                <View key={item.id} style={{ marginBottom: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.line }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: colors.ink }}>{item.no}</Text>
                    <Text style={{ fontFamily: fonts.monoSemi, fontSize: 12, color: colors.faint }}>Due: {money(item.due)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Field
                        label="Amount to apply"
                        value={alloc ? String(alloc) : ''}
                        onChangeText={(text) => {
                          const next = Math.min(item.due, Math.max(0, Number(text.replace(/[^0-9.]/g, '')) || 0));
                          setAllocations((p) => ({ ...p, [item.id]: next }));
                        }}
                        numeric
                        decimal
                        compact
                      />
                    </View>
                  </View>
                </View>
              );
            }}
          />
        </>
      )}

      <View style={{ flexDirection: 'row', gap: spacing.lg }}>
        <View style={{ flex: 1 }}>
          <Button label="Cancel" onPress={onCancel} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Apply" variant="pri" onPress={handleConfirm} disabled={allocated === 0} />
        </View>
      </View>
    </View>
  );
}
