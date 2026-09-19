/** Small pure helpers ported from the prototype (plural, money0, date/period ranges). */

export function plural(n: number, one: string, many?: string): string {
  return n + ' ' + (n === 1 ? one : many || one + 's');
}

export function money0(n: number): string {
  return Math.round(n || 0).toLocaleString('en-US');
}

export function startOfDay(d?: Date | number): number {
  const x = d ? new Date(d) : new Date();
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}
export function endOfDay(d?: Date | number): number {
  const x = d ? new Date(d) : new Date();
  x.setHours(23, 59, 59, 999);
  return x.getTime();
}
export function daysAgo(n: number): number {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.getTime();
}
export function inRange(ts: string | number, from: number, to: number): boolean {
  const t = typeof ts === 'string' ? new Date(ts).getTime() : ts;
  return t >= from && t <= to;
}
export function ageOfDays(ts: string): number {
  return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
}

export type Range = { from: number; to: number; label: string };

/** Dashboard period — reference `periodRange` line 6179. */
export function periodRange(p: string): Range & { prev: { from: number; to: number } } {
  const to = endOfDay();
  if (p === 'month') return { from: startOfDay(daysAgo(29)), to, label: 'Last 30 days', prev: { from: startOfDay(daysAgo(59)), to: endOfDay(daysAgo(30)) } };
  if (p === 'week') return { from: startOfDay(daysAgo(6)), to, label: 'Last 7 days', prev: { from: startOfDay(daysAgo(13)), to: endOfDay(daysAgo(7)) } };
  return { from: startOfDay(), to, label: 'Today', prev: { from: startOfDay(daysAgo(1)), to: endOfDay(daysAgo(1)) } };
}

/** Finance period — reference `finRange` line 12607. */
export function finRange(p: string): Range {
  const to = endOfDay();
  if (p === 'today') return { from: startOfDay(), to, label: 'Today' };
  if (p === 'week') return { from: startOfDay(daysAgo(6)), to, label: 'Last 7 days' };
  if (p === 'quarter') return { from: startOfDay(daysAgo(89)), to, label: 'Last 90 days' };
  if (p === 'year') return { from: new Date(new Date().getFullYear(), 0, 1).getTime(), to, label: 'This year' };
  if (p === 'all') return { from: new Date(2000, 0, 1).getTime(), to, label: 'All time' };
  return { from: startOfDay(daysAgo(29)), to, label: 'Last 30 days' };
}

export const FIN_PERIODS: [string, string][] = [
  ['today', 'Today'], ['week', '7 days'], ['month', '30 days'],
  ['quarter', '90 days'], ['year', 'This year'], ['all', 'All'],
];

/** List period — reference `listRange` line 12959 (lower-case labels, used inline in a sentence). */
export function listRange(p: string): Range {
  const to = endOfDay();
  if (p === 'today') return { from: startOfDay(), to, label: 'today' };
  if (p === 'week') return { from: startOfDay(daysAgo(6)), to, label: 'the last 7 days' };
  if (p === 'quarter') return { from: startOfDay(daysAgo(89)), to, label: 'the last 90 days' };
  if (p === 'year') return { from: new Date(new Date().getFullYear(), 0, 1).getTime(), to, label: 'this year' };
  if (p === 'all') return { from: 0, to, label: 'all time' };
  return { from: startOfDay(daysAgo(29)), to, label: 'the last 30 days' };
}

export const LIST_PERIODS: [string, string][] = [
  ['today', 'Today'], ['week', '7 days'], ['month', '30 days'],
  ['quarter', '90 days'], ['year', 'Year'], ['all', 'All'],
];

const AVATAR_COLORS = ['#3F3D9E', '#B4652A', '#0A7346', '#C93A3A', '#2563EB', '#7A3EA8', '#0F766E'];

/** reference `avatar()` line ~1589 */
export function avatarFor(name: string, id?: string): { initials: string; color: string } {
  const key = id || name || '?';
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  const initials = (name || '?').split(' ').map((w) => w[0] || '').slice(0, 2).join('').toUpperCase();
  return { initials, color: AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length] };
}

/** reference `fmtDate()` */
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function pad(n: number) { return n < 10 ? '0' + n : String(n); }
export function fmtDate(ts: string | number): string {
  const d = new Date(ts); const n = new Date();
  const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
  if (d.toDateString() === n.toDateString()) return 'Today ' + hm;
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday ' + hm;
  return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + hm;
}
export function fmtDay(ts: string | number): string {
  const d = new Date(ts);
  return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear();
}
