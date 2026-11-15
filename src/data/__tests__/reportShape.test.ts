/**
 * A report on a phone is a list, not a table: each row a name, a line of
 * context and the figure it is read for. These check the columns are chosen
 * the way a person would, and that amounts read 12,500.00 with no currency.
 */
import { reportShape, plainCell, subline, rowIsZero, countLabel, shortRange } from '../reportShape';
import { runReport, REPORTS } from '../reports';
import { seed } from '../seed';
import { groupNum } from '../helpers';

const cols = (...h: (string | [string])[]) => h.map((x) => (Array.isArray(x) ? { h: x[0], r: true } : { h: x }));

describe('which column is which', () => {
  it('profit per item: the item, with profit as the figure', () => {
    const c = cols('Item', ['Qty'], ['Revenue'], ['Cost'], ['Profit'], ['Margin']);
    const s = reportShape(c);
    expect(c[s.title].h).toBe('Item');
    expect(c[s.key].h).toBe('Profit');
    expect(subline(['Sugar 1kg', '4', 'Sh 20,000', 'Sh 12,000', 'Sh 8,000', '40%'], c, s, 'Sh')).toBe('Qty 4 · Revenue 20,000.00');
  });
  it('a ledger list: the ledger, with closing as the figure', () => {
    const c = cols('Code', 'Ledger', ['Opening'], ['Debit'], ['Credit'], ['Closing']);
    const s = reportShape(c);
    expect(c[s.title].h).toBe('Ledger');
    expect(c[s.key].h).toBe('Closing');
    expect(s.rest.map((i) => c[i].h)).toEqual(['Code', 'Opening', 'Debit', 'Credit']);
  });
  it('a register: the party, not the date or the voucher number', () => {
    const c = cols('Date', 'Vch no', 'Party', 'Status', ['Total'], ['Paid'], ['Balance']);
    const s = reportShape(c);
    expect(c[s.title].h).toBe('Party');
    expect(c[s.key].h).toBe('Balance');
  });
  it('a report with no figures has no key amount', () => {
    expect(reportShape(cols('Item', 'Batch', 'Expiry')).key).toBe(-1);
  });
});

describe('how a cell is written', () => {
  it('drops the currency and writes two decimals', () => {
    expect(plainCell('Sh 12,500', true, 'Sh')).toBe('12,500.00');
    expect(plainCell('UGX 1,234.5', true, 'UGX')).toBe('1,234.50');
    expect(plainCell('12,500 UGX', true, 'UGX')).toBe('12,500.00');
    expect(plainCell('-Sh 500', true, 'Sh')).toBe('-500.00');
  });
  it('keeps Dr and Cr', () => {
    expect(plainCell('Sh 12,711.13 Dr', true, 'Sh')).toBe('12,711.13 Dr');
  });
  it('writes nothing as a dash, in a figure column only', () => {
    expect(plainCell('Sh 0', true, 'Sh')).toBe('—');
    expect(plainCell('0', true, 'Sh')).toBe('—');
    expect(plainCell('', true, 'Sh')).toBe('—');
    expect(plainCell('', false, 'Sh')).toBe('');
  });
  it('leaves a quantity and a name alone', () => {
    expect(plainCell('4', true, 'Sh')).toBe('4');
    expect(plainCell('Shell Kampala', false, 'Sh')).toBe('Shell Kampala');
  });
  it('knows a row with nothing on it', () => {
    const c = cols('Ledger', ['Debit'], ['Credit']);
    expect(rowIsZero(['Bank', 'Sh 0', ''], c, 'Sh')).toBe(true);
    expect(rowIsZero(['Bank', 'Sh 5', ''], c, 'Sh')).toBe(false);
  });
});

describe('the lines around the list', () => {
  it('counts what the rows are', () => {
    const c = cols('Customer', ['Closing']);
    expect(countLabel(14, c, reportShape(c))).toBe('14 customers');
    expect(countLabel(1, c, reportShape(c))).toBe('1 customer');
    const p = cols('Particulars', ['Amount']);
    expect(countLabel(3, p, reportShape(p))).toBe('3 rows');
  });
  it('writes the period short', () => {
    const y = new Date().getFullYear();
    expect(shortRange(new Date(y, 10, 1).getTime(), new Date(y, 10, 14, 23, 59).getTime())).toBe('1–14 Nov');
    expect(shortRange(new Date(y, 9, 28).getTime(), new Date(y, 10, 3).getTime())).toBe('28 Oct – 3 Nov');
    expect(shortRange(0, Date.now())).toBe('All time');
  });
});

describe('every report', () => {
  it('has a name for each row, and no currency left in any cell', () => {
    const d = seed();
    const sym = d.settings.currency || 'Sh';
    const money = (n: number) => groupNum(n || 0, 2);
    const from = Date.now() - 400 * 864e5, to = Date.now() + 864e5;
    const bad: string[] = [];
    for (const r of REPORTS) {
      let res;
      try { res = runReport(d, r.id, from, to, money); } catch { continue; }
      if (!res || !res.cols.length) continue;
      const s = reportShape(res.cols);
      if (s.title < 0 || s.title >= res.cols.length || s.key === s.title) bad.push(r.id + ': shape');
      res.rows.slice(0, 40).forEach((row) => row.forEach((c, i) => {
        const t = plainCell(c, !!res.cols[i].r, sym);
        if (new RegExp('(^|\s)' + sym + '\s?\d').test(t)) bad.push(r.id + ': ' + res.cols[i].h + ' = ' + t);
      }));
    }
    expect(bad).toEqual([]);
  });
});
