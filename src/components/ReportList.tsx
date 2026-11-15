/**
 * The parts of a report on a phone: tab chips with Period pinned beside them,
 * rows that open in place, the Select period and More sheets, and the totals
 * bar at the foot. One look for every report (ReportDetailScreen draws them
 * all): white, grey labels, yellow only on the row that is open, no currency
 * in front of an amount.
 */
import React, { memo, useState } from 'react';
import { View, Text, ScrollView, Platform, Switch } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable } from './Press';
import { Sheet } from './Sheet';
import Icon, { IconName } from './icons';
import { useTheme, fonts } from '../theme';
import { listPeriod, ListPeriod } from './DocList';
import type { Cell, ReportCol } from '../data/reports';
import { ReportShape, plainCell, rowIsZero, subline, shortRange } from '../data/reportShape';

/** The report colours. Light is the design's own; dark follows the app's dark theme. */
export function useReportPalette() {
  const { colors, dark } = useTheme();
  return dark ? {
    bg: colors.bg, card: colors.surface, text: colors.ink, muted: colors.faint, faint: colors.faint,
    row: colors.line, section: colors.line, primary: '#4C8DF6', primaryInk: '#FFFFFF', primarySoft: 'rgba(76,141,246,0.16)',
    chip: colors.sunk, chipInk: colors.soft, open: '#4A4423', openLine: '#6B6231',
  } : {
    bg: '#F5F6F8', card: '#FFFFFF', text: '#1C2024', muted: '#69717C', faint: '#8A919B',
    row: '#EEF0F2', section: '#E4E7EB', primary: '#1F6FEB', primaryInk: '#FFFFFF', primarySoft: '#EAF2FE',
    chip: '#F1F3F5', chipInk: '#3A4048', open: '#FFF6D1', openLine: '#EADFAE',
  };
}
export type ReportPalette = ReturnType<typeof useReportPalette>;

const NUM = { fontVariant: ['tabular-nums' as const] };

/* ── tabs ─────────────────────────────────────────────────────────────── */

/** The report's views as chips that scroll sideways. */
export function TabChips({ tabs, value, onPick }: { tabs: { id: string; label: string }[]; value: string; onPick: (id: string) => void }) {
  const p = useReportPalette();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 8, paddingRight: 8, alignItems: 'center' }}>
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <Pressable key={t.id} onPress={() => onPick(t.id)} accessibilityRole="tab" accessibilityState={{ selected: on }} hitSlop={{ top: 4, bottom: 4 }}
            style={{ height: 36, paddingHorizontal: 14, borderRadius: 18, justifyContent: 'center', backgroundColor: on ? p.primary : p.chip }}>
            <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: on ? p.primaryInk : p.chipInk }}>{t.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/* ── period ───────────────────────────────────────────────────────────── */

const PRESETS = ['today', 'week', 'month', 'lastMonth', 'year', 'all'];
const dmy = (t: number) => { const d = new Date(t); return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); };

/**
 * The Period pill and its sheet. The sheet works on a draft: a preset or a
 * date changes nothing on the report until Apply.
 */
