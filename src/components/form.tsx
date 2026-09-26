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
import { View, Text, Pressable, TextInput, ViewStyle } from 'react-native';
import { useTheme, radius, fonts } from '../theme';
import { Icon, IconName } from './icons';

function CapText({ children, style }: { children: React.ReactNode; style?: any }) {
  const { colors } = useTheme();
  return (
    <Text style={[{ fontFamily: fonts.uiBold, fontSize: 10.5, letterSpacing: 0.6, color: colors.faint, textTransform: 'uppercase' }, style]}>
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
          <Pressable
            key={o.v}
            onPress={() => onChange(o.v)}
            style={{
              flex: 1, height: 42, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
              flexDirection: 'row', gap: 7, backgroundColor: on ? colors.accent : 'transparent',
            }}
          >
            {o.i ? <Icon name={o.i} size={16} color={on ? colors.accentInk : colors.faint} /> : null}
            <Text numberOfLines={1} style={{ fontFamily: fonts.uiBold, fontSize: 14, color: on ? colors.accentInk : colors.faint }}>
              {o.l}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** `fieldNote(t)` — the small grey sentence under a field. */
export function FieldNote({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <Text style={{ fontFamily: fonts.ui, fontSize: 11.5, lineHeight: 16.5, color: colors.faint, marginTop: 6, marginBottom: 10 }}>
      {children}
    </Text>
  );
}

/**
 * The outlined field from the supplied Edit Item reference: a rounded outline
 * with the label notched into the top border, a leading glyph, and an optional
 * trailing control. The label only floats when one is given; otherwise the
 * placeholder sits on the baseline.
 */
export function Field({
  label, value, onChangeText, placeholder, numeric, decimal, multiline, readOnly, right, style,
  compact, error, icon, secure, maxLength, autoCapitalize, onFocus, onBlur, suffix, autoFocus, inputRef,
}: {
  label?: string; value: string; onChangeText?: (v: string) => void; placeholder?: string;
  numeric?: boolean; decimal?: boolean; multiline?: boolean; readOnly?: boolean; right?: React.ReactNode;
  style?: ViewStyle; compact?: boolean; error?: string; icon?: IconName;
  secure?: boolean; maxLength?: number; autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  onFocus?: () => void; onBlur?: () => void; suffix?: string; autoFocus?: boolean; inputRef?: React.Ref<TextInput>;
}) {
  const { colors } = useTheme();
  const [focused, setFocused] = React.useState(false);
  const hasError = !!error;
  const border = hasError ? colors.danger : focused ? colors.accent : colors.line;
  const labelColor = hasError ? colors.danger : focused ? colors.accent : colors.faint;
  const bg = readOnly ? colors.sunk : colors.surface;

  return (
    <View style={[{ marginBottom: hasError ? 6 : 14 }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{
          flex: 1, flexDirection: 'row', alignItems: multiline ? 'flex-start' : 'center', gap: 12,
          minHeight: multiline ? 96 : compact ? 46 : 62,
          borderRadius: radius.md, borderWidth: 1.4, borderColor: border,
          backgroundColor: bg,
          paddingHorizontal: 15,
          paddingTop: multiline ? 14 : label ? 6 : 0,
          paddingBottom: multiline ? 12 : 0,
        }}>
          {icon ? (
            <View style={{ paddingTop: multiline ? 1 : 0 }}>
              <Icon name={icon} size={20} color={hasError ? colors.danger : colors.ink} />
            </View>
          ) : null}

          <TextInput
            ref={inputRef}
            value={value}
            onChangeText={onChangeText}
            editable={!readOnly}
            placeholder={placeholder}
            placeholderTextColor={colors.faint}
            keyboardType={numeric ? (decimal ? 'decimal-pad' : 'numeric') : 'default'}
            multiline={multiline}
            secureTextEntry={secure}
            maxLength={maxLength}
            autoCapitalize={autoCapitalize}
            autoFocus={autoFocus}
            onFocus={() => { setFocused(true); onFocus?.(); }}
            onBlur={() => { setFocused(false); onBlur?.(); }}
            style={{
              flex: 1, padding: 0,
              minHeight: multiline ? 68 : undefined,
              color: readOnly ? colors.faint : colors.ink,
              fontFamily: numeric ? fonts.monoSemi : fonts.ui,
              fontSize: 16,
              textAlign: numeric && compact ? 'right' : 'left',
              textAlignVertical: multiline ? 'top' : 'center',
            }}
          />

          {suffix ? (
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.faint }}>{suffix}</Text>
          ) : null}

          {/* the label notched into the top border */}
          {label ? (
            <View style={{
              position: 'absolute', top: -8, left: 13,
              backgroundColor: bg, paddingHorizontal: 5,
            }}>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: labelColor }}>{label}</Text>
            </View>
          ) : null}
        </View>
        {right}
      </View>
      {hasError ? (
        <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.danger, marginTop: 6, marginBottom: 7 }}>{error}</Text>
      ) : null}
    </View>
  );
}

