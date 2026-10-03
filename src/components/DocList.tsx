/**
 * THE LIST SCREENS' SHARED PARTS — sales, purchases, quotations, delivery
 * notes, returns, recurring bills, instalments, stock takes, batches, parties,
 * cash & bank, cash in and out all read the same way:
 *
 *   a filter (status chips, or a period with its dates)
 *   summary tiles — the totals that matter for this list
 *   a search box
 *   one card per record: who, a status pill, the amount; the number and the
 *   date on the right; a line or two of detail; and its actions
 *   an empty state that says so, and an "Add …" button
 */
import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, Platform, ListRenderItem } from 'react-native';
import { Pressable } from './Press';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTheme, fonts } from '../theme';
import { Icon, IconName } from './icons';
import { Sheet } from './Sheet';
import { Search, FAB } from './ui';
import { useToast } from './Toast';
import { useAppData } from '../data/AppDataContext';
import { printDoc, shareDoc, DocMeta } from '../data/docPrint';
import { printOptsFor, docKindOf, shareOptsFor } from '../data/printSetup';

export type PillTone = 'good' | 'warn' | 'danger' | 'accent' | 'neutral';

function useTone() {
  const { colors } = useTheme();
  return (t: PillTone = 'neutral') => (t === 'good' ? { fg: colors.good, bg: colors.goodSoft }
    : t === 'warn' ? { fg: colors.warn, bg: colors.warnSoft }
      : t === 'danger' ? { fg: colors.danger, bg: colors.dangerSoft }
        : t === 'accent' ? { fg: colors.accent, bg: colors.accentSoft }
          : { fg: colors.faint, bg: colors.sunk });
}

/* ------------------------------------------------------------------ the card */

export interface DocRowProps {
  /** Who it is for: the customer, supplier, account. */
  title: string;
  pill?: { label: string; tone?: PillTone };
  /** The main figure, under the title. */
  amount?: string;
  amountTone?: string;
  /** "Sale #111", top right. */
  refText?: string;
  /** When it happened; shown as "16 Sep, 26 • 03:52 PM". */
  ts?: string;
  /** Replaces the date line, for records without a moment (a product, an account). */
  sideText?: string;
  /** Detail lines under the amount: "Balance: Sh 271,000", "Due date: 16 Sep, 26". */
  lines?: { label: string; value: string; tone?: string }[];
  onPress?: () => void;
  onPrint?: () => void;
  onShare?: () => void;
  onMore?: () => void;
  /** One clear next step instead of the icons: Convert, See invoice #108, Mark delivered. */
  action?: { label: string; onPress: () => void };
  dim?: boolean;
}

export function stamp(ts?: string): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ (\d\d)$/, ', $1')
    + ' • ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

export function DocRow(p: DocRowProps) {
  const { colors } = useTheme();
  const tone = useTone();
  const t = tone(p.pill?.tone);
  const iconBtn = (name: IconName, label: string, onPress: () => void) => (
    <Pressable
      key={label}
      onPress={onPress}
      hitSlop={4}
      accessibilityLabel={label}
      style={({ pressed }) => ({ width: 42, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? colors.sunk : 'transparent' })}
    >
      <Icon name={name} size={21} color={colors.faint} />
    </Pressable>
  );
  const hasIcons = !!(p.onPrint || p.onShare || p.onMore);
  return (
    <Pressable
      onPress={p.onPress}
      disabled={!p.onPress}
      style={({ pressed }) => ({
        marginHorizontal: 16, marginBottom: 10, borderRadius: 16, paddingTop: 14, paddingHorizontal: 15, paddingBottom: hasIcons || p.action ? 10 : 14,
        backgroundColor: pressed ? colors.sunk : colors.surface, borderWidth: 1, borderColor: colors.line, opacity: p.dim ? 0.55 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{p.title}</Text>
            {p.pill ? (
              <View style={{ paddingVertical: 3, paddingHorizontal: 9, borderRadius: 999, backgroundColor: t.bg }}>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, letterSpacing: 0.3, color: t.fg }}>{p.pill.label.toUpperCase()}</Text>
              </View>
            ) : null}
          </View>
          {p.amount ? (
            <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: p.amountTone || colors.ink, marginTop: 6 }}>{p.amount}</Text>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          {p.refText ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{p.refText}</Text> : null}
          {p.ts || p.sideText ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 4 }}>{p.sideText || stamp(p.ts)}</Text> : null}
        </View>
      </View>

      {p.lines?.length || hasIcons || p.action ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 10, gap: 8 }}>
          <View style={{ flex: 1, minWidth: 0, paddingBottom: hasIcons || p.action ? 4 : 0, gap: 3 }}>
            {(p.lines || []).map((l) => (
              <Text key={l.label} numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
                {l.label}: <Text style={{ color: l.tone || colors.faint }}>{l.value}</Text>
              </Text>
            ))}
          </View>
          {p.action ? (
            <Pressable
              onPress={p.action.onPress}
              style={({ pressed }) => ({ paddingVertical: 10, paddingHorizontal: 18, borderRadius: 999, backgroundColor: pressed ? colors.accent : colors.accentSoft })}
            >
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.accent }}>{p.action.label}</Text>
            </Pressable>
          ) : null}
          {p.onPrint ? iconBtn('print', 'Print', p.onPrint) : null}
          {p.onShare ? iconBtn('share', 'Share', p.onShare) : null}
          {p.onMore ? iconBtn('dots', 'More actions', p.onMore) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

/* --------------------------------------------------------- summary tiles */

export function SummaryTiles({ tiles }: { tiles: { label: string; value: string; tone?: string }[] }) {
  const { colors } = useTheme();
  if (!tiles.length) return null;
  return (
    <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginBottom: 12 }}>
      {tiles.map((t) => (
        <View key={t.label} style={{ flex: 1, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, paddingVertical: 11, paddingHorizontal: 13 }}>
          <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{t.label}</Text>
          <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: t.tone || colors.ink, marginTop: 3 }}>{t.value}</Text>
        </View>
      ))}
    </View>
  );
}

