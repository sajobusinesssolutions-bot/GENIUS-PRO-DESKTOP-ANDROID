/**
 * Layout primitives derived from the supplied reference screens.
 *
 * The references share one language: a neutral page, white cards carrying a soft
 * shadow instead of a border, a tinted icon tile leading every row, small-caps
 * grey section labels, pill filters whose active state is filled and ticked, and
 * a single full-width primary action at the bottom of every form.
 */
import React from 'react';
import { View, Text, ScrollView, ViewStyle, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, fonts, radius, shadow, control } from '../theme';
import { Icon, IconName } from './icons';
import { Tap, Rise } from './Tap';
import { Field } from './form';

type Tone = 'accent' | 'good' | 'warn' | 'danger' | 'neutral';

export function useTone(tone: Tone = 'accent'): { bg: string; fg: string } {
  const { colors } = useTheme();
  switch (tone) {
    case 'good': return { bg: colors.goodSoft, fg: colors.good };
    case 'warn': return { bg: colors.warnSoft, fg: colors.warn };
    case 'danger': return { bg: colors.dangerSoft, fg: colors.danger };
    case 'neutral': return { bg: colors.sunk, fg: colors.soft };
    default: return { bg: colors.accentSoft, fg: colors.accent };
  }
}

/* ------------------------------------------------------------------ surfaces */

/** A white elevated panel. `flush` drops the inner padding for full-bleed rows. */
export function Panel({ children, style, flush }: { children: React.ReactNode; style?: ViewStyle; flush?: boolean }) {
  const { colors } = useTheme();
  return (
    <Rise style={[{
      backgroundColor: colors.surface, borderRadius: radius.lg,
      padding: flush ? 0 : 16, overflow: 'hidden', ...shadow.card,
    }, style]}>
      {children}
    </Rise>
  );
}

/** The small-caps grey caption that heads a group — "PAYMENT METHOD", "LINKED DEVICES". */
export function SectionLabel({ children, right, style }: { children: React.ReactNode; right?: React.ReactNode; style?: ViewStyle }) {
  const { colors } = useTheme();
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }, style]}>
      <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 12.5, letterSpacing: 0.7, color: colors.faint, textTransform: 'uppercase' }}>
        {children}
      </Text>
      {right}
    </View>
  );
}

/** A heavier section head marked by a short accent bar — the "Session History" pattern. */
export function AccentHead({ title, right, tone = 'good' }: { title: string; right?: React.ReactNode; tone?: Tone }) {
  const { colors } = useTheme();
  const { fg } = useTone(tone);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 11 }}>
      <View style={{ width: 3.5, height: 17, borderRadius: 2, backgroundColor: fg }} />
      <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{title}</Text>
      {right}
    </View>
  );
}

/* ---------------------------------------------------------------------- rows */

/** A tinted rounded tile carrying the row's icon. */
export function Tile({ icon, tone = 'accent', size = 42, round, iconSize }: {
  icon: IconName; tone?: Tone; size?: number; round?: number; iconSize?: number;
}) {
  const { bg, fg } = useTone(tone);
  return (
    <View style={{
      width: size, height: size, borderRadius: round ?? size / 3,
      backgroundColor: bg, alignItems: 'center', justifyContent: 'center',
    }}>
      <Icon name={icon} size={iconSize ?? Math.round(size * 0.48)} color={fg} weight="duotone" />
    </View>
  );
}

/**
 * The standard list entry: tinted icon tile, title over subtitle, trailing value
 * or control. `card` renders it as its own elevated row (the Payment Methods and
 * Settings pattern); otherwise it sits inside a Panel as a divided row.
 */
