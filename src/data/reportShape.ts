/**
 * How a report's table reads as a list on a phone.
 *
 * A wide table does not fit a phone, so each row is shown as a title, one
 * line of context under it and the figure people scan for; the rest of the
 * columns open under the row when it is tapped. Which column is which is
 * worked out here from the headings, the same way for every report, so a new
 * report needs nothing written for it.
 */
import type { ReportCol, Cell } from './reports';
import { cellText } from './reports';
import { groupNum } from './helpers';

export interface ReportShape {
  /** The column that names the row. */
  title: number;
  /** The figure on the right; -1 when the report has no figure column. */
  key: number;
  /** Every other column, in the order they are shown when the row is open. */
  rest: number[];
  /** A second figure beside the main one, when the report asks for it (-1: none). */
  side?: number;
}

const NAMES = /^(item|product|customer|supplier|party|name|ledger|account|particulars|description|category|staff|user|cashier|waiter|table|line|section|group|dish|menu|batch)/i;
const NOT_A_NAME = /date|^no\.?$|#|voucher|vch|type|code|ref|status|mode|phone|unit|barcode/i;
/** The figure a row is read for, most wanted first. */
const KEYS = [/closing/i, /balance/i, /outstanding|still owing|due$/i, /profit/i, /^net/i, /total/i, /amount/i, /value/i, /revenue|sales/i];

export function reportShape(cols: ReportCol[]): ReportShape {
  const text = cols.map((c, i) => i).filter((i) => !cols[i].r);
  const nums = cols.map((c, i) => i).filter((i) => !!cols[i].r);
  let title = text.find((i) => NAMES.test(cols[i].h));
  if (title === undefined) title = text.find((i) => !NOT_A_NAME.test(cols[i].h));
  if (title === undefined) title = text.length ? text[0] : 0;
  const side = cols.findIndex((c) => c.side);
  let key = cols.findIndex((c) => c.main);
  if (key >= 0) {
    const rest = cols.map((c, i) => i).filter((i) => i !== title && i !== key && i !== side);
    return { title, key, rest, side };
  }
  for (const re of KEYS) {
    const hit = nums.filter((i) => i !== title && re.test(cols[i].h));
    if (hit.length) { key = hit[hit.length - 1]; break; }
  }
  if (key < 0) { const others = nums.filter((i) => i !== title); key = others.length ? others[others.length - 1] : -1; }
  const rest = cols.map((c, i) => i).filter((i) => i !== title && i !== key && i !== side);
  return { title, key, rest, side };
}

const ZERO = /^-?0(\.0+)?$/;

/**
 * A cell as a report shows it: no currency in front (or behind), an amount to
 * two decimals, and nothing in a figure column as a dash. "Dr" and "Cr" stay.
 */
export function plainCell(c: Cell, numeric: boolean, sym: string): string {
  let t = cellText(c).trim();
  if (sym) {
    const esc = sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const before = new RegExp('^(-?)\\s*' + esc + '\\s*(-?)([\\d,]+(?:\\.\\d+)?)(.*)$').exec(t);
    const after = before ? null : new RegExp('^(-?)([\\d,]+(?:\\.\\d+)?)\\s*' + esc + '(.*)$').exec(t);
    const m = before ? [before[1] || before[2], before[3], before[4]] : after ? [after[1], after[2], after[3]] : null;
    if (m) t = (m[0] ? '-' : '') + groupNum(Number(m[1].replace(/,/g, '')), 2) + m[2];
  }
  if (numeric && (t === '' || ZERO.test(t.replace(/,/g, '')))) return '—';
  return t;
}

/** Nothing on the row: every figure a dash. */
export function rowIsZero(row: Cell[], cols: ReportCol[], sym: string): boolean {
  const nums = cols.map((c, i) => i).filter((i) => !!cols[i].r);
  return nums.length > 0 && nums.every((i) => plainCell(row[i] ?? '', true, sym) === '—');
}

/** The line under a row's title: the next one or two useful facts. */
export function subline(row: Cell[], cols: ReportCol[], shape: ReportShape, sym: string): string {
  const parts: string[] = [];
  for (const i of shape.rest) {
    if (parts.length >= 2) break;
    const v = plainCell(row[i] ?? '', !!cols[i].r, sym);
    if (!v || v === '—') continue;
    parts.push(cols[i].r ? cols[i].h + ' ' + v : v);
  }
  return parts.join(' · ');
}

/** "14 customers", "1 item": the count under the controls, named after what the rows are. */
export function countLabel(n: number, cols: ReportCol[], shape: ReportShape): string {
  const h = (cols[shape.title]?.h || 'row').toLowerCase();
  const noun = /^(particulars|line|section|description|name|group)$/.test(h) ? 'row' : h;
  return groupNum(n, 0) + ' ' + (n === 1 ? noun.replace(/s$/, '') : /s$/.test(noun) ? noun : noun + 's');
}

/** "1–14 Nov", "28 Oct – 3 Nov", "1 Jan 2025 – 14 Nov 2026": the range on the Period pill. */
export function shortRange(from: number, to: number): string {
  if (from <= 0) return 'All time';
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const a = new Date(from), b = new Date(to);
  const thisYear = new Date().getFullYear();
  const yr = (d: Date) => (d.getFullYear() === thisYear ? '' : ' ' + d.getFullYear());
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    return a.getDate() === b.getDate() ? a.getDate() + ' ' + M[a.getMonth()] + yr(a) : a.getDate() + '–' + b.getDate() + ' ' + M[b.getMonth()] + yr(b);
  }
  if (a.getFullYear() === b.getFullYear()) return a.getDate() + ' ' + M[a.getMonth()] + ' – ' + b.getDate() + ' ' + M[b.getMonth()] + yr(b);
  return a.getDate() + ' ' + M[a.getMonth()] + ' ' + a.getFullYear() + ' – ' + b.getDate() + ' ' + M[b.getMonth()] + ' ' + b.getFullYear();
}
