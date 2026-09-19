/**
 * Batch and expiry entry.
 *
 * Typing a date on a phone is the slow part, so each row offers the shelf lives
 * people actually use — 3, 6, 12, 24 months — and computes the date from today.
 * The exact date is still editable for stock that arrives part-used, and the row
 * colours itself by how close the expiry is.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme, fonts, radius } from '../theme';
import { Button, Field, Badge, SectionLabel, InfoBanner, EmptyBlock, Panel } from './ui';
import { Icon } from './icons';
import { expiryState, daysToExpiry } from '../data/batches';
import type { ProductBatch } from '../data/types';

const SHELF_LIVES: Array<{ l: string; months: number }> = [
  { l: '3 months', months: 3 },
  { l: '6 months', months: 6 },
  { l: '1 year', months: 12 },
  { l: '2 years', months: 24 },
];

function addMonths(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function fmt(iso: string) {
  if (!iso) return 'Set expiry';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function BatchEditor({ batches, onChange, unit = 'pcs', suggestNo }: {
  batches: ProductBatch[];
  onChange: (next: ProductBatch[]) => void;
  unit?: string;
  /** Used to seed the number of a freshly added batch. */
  suggestNo?: () => string;
}) {
  const { colors } = useTheme();
  const [picking, setPicking] = useState<number | null>(null);

  function patch(i: number, p: Partial<ProductBatch>) {
    onChange(batches.map((b, idx) => (idx === i ? { ...b, ...p } : b)));
  }

  function add() {
    const n = suggestNo
      ? suggestNo()
      : 'B' + String(batches.length + 1).padStart(3, '0');
    onChange([...batches, { no: n, expiry: addMonths(12), qty: 0 }]);
  }

  function remove(i: number) {
    onChange(batches.filter((_, idx) => idx !== i));
  }

  const total = batches.reduce((s, b) => s + (Number(b.qty) || 0), 0);

  return (
    <View>
      <SectionLabel right={
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: colors.ink }}>
          {total} {unit}
        </Text>
      }>
        Batches
      </SectionLabel>

      {!batches.length ? (
        <Panel style={{ marginBottom: 14 }}>
          <EmptyBlock
            icon="box"
            title="No batches yet"
            hint="Add one for each delivery you want to track separately by expiry."
          />
        </Panel>
      ) : null}

      {batches.map((b, i) => {
        const state = expiryState(b);
        const days = daysToExpiry(b);
        const edge = state === 'expired' || state === 'critical' ? colors.danger
          : state === 'soon' ? colors.warn
            : state === 'none' ? colors.lineHard : colors.good;
        return (
          <View
            key={i}
            style={{
              borderRadius: radius.md, borderWidth: 1.4, borderColor: colors.line,
              borderLeftWidth: 5, borderLeftColor: edge,
              backgroundColor: colors.surface, padding: 14, marginBottom: 12, gap: 12,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>
                Batch {i + 1}
              </Text>
              {state !== 'none' ? (
                <Badge
                  label={
                    state === 'expired' ? 'Expired'
                      : state === 'critical' ? (days ?? 0) + 'd left'
                        : state === 'soon' ? 'Use soon' : 'Fresh'
                  }
                  tone={state === 'expired' || state === 'critical' ? 'danger' : state === 'soon' ? 'warn' : 'good'}
                />
              ) : null}
              <Pressable onPress={() => remove(i)} hitSlop={8} style={{ padding: 4 }}>
                <Icon name="trash" size={18} color={colors.danger} />
              </Pressable>
            </View>

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1.3 }}>
                <Field
                  icon="tag"
                  label="Batch / lot no."
                  value={b.no}
                  onChangeText={(v) => patch(i, { no: v })}
                  autoCapitalize="characters"
                  style={{ marginBottom: 0 }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label={'Qty (' + unit + ')'}
                  value={String(b.qty ?? '')}
                  onChangeText={(v) => patch(i, { qty: Number(String(v).replace(/[^0-9.]/g, '')) || 0 })}
                  numeric
                  decimal
                  style={{ marginBottom: 0 }}
                />
              </View>
            </View>

            {/* expiry: tap a shelf life, or set the exact date */}
            <View>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginBottom: 8 }}>
                Expires
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                {SHELF_LIVES.map((s) => {
                  const iso = addMonths(s.months);
                  const on = b.expiry === iso;
                  return (
                    <Pressable
                      key={s.l}
                      onPress={() => patch(i, { expiry: iso })}
                      style={{
                        paddingVertical: 9, paddingHorizontal: 14, borderRadius: radius.pill,
                        borderWidth: 1.4, borderColor: on ? colors.accent : colors.line,
                        backgroundColor: on ? colors.accentSoft : colors.surface,
                      }}
                    >
                      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: on ? colors.accent : colors.soft }}>
                        {s.l}
                      </Text>
                    </Pressable>
                  );
                })}
                <Pressable
                  onPress={() => patch(i, { expiry: '' })}
                  style={{
                    paddingVertical: 9, paddingHorizontal: 14, borderRadius: radius.pill,
                    borderWidth: 1.4, borderColor: !b.expiry ? colors.ink : colors.line,
                    backgroundColor: !b.expiry ? colors.sunk : colors.surface,
                  }}
                >
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: !b.expiry ? colors.ink : colors.soft }}>
                    No expiry
                  </Text>
                </Pressable>
              </View>

              <Pressable
                onPress={() => setPicking(i)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 11,
                  borderRadius: radius.md, borderWidth: 1.4, borderColor: colors.line,
                  backgroundColor: colors.sunk, paddingHorizontal: 14, paddingVertical: 13,
                }}
              >
                <Icon name="calendar" size={19} color={colors.accent} />
                <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 14.5, color: b.expiry ? colors.ink : colors.faint }}>
                  {fmt(b.expiry)}
                </Text>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: colors.accent }}>Change</Text>
              </Pressable>

              {picking === i ? (
                <DateTimePicker
                  value={b.expiry && Number.isFinite(new Date(b.expiry).getTime()) ? new Date(b.expiry) : new Date()}
                  mode="date"
                  display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                  onChange={(_e, date) => {
                    if (Platform.OS !== 'ios') setPicking(null);
                    if (date) patch(i, { expiry: date.toISOString().slice(0, 10) });
                  }}
                />
              ) : null}
            </View>
          </View>
        );
      })}

      <Button
        label="Add a batch"
        icon={<Icon name="plus" size={17} color={colors.ink} />}
        onPress={add}
      />

      <View style={{ height: 12 }} />
      <InfoBanner
        tone="neutral"
        icon="bulb"
        text="Sales draw from the batch that expires soonest unless the cashier picks another."
      />
    </View>
  );
}
