import { useColorScheme } from 'react-native';
import { light, dark, ThemeColors } from './colors';
import { useAppDataSafe } from '../data/AppDataContext';

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 22 };
/** Small, even corners on every card, button and field — the same 4 px as the desktop Items screen. Sheets keep a softer top. */
export const radius = { sm: 4, md: 4, lg: 4, xl: 4, sheet: 12, pill: 999 };

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
/**
 * Google Sans across the app. It is narrower than Inter was, so long item
 * names fit on one line; body text is the regular weight, as on the reference.
 * The family has no 800, so the heaviest headings use 700.
 */
export const fonts = {
  ui: 'Sans_400',
  uiSemi: 'Sans_500',
  uiBold: 'Sans_600',
  uiExtra: 'Sans_700',
  mono: 'Sans_400',
  monoSemi: 'Sans_500',
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
