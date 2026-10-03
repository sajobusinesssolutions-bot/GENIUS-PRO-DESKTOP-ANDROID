/**
 * Form primitives ported from the prototype's helpers and CSS:
 * `seg()`, `fld()`, `chipRow()`, `bigAmount()` (`.bigfield`), `fieldNote()`,
 * `togRow()` (9346), `setRow()`/`setToggle()`/`setGroup()` (6803-6816),
 * and the `.sw`, `.cbx`, `.rolebar`, `.swatch`, `.emojigrid`/`.emojibtn`,
 * `.scanbox`/`.scanline`, `.itemimg` classes.
 *
 * Kept in their own module (no imports from ui.tsx) so ui.tsx can re-export
 * them without a cycle.
 */
import React from 'react';
import { View, Text, TextInput, ViewStyle, Animated } from 'react-native';
import { useTheme, radius, fonts } from '../theme';
import { Icon, IconName } from './icons';
import { Tap, TapProps } from './Tap';

const SoftTap = (p: TapProps) => <Tap feel="soft" {...p} />;

function CapText({ children, style }: { children: React.ReactNode; style?: any }) {
  const { colors } = useTheme();
  return (
    <Text style={[{ fontFamily: fonts.uiBold, fontSize: 12.5, letterSpacing: 0.6, color: colors.faint, textTransform: 'uppercase' }, style]}>
      {children}
    </Text>
  );
}

/** `.seg` — a segmented control. */
export function Seg<T extends string>({ value, options, onChange, style }: {
  value: T; options: { v: T; l: string; i?: IconName }[]; onChange: (v: T) => void; style?: ViewStyle;
}) {
  const { colors } = useTheme();
  return (
    <View style={[{ flexDirection: 'row', backgroundColor: colors.sunk, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: 4, gap: 4 }, style]}>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <Tap feel="soft"
            key={o.v}
            onPress={() => onChange(o.v)}
            style={{
              flex: 1, height: 42, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
              flexDirection: 'row', gap: 7, backgroundColor: on ? colors.accent : 'transparent',
            }}
          >
            {o.i ? <Icon name={o.i} size={16} color={on ? colors.accentInk : colors.faint} /> : null}
            <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 15, color: on ? colors.accentInk : colors.faint }}>
              {o.l}
            </Text>
          </Tap>
        );
      })}
    </View>
  );
}

/** `fieldNote(t)` — the small grey sentence under a field. */
export function FieldNote({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 16.5, color: colors.faint, marginTop: 6, marginBottom: 10 }}>
      {children}
    </Text>
  );
}

/**
 * The app's text field. The label sits inside the box, where a placeholder
 * would be; when the field is tapped (or holds a value) it slides up and
 * shrinks to a small faint caption, leaving the box for what is typed. The
 * placeholder — a hint such as "e.g. 24" — only shows once the field is in
 * use, so an empty form reads as a list of plain names.
 */