/** The same outline, but the body is yours — used for pickers and read-outs. */
export function FieldShell({ label, icon, children, onPress, right, style, tone, error }: {
  label?: string; icon?: IconName; children: React.ReactNode; onPress?: () => void;
  right?: React.ReactNode; style?: ViewStyle; tone?: string; error?: boolean;
}) {
  const { colors } = useTheme();
  const Comp: any = onPress ? Pressable : View;
  const border = error ? colors.danger : tone || colors.line;
  return (
    <View style={[{ marginBottom: 14 }, style]}>
      <Comp
        onPress={onPress}
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 62,
          borderRadius: radius.md, borderWidth: 1.4, borderColor: border,
          backgroundColor: colors.surface, paddingHorizontal: 15,
          paddingTop: label ? 6 : 0,
        }}
      >
        {icon ? <Icon name={icon} size={20} color={error ? colors.danger : colors.ink} /> : null}
        <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
        {right}
        {label ? (
          <View style={{ position: 'absolute', top: -8, left: 13, backgroundColor: colors.surface, paddingHorizontal: 5 }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: error ? colors.danger : colors.faint }}>{label}</Text>
          </View>
        ) : null}
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
          <Pressable
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
          </Pressable>
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
    <Pressable
      onPress={() => onChange(!on)}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16,
        borderRadius: radius.md, borderWidth: 1.4, borderColor: on ? fg : bg,
        backgroundColor: bg, paddingHorizontal: 16, paddingVertical: 15,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 16, color: colors.ink }}>{title}</Text>
        {sub ? (
          <Text style={{ fontFamily: fonts.ui, fontSize: 13, lineHeight: 18, color: colors.soft, marginTop: 3 }}>{sub}</Text>
        ) : null}
      </View>
      <Sw on={on} onPress={() => onChange(!on)} />
    </Pressable>
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
    <Pressable
      onPress={onPress}
      style={{
        borderRadius: radius.md, borderWidth: 1.4, borderColor: fg, backgroundColor: bg,
        alignItems: 'center', justifyContent: 'center', paddingVertical: 34, gap: 10, marginBottom: 16,
      }}
    >
      {children ?? <Icon name="plus" size={34} color={fg} />}
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14.5, color: fg }}>{label}</Text>
    </Pressable>
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
    <View style={[{ marginBottom: 14 }, style]}>
      <Pressable
        onPress={() => setOpen((o) => !o)}
        style={{
          minHeight: 62, borderRadius: radius.md, borderWidth: 1.4, borderColor: border,
          backgroundColor: colors.surface, paddingHorizontal: 15,
          paddingTop: label ? 6 : 0,
          flexDirection: 'row', alignItems: 'center', gap: 12,
        }}
      >
        {icon ? <Icon name={icon} size={20} color={open ? colors.accent : colors.ink} /> : null}
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.ui, fontSize: 16, color: cur ? colors.ink : colors.faint }}>
          {cur ? cur.l : placeholder || 'Select…'}
        </Text>
        <Icon name={open ? 'up' : 'down'} size={19} color={colors.soft} />
        {label ? (
          <View style={{ position: 'absolute', top: -8, left: 13, backgroundColor: colors.surface, paddingHorizontal: 5 }}>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: open ? colors.accent : colors.faint }}>{label}</Text>
          </View>
        ) : null}
      </Pressable>
      {open ? (
        <View style={{ marginTop: 8, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: 'hidden' }}>
          {options.map((o, i) => (
            <Pressable
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
            </Pressable>
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
          <Pressable
            key={o.v}
            onPress={() => onChange(o.v)}
            style={{
              paddingVertical: 7, paddingHorizontal: 11, borderRadius: radius.pill, borderWidth: 1,
              borderColor: on ? colors.ink : colors.line, backgroundColor: on ? colors.ink : colors.surface,
              flexDirection: 'row', alignItems: 'center', gap: 5,
            }}
          >
            {o.i ? <Icon name={o.i} size={13} color={on ? colors.bg : colors.faint} /> : null}
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: on ? colors.bg : colors.soft }}>{o.l}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A plain tappable chip that fires an action rather than selecting a value. */
export function ActionChip({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} style={{
      paddingVertical: 7, paddingHorizontal: 11, borderRadius: radius.pill,
      borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface,
    }}>
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: colors.soft }}>{label}</Text>
    </Pressable>
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
        {currency ? <Text style={{ fontFamily: fonts.monoSemi, fontSize: 19, color: colors.faint }}>{currency}</Text> : null}
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
      {hint ? <Text style={{ fontFamily: fonts.ui, fontSize: 11, color: colors.faint, marginTop: 7, textAlign: 'center' }}>{hint}</Text> : null}
    </View>
  );
}

