/**
 * Light, dark or automatic, as one quiet row: tap it to move to the next.
 * Automatic follows the phone.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { Pressable } from './Press';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Icon, IconName } from './icons';

type Mode = 'light' | 'dark' | 'auto';

const NEXT: Record<Mode, Mode> = { light: 'dark', dark: 'auto', auto: 'light' };
const LOOK: Record<Mode, { l: string; i: IconName }> = {
  light: { l: 'Light', i: 'sun' },
  dark: { l: 'Dark', i: 'moon' },
  auto: { l: 'Auto', i: 'contrast' },
};

export default function ThemePicker() {
  const { colors } = useTheme();
  const { db, setSetting } = useAppData();
  const current: Mode = (db?.settings.theme as Mode) || 'auto';
  const look = LOOK[current];
  return (
    <Pressable
      onPress={() => setSetting({ theme: NEXT[current] })}
      accessibilityRole="button"
      accessibilityLabel={'Theme: ' + look.l + '. Tap for ' + LOOK[NEXT[current]].l}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 12, height: 56, paddingHorizontal: 14,
        borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
      }}
    >
      <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={look.i} size={18} color={colors.accent} />
      </View>
      <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>Appearance</Text>
      <View style={{ flexDirection: 'row', backgroundColor: colors.sunk, borderRadius: 999, padding: 3 }}>
        {(['light', 'dark', 'auto'] as Mode[]).map((m) => (
          <View key={m} style={{ width: 32, height: 26, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: m === current ? colors.accent : 'transparent' }}>
            <Icon name={LOOK[m].i} size={14} color={m === current ? colors.accentInk : colors.faint} />
          </View>
        ))}
      </View>
    </Pressable>
  );
}
