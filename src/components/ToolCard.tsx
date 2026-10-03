/**
 * The rounded tool panels used by Data tools and Cloud sync: an icon tile, a
 * title and one line under it, an optional action at the top right, and the
 * body below.
 */
import React from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { Pressable } from './Press';
import { useTheme, fonts } from '../theme';
import { Icon, IconName } from './icons';

type Tone = 'good' | 'accent' | 'danger' | 'warn' | 'neutral';

export function useToneColors(tone: Tone) {
  const { colors } = useTheme();
  return {
    good: { fg: colors.good, bg: colors.goodSoft },
    accent: { fg: colors.accent, bg: colors.accentSoft },
    danger: { fg: colors.danger, bg: colors.dangerSoft },
    warn: { fg: colors.warn, bg: colors.warnSoft },
    neutral: { fg: colors.soft, bg: colors.sunk },
  }[tone];
}

export function ToolCard({ icon, tone = 'accent', title, sub, action, border, children, titleColor }: {
  icon: IconName; tone?: Tone; title: string; sub?: string;
  action?: { icon: IconName; label: string; onPress: () => void; busy?: boolean };
  border?: string; titleColor?: string; children?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const t = useToneColors(tone);
  return (
    <View style={{
      backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1.2, borderColor: border || colors.line,
      padding: 18, marginBottom: 16,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={23} color={t.fg} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: titleColor || colors.ink }}>{title}</Text>
          {sub ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>{sub}</Text> : null}
        </View>
        {action ? (
          <Pressable onPress={action.onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={action.label} disabled={action.busy}>
            {action.busy ? <ActivityIndicator color={colors.faint} /> : <Icon name={action.icon} size={21} color={colors.faint} />}
          </Pressable>
        ) : null}
      </View>
      {children ? <View style={{ marginTop: 16 }}>{children}</View> : null}
    </View>
  );
}

export function ChoiceChips<T extends string>({ value, options, onChange }: {
  value: T; options: { v: T; l: string }[]; onChange: (v: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <Pressable
            key={o.v}
            onPress={() => onChange(o.v)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 9, paddingHorizontal: 16,
              borderRadius: 999, borderWidth: 1.2, borderColor: on ? colors.good : colors.line,
              backgroundColor: on ? colors.goodSoft : 'transparent',
            }}
          >
            {on ? <Icon name="check" size={14} color={colors.good} /> : null}
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: on ? colors.good : colors.ink }}>{o.l}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function CountPill({ label, n, tone }: { label: string; n: number; tone: Tone }) {
  const t = useToneColors(tone);
  return (
    <View style={{ paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.2, borderColor: t.fg, backgroundColor: t.bg }}>
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: t.fg }}>{label}: {n}</Text>
    </View>
  );
}

export function SectionCap({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, marginTop: 4 }}>
      <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.faint }}>{children}</Text>
      {right}
    </View>
  );
}
