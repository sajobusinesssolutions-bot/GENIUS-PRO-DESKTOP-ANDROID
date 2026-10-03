import React from 'react';
import { View, Text, StyleSheet, ViewStyle, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { useTheme, spacing, radius, fonts, shadow, control } from '../theme';
import { avatarFor } from '../data/helpers';
import { Icon, IconName } from './icons';
import { Tap, Rise } from './Tap';
import { Field as FormField } from './form';

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const { colors } = useTheme();
  return (
    <Rise style={[{
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      overflow: 'visible',
      ...shadow.card,
    }, style]}>
      {children}
    </Rise>
  );
}

export function Row({ title, subtitle, right, onPress, left, last }: {
  title: string; subtitle?: string; right?: React.ReactNode; onPress?: () => void; left?: React.ReactNode; last?: boolean;
}) {
  const { colors } = useTheme();
  const Comp: any = onPress ? Tap : View;
  const rowStyle = {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md, paddingVertical: 13, paddingHorizontal: spacing.lg,
    minHeight: control.row,
    borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.line, backgroundColor: colors.surface,
  };
  return (
    <Comp
      onPress={onPress}
      android_ripple={onPress ? { color: colors.accentSoft } : undefined}
      style={onPress ? ({ pressed }: { pressed: boolean }) => [rowStyle, { opacity: pressed ? 0.82 : 1, transform: [{ scale: pressed ? 0.992 : 1 }] }] : rowStyle}
    >
      {left}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      {right}
    </Comp>
  );
}

export function Pill({ label, tone = 'default', icon }: { label: string; tone?: Tone; icon?: React.ReactNode }) {
  const map = useToneMap();
  const [bg, fg] = map[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingVertical: 3.5, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      {icon}
      <Text style={{ color: fg, fontFamily: fonts.uiBold, fontSize: 12.5 }}>{label}</Text>
    </View>
  );
}

export function Button({ label, onPress, variant = 'default', size = 'md', disabled, icon, loading }: {
  label: string; onPress?: () => void; variant?: 'default' | 'pri' | 'dngr'; size?: 'md' | 'sm'; disabled?: boolean; icon?: React.ReactNode; loading?: boolean;
}) {
  const { colors } = useTheme();
  const bg = variant === 'pri' ? colors.accent : variant === 'dngr' ? colors.dangerSoft : colors.surface;
  const border = variant === 'pri' ? colors.accent : variant === 'dngr' ? 'transparent' : colors.lineHard;
  const fg = variant === 'pri' ? colors.accentInk : variant === 'dngr' ? colors.danger : colors.ink;
  const isDisabled = disabled || loading;
  return (
    <Tap
      feel={variant === 'default' ? 'spring' : 'burst'}
      burstColor={variant === 'dngr' ? colors.danger : '#FFFFFF'}
      onPress={isDisabled ? undefined : onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: !!loading }}
      style={({ pressed }) => ({
        width: '100%', alignSelf: 'stretch',
        height: size === 'sm' ? control.buttonSm : control.button,
        borderRadius: size === 'sm' ? radius.sm : radius.md,
        backgroundColor: bg, borderWidth: variant === 'default' ? 1.4 : 1, borderColor: border,
        alignItems: 'center', justifyContent: 'center',
        flexDirection: 'row', gap: 8, paddingHorizontal: size === 'sm' ? 14 : 18,
        opacity: isDisabled ? 0.45 : pressed ? 0.92 : 1,
        shadowColor: variant === 'pri' ? colors.accent : '#0B1D2A',
        shadowOpacity: variant === 'pri' ? 0.22 : 0.04,
        shadowRadius: variant === 'pri' ? 14 : 6,
        shadowOffset: { width: 0, height: 4 },
        elevation: variant === 'pri' ? 3 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        icon
      )}
      {!loading && <Text numberOfLines={1} style={{ color: fg, fontFamily: fonts.uiBold, fontSize: 15 }}>{label}</Text>}
    </Tap>
  );
}