/** `.sw` — the pill switch the prototype draws by hand. */
export function Sw({ on, onPress }: { on: boolean; onPress?: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={{
        width: 50, height: 29, borderRadius: 15, padding: 2.5,
        backgroundColor: on ? colors.accent : colors.lineHard,
        alignItems: on ? 'flex-end' : 'flex-start', justifyContent: 'center',
      }}
    >
      <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff' }} />
    </Pressable>
  );
}

/** `togRow(label, key, on)` — a bordered row whose whole surface toggles a switch. */
export function ToggleRow({ label, sub, on, onChange, bare }: {
  label: string; sub?: string; on: boolean; onChange: (v: boolean) => void; bare?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
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
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 14.5, color: colors.ink }}>{label}</Text>
        {sub ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>{sub}</Text> : null}
      </View>
      <Sw on={on} onPress={() => onChange(!on)} />
    </Pressable>
  );
}

/** `.cbx` — the square tick used by the permission grid. */
export function Checkbox({ on, onPress, size = 19 }: { on: boolean; onPress?: () => void; size?: number }) {
  const { colors } = useTheme();
  return (
    <Pressable
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
    </Pressable>
  );
}

/** `.swatch` — the colour tag squares on the item editor's More tab. */
export function Swatch({ color, on, onPress }: { color: string; on: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: 34, height: 34, borderRadius: 10,
        backgroundColor: color || colors.sunk,
        borderWidth: on ? 2.5 : 1,
        borderColor: on ? colors.ink : colors.line,
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      {color ? null : <Text style={{ color: colors.faint, fontFamily: fonts.uiSemi, fontSize: 13 }}>—</Text>}
    </Pressable>
  );
}

/** `setGroup(title, rows)` — a caption over one card of rows. */
export function SettingGroup({ title, children, style }: { title: string; children: React.ReactNode; style?: ViewStyle }) {
  const { colors } = useTheme();
  const kids = React.Children.toArray(children).filter(Boolean);
  if (!kids.length) return null;
  return (
    <View style={[{ marginBottom: 18 }, style]}>
      <CapText style={{ marginBottom: 10 }}>{title}</CapText>
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

/** `setRow(k, v, action)` — label on the left, current value and a chevron on the right. */
export function SettingRow({ label, value, onPress, danger, icon, sub }: {
  label: string; value?: string; onPress?: () => void; danger?: boolean; icon?: IconName; sub?: string;
}) {
  const { colors } = useTheme();
  const Comp: any = onPress ? Pressable : View;
  const fg = danger ? colors.danger : colors.accent;
  return (
    <Comp onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 15, minHeight: 60 }}>
      {icon ? (
        <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: danger ? colors.dangerSoft : colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={19} color={fg} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14.5, color: danger ? colors.danger : colors.ink }}>{label}</Text>
        {sub ? <Text numberOfLines={2} style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 2 }}>{sub}</Text> : null}
      </View>
      {value ? (
        <Text numberOfLines={1} style={{ maxWidth: '46%', fontFamily: fonts.uiSemi, fontSize: 13, color: colors.faint, textAlign: 'right' }}>
          {value}
        </Text>
      ) : null}
      {onPress ? <Icon name="chev" size={17} color={colors.faint} /> : null}
    </Comp>
  );
}

/** `setToggle(label, key)` — the same row with a switch instead of a chevron. */
export function SettingToggle({ label, sub, on, onChange }: {
  label: string; sub?: string; on: boolean; onChange: (v: boolean) => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={() => onChange(!on)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 15, minHeight: 60 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14.5, color: colors.ink }}>{label}</Text>
        {sub ? <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 2 }}>{sub}</Text> : null}
      </View>
      <Sw on={on} onPress={() => onChange(!on)} />
    </Pressable>
  );
}

/** A settings row whose right-hand side is a small segmented control (Theme). */
export function SettingSeg<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { v: T; l: string }[]; onChange: (v: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 14 }}>
      <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 13, color: colors.ink }}>{label}</Text>
      <Seg value={value} options={options} onChange={onChange} style={{ width: 186 }} />
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
