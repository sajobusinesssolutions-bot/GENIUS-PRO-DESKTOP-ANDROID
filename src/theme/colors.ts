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
  // The Price lists palette, for every screen: a soft green-grey page, white
  // cards, a green accent and quiet grey secondary text. Shapes stay each screen's own.
  bg: '#F7FAF8', surface: '#FFFFFF', sunk: '#E6EBE8', line: '#E2E7E4', lineHard: '#C0C9C3',
  rail: '#07493B', ink: '#191C1B', soft: '#404944', faint: '#56605B',
  good: '#0B6B57', goodSoft: '#CDEEE2',
  warn: '#B5650F', warnSoft: '#FFF0DC',
  danger: '#BA1A1A', dangerSoft: '#FDEAEA',
  accent: '#0B6B57', accentSoft: '#CDE8DF', accentInk: '#FFFFFF',
  page: '#E6EBE8', pageInk: '#404944',
  row: '#EDF1EE',
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
