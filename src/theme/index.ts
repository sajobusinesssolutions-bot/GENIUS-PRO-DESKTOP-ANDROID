import { useColorScheme } from 'react-native';
import { light, dark, ThemeColors } from './colors';
import { useAppDataSafe } from '../data/AppDataContext';

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 22 };
export const radius = { sm: 10, md: 13, lg: 16, xl: 20, sheet: 24, pill: 999 };

/** Card elevation. The reference screens use one soft shadow, never a hard border. */
export const shadow = {
  card: {
    shadowColor: '#0B1D2A', shadowOpacity: 0.06, shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  raised: {
    shadowColor: '#0B1D2A', shadowOpacity: 0.12, shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 }, elevation: 6,
  },
};

/** Minimum comfortable tap target, and the standard control heights. */
export const control = { field: 52, button: 52, buttonSm: 40, row: 60 };
export const fonts = {
  ui: 'Inter_500Medium',
  uiSemi: 'Inter_600SemiBold',
  uiBold: 'Inter_700Bold',
  uiExtra: 'Inter_800ExtraBold',
  mono: 'IBMPlexMono_500Medium',
  monoSemi: 'IBMPlexMono_600SemiBold',
};

export function useTheme(): { colors: ThemeColors; dark: boolean } {
  const scheme = useColorScheme();
  const ctx = useAppDataSafe();
  const override = ctx?.db?.settings.theme || 'auto';
  const isDark = override === 'auto' ? scheme === 'dark' : override === 'dark';
  return { colors: isDark ? dark : light, dark: isDark };
}

export { light, dark };
export type { ThemeColors };