export function Field({
  label, value, onChangeText, placeholder, numeric, decimal, multiline, readOnly, right, style,
  compact, error, icon, secure, maxLength, autoCapitalize, onFocus, onBlur, suffix, autoFocus, inputRef, big, keyboard,
  trailing, returnKeyType, onSubmitEditing, autoCorrect, keepFocus,
}: {
  label?: string; value: string; onChangeText?: (v: string) => void; placeholder?: string;
  numeric?: boolean; decimal?: boolean; multiline?: boolean; readOnly?: boolean; right?: React.ReactNode;
  style?: ViewStyle; compact?: boolean; error?: string; icon?: IconName;
  secure?: boolean; maxLength?: number; autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  onFocus?: () => void; onBlur?: () => void; suffix?: string; autoFocus?: boolean; inputRef?: React.Ref<TextInput>;
  /** Kept for callers written for the earlier inset style; every label is inset now. */
  inset?: boolean;
  /** A large number, for the one figure a screen is about (opening stock). */
  big?: boolean;
  /** A text keyboard other than the plain one, for phone numbers and emails. */
  keyboard?: 'phone-pad' | 'email-address';
  /** Inside the box at its right edge — a clear button, a scan button. */
  trailing?: React.ReactNode;
  returnKeyType?: 'done' | 'search' | 'next' | 'go';
  onSubmitEditing?: () => void;
  autoCorrect?: boolean;
  /** Stay in the box after Enter, for typing or scanning several in a row. */
  keepFocus?: boolean;
}) {
  const { colors } = useTheme();
  const [focused, setFocused] = React.useState(false);
  const hasError = !!error;
  const bg = readOnly ? colors.sunk : colors.surface;
  const hasLabel = !!label;
  // a lone zero in a number box is a blank, not a value: it clears on focus
  // so the first key typed replaces it instead of landing after it
  const raw = String(value ?? '');
  const shown = numeric && focused && raw !== '' && /^0*(\.0*)?$/.test(raw) ? '' : value;
  const filled = raw !== '';
  const up = !hasLabel || big || focused || filled;

  // two clocks, both 100ms: `lift` moves the label (up while focused or
  // filled), `glow` turns the border and label blue (only while focused)
  const lift = React.useRef(new Animated.Value(up ? 1 : 0)).current;
  const glow = React.useRef(new Animated.Value(focused ? 1 : 0)).current;
  React.useEffect(() => {
    Animated.parallel([
      Animated.timing(lift, { toValue: up ? 1 : 0, duration: FLOAT_MS, useNativeDriver: false }),
      Animated.timing(glow, { toValue: focused ? 1 : 0, duration: FLOAT_MS, useNativeDriver: false }),
    ]).start();
  }, [up, focused, lift, glow]);

  const rowH = big ? 84 : multiline ? 104 : compact ? 48 : 56;
  const restTop = multiline ? 14 : (rowH - 2.8) / 2 - LABEL_H / 2;
  const padH = compact ? 12 : 15;
  const restLeft = padH + (icon ? 31 : 0) - 4;
  const idle = hasError ? colors.danger : colors.line;
  const lit = hasError ? colors.danger : colors.accent;

  return (
    <View style={[{ marginTop: hasLabel ? 6 : 0, marginBottom: hasError ? 6 : 14 }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Animated.View style={{
          flex: 1, flexDirection: 'row', alignItems: multiline ? 'flex-start' : 'center', gap: 12,
          minHeight: compact && !hasLabel ? 46 : rowH,
          borderRadius: radius.md, borderWidth: 1.4,
          borderColor: glow.interpolate({ inputRange: [0, 1], outputRange: [idle, lit] }),
          backgroundColor: bg,
          paddingHorizontal: padH,
          paddingVertical: multiline ? 14 : 0,
        }}>
          {icon ? (
            <View style={{ alignSelf: multiline ? 'flex-start' : 'center', marginTop: multiline ? 1 : 0 }}>
              <Icon name={icon} size={19} color={hasError ? colors.danger : focused ? colors.accent : colors.soft} />
            </View>
          ) : null}

          <TextInput
            ref={inputRef}
            value={shown}
            onChangeText={onChangeText}
            editable={!readOnly}
            placeholder={placeholder}
            placeholderTextColor={focused || !hasLabel ? colors.faint : 'transparent'}
            keyboardType={keyboard || (numeric ? (decimal ? 'decimal-pad' : 'numeric') : 'default')}
            multiline={multiline}
            secureTextEntry={secure}
            maxLength={maxLength}
            autoCapitalize={autoCapitalize}
            autoFocus={autoFocus}
            returnKeyType={returnKeyType}
            onSubmitEditing={onSubmitEditing}
            autoCorrect={autoCorrect}
            submitBehavior={keepFocus ? 'submit' : undefined}
            onFocus={() => { setFocused(true); onFocus?.(); }}
            onBlur={() => { setFocused(false); onBlur?.(); }}
            style={{
              flex: 1, padding: 0, alignSelf: 'stretch',
              minHeight: multiline ? 70 : undefined,
              color: readOnly ? colors.faint : colors.ink,
              fontFamily: big ? fonts.uiBold : numeric ? fonts.mono : fonts.ui,
              fontSize: big ? 30 : 15,
              textAlign: numeric && compact && !hasLabel ? 'right' : 'left',
              textAlignVertical: multiline ? 'top' : 'center',
            }}
          />

          {suffix ? (
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.faint }}>{suffix}</Text>
          ) : null}
          {trailing}

          {/* the label: the placeholder while empty, a caption cut into the border once in use */}
          {hasLabel ? (
            <FloatLabel
              text={label!}
              bg={bg}
              lift={lift}
              glow={glow}
              restTop={restTop}
              restLeft={restLeft}
              upLeft={padH - 5}
              idle={hasError ? colors.danger : colors.faint}
              lit={lit}
            />
          ) : null}
        </Animated.View>
        {right}
      </View>
      {hasError ? (
        <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.danger, marginTop: 6, marginBottom: 7 }}>{error}</Text>
      ) : null}
    </View>
  );
}