export function PeriodPill({ value, onChange, iconOnly }: { value: ListPeriod; onChange: (p: ListPeriod) => void; iconOnly?: boolean }) {
  const p = useReportPalette();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ListPeriod>(value);
  const [picking, setPicking] = useState<null | 'from' | 'to'>(null);
  const show = () => { setDraft(value); setOpen(true); };
  const dateField = (which: 'from' | 'to', label: string) => (
    <View style={{ flex: 1 }}>
      <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: p.muted, marginBottom: 6 }}>{label}</Text>
      <Pressable onPress={() => setPicking(which)} accessibilityLabel={label + ' date'}
        style={{ height: 44, borderRadius: 8, borderWidth: 1, borderColor: p.section, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: p.card }}>
        <Icon name="calendar" size={16} color={p.muted} />
        <Text style={[{ fontFamily: fonts.ui, fontSize: 16, color: p.text }, NUM]}>{draft.key === 'all' ? (which === 'from' ? 'The start' : 'Today') : dmy(which === 'from' ? draft.from : draft.to)}</Text>
      </Pressable>
    </View>
  );
  return (
    <>
      <Pressable onPress={show} accessibilityRole="button" accessibilityLabel={'Period: ' + shortRange(value.from, value.to)}
        style={{ height: 36, minWidth: 44, paddingHorizontal: iconOnly ? 0 : 12, borderRadius: 18, borderWidth: 1, borderColor: p.section, backgroundColor: p.card, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        <Icon name="calendar" size={16} color={p.muted} />
        {iconOnly ? null : <Text numberOfLines={1} style={[{ fontFamily: fonts.uiSemi, fontSize: 13, color: p.text }, NUM]}>{shortRange(value.from, value.to)}</Text>}
      </Pressable>

      <Sheet visible={open} title="Select period" icon="calendar" onClose={() => setOpen(false)}
        footer={(
          <Pressable onPress={() => { onChange(draft); setOpen(false); }} accessibilityRole="button"
            style={{ height: 48, borderRadius: 8, backgroundColor: p.primary, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: p.primaryInk }}>Apply</Text>
          </Pressable>
        )}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {PRESETS.map((k) => {
            const pr = listPeriod(k), on = draft.key === k;
            return (
              <Pressable key={k} onPress={() => setDraft(pr)} accessibilityRole="button" accessibilityState={{ selected: on }}
                style={{ height: 44, paddingHorizontal: 14, borderRadius: 22, justifyContent: 'center', borderWidth: 1, borderColor: on ? p.primary : p.section, backgroundColor: on ? p.primarySoft : p.card }}>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: on ? p.primary : p.chipInk }}>{pr.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={{ flexDirection: 'row', gap: 12, marginBottom: 8 }}>
          {dateField('from', 'From')}
          {dateField('to', 'To')}
        </View>
        {picking ? (
          <DateTimePicker
            value={new Date(picking === 'from' ? (draft.from > 0 ? draft.from : Date.now()) : Math.min(draft.to, Date.now()))}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            onDismiss={() => setPicking(null)}
            onValueChange={(_e: unknown, d?: Date) => {
              const which = picking;
              setPicking(null);
              if (!d) return;
              const base = draft.key === 'all' ? listPeriod('month') : draft;
              const from = which === 'from' ? d.getTime() : base.from;
              const to = which === 'to' ? d.getTime() : base.to;
              setDraft(listPeriod('custom', { from: Math.min(from, to), to: Math.max(from, to) }));
            }}
          />
        ) : null}
      </Sheet>
    </>
  );
}

/* ── the More sheet's rows ────────────────────────────────────────────── */

export function MoreRow({ icon, label, sub, onPress, checked, onCheck, last }: {
  icon: IconName; label: string; sub?: string; onPress?: () => void; checked?: boolean; onCheck?: (v: boolean) => void; last?: boolean;
}) {
  const p = useReportPalette();
  return (
    <Pressable onPress={onCheck ? () => onCheck(!checked) : onPress} accessibilityRole={onCheck ? 'switch' : 'button'} accessibilityState={onCheck ? { checked: !!checked } : undefined}
      style={({ pressed }) => ({ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 14, borderBottomWidth: last ? 0 : 1, borderBottomColor: p.row, opacity: pressed ? 0.6 : 1 })}>
      <Icon name={icon} size={20} color={p.muted} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: fonts.ui, fontSize: 15, color: p.text }}>{label}</Text>
        {sub ? <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12, color: p.muted, marginTop: 1 }}>{sub}</Text> : null}
      </View>
      {onCheck ? <Switch value={!!checked} onValueChange={onCheck} trackColor={{ true: p.primary, false: p.section }} thumbColor="#FFFFFF" /> : null}
    </Pressable>
  );
}

/* ── a row ────────────────────────────────────────────────────────────── */

interface RowProps {
  row: Cell[]; cols: ReportCol[]; shape: ReportShape; sym: string; index: number;
  open: boolean; onToggle: (index: number) => void;
  /** "View statement", "View ledger", "View sale"… when the row leads somewhere. */
  action?: string; onAction?: (index: number) => void;
  /** An opening-balance line and the like: bold. */
  strong?: boolean;
}