export function ListRow({ icon, tone, title, subtitle, value, valueTone, right, onPress, card, last, badge }: {
  icon?: IconName; tone?: Tone; title: string; subtitle?: string;
  value?: string; valueTone?: string; right?: React.ReactNode;
  onPress?: () => void; card?: boolean; last?: boolean; badge?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const Comp: any = onPress ? Tap : View;
  return (
    <Comp
      {...(onPress ? { feel: 'soft' } : null)}
      onPress={onPress}
      style={({ pressed }: any) => ({
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingHorizontal: card ? 14 : 16, paddingVertical: 13, minHeight: control.row,
        backgroundColor: pressed ? colors.sunk : card ? colors.surface : 'transparent',
        borderRadius: card ? radius.lg : 0,
        marginBottom: card ? 10 : 0,
        borderBottomWidth: !card && !last ? 1 : 0, borderBottomColor: colors.line,
        ...(card ? shadow.card : null),
      })}
    >
      {icon ? <Tile icon={icon} tone={tone} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{title}</Text>
          {badge}
        </View>
        {subtitle ? (
          <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>{subtitle}</Text>
        ) : null}
      </View>
      {value ? (
        <Text style={{ fontFamily: fonts.monoSemi, fontSize: 15, color: valueTone || colors.ink }}>{value}</Text>
      ) : null}
      {right}
      {onPress && !right && !value ? <Icon name="chev" size={17} color={colors.faint} /> : null}
    </Comp>
  );
}

/** A label/value line — the product-detail and balance-sheet pattern. */
export function DetailRow({ label, value, tone, bold, last }: {
  label: string; value: string; tone?: string; bold?: boolean; last?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14,
      paddingVertical: 11, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.line,
    }}>
      <Text style={{ fontFamily: fonts.ui, fontSize: 15, color: colors.faint, flexShrink: 1 }}>{label}</Text>
      <Text style={{ fontFamily: bold ? fonts.uiBold : fonts.uiSemi, fontSize: 15, color: tone || colors.ink }}>{value}</Text>
    </View>
  );
}

/** A coloured status pill — "Paid", "Out of stock", "This device". */
export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const { bg, fg } = useTone(tone);
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: 9 }}>
      <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: fg }}>{label}</Text>
    </View>
  );
}

/* --------------------------------------------------------------- stat blocks */

/** One KPI card: small tinted icon, grey caption, large value. */
export function StatCard({ icon, label, value, tone = 'accent' }: {
  icon?: IconName; label: string; value: string; tone?: Tone;
}) {
  const { colors } = useTheme();
  const { bg, fg } = useTone(tone);
  return (
    <View style={{
      flex: 1, minWidth: 0, backgroundColor: colors.surface, borderRadius: radius.lg,
      borderWidth: 1, borderColor: bg, padding: 14, ...shadow.card,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        {icon ? <Icon name={icon} size={15} color={fg} /> : null}
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{label}</Text>
      </View>
      <Text numberOfLines={1} style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink, marginTop: 8 }}>{value}</Text>
    </View>
  );
}

/** The 2×2 KPI block the report screens open with. */
export function StatGrid({ items }: { items: Array<{ icon?: IconName; label: string; value: string; tone?: Tone }> }) {
  const rows: typeof items[] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return (
    <View style={{ gap: 12 }}>
      {rows.map((row, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 12 }}>
          {row.map((s, j) => <StatCard key={j} {...s} />)}
          {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
        </View>
      ))}
    </View>
  );
}

/* ----------------------------------------------------------------- selectors */

/** A horizontally scrolling filter strip; the active pill is filled and ticked. */
export function FilterChips<T extends string>({ value, options, onChange, tone = 'accent' }: {
  value: T; options: Array<{ v: T; l: string; i?: IconName }>; onChange: (v: T) => void; tone?: Tone;
}) {
  const { colors } = useTheme();
  const { fg } = useTone(tone);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0 }}
      contentContainerStyle={{ gap: 9, paddingVertical: 2, paddingRight: 8 }}
    >
      {options.map((o) => {
        const on = o.v === value;
        return (
          <Tap
            key={o.v}
            onPress={() => onChange(o.v)}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 6,
              paddingVertical: 10, paddingHorizontal: 16, borderRadius: radius.pill,
              backgroundColor: on ? fg : colors.surface,
              borderWidth: 1, borderColor: on ? fg : colors.line,
              ...(on ? null : shadow.card),
            }}
          >
            {on ? <Icon name="check" size={14} color={colors.accentInk} /> : o.i ? <Icon name={o.i} size={14} color={colors.faint} /> : null}
            <Text style={{ fontFamily: on ? fonts.uiBold : fonts.uiSemi, fontSize: 12.5, color: on ? colors.accentInk : colors.soft }}>{o.l}</Text>
          </Tap>
        );
      })}
    </ScrollView>
  );
}

