/**
 * Batch and expiry entry.
 *
 * One compact card per batch: its lot number and quantity side by side, and
 * the expiry as a single date box beneath that colours itself by how close
 * the date is. Above the cards, a thin bar shows how much of the item is
 * placed in a batch.
 */
import React, { useState } from 'react';
import { View, Text, Platform } from 'react-native';
import { Pressable } from './Press';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme, fonts, radius } from '../theme';
import { Field } from './ui';
import { Icon } from './icons';
import { expiryState, daysToExpiry } from '../data/batches';
import type { ProductBatch } from '../data/types';

function fmt(iso: string) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function BatchEditor({ batches, onChange, unit = 'pcs', suggestNo, target }: {
  batches: ProductBatch[];
  onChange: (next: ProductBatch[]) => void;
  unit?: string;
  /**
   * How much of the item there is in total. Batches are a breakdown of that
   * quantity, not a second count of it.
   */
  target?: number;
  /** Used to seed the number of a freshly added batch. */
  suggestNo?: () => string;
}) {
  const { colors } = useTheme();
  const [picking, setPicking] = useState<number | null>(null);

  function patch(i: number, p: Partial<ProductBatch>) {
    onChange(batches.map((b, idx) => (idx === i ? { ...b, ...p } : b)));
  }

  function add() {
    onChange([...batches, { no: '', expiry: '', qty: 0 }]);
  }

  function remove(i: number) {
    onChange(batches.filter((_, idx) => idx !== i));
  }

  const total = batches.reduce((s, b) => s + (Number(b.qty) || 0), 0);
  const hasTarget = target !== undefined && target > 0;
  const left = hasTarget ? target! - total : 0;
  const over = hasTarget && left < 0;
  const tone = over ? colors.danger : hasTarget && left === 0 ? colors.good : colors.accent;

  return (
    <View>
      {/* how much of the item sits in a batch */}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.faint }}>
          {over
            ? (-left) + ' ' + unit + ' too many'
            : hasTarget && left > 0 ? left + ' ' + unit + ' not in a batch' : hasTarget ? 'All in batches' : 'In batches'}
        </Text>
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: over ? colors.danger : colors.ink }}>
          {hasTarget ? total + ' / ' + target + ' ' + unit : total + ' ' + unit}
        </Text>
      </View>
      {hasTarget ? (
        <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.sunk, overflow: 'hidden', marginBottom: 12 }}>
          <View style={{
            height: 4, borderRadius: 2, backgroundColor: tone,
            width: (Math.min(100, Math.round((total / target!) * 100)) + '%') as `${number}%`,
          }} />
        </View>
      ) : <View style={{ height: 6 }} />}

      {batches.map((b, i) => {
        const state = expiryState(b);
        const days = daysToExpiry(b);
        const fg = state === 'expired' || state === 'critical' ? colors.danger
          : state === 'soon' ? colors.warn : state === 'none' ? colors.faint : colors.good;
        const soft = state === 'expired' || state === 'critical' ? colors.dangerSoft
          : state === 'soon' ? colors.warnSoft : state === 'none' ? colors.sunk : colors.goodSoft;
        const when = state === 'none' ? '' : state === 'expired' ? 'Expired' : (days ?? 0) + 'd left';
        return (
          <View
            key={i}
            style={{
              borderRadius: radius.md, borderWidth: 1, borderColor: colors.line,
              backgroundColor: colors.surface, paddingHorizontal: 10, paddingTop: 10, paddingBottom: 10, marginBottom: 8,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Field
                compact
                label="Batch / lot"
                value={b.no}
                placeholder={suggestNo ? suggestNo() : 'B' + String(i + 1).padStart(3, '0')}
                onChangeText={(v) => patch(i, { no: v })}
                autoCapitalize="characters"
                style={{ flex: 1.4, marginBottom: 0, marginTop: 4 }}
              />
              <Field
                compact
                label={'Qty ' + unit}
                value={b.qty ? String(b.qty) : ''}
                onChangeText={(v) => patch(i, { qty: Number(String(v).replace(/[^0-9.]/g, '')) || 0 })}
                numeric
                decimal
                style={{ flex: 1, marginBottom: 0, marginTop: 4 }}
              />
              <Pressable onPress={() => remove(i)} hitSlop={8} accessibilityLabel="Remove batch" style={{ width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dangerSoft, marginTop: 4 }}>
                <Icon name="trash" size={15} color={colors.danger} />
              </Pressable>
            </View>

            {/* expiry: one box, tap to set; × clears it */}
            <Pressable
              onPress={() => setPicking(i)}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 8, height: 40,
                borderRadius: 10, backgroundColor: soft, paddingHorizontal: 11,
              }}
            >
              <Icon name="calendar" size={15} color={fg} />
              <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 13.5, color: b.expiry ? colors.ink : colors.faint }}>
                {b.expiry ? 'Expires ' + fmt(b.expiry) : 'No expiry — tap to set'}
              </Text>
              {when ? <Text style={{ fontFamily: fonts.uiBold, fontSize: 12, color: fg }}>{when}</Text> : null}
              {b.expiry ? (
                <Pressable onPress={() => patch(i, { expiry: '' })} hitSlop={8} accessibilityLabel="Clear expiry">
                  <Icon name="x" size={14} color={colors.faint} />
                </Pressable>
              ) : null}
            </Pressable>

            {picking === i ? (
              <DateTimePicker
                value={b.expiry && Number.isFinite(new Date(b.expiry).getTime()) ? new Date(b.expiry) : new Date()}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onDismiss={() => setPicking(null)}
                onValueChange={(_e, date) => {
                  if (Platform.OS !== 'ios') setPicking(null);
                  if (date) patch(i, { expiry: date.toISOString().slice(0, 10) });
                }}
              />
            ) : null}
          </View>
        );
      })}

      <Pressable
        onPress={add}
        style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 42,
          borderRadius: radius.md, borderWidth: 1.2, borderStyle: 'dashed', borderColor: colors.accent,
        }}
      >
        <Icon name="plus" size={15} color={colors.accent} />
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 13.5, color: colors.accent }}>Add batch</Text>
      </Pressable>
      <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 8 }}>
        Sales take from the batch that expires soonest unless another is picked.
      </Text>
    </View>
  );
}
