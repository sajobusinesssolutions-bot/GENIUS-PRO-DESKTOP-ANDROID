/**
 * The receipt / payment voucher page (data/voucherPrint.ts): who, how much in
 * figures and words, the account before and after, and a signature line for
 * each side.
 */
jest.mock('expo-print', () => ({ printAsync: jest.fn(), printToFileAsync: jest.fn().mockResolvedValue({ uri: 'file:///tmp/v.pdf' }) }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: jest.fn(), Directory: jest.fn(), Paths: { cache: { uri: 'file:///cache/' }, document: { uri: 'file:///doc/' } } }));
jest.mock('expo-intent-launcher', () => ({ startActivityAsync: jest.fn() }));

import { voucherHtml, type Voucher } from '../voucherPrint';

const money = (n: number) => 'UGX ' + n.toLocaleString('en-US');
const base: Voucher = {
  isIn: true, no: 'RCT-0001', date: '21/10/2026',
  firm: { name: 'Saljo Tech', phone: '0753201462' },
  party: { name: 'Gainapar', phone: '0772000000', address: 'Kampala' },
  amount: 50000, method: 'cash', account: 'Cash in hand',
  before: 316000, after: 266000, settles: [{ no: 'INV-000002', amount: 48000 }],
};

describe('voucher page', () => {
  it('a receipt names the payer, the sum in words, the balance either side and both signatures', async () => {
    const html = await voucherHtml(base, money);
    expect(html).toContain('Received from');
    expect(html).toContain('Gainapar');
    expect(html).toContain('0772000000');
    expect(html.toLowerCase()).toContain('fifty thousand');
    expect(html).toContain('UGX 316,000 owed to us');
    expect(html).toContain('UGX 266,000 owed to us');
    expect(html).toContain('INV-000002');
    expect(html).toContain('Received by');
    expect(html).toContain('Paid by');
    expect(html).toContain('Received with thanks');
  });
  it('a payment says who was paid, asks for their ID, and has no thank-you stamp', async () => {
    const html = await voucherHtml({ ...base, isIn: false, before: -100000, after: -50000 }, money);
    expect(html).toContain('Paid to');
    expect(html).toContain('Payment voucher');
    expect(html).toContain('name and ID/phone');
    expect(html).toContain('UGX 100,000 we owe them');
    expect(html).not.toContain('Received with thanks');
  });
  it('names are escaped', async () => {
    const html = await voucherHtml({ ...base, party: { name: '<b>x</b>' } }, money);
    expect(html).not.toContain('<b>x</b>');
  });
});