/** The large two-option pill — Staff/Other, Bluetooth/Network, Credit/Debit. */
export function SegPill<T extends string>({ value, options, onChange, tone = 'good' }: {
  value: T; options: Array<{ v: T; l: string; i?: IconName }>; onChange: (v: T) => void; tone?: Tone;
}) {
  const { colors } = useTheme();
  const { fg } = useTone(tone);
  return (
    <View style={{
      flexDirection: 'row', borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.ink,
      overflow: 'hidden', backgroundColor: colors.surface,
    }}>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <Tap
            key={o.v}
            onPress={() => onChange(o.v)}
            style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 14, backgroundColor: on ? fg : 'transparent' }}
          >
            {on ? <Icon name={o.i || 'check'} size={16} color={colors.accentInk} /> : null}
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: on ? colors.accentInk : colors.ink }}>{o.l}</Text>
          </Tap>
        );
      })}
    </View>
  );
}

/** Underlined top tabs with an icon over each label. Scrolls when it overflows. */
export function TopTabs<T extends string>({ value, options, onChange, tone = 'accent' }: {
  value: T; options: Array<{ v: T; l: string; i?: IconName }>; onChange: (v: T) => void; tone?: Tone;
}) {
  const { colors } = useTheme();
  const { fg } = useTone(tone);
  return (
    <View style={{ backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.line }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 6 }}>
        {options.map((o) => {
          const on = o.v === value;
          return (
            <Tap
              key={o.v}
              onPress={() => onChange(o.v)}
              style={{ minWidth: 92, alignItems: 'center', gap: 4, paddingTop: 10, paddingBottom: 9, paddingHorizontal: 14, borderBottomWidth: 2.5, borderBottomColor: on ? fg : 'transparent' }}
            >
              {o.i ? <Icon name={o.i} size={19} color={on ? fg : colors.faint} /> : null}
              <Text numberOfLines={1} style={{ fontFamily: on ? fonts.uiBold : fonts.uiSemi, fontSize: 12.5, color: on ? fg : colors.faint }}>{o.l}</Text>
            </Tap>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** The 4-across selectable tiles used for payment method. */
export function OptionTiles<T extends string>({ value, options, onChange, tone = 'good' }: {
  value: T; options: Array<{ v: T; l: string; i?: IconName }>; onChange: (v: T) => void; tone?: Tone;
}) {
  const { colors } = useTheme();
  const { fg } = useTone(tone);
  return (
    <View style={{ flexDirection: 'row', gap: 9 }}>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <Tap
            key={o.v}
            onPress={() => onChange(o.v)}
            style={{
              flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', gap: 6,
              paddingVertical: 13, paddingHorizontal: 4, borderRadius: radius.md,
              backgroundColor: on ? fg : colors.surface,
              borderWidth: 1, borderColor: on ? fg : colors.line,
            }}
          >
            {o.i ? <Icon name={o.i} size={20} color={on ? colors.accentInk : colors.soft} /> : null}
            <Text numberOfLines={2} style={{ textAlign: 'center', fontFamily: fonts.uiSemi, fontSize: 12.5, color: on ? colors.accentInk : colors.soft }}>{o.l}</Text>
          </Tap>
        );
      })}
    </View>
  );
}

/* --------------------------------------------------------------- messaging */

/** The tinted advisory strip with a leading icon. */
export function InfoBanner({ text, tone = 'accent', icon = 'alert' }: { text: string; tone?: Tone; icon?: IconName }) {
  const { bg, fg } = useTone(tone);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: bg, borderRadius: radius.md, padding: 13 }}>
      <Icon name={icon} size={17} color={fg} />
      <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 19, color: fg }}>{text}</Text>
    </View>
  );
}

