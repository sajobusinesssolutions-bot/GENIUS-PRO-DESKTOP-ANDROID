import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme, fonts, radius } from '../theme';
import { Button, SelectField } from './ui';
import { Sheet } from './Sheet';
import { Icon } from './icons';

export interface ListFilterOption { v: string; l: string }

function parseDate(value: string): Date {
  const d = new Date(value + 'T12:00:00');
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function dateText(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function ListFilters({
  filterLabel = 'Filter', filterValue, filterOptions, onFilterChange,
  from, to, onDateChange,
}: {
  filterLabel?: string;
  filterValue: string;
  filterOptions: ListFilterOption[];
  onFilterChange: (value: string) => void;
  from?: string;
  to?: string;
  onDateChange?: (from: string, to: string) => void;
}) {
  const { colors } = useTheme();
  const [filterOpen, setFilterOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from || '');
  const [draftTo, setDraftTo] = useState(to || '');
  const [picker, setPicker] = useState<'from' | 'to' | null>(null);

  useEffect(() => {
    if (!dateOpen) { setDraftFrom(from || ''); setDraftTo(to || ''); }
  }, [dateOpen, from, to]);

  const selectedFilter = filterOptions.find((x) => x.v === filterValue)?.l || filterLabel;
  const dateLabel = from && to ? (from === to ? from : from + ' - ' + to) : 'Pick range';

  return (
    <>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {from && to && onDateChange ? <Pressable
          onPress={() => setFilterOpen(true)}
          style={{ flex: 1, minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, borderRadius: radius.md, borderWidth: 1, borderColor: filterValue === 'all' ? colors.line : colors.accent, backgroundColor: filterValue === 'all' ? colors.surface : colors.accentSoft }}
        >
          <Icon name="tools" size={14} color={filterValue === 'all' ? colors.faint : colors.accent} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 9.5, color: colors.faint, letterSpacing: 0.35, textTransform: 'uppercase' }}>{filterLabel}</Text>
            <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 11.5, color: filterValue === 'all' ? colors.soft : colors.accent }}>{selectedFilter}</Text>
          </View>
          <Icon name="down" size={12} color={colors.faint} />
        </Pressable> : null}
        <Pressable
          onPress={() => setDateOpen(true)}
          style={{ flex: 1, minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface }}
        >
          <Icon name="calendar" size={14} color={colors.accent} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 9.5, color: colors.faint, letterSpacing: 0.35, textTransform: 'uppercase' }}>Date</Text>
            <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 11.5, color: colors.ink }}>{dateLabel}</Text>
          </View>
          <Icon name="down" size={12} color={colors.faint} />
        </Pressable>
      </View>

      <Sheet visible={filterOpen} title={filterLabel} icon="tools" onClose={() => setFilterOpen(false)}>
        <SelectField
          label="Choose a filter"
          value={filterValue}
          options={filterOptions}
          onChange={(value) => { onFilterChange(value); setFilterOpen(false); }}
        />
      </Sheet>

      <Sheet
        visible={dateOpen}
        title="Date range"
        subtitle="Choose the first and last day to show"
        icon="calendar"
        onClose={() => { setDateOpen(false); setPicker(null); }}
        footer={<Button variant="pri" label="Apply date range" onPress={() => { onDateChange?.(draftFrom, draftTo); setDateOpen(false); }} />}
      >
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['from', 'to'] as const).map((which) => (
            <Pressable key={which} onPress={() => setPicker(which)} style={{ flex: 1, minHeight: 58, justifyContent: 'center', paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1.2, borderColor: colors.line, backgroundColor: colors.surface }}>
              <Text style={{ fontFamily: fonts.ui, fontSize: 10.5, color: colors.faint }}>{which === 'from' ? 'From' : 'To'}</Text>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink, marginTop: 4 }}>{which === 'from' ? draftFrom : draftTo}</Text>
            </Pressable>
          ))}
        </View>
        {picker ? (
          <DateTimePicker
            value={parseDate(picker === 'from' ? draftFrom : draftTo)}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={(_event, value) => {
              setPicker(null);
              if (!value) return;
              const next = dateText(value);
              if (picker === 'from') setDraftFrom(next); else setDraftTo(next);
            }}
          />
        ) : null}
      </Sheet>
    </>
  );
}