const FLOAT_MS = 100;
const LABEL_H = 18;
/** Where a raised label sits: centred on the 1.4px top border. */
const UP_TOP = -1.4 / 2 - 1.4 - LABEL_H / 2 + 1.4;

/**
 * The label of an outlined field. At rest it sits where the text would be;
 * raised, it shrinks onto the top border and a strip of the field's own
 * colour behind it cuts the notch in the line.
 */
function FloatLabel({ text, bg, lift, glow, restTop, restLeft, upLeft, idle, lit }: {
  text: string; bg: string; lift: Animated.Value; glow: Animated.Value;
  restTop: number; restLeft: number; upLeft: number; idle: string; lit: string;
}) {
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute', height: LABEL_H, maxWidth: '88%', paddingHorizontal: 4, justifyContent: 'center',
        top: lift.interpolate({ inputRange: [0, 1], outputRange: [restTop, UP_TOP] }),
        left: lift.interpolate({ inputRange: [0, 1], outputRange: [restLeft, upLeft] }),
      }}
    >
      <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: LABEL_H / 2 - 2, height: 4, backgroundColor: bg, opacity: lift }} />
      <Animated.Text
        numberOfLines={1}
        style={{
          fontFamily: fonts.ui,
          fontSize: lift.interpolate({ inputRange: [0, 1], outputRange: [15, 12] }),
          color: glow.interpolate({ inputRange: [0, 1], outputRange: [idle, lit] }),
        }}
      >
        {text}
      </Animated.Text>
    </Animated.View>
  );
}

/** A label already raised onto the border, for boxes that always hold a value. */
function StaticLabel({ text, bg, color, left }: { text: string; bg: string; color: string; left: number }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: UP_TOP, left, height: LABEL_H, maxWidth: '88%', paddingHorizontal: 4, justifyContent: 'center' }}>
      <View style={{ position: 'absolute', left: 0, right: 0, top: LABEL_H / 2 - 2, height: 4, backgroundColor: bg }} />
      <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12, color }}>{text}</Text>
    </View>
  );
}

/** The same outline, but the body is yours — used for pickers and read-outs. */
export function FieldShell({ label, icon, children, onPress, right, style, tone, error }: {
  label?: string; icon?: IconName; children: React.ReactNode; onPress?: () => void;
  right?: React.ReactNode; style?: ViewStyle; tone?: string; error?: boolean;
}) {
  const { colors } = useTheme();
  const Comp: any = onPress ? SoftTap : View;
  const border = error ? colors.danger : tone || colors.line;
  return (
    <View style={[{ marginTop: label ? 6 : 0, marginBottom: 14 }, style]}>
      <Comp
        onPress={onPress}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56,
          borderRadius: radius.md, borderWidth: 1.4, borderColor: border,
          backgroundColor: colors.surface, paddingHorizontal: 15, paddingVertical: 8,
        }}
      >
        {icon ? <Icon name={icon} size={19} color={error ? colors.danger : colors.soft} /> : null}
        <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
        {right}
        {label ? <StaticLabel text={label} bg={colors.surface} color={error ? colors.danger : colors.faint} left={10} /> : null}
      </Comp>
    </View>
  );
}

/** The outlined pill pair at the top of the reference sheet — Simple / Service. */
export function TypeChips<T extends string>({ value, options, onChange, style }: {
  value: T; options: { v: T; l: string; i?: IconName }[]; onChange: (v: T) => void; style?: ViewStyle;
}) {
  const { colors } = useTheme();
  return (
    <View style={[{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }, style]}>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <Tap feel="soft"
            key={o.v}
            onPress={() => onChange(o.v)}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 9,
              paddingVertical: 12, paddingHorizontal: 20, borderRadius: radius.pill,
              borderWidth: 1.4, borderColor: on ? colors.good : colors.line,
              backgroundColor: on ? colors.goodSoft : colors.surface,
            }}
          >
            {o.i ? <Icon name={o.i} size={18} color={on ? colors.good : colors.soft} /> : null}
            <Text style={{ fontFamily: on ? fonts.uiBold : fonts.uiSemi, fontSize: 15, color: on ? colors.good : colors.ink }}>
              {o.l}
            </Text>
          </Tap>
        );
      })}
    </View>
  );
}