export function Screen({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return <View style={{ flex: 1, backgroundColor: colors.bg }}>{children}</View>;
}

export function Cap({ children, style }: { children: React.ReactNode; style?: any }) {
  const { colors } = useTheme();
  return <Text style={[{ fontFamily: fonts.uiBold, fontSize: 12.5, letterSpacing: 0.7, color: colors.faint, textTransform: 'uppercase' }, style]}>{children}</Text>;
}

export function Empty({ title, subtitle, actionLabel, onAction }: { title: string; subtitle?: string; actionLabel?: string; onAction?: () => void }) {
  return <EmptyState icon="box" title={title} subtitle={subtitle} actionLabel={actionLabel} onAction={onAction} />;
}

export function Chip({ label, on, onPress }: { label: string; on?: boolean; onPress?: () => void }) {
  const { colors } = useTheme();
  return (
    <Tap onPress={onPress} style={{
      paddingVertical: 9, paddingHorizontal: 15, borderRadius: radius.pill, borderWidth: 1,
      borderColor: on ? colors.accent : colors.line, backgroundColor: on ? colors.accent : colors.surface,
      flexDirection: 'row', alignItems: 'center', gap: 6,
    }}>
      {on ? <Icon name="check" size={13} color={colors.accentInk} /> : null}
      <Text style={{ fontFamily: on ? fonts.uiBold : fonts.uiSemi, fontSize: 12.5, color: on ? colors.accentInk : colors.soft }}>{label}</Text>
    </Tap>
  );
}

/* ------------------------------------------------------------------
   Primitives ported one-for-one from the prototype's <style> block.
   ------------------------------------------------------------------ */

export type Tone = 'default' | 'g' | 'w' | 'd' | 'a';

export function useToneMap(): Record<Tone, [string, string]> {
  const { colors } = useTheme();
  return {
    default: [colors.sunk, colors.ink],
    g: [colors.goodSoft, colors.good],
    w: [colors.warnSoft, colors.warn],
    d: [colors.dangerSoft, colors.danger],
    a: [colors.accentSoft, colors.accent],
  };
}

/** `.stat` — inside a `.g3` the value and the caption shrink. */
export function Stat({ label, value, tone = 'default', compact }: {
  label: string; value: string; tone?: Tone; compact?: boolean;
}) {
  const { colors } = useTheme();
  const map = useToneMap();
  const [bg, fg] = map[tone];
  return (
    <View style={{
      backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: bg,
      paddingVertical: compact ? 11 : 14, paddingHorizontal: compact ? 11 : 14, flex: 1, ...shadow.card,
    }}>
      <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginBottom: 6 }}>{label}</Text>
      <Text numberOfLines={1} style={{ fontFamily: fonts.uiExtra, fontSize: compact ? 15 : 20, color: tone === 'default' ? colors.ink : fg }}>{value}</Text>
    </View>
  );
}

/** Kept for existing screens that still import it. */
export function StatTile({ label, value, tone = 'default' }: { label: string; value: string; tone?: Tone }) {
  return <Stat label={label} value={value} tone={tone} />;
}

/** `.pad` */
export function Pad({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[{ paddingVertical: 14, paddingHorizontal: 16 }, style]}>{children}</View>;
}

/** `.g2` / `.g3` / `.qgrid` — fixed-column grids with a 9px gutter. */
export function Grid({ cols, children, gap = 9 }: { cols: number; children: React.ReactNode; gap?: number }) {
  const items = React.Children.toArray(children).filter(Boolean);
  const rows: React.ReactNode[][] = [];
  for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
  return (
    <View style={{ gap }}>
      {rows.map((r, ri) => (
        <View key={ri} style={{ flexDirection: 'row', gap, alignItems: 'stretch' }}>
          {r.map((c, ci) => <View key={ci} style={{ flex: 1, minWidth: 0 }}>{c as any}</View>)}
          {r.length < cols ? Array.from({ length: cols - r.length }).map((_, k) => <View key={'e' + k} style={{ flex: 1 }} />) : null}
        </View>
      ))}
    </View>
  );
}

/** `.banner` */
export function Banner({ tone, icon, text }: { tone: 'g' | 'w' | 'd'; icon: IconName; text: string }) {
  const map = useToneMap();
  const [bg, fg] = map[tone];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 16, backgroundColor: bg }}>
      <Icon name={icon} size={15} color={fg} />
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: fg }}>{text}</Text>
    </View>
  );
}

/** `.kv` */
export function KV({ label, value, bold, valueColor, last }: {
  label: string; value: string; bold?: boolean; valueColor?: string; last?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={{
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 14, paddingVertical: 11,
      borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.line,
    }}>
      <Text style={{ fontFamily: fonts.ui, fontSize: 15, color: colors.faint, flexShrink: 1 }}>{label}</Text>
      <Text style={{ fontFamily: bold ? fonts.uiBold : fonts.uiSemi, fontSize: 15, color: valueColor || colors.ink }}>{value}</Text>
    </View>
  );
}

/** `.kv` whose right-hand side is a component (a pill, a switch …). */
export function KVNode({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 14, paddingVertical: 11,
      borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.line,
    }}>
      <Text style={{ fontFamily: fonts.ui, fontSize: 15, color: colors.faint }}>{label}</Text>
      {children}
    </View>
  );
}

/** `.avatar` */
export function Avatar({ name, id, size = 34 }: { name: string; id?: string; size?: number }) {
  const { initials, color } = avatarFor(name, id);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontFamily: fonts.uiBold, fontSize: Math.round(size * 0.34) }}>{initials}</Text>
    </View>
  );
}