/* ---------------------------------------------------------- status chips */

export function StatusChips<T extends string>({ value, options, onChange }: {
  value: T; options: { v: T; l: string }[]; onChange: (v: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 }}>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <Pressable
            key={o.v}
            onPress={() => onChange(o.v)}
            style={{
              paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1.4,
              borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accentSoft : colors.surface,
            }}
          >
            <Text style={{ fontFamily: on ? fonts.uiSemi : fonts.ui, fontSize: 15, color: on ? colors.accent : colors.ink }}>{o.l}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------ period bar */

export interface ListPeriod { key: string; from: number; to: number; label: string }

const DAY = 864e5;
const sod = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const eod = (t: number) => { const d = new Date(t); d.setHours(23, 59, 59, 999); return d.getTime(); };

export function listPeriod(key: string, custom?: { from: number; to: number }): ListPeriod {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  switch (key) {
    case 'today': return { key, from: sod(now.getTime()), to: eod(now.getTime()), label: 'Today' };
    case 'week': { const back = (now.getDay() + 6) % 7; return { key, from: sod(now.getTime() - back * DAY), to: eod(now.getTime()), label: 'This week' }; }
    case 'lastMonth': return { key, from: new Date(y, m - 1, 1).getTime(), to: eod(new Date(y, m, 0).getTime()), label: 'Last month' };
    case 'year': return { key, from: new Date(y, 0, 1).getTime(), to: eod(new Date(y, 11, 31).getTime()), label: 'This year' };
    case 'all': return { key, from: 0, to: eod(now.getTime() + 3650 * DAY), label: 'All time' };
    case 'custom': return { key, from: sod(custom?.from ?? now.getTime()), to: eod(custom?.to ?? now.getTime()), label: 'Custom' };
    default: return { key: 'month', from: new Date(y, m, 1).getTime(), to: eod(new Date(y, m + 1, 0).getTime()), label: 'This month' };
  }
}

export const inPeriod = (ts: string | undefined, p: ListPeriod) => {
  const t = ts ? new Date(ts).getTime() : NaN;
  return !Number.isNaN(t) && t >= p.from && t <= p.to;
};

const ddmmyyyy = (t: number) => new Date(t).toLocaleDateString('en-GB');

export function PeriodBar({ value, onChange }: { value: ListPeriod; onChange: (p: ListPeriod) => void }) {
  const { colors } = useTheme();
  const [menu, setMenu] = useState(false);
  const [picking, setPicking] = useState<null | 'from' | 'to'>(null);
  const keys = ['today', 'week', 'month', 'lastMonth', 'year', 'all'];
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 11,
      backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.line, marginBottom: 12,
    }}>
      <Pressable onPress={() => setMenu(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 10, borderRightWidth: 1, borderRightColor: colors.line }}>
        <Text style={{ fontFamily: fonts.ui, fontSize: 15, color: colors.ink }}>{value.label}</Text>
        <Icon name="down" size={15} color={colors.accent} />
      </Pressable>
      <Icon name="calendar" size={18} color={colors.accent} />
      {value.key === 'all' ? (
        <Text style={{ fontFamily: fonts.ui, fontSize: 15, color: colors.faint }}>Every date</Text>
      ) : (
        <>
          <Pressable onPress={() => setPicking('from')}><Text style={{ fontFamily: fonts.ui, fontSize: 15, color: colors.ink }}>{ddmmyyyy(value.from)}</Text></Pressable>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>TO</Text>
          <Pressable onPress={() => setPicking('to')}><Text style={{ fontFamily: fonts.ui, fontSize: 15, color: colors.ink }}>{ddmmyyyy(value.to)}</Text></Pressable>
        </>
      )}

      <Sheet visible={menu} title="Period" icon="calendar" onClose={() => setMenu(false)}>
        {keys.map((k) => {
          const p = listPeriod(k);
          const on = value.key === k;
          return (
            <Pressable
              key={k}
              onPress={() => { onChange(p); setMenu(false); }}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: pressed ? colors.sunk : 'transparent' })}
            >
              <Text style={{ flex: 1, fontFamily: on ? fonts.uiSemi : fonts.ui, fontSize: 15, color: on ? colors.accent : colors.ink }}>{p.label}</Text>
              {on ? <Icon name="check" size={17} color={colors.accent} /> : null}
            </Pressable>
          );
        })}
      </Sheet>

      {picking ? (
        <DateTimePicker
          value={new Date(picking === 'from' ? value.from : value.to)}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onDismiss={() => setPicking(null)}
          onValueChange={(_e: unknown, d?: Date) => {
            const which = picking;
            setPicking(null);
            if (!d) return;
            const from = which === 'from' ? d.getTime() : value.from;
            const to = which === 'to' ? d.getTime() : value.to;
            onChange(listPeriod('custom', { from: Math.min(from, to), to: Math.max(from, to) }));
          }}
        />
      ) : null}
    </View>
  );
}