/** The tinted highlight card carrying a switch — "This product has variations". */
export function HighlightToggle({ title, sub, on, onChange, tone = 'good' }: {
  title: string; sub?: string; on: boolean; onChange: (v: boolean) => void;
  tone?: 'good' | 'accent' | 'warn';
}) {
  const { colors } = useTheme();
  const fg = tone === 'accent' ? colors.accent : tone === 'warn' ? colors.warn : colors.good;
  const bg = tone === 'accent' ? colors.accentSoft : tone === 'warn' ? colors.warnSoft : colors.goodSoft;
  return (
    <Tap feel="soft"
      onPress={() => onChange(!on)}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16,
        borderRadius: radius.md, borderWidth: 1.4, borderColor: on ? fg : bg,
        backgroundColor: bg, paddingHorizontal: 16, paddingVertical: 15,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{title}</Text>
        {sub ? (
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 18, color: colors.soft, marginTop: 3 }}>{sub}</Text>
        ) : null}
      </View>
      <Sw on={on} onPress={() => onChange(!on)} />
    </Tap>
  );
}

/** The large tinted media drop zone from the reference sheet. */
export function DropZone({ label, onPress, children, tone = 'good' }: {
  label: string; onPress: () => void; children?: React.ReactNode; tone?: 'good' | 'accent';
}) {
  const { colors } = useTheme();
  const fg = tone === 'accent' ? colors.accent : colors.good;
  const bg = tone === 'accent' ? colors.accentSoft : colors.goodSoft;
  return (
    <Tap feel="soft"
      onPress={onPress}
      style={{
        borderRadius: radius.md, borderWidth: 1.4, borderColor: fg, backgroundColor: bg,
        alignItems: 'center', justifyContent: 'center', paddingVertical: 34, gap: 10, marginBottom: 16,
      }}
    >
      {children ?? <Icon name="plus" size={34} color={fg} />}
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: fg }}>{label}</Text>
    </Tap>
  );
}

/** The port's stand-in for `<select class="inp">` — tap to reveal the options. */
export function SelectField<T extends string>({ label, value, options, onChange, style, icon, placeholder }: {
  label?: string; value: T; options: { v: T; l: string }[]; onChange: (v: T) => void;
  style?: ViewStyle; icon?: IconName; placeholder?: string;
}) {
  const { colors } = useTheme();
  const [open, setOpen] = React.useState(false);
  const cur = options.find((o) => o.v === value);
  const border = open ? colors.accent : colors.line;
  return (
    <View style={[{ marginTop: label ? 6 : 0, marginBottom: 14 }, style]}>
      <Tap feel="soft"
        onPress={() => setOpen((o) => !o)}
        style={{
          minHeight: 56, borderRadius: radius.md, borderWidth: 1.4, borderColor: border,
          backgroundColor: colors.surface, paddingHorizontal: 15, paddingVertical: 8,
          flexDirection: 'row', alignItems: 'center', gap: 12,
        }}
      >
        {icon ? <Icon name={icon} size={19} color={open ? colors.accent : colors.soft} /> : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 15, color: cur ? colors.ink : colors.faint }}>
            {cur ? cur.l : placeholder || 'Select…'}
          </Text>
        </View>
        <Icon name={open ? 'up' : 'down'} size={18} color={colors.faint} />
        {label ? <StaticLabel text={label} bg={colors.surface} color={open ? colors.accent : colors.faint} left={10} /> : null}
      </Tap>
      {open ? (
        <View style={{ marginTop: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: 'hidden' }}>
          {options.map((o, i) => (
            <Tap feel="soft"
              key={o.v}
              onPress={() => { onChange(o.v); setOpen(false); }}
              style={{
                paddingVertical: 14, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 9,
                borderBottomWidth: i === options.length - 1 ? 0 : 1, borderBottomColor: colors.line,
                backgroundColor: o.v === value ? colors.accentSoft : colors.surface,
              }}
            >
              <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{o.l}</Text>
              {o.v === value ? <Icon name="check" size={17} color={colors.accent} /> : null}
            </Tap>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/** `chipRow(name, value, opts)` — a wrapping row of chips, each with an optional icon. */
export function ChipRow<T extends string>({ value, options, onChange, style }: {
  value: T; options: { v: T; l: string; i?: IconName }[]; onChange: (v: T) => void; style?: ViewStyle;
}) {
  const { colors } = useTheme();
  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, style]}>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <Tap feel="soft"
            key={o.v}
            onPress={() => onChange(o.v)}
            style={{
              paddingVertical: 7, paddingHorizontal: 11, borderRadius: radius.pill, borderWidth: 1,
              borderColor: on ? colors.ink : colors.line, backgroundColor: on ? colors.ink : colors.surface,
              flexDirection: 'row', alignItems: 'center', gap: 5,
            }}
          >
            {o.i ? <Icon name={o.i} size={13} color={on ? colors.bg : colors.faint} /> : null}
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: on ? colors.bg : colors.soft }}>{o.l}</Text>
          </Tap>
        );
      })}
    </View>
  );
}

