/**
 * A receipt or a payment voucher, printed or shared as a PDF.
 *
 * The same page as the computer's (GENIUS PRO POS WINDOWS lib/print.js
 * printVoucher): who paid or was paid, with their phone and address; the sum
 * in figures and in words; where their account stood before and after; the
 * bills it settled; and a signature line for each side. A receipt carries a
 * "Received with thanks" stamp.
 */
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { esc, numberToWords } from './invoiceLayouts';
import { inlineImage, printPdfToCache } from './docPrint';

export interface Voucher {
  isIn: boolean;
  no: string;
  date: string;
  firm: { name: string; address?: string; phone?: string; email?: string; tin?: string; logo?: string };
  party: { name: string; phone?: string; address?: string };
  amount: number;
  method?: string;
  account?: string;
  note?: string;
  /** +ve: they owe the business; -ve: the business owes them */
  before?: number;
  after?: number;
  settles?: { no: string; amount: number }[];
  currencyName?: string;
}

function owes(v: number | undefined, money: (n: number) => string): string {
  if (v == null) return '';
  if (Math.abs(v) < 0.005) return 'Settled';
  return v > 0 ? money(v) + ' owed to us' : money(-v) + ' we owe them';
}

export async function voucherHtml(v: Voucher, money: (n: number) => string): Promise<string> {
  const logo = await inlineImage(v.firm.logo);
  const words = numberToWords(v.amount) + ' ' + (v.currencyName || 'shillings') + ' only';
  const title = v.isIn ? 'Receipt' : 'Payment voucher';
  const firmLine = [v.firm.address, v.firm.phone ? 'Tel ' + v.firm.phone : '', v.firm.email, v.firm.tin ? 'TIN ' + v.firm.tin : ''].filter(Boolean).map((x) => esc(String(x))).join(' · ');
  const partyLine = [v.party.phone, v.party.address].filter(Boolean).map((x) => esc(String(x))).join(' · ');
  const sigs = v.isIn
    ? [['Received by', 'for ' + esc(v.firm.name)], ['Paid by', esc(v.party.name || 'payer')], ['Date', '']]
    : [['Paid by', 'for ' + esc(v.firm.name)], ['Received by', esc(v.party.name || 'payee') + ' — name and ID/phone'], ['Approved by', '']];
  const rows = [['Method', v.method], [v.isIn ? 'Into' : 'From', v.account], ['Note', v.note]].filter((r) => r[1]);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{margin:12mm} *{box-sizing:border-box} body{font-family:sans-serif;font-size:12.5px;color:#111827;max-width:780px;margin:0 auto}
    .vh{display:flex;justify-content:space-between;gap:16px;padding-bottom:12px;border-bottom:2px solid #111827}
    .fn{font-size:19px;font-weight:700}.fd{font-size:11px;color:#4B5563;margin-top:3px}.lg{max-width:100px;max-height:56px;margin-right:10px}
    .vk{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;background:#111827;color:#fff;padding:5px 12px;border-radius:4px}
    .vn{font-size:17px;font-weight:700;margin-top:6px;text-align:right}.vd{font-size:12px;color:#4B5563;text-align:right}
    .pk{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#6B7280;margin-top:16px}.pv{font-size:16px;font-weight:700}.pl{font-size:12px;color:#4B5563}
    .amt{display:flex;justify-content:space-between;align-items:center;border:1.5px solid #111827;border-radius:6px;padding:12px 14px;margin:12px 0}
    .aw{font-style:italic;font-size:12px;max-width:60%}.av{font-size:24px;font-weight:800}
    .acct{display:flex;border:1px solid #D1D5DB;border-radius:6px;overflow:hidden;margin-bottom:12px}
    .acct div{flex:1;padding:8px 12px;border-right:1px solid #E5E7EB}.acct div:last-child{border-right:0;background:#F3F4F6}
    .acct span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#6B7280}.acct b{font-size:13px}
    .row{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #F3F4F6}
    .sec{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#6B7280;margin:12px 0 4px}
    .sig{display:flex;gap:24px;margin-top:50px;text-align:center;font-size:11.5px;color:#4B5563}.sig div{flex:1}.sig span{display:block;border-top:1px solid #111827;margin-bottom:4px}
    .sig b{color:#111827}.sig small{display:block;font-size:10px}
    .stamp{margin:20px auto 0;width:max-content;border:2px solid #15803D;color:#15803D;border-radius:6px;padding:5px 14px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;transform:rotate(-4deg)}
  </style></head><body>
    <div class="vh"><div style="display:flex;align-items:center">${logo ? `<img class="lg" src="${logo}">` : ''}<div><div class="fn">${esc(v.firm.name)}</div><div class="fd">${firmLine}</div></div></div>
      <div><div class="vk">${title}</div><div class="vn">${esc(v.no)}</div><div class="vd">${esc(v.date)}</div></div></div>
    <div class="pk">${v.isIn ? 'Received from' : 'Paid to'}</div><div class="pv">${esc(v.party.name || '—')}</div>${partyLine ? `<div class="pl">${partyLine}</div>` : ''}
    <div class="amt"><div><div class="pk" style="margin:0">The sum of</div><div class="aw">${esc(words)}</div></div><div class="av">${esc(money(v.amount))}</div></div>
    ${v.before != null ? `<div class="acct"><div><span>Balance before</span><b>${esc(owes(v.before, money))}</b></div><div><span>${v.isIn ? 'This receipt' : 'This payment'}</span><b>${v.isIn ? '−' : '+'} ${esc(money(v.amount))}</b></div><div><span>Balance now</span><b>${esc(owes(v.after, money))}</b></div></div>` : ''}
    ${rows.map((r) => `<div class="row"><span>${esc(String(r[0]))}</span><b>${esc(String(r[1]))}</b></div>`).join('')}
    ${v.settles && v.settles.length ? `<div class="sec">Settles</div>${v.settles.map((s) => `<div class="row"><span>${esc(s.no)}</span><b>${esc(money(s.amount))}</b></div>`).join('')}` : ''}
    <div class="sig">${sigs.map(([k, n]) => `<div><span></span><b>${k}</b>${n ? `<small>${n}</small>` : ''}</div>`).join('')}</div>
    ${v.isIn ? '<div class="stamp">Received with thanks</div>' : ''}
  <div style="text-align:center;font:500 9px/1.4 Arial,sans-serif;color:#6b6f76;margin-top:10px;letter-spacing:.03em">Powered by Genius POS</div></body></html>`;
}

export async function printVoucher(v: Voucher, money: (n: number) => string): Promise<void> {
  await Print.printAsync({ html: await voucherHtml(v, money) });
}

export async function shareVoucher(v: Voucher, money: (n: number) => string): Promise<boolean> {
  const file = await printPdfToCache({ html: await voucherHtml(v, money) }, (v.isIn ? 'Receipt-' : 'Payment-') + v.no.replace(/[^\w-]+/g, '_') + '.pdf');
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(file, { mimeType: 'application/pdf', dialogTitle: (v.isIn ? 'Receipt ' : 'Payment ') + v.no, UTI: 'com.adobe.pdf' });
  return true;
}