/** The tinted rounded square that leads a row, an account card or a menu group. */
export function IconTile({ icon, bg, color, size = 34, round = 9, iconSize = 16 }: {
  icon: IconName; bg: string; color: string; size?: number; round?: number; iconSize?: number;
}) {
  return (
    <View style={{ width: size, height: size, borderRadius: round, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={iconSize} color={color} weight="duotone" />
    </View>
  );
}

/** `.tile` — an icon over a name and an optional sub-label. `horizontal` is `.qpanel .qact`. */
export function Tile({ icon, iconColor, name, sub, onPress, horizontal }: {
  icon: IconName; iconColor?: string; name: string; sub?: string; onPress?: () => void; horizontal?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Tap onPress={onPress} style={({ pressed }) => ({
      backgroundColor: pressed ? colors.accentSoft : colors.surface,
      borderWidth: 1, borderColor: pressed ? colors.accent : colors.line, borderRadius: 12,
      paddingVertical: horizontal ? 11 : 12, paddingHorizontal: horizontal ? 12 : 11,
      flexDirection: horizontal ? 'row' : 'column', alignItems: horizontal ? 'center' : 'flex-start',
      gap: horizontal ? 9 : 8, flex: 1,
    })}>
      <Icon name={icon} size={horizontal ? 16 : 17} color={iconColor || colors.rail} />
      <View style={{ flex: horizontal ? 1 : undefined, minWidth: 0 }}>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.ink, lineHeight: 17 }}>{name}</Text>
        {sub ? <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 1 }}>{sub}</Text> : null}
      </View>
    </Tap>
  );
}

/** `searchBar(ph)` — reference line 1576. */
export function SearchBar({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ paddingVertical: 10, paddingHorizontal: 16, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.line }}>
      <FormField
        icon="search"
        label={placeholder}
        value={value}
        onChangeText={onChange}
        autoCorrect={false}
        returnKeyType="search"
        style={{ marginBottom: 0 }}
        trailing={value ? <Tap onPress={() => onChange('')} hitSlop={8}><Icon name="x" size={17} color={colors.faint} /></Tap> : null}
      />
    </View>
  );
}

/** `.chips` — a horizontally scrolling chip strip. `plain` drops the surface + rule. */
export function ChipStrip({ options, value, onChange, plain }: {
  options: [string, string][]; value: string; onChange: (v: string) => void; plain?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={plain ? { flexGrow: 0 } : { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.line, flexGrow: 0 }}
      contentContainerStyle={{ gap: 7, paddingVertical: plain ? 0 : 10, paddingHorizontal: plain ? 0 : 16, alignItems: 'center' }}
    >
      {options.map(([v, l]) => <Chip key={v} label={l} on={v === value} onPress={() => onChange(v)} />)}
    </ScrollView>
  );
}

/** `emptyState(icon, t, s, action)` — reference line 1582. Enhanced with CTA. */
export function EmptyState({ icon, title, subtitle, action, actionLabel, onAction }: {
  icon: IconName; title: string; subtitle?: string; action?: React.ReactNode; actionLabel?: string; onAction?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, paddingVertical: 60, paddingHorizontal: 32, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={48} color={colors.lineHard} />
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.soft, marginTop: 16, marginBottom: 8, textAlign: 'center' }}>{title}</Text>
      {subtitle ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 20, color: colors.faint, textAlign: 'center', marginBottom: 20 }}>{subtitle}</Text> : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: 12 }}>
          <Button label={actionLabel} onPress={onAction} variant="pri" size="sm" />
        </View>
      ) : null}
      {action ? <View style={{ marginTop: 16 }}>{action}</View> : null}
    </View>
  );
}

/** A section caption with an optional trailing chip, e.g. "Latest bills … [All]". */
export function SectionHead({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
      <Cap>{title}</Cap>
      {action}
    </View>
  );
}

/** The form primitives live in ./form so they can be used without a cycle. */
export {
  Seg, FieldNote, Field, FieldShell, TypeChips, HighlightToggle, DropZone, SelectField, ChipRow, ActionChip, BigAmount, Sw, ToggleRow,
  Checkbox, Swatch, SettingGroup, SettingRow, SettingToggle, SettingSeg, ProgressBar,
} from './form';

/** The reference-derived layout primitives. */
export {
  Panel, SectionLabel, AccentHead, Tile as IconTileSoft, ListRow, DetailRow, Badge,
  StatCard, StatGrid, FilterChips, SegPill, TopTabs, OptionTiles, InfoBanner,
  Empty as EmptyBlock, FAB, ActionGrid, StickyBar, Search, SquareBtn, useTone, DocCard, SegTabs,
} from './kit';

export const gStyles = StyleSheet.create({
  pad: { padding: spacing.lg },
  sep: { height: 9 },
});