/** A plain tappable chip that fires an action rather than selecting a value. */
export function ActionChip({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Tap feel="soft" onPress={onPress} style={{
      paddingVertical: 7, paddingHorizontal: 11, borderRadius: radius.pill,
      borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface,
    }}>
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.soft }}>{label}</Text>
    </Tap>
  );
}

/** `.bigfield` — the large centred amount input with its caption and hint. */
export function BigAmount({ caption, value, onChangeText, hint, currency }: {
  caption?: string; value: string; onChangeText: (v: string) => void; hint?: string; currency?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={{
      backgroundColor: colors.sunk, borderRadius: radius.lg,
      paddingVertical: 16, paddingHorizontal: 16, alignItems: 'center', marginBottom: 12,
    }}>
      {caption ? <CapText style={{ marginBottom: 6 }}>{caption}</CapText> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
        {currency ? <Text style={{ fontFamily: fonts.monoSemi, fontSize: 20, color: colors.faint }}>{currency}</Text> : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          keyboardType="numeric"
          placeholder="0"
          placeholderTextColor={colors.lineHard}
          style={{
            minWidth: 120, padding: 0, textAlign: 'center',
            fontFamily: fonts.monoSemi, fontSize: 32, letterSpacing: -0.8, color: colors.ink,
          }}
        />
      </View>
      {hint ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 7, textAlign: 'center' }}>{hint}</Text> : null}
    </View>
  );
}

/** `.sw` — the pill switch the prototype draws by hand. */
export function Sw({ on, onPress }: { on: boolean; onPress?: () => void }) {
  const { colors } = useTheme();
  return (
    <Tap feel="soft"
      onPress={onPress}
      hitSlop={6}
      style={{
        width: 50, height: 29, borderRadius: 15, padding: 2.5,
        backgroundColor: on ? colors.accent : colors.lineHard,
        alignItems: on ? 'flex-end' : 'flex-start', justifyContent: 'center',
      }}
    >
      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff' }} />
    </Tap>
  );
}

/** `togRow(label, key, on)` — a bordered row whose whole surface toggles a switch. */
export function ToggleRow({ label, sub, on, onChange, bare }: {
  label: string; sub?: string; on: boolean; onChange: (v: boolean) => void; bare?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Tap feel="soft"
      onPress={() => onChange(!on)}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingVertical: 14, paddingHorizontal: bare ? 0 : 15,
        borderRadius: bare ? 0 : radius.md,
        borderWidth: bare ? 0 : 1, borderColor: on ? colors.accent : colors.line,
        marginBottom: bare ? 0 : 12,
        backgroundColor: bare ? 'transparent' : on ? colors.accentSoft : colors.surface,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{label}</Text>
        {sub ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>{sub}</Text> : null}
      </View>
      <Sw on={on} onPress={() => onChange(!on)} />
    </Tap>
  );
}

