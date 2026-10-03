/**
 * The words that go out with a document or a reminder, and the ways to send
 * them. Every message reads the same way whatever it carries: a greeting by
 * name, what it is about, the figures, a line saying to ignore it if it is
 * already settled (where money is owed), and the shop's regards.
 */
import { Linking, Share } from 'react-native';
import type { DocMeta } from './docPrint';

export type Channel = 'whatsapp' | 'sms' | 'email' | 'other';

/** International digits for WhatsApp: a local 07… number takes the country code. */
export function intlPhone(phone: string | undefined, countryCode = '256'): string {
  const digits = String(phone || '').replace(/[^0-9]/g, '');
  if (!digits) return '';
  if (digits.startsWith(countryCode)) return digits;
  if (digits.startsWith('0')) return countryCode + digits.slice(1);
  // a bare nine-digit mobile number (771234567)
  if (digits.length === 9) return countryCode + digits;
  return digits;
}

const day = (ts: string) => new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function greet(name?: string) {
  const first = (name || '').trim();
  return first ? 'Dear ' + first + ',' : 'Hello,';
}

function regards(firm: { name: string; phone?: string }) {
  return ['Kind regards,', firm.name, firm.phone].filter(Boolean).join('\n');
}

/** What each kind of document is called in a sentence. */
function called(kind: string) {
  const k = kind.toLowerCase();
  if (k.includes('quot') || k.includes('estimate')) return 'quotation';
  if (k.includes('purchase') || k.includes('bill')) return 'purchase order';
  if (k.includes('receipt')) return 'receipt';
  if (k.includes('voucher')) return 'payment voucher';
  if (k.includes('credit')) return 'credit note';
  if (k.includes('delivery') || k.includes('challan')) return 'delivery note';
  return 'invoice';
}

/** The message that goes with a document: invoice, quotation, purchase, receipt and the rest. */
export function docMessage(d: DocMeta, money: (n: number) => string): string {
  const what = called(d.kind);
  const owed = (d.due || 0) > 0.01 && (what === 'invoice');
  const items = d.lines.slice(0, 6).map((l) => '• ' + l.name + ' × ' + l.qty + ' — ' + money(l.qty * l.price)).join('\n')
    + (d.lines.length > 6 ? '\n• and ' + (d.lines.length - 6) + ' more' : '');
  const lead = what === 'quotation'
    ? 'Thank you for your interest. Here is our quotation ' + d.no + ' dated ' + day(d.ts) + '.'
    : what === 'purchase order'
      ? 'Please find our purchase ' + d.no + ' dated ' + day(d.ts) + '.'
      : what === 'receipt' || what === 'payment voucher'
        ? 'Thank you for your payment. Here is your ' + what + ' ' + d.no + ' dated ' + day(d.ts) + '.'
        : 'Thank you for your business. Here is your ' + what + ' ' + d.no + ' dated ' + day(d.ts) + '.';
  return [
    greet(d.partyName),
    '',
    'Greetings from ' + d.firmName + '. ' + lead,
    '',
    items,
    '',
    'Total: ' + money(d.total),
    ...(owed ? ['Paid: ' + money(d.paid || 0), 'Balance due: ' + money(d.due || 0)] : []),
    '',
    ...(owed ? ['If you have already cleared this, kindly ignore this message.', ''] : []),
    regards({ name: d.firmName, phone: d.firmPhone }),
  ].join('\n');
}

export interface DueBill { no: string; ts: string; total: number; due: number }

/** A reminder of what a customer still owes, bill by bill. */
export function reminderMessage(o: {
  partyName: string; bills: DueBill[]; firm: { name: string; phone?: string }; money: (n: number) => string;
}): string {
  const total = o.bills.reduce((a, b) => a + b.due, 0);
  const one = o.bills.length === 1;
  const list = o.bills
    .map((b) => '• Invoice ' + b.no + ' of ' + day(b.ts) + ' — ' + o.money(b.due) + ' due')
    .join('\n');
  return [
    greet(o.partyName),
    '',
    'Greetings from ' + o.firm.name + '. This is a friendly reminder that ' + (one ? 'the invoice below is' : 'the invoices below are') + ' still open:',
    '',
    list,
    '',
    'Total due: ' + o.money(total),
    '',
    'If you have already cleared ' + (one ? 'it' : 'them') + ', kindly ignore this message. Thank you.',
    '',
    regards(o.firm),
  ].join('\n');
}