/* ----------------------------------------------------------- empty state */

/** Two sheets of paper and a plain sentence — the list is empty, and why. */
export function NoData({ title = 'No Data Available', text = 'Nothing matches this period or filter. Try a wider date range, or add one.' }: { title?: string; text?: string }) {
  const { colors } = useTheme();
  const sheet = (rotate: string, left: number, top: number, front?: boolean) => (
    <View style={{
      position: 'absolute', left, top, width: 104, height: 128, borderRadius: 6, borderWidth: 3,
      borderColor: colors.lineHard, backgroundColor: colors.surface, transform: [{ rotate }], padding: 12, gap: 8,
    }}>
      {[70, 58, 64, 44].map((w, i) => <View key={i} style={{ height: 5, width: w + '%' as any, borderRadius: 3, backgroundColor: colors.line }} />)}
      {front ? <View style={{ position: 'absolute', right: 14, bottom: 18, width: 22, height: 6, borderRadius: 3, backgroundColor: colors.accent }} /> : null}
    </View>
  );
  return (
    <View style={{ alignItems: 'center', paddingTop: 70, paddingHorizontal: 30, paddingBottom: 40 }}>
      <View style={{ width: 190, height: 150 }}>
        {sheet('-12deg', 20, 12)}
        {sheet('6deg', 66, 4, true)}
      </View>
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink, marginTop: 22 }}>{title}</Text>
      <Text style={{ fontFamily: fonts.ui, fontSize: 15, lineHeight: 21, color: colors.faint, marginTop: 6, textAlign: 'center' }}>{text}</Text>
    </View>
  );
}

/* -------------------------------------------------------------- the page */

/**
 * A whole list screen: whatever sits on top (filter, tiles, search), the
 * cards, the empty state, and the "Add …" button.
 */
export function ListPage<T>({ top, data, renderItem, keyExtractor, empty, add, search }: {
  top?: React.ReactNode;
  data: T[];
  renderItem: ListRenderItem<T>;
  keyExtractor: (t: T) => string;
  empty?: { title?: string; text?: string };
  add?: { label: string; onPress: () => void };
  search?: { value: string; onChange: (v: string) => void; placeholder: string };
}) {
  const { colors } = useTheme();
  const header = useMemo(() => (
    <View>
      {top}
      {search ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
          <Search value={search.value} onChange={search.onChange} placeholder={search.placeholder} />
        </View>
      ) : null}
    </View>
  ), [top, search?.value, search?.placeholder]);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <FlatList
        data={data}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={<NoData title={empty?.title} text={empty?.text} />}
        contentContainerStyle={{ paddingBottom: 110, flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
      />
      {add ? <FAB label={add.label} icon="plus" tone="accent" onPress={add.onPress} /> : null}
    </View>
  );
}

/* ------------------------------------------------- print / share a record */

/**
 * Print or share one record's document straight from its card, with the same
 * printer and template rules as its own screen.
 */
export function useQuickDoc() {
  const { db, money } = useAppData();
  const { error } = useToast();
  return async (make: () => DocMeta, what: 'print' | 'share') => {
    try {
      const d = make();
      const opts = printOptsFor(db, d.docKind || docKindOf(d.kind));
      if (what === 'print') await printDoc(d, money, opts);
      else if (!(await shareDoc(d, money, shareOptsFor(db, d.docKind || docKindOf(d.kind))))) error('Sharing is not available on this phone.');
    } catch (e: any) {
      error(e?.message || 'That could not be ' + (what === 'print' ? 'printed' : 'shared') + '.');
    }
  };
}
