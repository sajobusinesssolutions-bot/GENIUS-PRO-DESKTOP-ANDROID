/**
 * A report with only two or three narrow columns — a Z report is "Line" and
 * "Amount" — used to size its table to its own content and stop there. The
 * bordered card around it still filled the phone's width, so the table left
 * a blank strip down the right side instead of a table that actually reaches
 * the edge of its own border. widthsFor() is what decides each column's
 * width; these check it actually fills the space it is told about.
 */
import { widthsFor } from '../screens/ReportDetailScreen';
import type { ReportResult } from '../data/reports';

function result(cols: ReportResult['cols'], rows: ReportResult['rows']): ReportResult {
  return { title: 'Z report · end of day', cols, rows };
}

describe('widthsFor', () => {
  it('leaves the table at its natural width when no minimum is given', () => {
    const r = result([{ h: 'Line' }, { h: 'Amount', r: true }], [['Cash sales', 'Sh 10,000']]);
    const widths = widthsFor(r);
    expect(widths.reduce((a, b) => a + b, 0)).toBeLessThan(300);
  });

  it('stretches a narrow table to fill the screen, so no blank strip is left', () => {
    const r = result([{ h: 'Line' }, { h: 'Amount', r: true }], [['Cash sales', 'Sh 10,000']]);
    const widths = widthsFor(r, 400);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(400);
  });

  it('never shrinks a table that already needs more room than the screen', () => {
    const r = result(
      [{ h: 'Date' }, { h: 'Type' }, { h: 'Voucher no.' }, { h: 'Particulars' }, { h: 'Amount', r: true }],
      [['01 Jan', 'Sale', 'INV-000123456', 'A very long line of particulars text here', 'Sh 10,000']],
    );
    const natural = widthsFor(r).reduce((a, b) => a + b, 0);
    const withMin = widthsFor(r, 300).reduce((a, b) => a + b, 0);
    expect(withMin).toBe(natural); // 300 is less than what this table already needs
  });

  it('gives the extra room to a left-aligned column, not the numbers', () => {
    const r = result([{ h: 'Line' }, { h: 'Amount', r: true }], [['Cash sales', 'Sh 10,000']]);
    const [lineWidth, amountWidth] = widthsFor(r);
    const [lineWidthStretched, amountWidthStretched] = widthsFor(r, 400);
    expect(amountWidthStretched).toBe(amountWidth); // untouched
    expect(lineWidthStretched).toBeGreaterThan(lineWidth); // absorbed the extra
  });

  it('falls back to the last column when every column is right-aligned', () => {
    const r = result([{ h: 'Qty', r: true }, { h: 'Amount', r: true }], [['5', 'Sh 10,000']]);
    const widths = widthsFor(r, 400);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(400);
  });
});