/** Opens the chosen app with the message ready, to this person where the app allows. */
export async function sendVia(channel: Channel, o: { text: string; phone?: string; email?: string; subject?: string; countryCode?: string }): Promise<boolean> {
  const body = encodeURIComponent(o.text);
  try {
    if (channel === 'whatsapp') {
      const to = intlPhone(o.phone, o.countryCode);
      // wa.me opens the chat with this person and the text filled in; without a number, WhatsApp asks who
      await Linking.openURL(to ? 'https://wa.me/' + to + '?text=' + body : 'whatsapp://send?text=' + body);
      return true;
    }
    if (channel === 'sms') {
      const to = String(o.phone || '').replace(/[^0-9+]/g, '');
      await Linking.openURL('sms:' + to + '?body=' + body);
      return true;
    }
    if (channel === 'email') {
      await Linking.openURL('mailto:' + encodeURIComponent(o.email || '') + '?subject=' + encodeURIComponent(o.subject || '') + '&body=' + body);
      return true;
    }
    await Share.share({ message: o.text, title: o.subject });
    return true;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- */
/* Payment reminders: the shop's own words, per way of sending         */
/* ---------------------------------------------------------------- */

export interface ReminderSettings {
  enabled: boolean;
  /** Only invoices at least this many days old are listed (0 = any open invoice). */
  afterDays: number;
  whatsapp: string;
  sms: string;
  email: string;
  emailSubject: string;
}

/** The fields a template can use, with what each becomes. */
export const REMINDER_FIELDS: { key: string; label: string }[] = [
  { key: '{name}', label: 'Customer' },
  { key: '{business}', label: 'Your business' },
  { key: '{invoices}', label: 'Invoice list' },
  { key: '{count}', label: 'How many' },
  { key: '{total}', label: 'Total due' },
  { key: '{oldest}', label: 'Oldest date' },
  { key: '{phone}', label: 'Your phone' },
];

export const DEFAULT_REMINDERS: ReminderSettings = {
  enabled: true,
  afterDays: 0,
  whatsapp: 'Dear {name},\n\nGreetings from {business}. This is a friendly reminder that the following is still open:\n\n{invoices}\n\nTotal due: {total}\n\nIf you have already cleared it, kindly ignore this message. Thank you.\n\nKind regards,\n{business}\n{phone}',
  // a text message is short: one line of what is owed
  sms: 'Dear {name}, {business} kindly reminds you that {total} is due on {count} invoice(s). If already cleared, please ignore. Thank you. {phone}',
  email: 'Dear {name},\n\nGreetings from {business}.\n\nThis is a friendly reminder that the following invoice(s) are still open:\n\n{invoices}\n\nTotal due: {total}\n\nIf you have already cleared them, kindly ignore this message.\n\nKind regards,\n{business}\n{phone}',
  emailSubject: 'Payment reminder from {business}',
};

export function reminderSettings(s?: Partial<ReminderSettings> | null): ReminderSettings {
  return { ...DEFAULT_REMINDERS, ...(s || {}) };
}

/** A reminder template with its fields filled in. */
export function fillReminder(template: string, o: {
  partyName: string; bills: DueBill[]; firm: { name: string; phone?: string }; money: (n: number) => string;
}): string {
  const total = o.bills.reduce((a, b) => a + b.due, 0);
  const oldest = o.bills.reduce((m, b) => Math.min(m, new Date(b.ts).getTime()), Infinity);
  const list = o.bills.map((b) => '• Invoice ' + b.no + ' of ' + day(b.ts) + ' — ' + o.money(b.due) + ' due').join('\n');
  const vals: Record<string, string> = {
    '{name}': o.partyName, '{business}': o.firm.name, '{invoices}': list, '{count}': String(o.bills.length),
    '{total}': o.money(total), '{oldest}': Number.isFinite(oldest) ? day(new Date(oldest).toISOString()) : '', '{phone}': o.firm.phone || '',
  };
  return template.replace(/\{(name|business|invoices|count|total|oldest|phone)\}/g, (k) => vals[k] ?? k).trim();
}