/** `.cbx` — the square tick used by the permission grid. */
export function Checkbox({ on, onPress, size = 19 }: { on: boolean; onPress?: () => void; size?: number }) {
  const { colors } = useTheme();
  return (
    <Tap feel="soft"
      onPress={onPress}
      hitSlop={6}
      style={{
        width: size, height: size, borderRadius: 6, borderWidth: 1.6,
        borderColor: on ? colors.accent : colors.lineHard,
        backgroundColor: on ? colors.accent : 'transparent',
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      {on ? <Icon name="check" size={size - 8} color={colors.accentInk} /> : null}
    </Tap>
  );
}

/** `.swatch` — the colour tag squares on the item editor's More tab. */
export function Swatch({ color, on, onPress }: { color: string; on: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Tap feel="soft"
      onPress={onPress}
      style={{
        width: 34, height: 34, borderRadius: 10,
        backgroundColor: color || colors.sunk,
        borderWidth: on ? 2.5 : 1,
        borderColor: on ? colors.ink : colors.line,
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      {color ? null : <Text style={{ color: colors.faint, fontFamily: fonts.uiSemi, fontSize: 12.5 }}>—</Text>}
    </Tap>
  );
}

/** `setGroup(title, rows)` — a caption over one card of rows. */
export function SettingGroup({ title, children, style }: { title: string; children: React.ReactNode; style?: ViewStyle }) {
  const { colors } = useTheme();
  const kids = React.Children.toArray(children).filter(Boolean);
  if (!kids.length) return null;
  return (
    <View style={[{ marginBottom: 18 }, style]}>
      <CapText style={{ marginBottom: 8, marginLeft: 4 }}>{title}</CapText>
      <View style={{
        backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden',
        shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 2,
      }}>
        {kids.map((c, i) => (
          <View key={i} style={{ borderBottomWidth: i === kids.length - 1 ? 0 : 1, borderBottomColor: colors.line }}>
            {c as React.ReactNode}
          </View>
        ))}
      </View>
    </View>
  );
}

/*
 * Every settings row is built from the same three parts, so a list of them
 * lines up: an icon tile of one size, a label column that starts at the same
 * x on every row, and the control on the right. Rows used to differ in
 * padding, font size and whether they had an icon at all, which is why labels
 * zig-zagged down a group.
 */
const ROW = { padH: 16, padV: 12, gap: 14, minH: 62, tile: 36 } as const;

function RowTile({ icon, danger }: { icon?: IconName; danger?: boolean }) {
  const { colors } = useTheme();
  if (!icon) return null;
  return (
    <View style={{
      width: ROW.tile, height: ROW.tile, borderRadius: 11,
      backgroundColor: danger ? colors.dangerSoft : colors.accentSoft, alignItems: 'center', justifyContent: 'center',
    }}>
      <Icon name={icon} size={18} color={danger ? colors.danger : colors.accent} />
    </View>
  );
}

function RowText({ label, sub, danger }: { label: string; sub?: string; danger?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}>
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, lineHeight: 20, color: danger ? colors.danger : colors.ink }}>{label}</Text>
      {sub ? <Text numberOfLines={2} style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 17, color: colors.faint, marginTop: 2 }}>{sub}</Text> : null}
    </View>
  );
}

const rowStyle = {
  flexDirection: 'row' as const, alignItems: 'center' as const, gap: ROW.gap,
  paddingVertical: ROW.padV, paddingHorizontal: ROW.padH, minHeight: ROW.minH,
};

/** `setRow(k, v, action)` — label on the left, current value and a chevron on the right. */
export function SettingRow({ label, value, onPress, danger, icon, sub }: {
  label: string; value?: string; onPress?: () => void; danger?: boolean; icon?: IconName; sub?: string;
}) {
  const { colors } = useTheme();
  const Comp: any = onPress ? SoftTap : View;
  return (
    <Comp onPress={onPress} style={rowStyle}>
      <RowTile icon={icon} danger={danger} />
      <RowText label={label} sub={sub} danger={danger} />
      {value ? (
        <Text numberOfLines={1} style={{ maxWidth: '42%', fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, textAlign: 'right' }}>
          {value}
        </Text>
      ) : null}
      {onPress ? <Icon name="chev" size={16} color={colors.lineHard} /> : null}
    </Comp>
  );
}

/** `setToggle(label, key)` — the same row with a switch instead of a chevron. */
export function SettingToggle({ label, sub, on, onChange, icon }: {
  label: string; sub?: string; on: boolean; onChange: (v: boolean) => void; icon?: IconName;
}) {
  return (
    <Tap feel="soft" onPress={() => onChange(!on)} accessibilityRole="switch" accessibilityState={{ checked: on }} style={rowStyle}>
      <RowTile icon={icon} />
      <RowText label={label} sub={sub} />
      <Sw on={on} onPress={() => onChange(!on)} />
    </Tap>
  );
}

/** A settings row whose right-hand side is a small segmented control (Theme). */
export function SettingSeg<T extends string>({ label, value, options, onChange, icon }: {
  label: string; value: T; options: { v: T; l: string }[]; onChange: (v: T) => void; icon?: IconName;
}) {
  return (
    <View style={rowStyle}>
      <RowTile icon={icon} />
      <RowText label={label} />
      <Seg value={value} options={options} onChange={onChange} style={{ width: 180 }} />
    </View>
  );
}

/** `.rolebar` / `.bar` — a thin progress bar. */
export function ProgressBar({ pct, tone }: { pct: number; tone?: string }) {
  const { colors } = useTheme();
  const w = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <View style={{ height: 5, borderRadius: 3, backgroundColor: colors.sunk, overflow: 'hidden' }}>
      <View style={{ width: (w + '%') as any, height: 5, borderRadius: 3, backgroundColor: tone || colors.accent }} />
    </View>
  );
}

export { CapText };
