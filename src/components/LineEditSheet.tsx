import React, { useEffect, useState } from 'react';
import { View, Text, TextInput } from 'react-native';
import { Pressable } from './Press';
import { useTheme, fonts } from '../theme';
import { Button, Field } from './ui';
import { Icon } from './icons';
import Sheet from './Sheet';
import type { SaleLine, Product } from '../data/types';

/** One unit an item can be sold in, with what it costs and how much stock it uses. */
export interface UnitChoice { unit: string; factor: number; price: number; cost: number }

/**
 * The units a product can be sold in: its main one, and a second where it has
 * one. The second unit's price is the one set on the item; failing that, the
 * main price divided down, so a piece never sells for the price of a carton.
 */
export function unitsFor(p?: Product | null): UnitChoice[] {
  if (!p) return [];
  const out: UnitChoice[] = [{ unit: p.unit, factor: 1, price: p.price, cost: p.cost }];
  const rate = Number(p.conversionRate) || 0;
  if (p.secondaryUnit && rate > 0) {
    out.push({
      unit: p.secondaryUnit,
      factor: 1 / rate,
      price: Number(p.secondaryPrice) > 0 ? Number(p.secondaryPrice) : p.price / rate,
      cost: p.cost / rate,
    });
  }
  return out;
}

export default function LineEditSheet({
  visible, line, maxStock, money, onSave, onRemove, onClose, onChooseBatch, product, canEditPrice = true, maxDiscountPct = 100,
}: {
  visible: boolean;
  line: SaleLine | null;
  /** In the item's main stock unit. */
  maxStock: number;
  money: (n: number) => string;
  onSave: (patch: {
    qty: number; price: number; discountPct: number; listPrice: number;
    unit: string; unitFactor: number; cost: number; batchNo?: string;
  }) => void;
  onRemove: () => void;
  onClose: () => void;
  onChooseBatch?: () => void;
  /** The product, so its second unit can be offered. */
  product?: Product | null;
  /** Settings: "Let staff change the price at the till". */
  canEditPrice?: boolean;
  /** Settings: "Biggest discount a cashier may give". */
  maxDiscountPct?: number;
}) {
  const { colors } = useTheme();
  const [qty, setQty] = useState('1');
  const [listPrice, setListPrice] = useState('0');
  const [discountPct, setDiscountPct] = useState('0');
  const [unit, setUnit] = useState('');
  const [batchNo, setBatchNo] = useState('');

  useEffect(() => {
    if (visible && line) {
      setQty(String(line.qty));
      setListPrice(String(line.listPrice ?? line.price));
      setDiscountPct(String(line.discountPct ?? 0));
      setUnit(line.unit);
      setBatchNo(line.batchNo || '');
    }
  }, [visible, line]);

  if (!line) return null;

  const units = unitsFor(product);
  const chosen = units.find((u) => u.unit === unit) || { unit: line.unit, factor: line.unitFactor || 1, price: line.price, cost: line.cost };

  const qtyNum = Math.max(0, Number(qty) || 0);
  const listNum = Math.max(0, Number(listPrice) || 0);
  const discRaw = Math.min(100, Math.max(0, Number(discountPct) || 0));
  const discNum = Math.min(discRaw, maxDiscountPct);
  const netPrice = listNum * (1 - discNum / 100);
  const lineTotal = qtyNum * netPrice;
  // stock is counted in the main unit, so what is available is shown in the chosen one
  const availableHere = chosen.factor > 0 ? maxStock / chosen.factor : maxStock;
  const overStock = qtyNum * chosen.factor > maxStock + 1e-9;

  function pickUnit(u: UnitChoice) {
    setUnit(u.unit);
    setListPrice(String(Math.round(u.price * 100) / 100));
  }

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
              onPress={() => onSave({
                qty: qtyNum, price: netPrice, discountPct: discNum, listPrice: listNum,
                unit: chosen.unit, unitFactor: chosen.factor, cost: chosen.cost,
                batchNo: batchNo || undefined,
              })}
            />
          </View>
        </View>
      }
    >
      <View style={{ gap: 16 }}>
        <View>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{line.name}</Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>
            {line.sku}{batchNo ? ' · Batch ' + batchNo : ''} · {Number.isFinite(availableHere) ? Math.floor(availableHere * 100) / 100 + ' ' + chosen.unit + ' available' : 'No stock limit'}
          </Text>
        </View>

        {units.length > 1 ? (
          <View style={{ gap: 6 }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint, letterSpacing: 0.3 }}>SELL BY</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {units.map((u) => {
                const on = u.unit === chosen.unit;
                return (
                  <Pressable
                    key={u.unit}
                    onPress={() => pickUnit(u)}
                    style={{
                      flex: 1, paddingVertical: 11, borderRadius: 12, borderWidth: 1.4, alignItems: 'center',
                      borderColor: on ? colors.accent : colors.line,
                      backgroundColor: on ? colors.accentSoft : colors.surface,
                    }}
                  >
                    <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: on ? colors.accent : colors.ink }}>{u.unit}</Text>
                    <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>{money(u.price)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {product?.trackBatches && (product.batches || []).length > 0 ? (
          <View style={{ gap: 6 }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint, letterSpacing: 0.3 }}>BATCH</Text>
            <Pressable
              onPress={onChooseBatch}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderRadius: 12, backgroundColor: colors.sunk, borderWidth: 1, borderColor: colors.lineHard, paddingHorizontal: 12, paddingVertical: 12 }}
            >
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: batchNo ? colors.ink : colors.faint }}>
                {batchNo ? 'Batch ' + batchNo : 'Choose batch'}
              </Text>
              <Icon name="box" size={15} color={colors.accent} />
            </Pressable>
          </View>
        ) : null}

        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Pressable onPress={() => step(-1)} style={{ width: 48, height: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.lineHard, backgroundColor: colors.sunk, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 20, color: colors.ink }}>−</Text>
            </Pressable>
            <Field style={{ flex: 1, marginBottom: 0 }} label="Quantity" value={qty} onChangeText={setQty} numeric decimal error={overStock ? " " : undefined} />
            <Pressable onPress={() => step(1)} style={{ width: 48, height: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.lineHard, backgroundColor: colors.sunk, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 20, color: colors.ink }}>+</Text>
            </Pressable>
          </View>
          {overStock ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.danger }}>Only {Math.floor(availableHere * 100) / 100} {chosen.unit} in stock.</Text> : null}
        </View>

        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Field style={{ flex: 1, marginBottom: 0 }} label="Unit price" value={listPrice} onChangeText={setListPrice} readOnly={!canEditPrice} numeric decimal />
          <Field style={{ flex: 1, marginBottom: 0 }} label="Discount %" value={discountPct} onChangeText={setDiscountPct} readOnly={!(maxDiscountPct > 0)} numeric decimal />
        </View>

        {!canEditPrice ? (
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
            The price is fixed here. Changing it at the till is switched off in Settings.
          </Text>
        ) : null}
        {discRaw > maxDiscountPct ? (
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.danger }}>
            The most you can give is {maxDiscountPct}%, so {maxDiscountPct}% is applied.
          </Text>
        ) : null}

        <View style={{ backgroundColor: colors.sunk, borderRadius: 14, padding: 14, gap: 8 }}>
          <Row label={'Net price × ' + qtyNum} value={money(netPrice)} colors={colors} />
          {discNum > 0 ? <Row label="You save" value={'− ' + money(qtyNum * (listNum - netPrice))} colors={colors} tone={colors.good} /> : null}
          <View style={{ height: 1, backgroundColor: colors.line }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>Line total</Text>
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
