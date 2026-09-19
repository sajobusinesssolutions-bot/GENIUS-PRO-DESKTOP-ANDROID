/**
 * What moved through one cash, bank or mobile-money account in a period.
 *
 * Read from the journal, as every money figure in the app is, and from the
 * branch being worked in — so the drawer of one branch never shows another's.
 * The balance at the start is everything before the period, so opening + in −
 * out always equals the balance at the end.
 */
import type { DB } from './types';
import { activeBranchId, branchJournal } from './branch';

export interface FlowRow { id: string; ts: string; memo: string; ref: string; delta: number; balance: number }
export interface FlowDay { day: number; label: string; inflow: number; outflow: number; rows: FlowRow[] }
export interface Flow {
  opening: number; inflow: number; outflow: number; closing: number;
  rows: FlowRow[]; days: FlowDay[];
}

export function accountFlow(d: DB, accId: string, from: number, to: number, branch = activeBranchId(d)): Flow {
  const lines: Array<{ id: string; ts: string; t: number; memo: string; ref: string; delta: number }> = [];
  branchJournal(d, branch).forEach((e) => {
    const t = new Date(e.ts).getTime();
    e.lines.forEach((l, i) => {
      if (l.acc !== accId) return;
      lines.push({ id: e.id + ':' + i, ts: e.ts, t, memo: e.memo, ref: (e as any).ref || '', delta: (l.dr || 0) - (l.cr || 0) });
    });
  });
  lines.sort((a, b) => a.t - b.t);

  let opening = 0;
  let inflow = 0;
  let outflow = 0;
  const inside: FlowRow[] = [];
  let running = 0;
  lines.forEach((l) => {
    if (l.t < from) { opening += l.delta; running += l.delta; return; }
    if (l.t > to) return;
    running += l.delta;
    if (l.delta >= 0) inflow += l.delta; else outflow += -l.delta;
    inside.push({ id: l.id, ts: l.ts, memo: l.memo, ref: l.ref, delta: l.delta, balance: running });
  });

  // newest day first, newest line first within the day
  const byDay = new Map<number, FlowDay>();
  [...inside].reverse().forEach((r) => {
    const x = new Date(r.ts); x.setHours(0, 0, 0, 0);
    const key = x.getTime();
    if (!byDay.has(key)) {
      byDay.set(key, {
        day: key,
        label: x.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }),
        inflow: 0, outflow: 0, rows: [],
      });
    }
    const g = byDay.get(key)!;
    g.rows.push(r);
    if (r.delta >= 0) g.inflow += r.delta; else g.outflow += -r.delta;
  });

  return {
    opening, inflow, outflow, closing: opening + inflow - outflow,
    rows: inside, days: [...byDay.values()],
  };
}
