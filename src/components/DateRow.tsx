/**
 * DateRow — the day (and time) an entry is recorded on.
 *
 * On every entry screen: a received payment, money paid out, an expense,
 * income, moving money, a quotation, a delivery note, returned goods, a
 * journal, a stock count, a stock take. It starts at now. An earlier day is
 * offered only to a role with "Date entries in the past" (sales.backdate);
 * anyone else sees today, said so. No day after today, and never into a day
 * that has been closed or a year that has been closed: the books check that
 * again when the entry is saved (AppDataContext pickWhen).
 */
import React, { useState } from 'react';
import { View, Text, Platform } from 'react-native';
import { Pressable } from './Press';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { FieldShell } from './form';
import { Icon } from './icons';

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export default function DateRow({ value, onChange, label = 'Date', withTime = true }: { value: Date; onChange: (d: Date) => void; label?: string; withTime?: boolean }) {
  const { colors } = useTheme();
  const { can } = useAppData();
  const [mode, setMode] = useState<'date' | 'time' | null>(null);
  const may = can('sales.backdate');
  const now = new Date();
  const today = sameDay(value, now);
  return (
    <>
      <FieldShell
        label={label}
        icon="calendar"
        onPress={may ? () => setMode('date') : undefined}
        right={withTime ? (
          <Pressable onPress={() => setMode('time')} hitSlop={8} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 4, backgroundColor: colors.sunk }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.soft }}>{value.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</Text>
          </Pressable>
        ) : (may ? <Icon name="down" size={17} color={colors.accent} /> : undefined)}
      >
        <View>
          <Text style={{ fontFamily: fonts.ui, fontSize: 14, color: colors.ink }}>
            {today ? 'Today · ' : ''}{value.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
          </Text>
          {!may ? <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint, marginTop: 2 }}>An earlier day needs “Date entries in the past” on your role</Text> : null}
        </View>
      </FieldShell>
      {mode ? (
        <DateTimePicker
          value={value}
          mode={mode}
          maximumDate={mode === 'date' ? now : undefined}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onDismiss={() => setMode(null)}
          onValueChange={(_e, d) => {
            if (Platform.OS !== 'ios') setMode(null);
            if (!d) return;
            /* a time later than now, today, is now */
            onChange(d.getTime() > Date.now() ? new Date() : d);
          }}
        />
      ) : null}
    </>
  );
}
