/**
 * Printing and sharing for the documents the shop raises — bills, purchases,
 * receipts and statements. Report exporting lives in ./exporters; this covers
 * the single-document case, where the layout is a receipt rather than a table.
 */
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';

export interface DocLine {
  name: string;
  qty: number;
  price: number;
  unit?: string;
  batchNo?: string;
  expiry?: string;
}

export interface DocMeta {
  /** "Tax Invoice", "Receipt", "Quotation" … */
  kind: string;
  no: string;
  ts: string;
  firmName: string;
  firmAddress?: string;
  firmTin?: string;
  partyName?: string;
  partyPhone?: string;
  partyAddress?: string;
  lines: DocLine[];
  subtotal: number;
  discount?: number;
  tax?: number;
  charges?: number;
  total: number;
  paid?: number;
  due?: number;
  method?: string;
  note?: string;
  terms?: string;
  servedBy?: string;
  footer?: string;
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeName(s: string) {
  return s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'document';
}

/**
 * An 80mm receipt. Batch and expiry ride under the line they belong to, because
 * that is what a pharmacy or a grocer needs on the paper for a recall or a return.
 */
export function docHtml(d: DocMeta, money: (n: number) => string): string {
  const rows = d.lines.map((l) => {
    const sub = l.batchNo || l.expiry
      ? `<div class="sub">${l.batchNo ? 'Batch ' + esc(l.batchNo) : ''}${l.batchNo && l.expiry ? ' · ' : ''}${l.expiry ? 'Exp ' + esc(new Date(l.expiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })) : ''}</div>`
      : '';
    return `<tr>
      <td class="l">${esc(l.name)}${sub}<div class="sub">${l.qty} ${esc(l.unit || '')} × ${esc(money(l.price))}</div></td>
      <td class="r">${esc(money(l.qty * l.price))}</td>
    </tr>`;
  }).join('');

  const totalRow = (label: string, value: string, strong = false) =>
    `<tr class="${strong ? 'strong' : ''}"><td class="l">${esc(label)}</td><td class="r">${esc(value)}</td></tr>`;

  const totals = [
    totalRow('Subtotal', money(d.subtotal)),
    d.discount ? totalRow('Discount', '− ' + money(d.discount)) : '',
    d.charges ? totalRow('Additional charges', money(d.charges)) : '',
    d.tax ? totalRow('Tax', money(d.tax)) : '',
    totalRow('TOTAL', money(d.total), true),
    d.paid !== undefined ? totalRow('Paid', money(d.paid)) : '',
    d.due ? totalRow('Balance due', money(d.due), true) : '',
  ].filter(Boolean).join('');

  return `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  @page { margin: 8mm; }
  body { font-family: -apple-system, Roboto, Helvetica, Arial, sans-serif; color: #111; margin: 0; padding: 10px 12px; }
  .doc { max-width: 420px; margin: 0 auto; }
  h1 { font-size: 17px; margin: 0; text-align: center; letter-spacing: .3px; }
  .muted { color: #666; font-size: 11px; text-align: center; margin-top: 3px; }
  .kind { text-align: center; font-size: 12px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; margin: 12px 0 2px; }
  .rule { border-top: 1px dashed #bbb; margin: 10px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  td { padding: 5px 0; vertical-align: top; }
  td.l { text-align: left; }
  td.r { text-align: right; white-space: nowrap; padding-left: 10px; }
  .sub { color: #777; font-size: 10.5px; margin-top: 2px; }
  .strong td { font-weight: 700; font-size: 14px; border-top: 1px solid #333; padding-top: 7px; }
  .meta { font-size: 11px; color: #444; }
  .meta div { display: flex; justify-content: space-between; padding: 2px 0; }
  .foot { text-align: center; color: #666; font-size: 10.5px; margin-top: 14px; }
</style></head><body><div class="doc">
  <h1>${esc(d.firmName)}</h1>
  ${d.firmAddress ? `<div class="muted">${esc(d.firmAddress)}</div>` : ''}
  ${d.firmTin ? `<div class="muted">TIN ${esc(d.firmTin)}</div>` : ''}

  <div class="kind">${esc(d.kind)}</div>
  <div class="rule"></div>

  <div class="meta">
    <div><span>Number</span><strong>${esc(d.no)}</strong></div>
    <div><span>Date</span><span>${esc(new Date(d.ts).toLocaleString())}</span></div>
    ${d.partyName ? `<div><span>Customer</span><strong>${esc(d.partyName)}</strong></div>` : ''}
    ${d.partyPhone ? `<div><span>Phone</span><span>${esc(d.partyPhone)}</span></div>` : ''}
    ${d.partyAddress ? `<div><span>Address</span><span>${esc(d.partyAddress)}</span></div>` : ''}
    ${d.method ? `<div><span>Paid by</span><span>${esc(d.method)}</span></div>` : ''}
    ${d.servedBy ? `<div><span>Served by</span><span>${esc(d.servedBy)}</span></div>` : ''}
  </div>

  <div class="rule"></div>
  <table>${rows}</table>
  <div class="rule"></div>
  <table>${totals}</table>

  ${d.note ? `<div class="foot">Note: ${esc(d.note)}</div>` : ''}
  ${d.terms ? `<div class="foot">Terms: ${esc(d.terms)}</div>` : ''}
  <div class="foot">${esc(d.footer || 'Thank you for your business')}</div>
</div></body></html>`;
}

/** Opens the system print dialog. */
export async function printDoc(d: DocMeta, money: (n: number) => string): Promise<void> {
  await Print.printAsync({ html: docHtml(d, money) });
}

/** Writes a PDF and hands it to the share sheet. Returns false if sharing is unavailable. */
export async function shareDoc(d: DocMeta, money: (n: number) => string): Promise<boolean> {
  const { uri } = await Print.printToFileAsync({ html: docHtml(d, money) });
  // The printer writes to a random file name, which is what the recipient
  // would see in WhatsApp, so the PDF is renamed to the document number first.
  // The legacy file-system helpers throw outright on SDK 57, so this uses the
  // File API; a rename that fails is not worth cancelling the share for.
  let target = uri;
  try {
    const dest = new File(Paths.cache, safeName(d.kind + '-' + d.no) + '.pdf');
    if (dest.exists) dest.delete();
    new File(uri).move(dest);
    target = dest.uri;
  } catch {
    // keep the printer's own path
  }
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(target, {
    mimeType: 'application/pdf',
    dialogTitle: d.kind + ' ' + d.no,
    UTI: 'com.adobe.pdf',
  });
  return true;
}

/** A plain-text version for WhatsApp and SMS. */
export function docText(d: DocMeta, money: (n: number) => string): string {
  const lines = d.lines
    .map((l) => `• ${l.name} — ${l.qty} × ${money(l.price)} = ${money(l.qty * l.price)}`
      + (l.batchNo ? `\n   batch ${l.batchNo}${l.expiry ? ', exp ' + new Date(l.expiry).toLocaleDateString('en-GB') : ''}` : ''))
    .join('\n');
  return [
    `*${d.firmName}*`,
    `${d.kind} ${d.no}`,
    new Date(d.ts).toLocaleString(),
    d.partyName ? `Customer: ${d.partyName}` : '',
    '',
    lines,
    '',
    `Total: ${money(d.total)}`,
    d.due ? `Balance due: ${money(d.due)}` : '',
  ].filter(Boolean).join('\n');
}
