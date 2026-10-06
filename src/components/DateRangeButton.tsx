/**
 * One button for a period: it shows the dates, and a tap opens the calendar —
 * first the day to start from, then the day to end on.
 */
import React, { useState } from 'react';
import { View, Text, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Pressable } from './Press';
import { useTheme, fonts } from '../theme';
import { fmtDay, startOfDay, endOfDay, daysAgo } from '../data/helpers';
import { Icon } from './icons';

export interface DateRange { from: number; to: number; label: string }

export function dateRange(from: number, to: number): DateRange {
  return { from: startOfDay(from), to: endOfDay(to), label: fmtDay(from) + ' – ' + fmtDay(to) };
}

/** The last 30 days, today included. */
export const last30 = () => dateRange(daysAgo(29), Date.now());

export function DateRangeButton({ value, onChange }: { value: DateRange; onChange: (r: DateRange) => void }) {
  const { colors } = useTheme();
  const [picking, setPicking] = useState<null | 'from' | 'to'>(null);
  const [from, setFrom] = useState(value.from);

  return (
    <View>
      <Pressable
        onPress={() => { setFrom(value.from); setPicking('from'); }}
        accessibilityLabel={'Dates: ' + value.label}
        style={({ pressed }) => ({
          flexDirection: 'row', alignItems: 'center', gap: 10, height: 46, paddingHorizontal: 14, borderRadius: 12,
          borderWidth: 1.2, borderColor: colors.line, backgroundColor: pressed ? colors.sunk : colors.surface,
        })}
      >
        <Icon name="calendar" size={18} color={colors.ink} />
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 14.5, color: colors.ink }}>{value.label}</Text>
        <Icon name="down" size={14} color={colors.faint} />
      </Pressable>
      {picking ? (
        <View>
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint, marginTop: 10 }}>
            {picking === 'from' ? 'From which day?' : 'Up to which day?'}
          </Text>
          <DateTimePicker
            value={new Date(picking === 'from' ? from : value.to)}
            mode="date"
            maximumDate={new Date()}
            minimumDate={picking === 'to' ? new Date(from) : undefined}
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            onDismiss={() => setPicking(null)}
            onValueChange={(_e, d) => {
              if (!d) { setPicking(null); return; }
              if (picking === 'from') {
                setFrom(startOfDay(d.getTime()));
                setPicking('to');
              } else {
                setPicking(null);
                onChange(dateRange(Math.min(from, d.getTime()), d.getTime()));
              }
            }}
          />
        </View>
      ) : null}
    </View>
  );
}

export default DateRangeButton;
