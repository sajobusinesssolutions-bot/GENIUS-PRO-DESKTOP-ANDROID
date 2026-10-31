import { withItemDetails } from '../reportItems';

it('writes each sale\'s items under its row, and leaves other rows alone', () => {
  const db: any = {
    products: [], purchases: [], estimates: [], creditNotes: [], journal: [],
    sales: [{ id: 's1', lines: [{ name: 'Pen', qty: 2, unit: 'pc', price: 500 }, { name: 'Book', qty: 1, price: 3000 }] }],
  };
  const out = withItemDetails(db, {
    title: 'Bills', cols: [{ h: 'No' }, { h: 'Total', r: true }],
    rows: [['INV-1', '4,000'], ['Total', '4,000']],
    rowRefs: [{ kind: 'sale', id: 's1' }, null],
  } as any, (n) => n.toLocaleString('en-US'));
  expect(out.rows.length).toBe(4);
  expect((out.rows[1][0] as any).text).toContain('Pen — 2 pc × 500 = 1,000');
  expect((out.rows[2][0] as any).text).toContain('Book — 1 × 3,000 = 3,000');
  expect(out.rows[3]).toEqual(['Total', '4,000']);
  expect(out.rowRefs).toEqual([{ kind: 'sale', id: 's1' }, null, null, null]);
});
