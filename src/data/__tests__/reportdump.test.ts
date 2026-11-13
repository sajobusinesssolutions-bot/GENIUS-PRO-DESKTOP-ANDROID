import { busyBook } from '../__fixtures__/reportbook';
import { runReport, REPORTS } from '../reports';

/* Not an assertion: prints every report on the busy book, for reading (DUMP=path). */
const run = process.env.DUMP ? it : it.skip;
run('dumps every report', () => {
  const d = busyBook();
  const out: string[] = [];
  const t = (c: any) => (c && typeof c === 'object' ? c.text : String(c ?? ''));
  for (const r of (REPORTS as any[])) {
    try {
      const x = runReport(d, r.id, 0, Date.now() + 864e5, (n) => String(Math.round(n * 100) / 100));
      out.push('### ' + r.id + ' | ' + x.title + (x.error ? ' ERROR ' + x.error : '') + '\n  cols: ' + x.cols.map((c) => c.h).join(' | ')
        + '\n' + x.rows.slice(0, 12).map((row) => '  ' + row.map(t).join(' | ')).join('\n')
        + (x.foot ? '\n  FOOT: ' + x.foot.map(t).join(' | ') : '') + (x.stats ? '\n  STATS: ' + x.stats.map((s) => s.k + '=' + s.v).join(', ') : ''));
    } catch (e: any) { out.push('### ' + r.id + ' THREW ' + e.message); }
  }
  require('fs').writeFileSync(process.env.DUMP as string, out.join('\n'));
});
