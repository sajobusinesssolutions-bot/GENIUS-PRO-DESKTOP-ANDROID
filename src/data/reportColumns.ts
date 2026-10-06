/**
 * A report's columns as the owner likes them: which show, and in what order.
 * Kept by column heading per report, so it survives a report gaining a column.
 * The first column (what each row is) always stays first and always shows.
 */
import type { ReportResult } from './reports';

export interface ColumnChoice {
  /** Headings in the order wanted; any not listed keep their place after these. */
  order: string[];
  /** Headings left off. */
  hidden: string[];
}

/** The column indexes to show, in order. */
export function arrangedIndexes(heads: string[], choice?: ColumnChoice | null): number[] {
  const rest = heads.map((_, i) => i).slice(1);
  if (!choice) return [0, ...rest];
  const rank = (i: number) => {
    const at = choice.order.indexOf(heads[i]);
    return at < 0 ? choice.order.length + i : at;
  };
  const shown = rest.filter((i) => !choice.hidden.includes(heads[i])).sort((a, b) => rank(a) - rank(b));
  return heads.length ? [0, ...shown] : [];
}

export function arrangeColumns(result: ReportResult, choice?: ColumnChoice | null): ReportResult {
  if (!choice || !result.cols.length) return result;
  const idx = arrangedIndexes(result.cols.map((c) => c.h), choice);
  if (idx.length === result.cols.length && idx.every((v, i) => v === i)) return result;
  return {
    ...result,
    cols: idx.map((i) => result.cols[i]),
    rows: result.rows.map((r) => (r.length === result.cols.length ? idx.map((i) => r[i]) : r)),
    foot: result.foot && result.foot.length === result.cols.length ? idx.map((i) => result.foot![i]) : result.foot,
  };
}
