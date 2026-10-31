import { docHtml } from '../docPrint';

const base: any = { no: 'EST-00001', ts: new Date().toISOString(), firmName: 'Shop', lines: [{ name: 'Pen', qty: 1, price: 500 }], subtotal: 500, total: 500 };
const tpl: any = { id: 't', name: 'A4', paper: 'A4', kind: 'page', title: 'Invoice', style: 'plain' };

it('a quotation keeps its own name on a layout titled Invoice', () => {
  const html = docHtml({ ...base, kind: 'Quotation' }, (n) => String(n), { paper: 'A4', tpl });
  expect(html).toMatch(/Quotation/);
  expect(html).not.toMatch(/>\s*INVOICE\s*</i);
});

it('a sale still takes the layout\'s title', () => {
  const html = docHtml({ ...base, kind: 'Tax Invoice' }, (n) => String(n), { paper: 'A4', tpl: { ...tpl, title: 'Cash Sale Bill' } });
  expect(html).toMatch(/Cash Sale Bill/i);
});