/**
 * One line of a report: its name, a line of context and the figure it is read
 * for. Tapped, it turns yellow and shows every column underneath.
 */
export const ReportRow = memo(function ReportRow({ row, cols, shape, sym, index, open, onToggle, action, onAction, strong }: RowProps) {
  const p = useReportPalette();
  const zero = rowIsZero(row, cols, sym);
  const ink = zero ? p.faint : p.text;
  const title = plainCell(row[shape.title] ?? '', false, sym) || '—';
  const sub = subline(row, cols, shape, sym);
  const key = shape.key >= 0 ? plainCell(row[shape.key] ?? '', true, sym) : '';
  const all = [shape.title, ...shape.rest, ...(shape.key >= 0 ? [shape.key] : [])].slice(1);
  return (
    <View style={{ backgroundColor: open ? p.open : p.card, borderBottomWidth: 1, borderBottomColor: p.row }}>
      <Pressable onPress={() => onToggle(index)} accessibilityRole="button" accessibilityState={{ expanded: open }}
        style={{ minHeight: 48, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={2} style={{ fontFamily: strong ? fonts.uiBold : fonts.uiSemi, fontSize: 15, lineHeight: 20, color: ink }}>{title}</Text>
          {sub ? <Text numberOfLines={2} style={[{ fontFamily: fonts.ui, fontSize: 12, lineHeight: 16, color: zero ? p.faint : p.muted, marginTop: 2 }, NUM]}>{sub}</Text> : null}
        </View>
        {shape.key >= 0 ? (
          <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
            <Text numberOfLines={1} style={[{ fontFamily: fonts.uiSemi, fontSize: 15, color: ink }, NUM]}>{key}</Text>
            <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 11, color: p.faint, marginTop: 1 }}>{cols[shape.key].h}</Text>
          </View>
        ) : null}
        <View style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
          <Icon name="chev" size={14} color={p.faint} />
        </View>
      </Pressable>
      {open ? (
        <View style={{ marginHorizontal: 16, marginBottom: 12, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: p.openLine, backgroundColor: p.card }}>
          {all.map((i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 5 }}>
              <Text style={{ fontFamily: fonts.ui, fontSize: 14, color: p.muted, flexShrink: 0, maxWidth: '50%' }}>{cols[i].h}</Text>
              <Text style={[{ flex: 1, textAlign: 'right', fontFamily: i === shape.key ? fonts.uiBold : fonts.ui, fontSize: 14, color: p.text }, NUM]}>
                {plainCell(row[i] ?? '', !!cols[i].r, sym) || '—'}
              </Text>
            </View>
          ))}
          {action && onAction ? (
            <Pressable onPress={() => onAction(index)} accessibilityRole="button"
              style={{ marginTop: 10, height: 44, borderRadius: 8, borderWidth: 1, borderColor: p.section, alignItems: 'center', justifyContent: 'center', backgroundColor: p.card }}>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: p.text }}>{action}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
});

/* ── totals ───────────────────────────────────────────────────────────── */

/** The totals, kept in sight at the foot of the report. */
export function TotalBar({ label, value, others }: { label: string; value: string; others?: { label: string; value: string }[] }) {
  const p = useReportPalette();
  const insets = useSafeAreaInsets();
  const rest = (others || []).filter((x) => x.value && x.value !== '—').slice(0, 2);
  return (
    <View style={{ backgroundColor: p.card, borderTopWidth: 1, borderTopColor: p.section, paddingHorizontal: 16, paddingTop: 10, paddingBottom: Math.max(insets.bottom + 10, 30) }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12 }}>
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 14, color: p.text }}>{label}</Text>
        <Text numberOfLines={1} style={[{ fontFamily: fonts.uiBold, fontSize: 17, color: p.text }, NUM]}>{value}</Text>
      </View>
      {rest.length ? (
        <Text numberOfLines={1} style={[{ fontFamily: fonts.ui, fontSize: 12, color: p.muted, marginTop: 3 }, NUM]}>
          {rest.map((x) => x.label + ' ' + x.value).join('  ·  ')}
        </Text>
      ) : null}
    </View>
  );
}