/** Centred empty state: large muted glyph, title, hint, optional action. */
export function Empty({ icon = 'box', title, hint, action }: {
  icon?: IconName; title: string; hint?: string; action?: React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 56, paddingHorizontal: 32, gap: 8 }}>
      <Icon name={icon} size={46} color={colors.lineHard} />
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.soft, textAlign: 'center', marginTop: 6 }}>{title}</Text>
      {hint ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 19, color: colors.faint, textAlign: 'center' }}>{hint}</Text> : null}
      {action ? <View style={{ marginTop: 14 }}>{action}</View> : null}
    </View>
  );
}

/* ----------------------------------------------------------------- actions */

/** The extended floating action button anchored bottom-right. */
export function FAB({ label, icon = 'plus', onPress, tone = 'danger' }: {
  label?: string; icon?: IconName; onPress: () => void; tone?: Tone;
}) {
  const { colors } = useTheme();
  const { fg } = useTone(tone);
  const insets = useSafeAreaInsets();
  return (
    <Tap
      feel="burst"
      onPress={onPress}
      style={{
        position: 'absolute', right: 18, bottom: 18 + insets.bottom,
        flexDirection: 'row', alignItems: 'center', gap: 9,
        height: 56, paddingHorizontal: label ? 22 : 0, width: label ? undefined : 56,
        justifyContent: 'center', borderRadius: 28, backgroundColor: fg, ...shadow.raised,
      }}
    >
      <Icon name={icon} size={22} color={colors.accentInk} />
      {label ? <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.accentInk }}>{label}</Text> : null}
    </Tap>
  );
}

/** The 2-column action grid that closes a detail sheet. */
export function ActionGrid({ actions }: {
  actions: Array<{ label: string; icon?: IconName; tone?: Tone; filled?: boolean; onPress: () => void }>;
}) {
  const rows: typeof actions[] = [];
  for (let i = 0; i < actions.length; i += 2) rows.push(actions.slice(i, i + 2));
  return (
    <View style={{ gap: 10 }}>
      {rows.map((row, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
          {row.map((a, j) => <GridAction key={j} {...a} />)}
          {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
        </View>
      ))}
    </View>
  );
}

function GridAction({ label, icon, tone = 'accent', filled, onPress }: {
  label: string; icon?: IconName; tone?: Tone; filled?: boolean; onPress: () => void;
}) {
  const { colors } = useTheme();
  const { fg } = useTone(tone);
  return (
    <Tap
      onPress={onPress}
      style={{
        flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        height: control.button, borderRadius: radius.md,
        backgroundColor: filled ? fg : colors.surface,
        borderWidth: 1.4, borderColor: fg,
      }}
    >
      {icon ? <Icon name={icon} size={17} color={filled ? colors.accentInk : fg} /> : null}
      <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 15, color: filled ? colors.accentInk : fg }}>{label}</Text>
    </Tap>
  );
}

/** A sticky bottom bar holding the screen's primary action. */
export function StickyBar({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{
      position: 'absolute', left: 0, right: 0, bottom: 0,
      backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line,
      paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 + insets.bottom,
    }}>
      {children}
    </View>
  );
}

/* ------------------------------------------------------------------- inputs */

/** A search field with a leading glyph and optional trailing buttons. */
export function Search({ value, onChange, placeholder, right, error }: {
  value: string; onChange: (v: string) => void; placeholder: string; right?: React.ReactNode; error?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
      <Field
        icon="search"
        label={placeholder}
        value={value}
        onChangeText={onChange}
        autoCorrect={false}
        returnKeyType="search"
        error={error ? ' ' : undefined}
        style={{ flex: 1, marginBottom: 0 }}
        trailing={value ? <Tap onPress={() => onChange('')} hitSlop={8}><Icon name="x" size={17} color={colors.faint} /></Tap> : null}
      />
      {right}
    </View>
  );
}

