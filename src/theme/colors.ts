export type ThemeColors = {
  bg: string; surface: string; sunk: string; line: string; lineHard: string;
  rail: string; ink: string; soft: string; faint: string;
  good: string; goodSoft: string;
  warn: string; warnSoft: string;
  danger: string; dangerSoft: string;
  accent: string; accentSoft: string; accentInk: string;
  page: string; pageInk: string;
};

export const light: ThemeColors = {
  // Neutral page, white cards — the reference screens get their hierarchy from
  // elevation and tinted icons rather than from a coloured page.
  bg: '#F2F4F7', surface: '#FFFFFF', sunk: '#F5F7FA', line: '#E6E9EF', lineHard: '#D3D8E0',
  rail: '#0F2F46', ink: '#27313C', soft: '#27313C', faint: '#6F7A87',
  good: '#16976A', goodSoft: '#E6F7F2',
  warn: '#D3832B', warnSoft: '#FFF0DC',
  danger: '#D94C4C', dangerSoft: '#FDEAEA',
  accent: '#1A7AE6', accentSoft: 'rgba(26,122,230,0.10)', accentInk: '#FFFFFF',
  page: '#E7ECF4', pageInk: '#405162',
};

export const dark: ThemeColors = {
  bg: '#14161C', surface: '#1C1F27', sunk: '#22262F', line: '#2C313C', lineHard: '#3A4150',
  rail: '#86C5C9', ink: '#E4E7EE', soft: '#E4E7EE', faint: '#A0A8B6',
  good: '#4ADE97', goodSoft: 'rgba(74,222,151,0.12)',
  warn: '#E3B25C', warnSoft: 'rgba(227,178,92,0.12)',
  danger: '#F87A7A', dangerSoft: 'rgba(248,122,122,0.12)',
  accent: '#5B8DFF', accentSoft: 'rgba(91,141,255,0.14)', accentInk: '#0B1020',
  page: '#0B0C10', pageInk: '#C3C8D4',
};
