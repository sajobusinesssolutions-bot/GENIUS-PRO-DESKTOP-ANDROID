import { docMessage, reminderMessage, intlPhone, fillReminder, reminderSettings, DEFAULT_REMINDERS } from '../messages';
import type { DocMeta } from '../docPrint';

const money = (n: number) => 'Sh ' + n;
const base: DocMeta = {
  kind: 'Tax Invoice', no: 'INV-7', ts: '2026-09-01T10:00:00Z', firmName: 'Corner Shop', firmPhone: '0700000000',
  partyName: 'Acme School', lines: [{ name: 'Printer', qty: 2, price: 500 }], subtotal: 1000, total: 1000, paid: 400, due: 600,
};

describe('the message that goes with a document', () => {
  it('greets the person by name, names the invoice and closes with the shop', () => {
    const m = docMessage(base, money);
    expect(m.startsWith('Dear Acme School,')).toBe(true);
    expect(m).toContain('invoice INV-7');
    expect(m).toContain('Balance due: Sh 600');
    expect(m).toContain('If you have already cleared this, kindly ignore this message.');
    expect(m.trim().endsWith('Corner Shop\n0700000000')).toBe(true);
  });

  it('leaves out the "already cleared" line when nothing is owed', () => {
    const m = docMessage({ ...base, paid: 1000, due: 0 }, money);
    expect(m).not.toContain('kindly ignore');
  });

  it('words a quotation as a quotation', () => {
    const m = docMessage({ ...base, kind: 'Quotation', due: 0 }, money);
    expect(m).toContain('our quotation INV-7');
    expect(m).not.toContain('kindly ignore');
  });
});

describe('a payment reminder', () => {
  it('lists each open invoice and the total, and says to ignore it if cleared', () => {
    const m = reminderMessage({
      partyName: 'Bob', firm: { name: 'Corner Shop' }, money,
      bills: [{ no: '8', ts: '2026-08-01T00:00:00Z', total: 500, due: 500 }, { no: '9', ts: '2026-08-10T00:00:00Z', total: 300, due: 200 }],
    });
    expect(m).toContain('Dear Bob,');
    expect(m).toContain('Invoice 8');
    expect(m).toContain('Total due: Sh 700');
    expect(m).toContain('If you have already cleared them, kindly ignore this message.');
  });
});

describe('phone numbers for WhatsApp', () => {
  it('turns a local number into the international form', () => {
    expect(intlPhone('0771 234 567')).toBe('256771234567');
    expect(intlPhone('+256 771 234567')).toBe('256771234567');
    expect(intlPhone('771234567')).toBe('256771234567');
    expect(intlPhone('')).toBe('');
  });
});


describe('reminder templates', () => {
  const o = {
    partyName: 'Bob', firm: { name: 'Corner Shop', phone: '0700' }, money,
    bills: [{ no: '8', ts: '2026-08-01T00:00:00Z', total: 500, due: 500 }, { no: '9', ts: '2026-08-10T00:00:00Z', total: 300, due: 200 }],
  };

  it('fills each field the shop used', () => {
    const m = fillReminder('Hi {name}, {business} here: {total} on {count} invoice(s). Call {phone}.', o);
    expect(m).toBe('Hi Bob, Corner Shop here: Sh 700 on 2 invoice(s). Call 0700.');
  });

  it('lists the invoices where {invoices} stands, and leaves unknown braces alone', () => {
    const m = fillReminder('{invoices}\n{unknown}', o);
    expect(m).toContain('• Invoice 8');
    expect(m).toContain('• Invoice 9');
    expect(m).toContain('{unknown}');
  });

  it('keeps the default SMS to one line, and falls back to the defaults for anything not set', () => {
    expect(DEFAULT_REMINDERS.sms).not.toContain('\n');
    const cfg = reminderSettings({ sms: 'Pay {total}' });
    expect(cfg.sms).toBe('Pay {total}');
    expect(cfg.whatsapp).toBe(DEFAULT_REMINDERS.whatsapp);
    expect(cfg.enabled).toBe(true);
  });
});
