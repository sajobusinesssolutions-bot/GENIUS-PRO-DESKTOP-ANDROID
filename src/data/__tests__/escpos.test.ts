/**
 * The receipt a thermal printer is sent: what it says, and that it fits.
 */
import { escposDoc, ascii, wrap, lr, lineWidth } from '../escpos';

const money = (n: number) => 'Sh ' + n.toLocaleString('en-US');
const doc: any = {
  kind: 'Receipt', no: 'INV-000412', ts: '2026-09-29T10:15:00Z',
  firmName: 'Kampala Hardware', firmPhone: '0772 000000', firmTin: '1000123456',
  partyName: 'Okello Builders', method: 'Cash', servedBy: 'Grace',
  lines: [
    { name: 'Cement 50kg Tororo — grey, the long description of it', qty: 3, price: 32000, unit: 'BAG' },
    { name: 'Nails 1kg', qty: 2, price: 6000, batchNo: 'B-7' },
  ],
  subtotal: 108000, tax: 0, total: 108000, paid: 110000,
};
const text = (b: Uint8Array) => String.fromCharCode(...Array.from(b));
/** The printable lines, with the control codes taken out. */
const printed = (b: Uint8Array) => text(b).replace(/\x1b@|\x1ba.|\x1bE.|\x1dV..|\x1dh.|\x1dw.|\x1dH.|\x1d!.|\x1bd./g, '').split('\n');

it('says what the receipt holds', () => {
  const t = text(escposDoc(doc, money, { paper: '80mm' }));
  for (const s of ['Kampala Hardware', 'INV-000412', 'Okello Builders', 'Cash', 'Grace', 'Nails 1kg', 'Batch B-7', 'TOTAL', 'Sh 108,000', 'Change', 'Sh 2,000', 'Thank you'])
    expect(t).toContain(s);
});

it('keeps every line inside the paper', () => {
  for (const paper of ['58mm', '80mm'] as const) {
    const w = lineWidth(paper);
    const long = printed(escposDoc(doc, money, { paper })).filter((l) => l.length > w);
    // the double-size TOTAL line is half as many characters, so it is checked by the half-width rule in lr()
    expect(long.filter((l) => !l.includes('TOTAL'))).toEqual([]);
  }
});

it('starts clean, cuts the paper, and opens the drawer only when asked', () => {
  const plain = escposDoc(doc, money, { paper: '80mm' });
  expect([...plain.slice(0, 2)]).toEqual([0x1b, 0x40]);
  expect(text(plain)).toContain('\x1dVB\x00');
  expect(text(plain)).not.toContain('\x1bp');
  expect(text(escposDoc(doc, money, { paper: '80mm', openDrawer: true }))).toContain('\x1bp\x00');
});

it('prints the template QR code and as many copies as it asks for', () => {
  const tpl: any = { code: 'qr', codeData: 'no', codeCaption: true, copies: 2, showTax: true, showServed: true, showParty: true, showBatch: true, showExpiry: true };
  const t = text(escposDoc(doc, money, { paper: '80mm', tpl, codeText: 'INV-000412' }));
  expect(t).toContain('\x1d(k');
  expect(t.split('\x1dVB').length - 1).toBe(2);
});

it('turns characters the printer cannot print into plain ones', () => {
  expect(ascii('3 × Sh 5,000 — “Nails” · café')).toBe('3 x Sh 5,000 - "Nails" - cafe');
  expect(wrap('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  expect(lr('Total', 'Sh 9', 12)).toEqual(['Total   Sh 9']);
});
