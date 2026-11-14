let counter = 0;
export function uid(prefix: string): string {
  counter += 1;
  return prefix + '_' + Date.now().toString(36) + counter.toString(36) + Math.random().toString(36).slice(2, 6);
}

export function iso(d?: Date): string {
  return (d || new Date()).toISOString();
}

/**
 * The day (YYYY-MM-DD) a moment falls on where the phone is. Times are kept in
 * UTC, so cutting the date off a saved time gives the UTC day: in Uganda that is
 * yesterday until three in the morning. A plain day is returned as it is.
 */
export function localDay(v?: Date | number | string): string {
  if (typeof v === 'string' && (v.length <= 10 || /T00:00:00(\.000)?Z?$/.test(v))) return v.slice(0, 10);
  const d = v === undefined ? new Date() : v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return typeof v === 'string' ? v.slice(0, 10) : '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
}

export function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

export function hoursAgo(n: number): Date {
  const d = new Date();
  d.setHours(d.getHours() - n);
  return d;
}

export function mulberry(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
