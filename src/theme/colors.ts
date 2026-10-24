export type ThemeColors = {
  bg: string; surface: string; sunk: string; line: string; lineHard: string;
  rail: string; ink: string; soft: string; faint: string;
  good: string; goodSoft: string;
  warn: string; warnSoft: string;
  danger: string; dangerSoft: string;
  accent: string; accentSoft: string; accentInk: string;
  page: string; pageInk: string;
  /** A darker white for rows that list what is on a bill, so each stands off the page. */
  row: string;
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
  row: '#E9ECF1',
};

export const dark: ThemeColors = {
  // plain greys, as a browser's dark mode: colour is kept for what means something
  bg: '#202124', surface: '#292A2D', sunk: '#35363A', line: '#3C4043', lineHard: '#5F6368',
  rail: '#BDC1C6', ink: '#E8EAED', soft: '#BDC1C6', faint: '#9AA0A6',
  good: '#81C995', goodSoft: 'rgba(129,201,149,0.12)',
  warn: '#FDD663', warnSoft: 'rgba(253,214,99,0.12)',
  danger: '#F28B82', dangerSoft: 'rgba(242,139,130,0.12)',
  accent: '#E8EAED', accentSoft: 'rgba(232,234,237,0.10)', accentInk: '#202124',
  page: '#202124', pageInk: '#BDC1C6',
  row: '#35363A',
};
