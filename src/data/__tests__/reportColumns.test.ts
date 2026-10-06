import { arrangeColumns, arrangedIndexes } from '../reportColumns';

const result: any = {
  title: 'T',
  cols: [{ h: 'Particulars' }, { h: 'Opening' }, { h: 'Debit' }, { h: 'Credit' }, { h: 'Closing' }],
  rows: [['Cash', 1, 2, 3, 4]],
  foot: ['Total', 1, 2, 3, 4],
};

describe('report columns', () => {
  it('leaves a report alone when nothing was chosen', () => {
    expect(arrangeColumns(result, null)).toBe(result);
  });

  it('hides and reorders, keeping the first column first', () => {
    const r = arrangeColumns(result, { order: ['Closing', 'Opening'], hidden: ['Debit', 'Particulars'] });
    expect(r.cols.map((c) => c.h)).toEqual(['Particulars', 'Closing', 'Opening', 'Credit']);
    expect(r.rows[0]).toEqual(['Cash', 4, 1, 3]);
    expect(r.foot).toEqual(['Total', 4, 1, 3]);
  });

  it('keeps a column the report gained since the choice was made', () => {
    expect(arrangedIndexes(['A', 'B', 'C', 'New'], { order: ['C', 'B'], hidden: [] })).toEqual([0, 2, 1, 3]);
  });
});
