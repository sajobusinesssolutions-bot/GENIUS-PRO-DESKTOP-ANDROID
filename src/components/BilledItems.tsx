/**
 * THE LINES ON A BILL, one card each: the number, the name and the line total
 * on top, then "qty unit x rate = subtotal", then the discount in amber, and
 * whatever else the line carries (batch, IMEIs, a description). A bar above
 * folds the list away; the four totals sit under it.
 *
 * Shared by the sale, the purchase and every document raised from LineEditor.
 */
import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { Pressable } from './Press';
import { useTheme, fonts } from '../theme';
import { Icon } from './icons';
import type { SoldSerial } from '../data/types';

export interface BilledLine {
  name: string;
  qty: number;
  unit?: string;
  /** Net rate charged per unit, after the line discount. */
  price: number;
  /** Rate before the discount; the same as price when there is none. */
  listPrice?: number;
  discountPct?: number;
  note?: string;
  batchNo?: string;
  serials?: SoldSerial[];
  /** A warning to show on the card, such as IMEIs still to enter. */
  warning?: string;
}

/** 70000 → "70,000": the rate in the middle row carries no currency, as on paper. */
export function plain(n: number) {
  const r = Math.round(n * 100) / 100;
  return r.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export default function BilledItems({ lines, money, onPress, title = 'Billed Items', taxTotal, empty }: {
  lines: BilledLine[];
  money: (n: number) => string;
  onPress?: (index: number) => void;
  title?: string;
  /** Shown in the totals when the bill carries tax. */
  taxTotal?: number;
  /** Shown in place of the cards when there are no lines. */
  empty?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(true);

  const totalQty = lines.reduce((s, l) => s + l.qty, 0);
  const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const totalDisc = lines.reduce((s, l) => s + l.qty * Math.max(0, (l.listPrice ?? l.price) - l.price), 0);

  if (!lines.length) return <>{empty ?? null}</>;

  return (
    <View style={{ gap: 10 }}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        accessibilityLabel={open ? 'Fold the items away' : 'Show the items'}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 10,
          backgroundColor: colors.accentSoft, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11,
        }}
      >
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={open ? 'down' : 'up'} size={13} color={colors.accentInk} />
        </View>
        <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 15, color: colors.accent }}>{title}</Text>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.accent }}>
          {lines.length} line{lines.length === 1 ? '' : 's'}
        </Text>
      </Pressable>

      {open ? lines.map((l, i) => {
        const list = l.listPrice ?? l.price;
        const disc = l.discountPct ?? 0;
        const discAmt = l.qty * Math.max(0, list - l.price);
        return (
          <Pressable
            key={i}
            onPress={onPress ? () => onPress(i) : undefined}
            disabled={!onPress}
            style={({ pressed }) => ({
              backgroundColor: pressed ? colors.line : colors.row,
              borderRadius: 14, borderWidth: 1, borderColor: colors.lineHard,
              paddingHorizontal: 14, paddingVertical: 12, gap: 7,
            })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ paddingHorizontal: 7, paddingVertical: 3, borderRadius: 7, borderWidth: 1, borderColor: colors.lineHard, backgroundColor: colors.surface }}>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: colors.soft }}>#{i + 1}</Text>
              </View>
              <Text numberOfLines={2} style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{l.name}</Text>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{money(l.qty * l.price)}</Text>
            </View>

            {(l as any).modifiers?.length ? (
              <Text numberOfLines={3} style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.soft }}>
                + {(l as any).modifiers.map((m: { name: string }) => m.name).join(', ')}
              </Text>
            ) : null}

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.soft }}>Item Subtotal</Text>
              <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.ui, fontSize: 12.5, color: colors.soft }}>
                {plain(l.qty)} {l.unit || ''} x {plain(list)} = {money(l.qty * list)}
              </Text>
            </View>

            {disc > 0 || discAmt > 0 ? (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.warn }}>Discount (%): {plain(disc)}</Text>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.warn }}>{money(discAmt)}</Text>
              </View>
            ) : null}

            {l.batchNo ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Icon name="box" size={12} color={colors.accent} />
                <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.accent }}>Batch {l.batchNo}</Text>
              </View>
            ) : null}

            {(l.serials || []).map((sr) => (
              <Text key={sr.imei} numberOfLines={1} style={{ fontFamily: fonts.mono, fontSize: 12.5, color: colors.accent }}>
                IMEI {sr.imei}{sr.imei2 ? ' / ' + sr.imei2 : ''}
              </Text>
            ))}

            {l.warning ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Icon name="alert" size={12} color={colors.warn} />
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: colors.warn }}>{l.warning}</Text>
              </View>
            ) : null}

            {l.note ? (
              <Text numberOfLines={3} style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.warn }}>* {l.note}</Text>
            ) : null}
          </Pressable>
        );
      }) : null}

      <View style={{ paddingHorizontal: 4, paddingTop: 2, gap: 6 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.soft }}>Total Disc: {plain(totalDisc)}</Text>
          {taxTotal !== undefined ? (
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.soft }}>Total Tax Amt: {plain(taxTotal)}</Text>
          ) : null}
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.soft }}>Total Qty: {plain(totalQty)}</Text>
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.ink }}>Subtotal: {plain(subtotal)}</Text>
        </View>
      </View>
    </View>
  );
}