/** A square icon button sized to sit beside a field. */
export function SquareBtn({ icon, onPress, tone = 'danger', filled }: {
  icon: IconName; onPress: () => void; tone?: Tone; filled?: boolean;
}) {
  const { colors } = useTheme();
  const { fg } = useTone(tone);
  return (
    <Tap
      onPress={onPress}
      style={{
        width: 50, height: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
        backgroundColor: filled ? fg : colors.surface, borderWidth: 1.4, borderColor: filled ? fg : colors.line,
      }}
    >
      <Icon name={icon} size={20} color={filled ? colors.accentInk : fg} />
    </Tap>
  );
}

/**
 * The document card shared by every list of records — invoices, estimates,
 * credit notes, challans, orders. Header row, rule, then a meta line carrying
 * the document number, its status badges and the date.
 */
export function DocCard({ icon, tone = 'accent', title, subtitle, amount, amountTone, no, date, badges, onPress, children, dim }: {
  icon?: IconName; tone?: Tone; title: string; subtitle?: string;
  amount?: string; amountTone?: string; no?: string; date?: string;
  badges?: React.ReactNode; onPress?: () => void; children?: React.ReactNode; dim?: boolean;
}) {
  const { colors } = useTheme();
  const Comp: any = onPress ? Tap : View;
  return (
    <Comp
      onPress={onPress}
      style={{
        backgroundColor: colors.surface, borderRadius: radius.lg,
        paddingHorizontal: 15, paddingVertical: 14, marginBottom: 10,
        opacity: dim ? 0.6 : 1, ...shadow.card,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {icon ? <Tile icon={icon} tone={tone} /> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{title}</Text>
          {subtitle ? (
            <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>{subtitle}</Text>
          ) : null}
        </View>
        {amount ? (
          <Text style={{ fontFamily: fonts.uiExtra, fontSize: 15, color: amountTone || colors.ink }}>{amount}</Text>
        ) : null}
      </View>

      {no || date || badges ? (
        <>
          <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 12 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
            {no ? <Text style={{ fontFamily: fonts.monoSemi, fontSize: 12.5, color: colors.faint }}>{no}</Text> : null}
            {badges}
            <View style={{ flex: 1 }} />
            {date ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{date}</Text> : null}
          </View>
        </>
      ) : null}

      {children ? <View style={{ marginTop: 12 }}>{children}</View> : null}
    </Comp>
  );
}

/**
 * Two or three equal buttons filling a row.
 *
 * `TopTabs` sizes each tab to its own label, so a pair like "Transactions" and
 * "Party details" came out lopsided and neither looked like something to press.
 * These share the width evenly and read as buttons, which is what a two-way
 * switch at the top of a screen should be.
 */
export function SegTabs<T extends string>({ value, options, onChange }: {
  value: T; options: Array<{ v: T; l: string; i?: IconName }>; onChange: (v: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{
      flexDirection: 'row', gap: 8,
      paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10,
      backgroundColor: colors.surface,
      borderBottomWidth: 1, borderBottomColor: colors.line,
    }}>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <Tap
            key={o.v}
            onPress={() => onChange(o.v)}
            style={{
              flex: 1,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
              // tall enough to be a comfortable target, not a line of text
              height: control.button,
              borderRadius: radius.md,
              backgroundColor: on ? colors.accent : colors.sunk,
              borderWidth: 1,
              borderColor: on ? colors.accent : colors.line,
            }}
          >
            {o.i ? <Icon name={o.i} size={16} color={on ? colors.accentInk : colors.soft} /> : null}
            <Text
              numberOfLines={1}
              style={{
                fontFamily: on ? fonts.uiBold : fonts.uiSemi,
                fontSize: 12.5,
                color: on ? colors.accentInk : colors.soft,
              }}
            >
              {o.l}
            </Text>
          </Tap>
        );
      })}
    </View>
  );
}
