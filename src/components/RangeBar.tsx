/**
 * A period to look at: quick chips (today, 7 days, 30 days …) and a custom
 * from–to picked on the calendar. Returns plain millisecond bounds so any
 * screen can filter with them.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView, Platform } from 'react-native';
import { Pressable } from './Press';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme, fonts, radius } from '../theme';
import { finRange, fmtDay, startOfDay, endOfDay } from '../data/helpers';
import { Icon } from './icons';

export interface Period { key: string; from: number; to: number; label: string }

const CHIPS: [string, string][] = [
  ['today', 'Today'], ['yesterday', 'Yesterday'], ['week', '7 days'], ['month', '30 days'],
  ['quarter', '90 days'], ['year', 'This year'], ['all', 'All'],
];

export function periodFor(key: string, custom?: { from: number; to: number }): Period {
  if (key === 'custom' && custom) {
    return { key, from: custom.from, to: custom.to, label: fmtDay(custom.from) + ' – ' + fmtDay(custom.to) };
  }
  if (key === 'yesterday') {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return { key, from: startOfDay(d.getTime()), to: endOfDay(d.getTime()), label: 'Yesterday' };
  }
  const r = finRange(key);
  return { key, from: r.from, to: r.to, label: r.label };
}

export function RangeBar({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const { colors } = useTheme();
  const [picking, setPicking] = useState<null | 'from' | 'to'>(null);
  const [draft, setDraft] = useState<{ from: number; to: number }>({ from: value.from, to: value.to });

  const chip = (key: string, label: string, on: boolean, press: () => void) => (
    <Pressable
      key={key}
      onPress={press}
      style={{
        paddingVertical: 8, paddingHorizontal: 13, borderRadius: radius.pill, borderWidth: 1.3,
        borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accent : colors.surface,
        flexDirection: 'row', alignItems: 'center', gap: 5,
      }}
    >
      {key === 'custom' ? <Icon name="calendar" size={13} color={on ? colors.accentInk : colors.soft} /> : null}
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: on ? colors.accentInk : colors.soft }}>{label}</Text>
    </Pressable>
  );

  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7, paddingVertical: 2 }}>
        {CHIPS.map(([k, l]) => chip(k, l, value.key === k, () => onChange(periodFor(k))))}
        {chip('custom', value.key === 'custom' ? value.label : 'Pick dates', value.key === 'custom', () => {
          setDraft({ from: value.from || startOfDay(), to: value.to });
          setPicking('from');
        })}
      </ScrollView>
      {picking ? (
        <View>
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint, marginTop: 10 }}>
            {picking === 'from' ? 'From which day?' : 'Up to which day?'}
          </Text>
          <DateTimePicker
            value={new Date(picking === 'from' ? draft.from : draft.to)}
            mode="date"
            maximumDate={new Date()}
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            onDismiss={() => setPicking(null)}
            onValueChange={(_e, d) => {
              if (!d) { setPicking(null); return; }
              if (picking === 'from') {
                const from = startOfDay(d.getTime());
                setDraft((x) => ({ ...x, from }));
                setPicking('to');
              } else {
                const to = endOfDay(d.getTime());
                const from = Math.min(draft.from, startOfDay(d.getTime()));
                setPicking(null);
                onChange(periodFor('custom', { from, to }));
              }
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

export default RangeBar;
