/**
 * The A4 invoice layouts, drawn as HTML for the print engine.
 *
 *  - plain: airy default.
 *  - tally: the ruled ledger invoice Tally prints — seller and buyer on the
 *    left, a grid of reference boxes on the right, tall item columns, amount
 *    in words, declaration and signatory.
 *  - quickbooks: logo and title on top, a grey Bill to / Ship to / Details
 *    band, a clean item table, customer message beside the totals.
 *  - gst: a coloured letterhead band, a boxed Tax Invoice with customer and
 *    invoice detail panels, a tax summary, bank details with a QR code, terms
 *    and two signature boxes.
 *
 * Batch and expiry get their own columns when switched on and at least one
 * line carries one — an empty column is just wasted width.
 */
import type { DocLine, DocMeta } from './docPrint';

export type InvoiceStyle = 'plain' | 'tally' | 'quickbooks' | 'gst';

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const SCALES = ['', ' Thousand', ' Million', ' Billion'];

function threeDigitsToWords(n: number): string {
  const parts: string[] = [];
  if (n >= 100) { parts.push(ONES[Math.floor(n / 100)] + ' Hundred'); n %= 100; }
  if (n >= 20) parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : ''));
  else if (n > 0) parts.push(ONES[n]);
  return parts.join(' ');
}

/** A whole number, spelled out — "Amount Chargeable (in words)". */
export function numberToWords(value: number): string {
  let n = Math.round(Math.abs(value));
  if (n === 0) return 'Zero';
  const chunks: string[] = [];
  let scale = 0;
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk) chunks.unshift(threeDigitsToWords(chunk) + SCALES[scale]);
    n = Math.floor(n / 1000);
    scale += 1;
  }
  return chunks.join(' ');
}

export interface LayoutCtx {
  showLogo: boolean; showTax: boolean; showServed: boolean; showParty: boolean;
  showBatch: boolean; showExpiry: boolean;
  head: string; foot: string; code: string; tight: boolean; accent: string;
}

/** 15-Apr-2015 — the date style on a ledger invoice. */
export function dmy(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
}

const lines2 = (s?: string) => esc(s || '').replace(/\n/g, '<br/>');

export function a4Layout(style: InvoiceStyle, d: DocMeta, money: (n: number) => string, c: LayoutCtx): { body: string; css: string } {
  const batchOn = c.showBatch && d.lines.some((l) => l.batchNo);
  const expOn = c.showExpiry && d.lines.some((l) => l.expiry);
  const bHead = batchOn ? '<th class="c">Batch</th>' : '';
  const eHead = expOn ? '<th class="c">Expiry</th>' : '';
  const bCell = (l: DocLine) => (batchOn ? `<td class="c">${esc(l.batchNo || '')}</td>` : '');
  const eCell = (l: DocLine) => (expOn ? `<td class="c">${l.expiry ? esc(dmy(l.expiry)) : ''}</td>` : '');
  const extra = (batchOn ? 1 : 0) + (expOn ? 1 : 0);
  const blanks = (n: number) => '<td></td>'.repeat(n);
  const taxOn = c.showTax && !!d.tax;
  const taxLabel = d.taxLabel || 'Tax';
  const partyOn = c.showParty && !!d.partyName;
  const partyLabel = /purchase/i.test(d.kind) ? 'Supplier' : 'Customer';
  const logo = c.showLogo && d.logo ? `<img class="logo" src="${esc(d.logo)}" />` : '';
  const words = [d.currencyName, numberToWords(d.total), 'Only'].filter(Boolean).join(' ');
  const sameUnit = d.lines.length > 0 && d.lines.every((l) => (l.unit || '') === (d.lines[0].unit || ''));
  const qtyTotal = sameUnit ? d.lines.reduce((s, l) => s + l.qty, 0) + (d.lines[0].unit ? ' ' + d.lines[0].unit : '') : '';
  const served = c.showServed && d.servedBy ? `<div class="foot">Served by ${esc(d.servedBy)}</div>` : '';
  const footLine = lines2(c.foot || d.footer || 'Thank you for your business');
  const pad = c.tight ? 0.6 : 1;
  const filler = (cols: number, rows: number, tall: number) =>
    `<tr class="fill"><td colspan="1" style="height:${Math.max(24, tall - rows * 22)}px"></td>${blanks(cols - 1)}</tr>`;

  if (style === 'tally') {
    const cell = (k: string, v?: string) => `<td class="k"><div class="lbl">${esc(k)}</div><div class="val">${esc(v || '')}</div></td>`;
    const cols = 6 + extra;
    const rows = d.lines.map((l, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td class="l"><b>${esc(l.name)}</b></td>
      ${bCell(l)}${eCell(l)}
      <td class="r"><b>${l.qty} ${esc(l.unit || '')}</b></td>
      <td class="r">${esc(money(l.price))}</td>
      <td class="c">${esc(l.unit || '')}</td>
      <td class="r"><b>${esc(money(l.qty * l.price))}</b></td>
    </tr>`).join('');
    const sideRow = (label: string, value: string) =>
      `<tr><td></td><td class="r"><i><b>${esc(label)}</b></i></td>${blanks(extra + 3)}<td class="r"><b>${esc(value)}</b></td></tr>`;
    const body = `<div class="tally">
      <div class="ttl">${esc(d.kind.toUpperCase())}</div>
      <table class="t-top"><tr>
        <td class="t-left">
          <div class="t-seller">${logo}<b>${esc(d.firmName)}</b>
            ${[d.firmDescription, d.firmAddress, d.firmPhone, d.firmEmail].filter(Boolean).map((x) => `<div>${esc(x)}</div>`).join('')}
          </div>
          <div class="t-buyer"><div class="lbl">${partyLabel === 'Supplier' ? 'Supplier' : 'Buyer'}</div>
            ${partyOn ? `<b>${esc(d.partyName)}</b>${d.partyAddress ? `<div>${lines2(d.partyAddress)}</div>` : ''}${d.partyPhone ? `<div>${esc(d.partyPhone)}</div>` : ''}` : ''}
          </div>
        </td>
        <td class="t-right"><table class="t-grid">
          <tr>${cell('Invoice No.', d.no)}${cell('Dated', dmy(d.ts))}</tr>
          <tr>${cell('Delivery Note')}${cell('Mode/Terms of Payment', d.method)}</tr>
          <tr>${cell("Supplier's Ref.")}${cell('Other Reference(s)')}</tr>
          <tr>${cell("Buyer's Order No.")}${cell('Dated')}</tr>
          <tr>${cell('Despatched through')}${cell('Destination')}</tr>
          <tr><td class="k terms" colspan="2"><div class="lbl">Terms of Delivery</div><div>${lines2(d.terms)}</div></td></tr>
        </table></td>
      </tr></table>
      ${c.head ? `<div class="t-head">${lines2(c.head)}</div>` : ''}
      <table class="t-items">
        <thead><tr><th class="c sl">Sl<br/>No.</th><th>Description of Goods</th>${bHead}${eHead}<th class="r">Quantity</th><th class="r">Rate</th><th class="c">per</th><th class="r">Amount</th></tr></thead>
        <tbody>
          ${rows}
          ${d.discount ? sideRow('Less: Discount', '− ' + money(d.discount)) : ''}
          ${d.charges ? sideRow('Additional charges', money(d.charges)) : ''}
          ${taxOn ? sideRow(taxLabel, money(d.tax || 0)) : ''}
          ${filler(cols, d.lines.length + (taxOn ? 1 : 0), 330)}
        </tbody>
        <tfoot>
          <tr class="tot"><td></td><td class="r">Total</td>${blanks(extra)}<td class="r"><b>${esc(qtyTotal)}</b></td><td></td><td></td><td class="r"><b>${esc(money(d.total))}</b></td></tr>
          ${d.due ? `<tr class="tot"><td></td><td class="r">Balance due</td>${blanks(extra + 3)}<td class="r"><b>${esc(money(d.due))}</b></td></tr>` : ''}
        </tfoot>
      </table>
      <table class="t-words"><tr>
        <td><div class="lbl">Amount Chargeable (in words)</div><b>${esc(words)}</b></td>
        <td class="r eoe">E. &amp; O.E</td>
      </tr></table>
      <div class="t-ids">
        ${d.firmTin ? `<div><span>Company's TIN No.</span>: <b>${esc(d.firmTin)}</b></div>` : ''}
        ${d.note ? `<div><span>Note</span>: ${esc(d.note)}</div>` : ''}
      </div>
      <table class="t-sign"><tr>
        <td class="decl"><u>Declaration</u><br/>We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.</td>
        <td class="sig"><b>for ${esc(d.firmName)}</b>
          ${d.signature ? `<img class="signimg" src="${esc(d.signature)}" />` : '<div style="height:36px"></div>'}
          <div>Authorised Signatory</div></td>
      </tr></table>
      <div class="foot">This is a Computer Generated ${esc(d.kind)}</div>
      ${served}${c.code}
      ${c.foot ? `<div class="foot">${lines2(c.foot)}</div>` : ''}
    </div>`;
    const css = `
      .tally { font-size: 11px; }
      .tally .ttl { text-align: center; font-weight: 800; font-size: 15px; margin-bottom: 3px; }
      .tally table { width: 100%; border-collapse: collapse; }
      .tally .lbl { font-size: 9.5px; color: #333; }
      .tally .t-top { border: 1px solid #000; }
      .tally .t-left { width: 50%; vertical-align: top; border-right: 1px solid #000; padding: 0; }
      .tally .t-seller { padding: 5px 6px 10px; line-height: 14px; }
      .tally .t-seller .logo { max-height: 16mm; max-width: 36mm; display: block; margin-bottom: 3px; }
      .tally .t-buyer { border-top: 1px solid #000; padding: 5px 6px 18px; line-height: 14px; }
      .tally .t-right { width: 50%; vertical-align: top; padding: 0; }
      .tally .t-grid td.k { border-bottom: 1px solid #000; border-left: 1px solid #000; padding: 2px 5px; width: 50%; height: 26px; vertical-align: top; }
      .tally .t-grid tr td.k:first-child { border-left: none; }
      .tally .t-grid .val { font-weight: 800; }
      .tally .t-grid td.terms { border-bottom: none; height: 60px; }
      .tally .t-head { border: 1px solid #000; border-top: none; padding: 4px 6px; }
      .tally .t-items { border: 1px solid #000; border-top: none; }
      .tally .t-items th { font-weight: 400; font-size: 10px; border: 1px solid #000; border-top: none; padding: 3px 4px; }
      .tally .t-items td { border-left: 1px solid #000; border-right: 1px solid #000; padding: ${4 * pad}px 4px; vertical-align: top; }
      .tally .t-items .sl { width: 18px; }
      .tally .t-items tr.fill td { padding: 0; }
      .tally .t-items tr.tot td { border-top: 1px solid #000; padding: 4px; }
      .tally .t-words { border: 1px solid #000; border-top: none; }
      .tally .t-words td { padding: 4px 6px 16px; vertical-align: top; }
      .tally .t-words .eoe { font-style: italic; font-size: 10px; width: 60px; }
      .tally .t-ids { border-left: 1px solid #000; border-right: 1px solid #000; padding: 26px 6px 8px; line-height: 18px; }
      .tally .t-ids span { display: inline-block; width: 110px; }
      .tally .t-sign { border: 1px solid #000; }
      .tally .t-sign td { vertical-align: bottom; padding: 5px 6px; }
      .tally .t-sign .decl { width: 55%; font-size: 10px; line-height: 13px; }
      .tally .t-sign .sig { border-left: 1px solid #000; border-top: 1px solid #000; text-align: right; font-size: 10.5px; }
      .tally .signimg { max-height: 14mm; max-width: 34mm; display: block; margin-left: auto; }
      .tally .foot { text-align: center; font-size: 10.5px; margin-top: 5px; }`;
    return { body, css };
  }

  if (style === 'quickbooks') {
    const rows = d.lines.map((l) => `<tr>
      <td class="l">${esc(l.name)}</td>
      ${bCell(l)}${eCell(l)}
      <td class="r">${l.qty}${l.unit ? ' ' + esc(l.unit) : ''}</td>
      <td class="r">${esc(money(l.price))}</td>
      <td class="r">${esc(money(l.qty * l.price))}</td>
    </tr>`).join('');
    const sumRow = (k: string, v: string) => `<tr><td>${esc(k)}</td><td class="r">${esc(v)}</td></tr>`;
    const body = `<div class="qb" style="--accent:${esc(c.accent || '#2CA01C')}">
      <div class="qb-bar"></div>
      <div class="qb-top">
        <div class="qb-logo">${logo || `<div class="qb-name">${esc(d.firmName)}</div>`}</div>
        <div class="qb-title">${esc(d.kind)}</div>
      </div>
      <div class="qb-firm">
        <div><b>${esc(d.firmName)}</b>${[d.firmDescription, d.firmAddress].filter(Boolean).map((x) => `<div>${lines2(x)}</div>`).join('')}</div>
        <div>
          ${d.firmPhone ? `<div><b>Phone #</b> ${esc(d.firmPhone)}</div>` : ''}
          ${d.firmWhatsapp ? `<div><b>WhatsApp</b> ${esc(d.firmWhatsapp)}</div>` : ''}
          ${d.firmEmail ? `<div><b>Email</b> ${esc(d.firmEmail)}</div>` : ''}
          ${d.firmWebsite ? `<div><b>Website</b> ${esc(d.firmWebsite)}</div>` : ''}
          ${d.firmTin ? `<div><b>TIN</b> ${esc(d.firmTin)}</div>` : ''}
        </div>
      </div>
      <table class="qb-band"><tr>
        <td><div class="lbl">Bill to</div>${partyOn ? `<div>${esc(d.partyName)}</div>${d.partyPhone ? `<div>${esc(d.partyPhone)}</div>` : ''}` : ''}</td>
        <td><div class="lbl">Ship to</div>${partyOn ? `<div>${esc(d.partyName)}</div>${d.partyAddress ? `<div>${lines2(d.partyAddress)}</div>` : ''}` : ''}</td>
        <td><div class="lbl">Details</div>
          <div><b>${esc(d.kind)} #</b> ${esc(d.no)}</div>
          <div><b>Date</b> ${esc(dmy(d.ts))}</div>
          ${d.method ? `<div><b>Terms</b> ${esc(d.method)}</div>` : ''}
        </td>
      </tr></table>
      ${c.head ? `<div class="qb-head">${lines2(c.head)}</div>` : ''}
      <table class="qb-items">
        <thead><tr><th class="l">Product/service</th>${bHead}${eHead}<th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="qb-sum">
        <div class="qb-msg"><div class="lbl">Customer message</div>${lines2(d.note || c.foot || d.footer || 'Thank you for your business.')}
          ${d.terms ? `<div style="margin-top:6px">${lines2(d.terms)}</div>` : ''}</div>
        <div class="qb-tot"><table>
          ${sumRow('Subtotal', money(d.subtotal))}
          ${d.discount ? sumRow('Discount', '− ' + money(d.discount)) : ''}
          ${taxOn ? sumRow(taxLabel, money(d.tax || 0)) : ''}
          ${d.charges ? sumRow('Shipping & charges', money(d.charges)) : ''}
          <tr class="big"><td>Total</td><td class="r">${esc(money(d.total))}</td></tr>
          ${d.paid !== undefined ? sumRow('Paid', money(d.paid)) : ''}
          ${d.due ? `<tr class="due"><td>Balance due</td><td class="r">${esc(money(d.due))}</td></tr>` : ''}
        </table></div>
      </div>
      ${d.signature ? `<div class="qb-sign"><img src="${esc(d.signature)}" /><div>Authorised signature</div></div>` : ''}
      ${served}${c.code}
      <div class="foot">${c.foot && !d.note ? '' : footLine}</div>
    </div>`;
    const css = `
      .qb { font-size: 11px; color: #222; }
      .qb .qb-bar { height: 6px; width: 45%; margin-left: auto; background: var(--accent); }
      .qb .qb-top { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 14px; }
      .qb .qb-logo .logo { max-height: 22mm; max-width: 50mm; }
      .qb .qb-name { font-size: 22px; font-weight: 800; }
      .qb .qb-title { font-size: 24px; font-weight: 700; }
      .qb .qb-firm { display: flex; gap: 40px; margin-top: 16px; line-height: 15px; }
      .qb .qb-firm > div:first-child { min-width: 60mm; }
      .qb .lbl { color: #777; font-size: 10px; margin-bottom: 3px; }
      .qb table { width: 100%; border-collapse: collapse; }
      .qb .qb-band { margin-top: 20px; background: #f2f2f2; }
      .qb .qb-band td { vertical-align: top; padding: 14px 16px 18px; width: 33%; line-height: 15px; }
      .qb .qb-head { margin-top: 12px; }
      .qb .qb-items { margin-top: 20px; }
      .qb .qb-items th { font-size: 10.5px; font-weight: 700; text-align: left; padding: 6px 4px; border-bottom: 1px solid #bbb; }
      .qb .qb-items td { padding: ${8 * pad}px 4px; border-bottom: 1px solid #eee; vertical-align: top; }
      .qb .qb-sum { display: flex; justify-content: space-between; gap: 24px; margin-top: 18px; border-top: 1px solid #bbb; padding-top: 12px; }
      .qb .qb-msg { flex: 1; line-height: 15px; }
      .qb .qb-tot { width: 70mm; }
      .qb .qb-tot td { padding: 3px 0; }
      .qb .qb-tot .big td { font-size: 17px; font-weight: 800; border-top: 1.5px solid #222; padding-top: 10px; }
      .qb .qb-tot .due td { font-weight: 800; }
      .qb .qb-sign { margin-top: 24px; text-align: right; font-size: 10px; color: #555; }
      .qb .qb-sign img { max-height: 16mm; max-width: 45mm; }
      .qb .foot { text-align: center; font-size: 9.5px; color: #555; margin-top: 26px; }`;
    return { body, css };
  }

  if (style === 'gst') {
    const cols = 5 + extra;
    const rows = d.lines.map((l, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td class="l"><b>${esc(l.name)}</b></td>
      ${bCell(l)}${eCell(l)}
      <td class="c">${l.qty} ${esc((l.unit || '').toUpperCase())}</td>
      <td class="r">${esc(money(l.price))}</td>
      <td class="r">${esc(money(l.qty * l.price))}</td>
    </tr>`).join('');
    const taxable = d.total - (d.tax || 0) - (d.charges || 0);
    const pct = taxable > 0 && d.tax ? Math.round((d.tax / taxable) * 10000) / 100 : 0;
    const pctText = pct ? pct.toFixed(2) + ' %' : '';
    const side = (label: string, value: string) =>
      `<tr><td></td><td class="r"><b>${esc(label)}</b></td>${blanks(extra + 2)}<td class="r">${esc(value)}</td></tr>`;
    const kv = (k: string, v?: string) => `<tr><td class="k">${esc(k)}</td><td class="v">${esc(v || '')}</td></tr>`;
    const body = `<div class="gst" style="--accent:${esc(c.accent || '#1E2A78')}">
      <div class="g-top">
        <div class="g-name">${esc(d.firmName.toUpperCase())}</div>
        ${logo ? `<div class="g-logo">${logo}</div>` : ''}
      </div>
      ${d.firmDescription ? `<div class="g-band">${esc(d.firmDescription)}</div>` : '<div class="g-band g-thin"></div>'}
      <div class="g-addr">
        <div>${lines2(d.firmAddress)}</div>
        <div class="r">
          ${d.firmPhone ? `<div>Tel : ${esc(d.firmPhone)}</div>` : ''}
          ${d.firmWhatsapp ? `<div>WhatsApp : ${esc(d.firmWhatsapp)}</div>` : ''}
          ${d.firmWebsite ? `<div>Web : ${esc(d.firmWebsite)}</div>` : ''}
          ${d.firmEmail ? `<div>Email : ${esc(d.firmEmail)}</div>` : ''}
        </div>
      </div>
      <table class="g-box g-hdr"><tr>
        <td class="l">${d.firmTin ? `<b>TIN : ${esc(d.firmTin)}</b>` : ''}</td>
        <td class="c g-title">${esc(d.kind.toUpperCase())}</td>
        <td class="r small"><b>ORIGINAL FOR RECIPIENT</b></td>
      </tr></table>
      <table class="g-box g-info"><tr>
        <td class="g-cust">
          <div class="g-cap">${partyLabel} Detail</div>
          <table>
            ${kv('M/S', partyOn ? d.partyName : '')}
            ${kv('Address', partyOn ? d.partyAddress : '')}
            ${kv('Phone', partyOn ? d.partyPhone : '')}
            ${kv('Place of Supply', '')}
          </table>
        </td>
        <td class="g-meta"><table>
          <tr><td class="k">Invoice No.</td><td class="v"><b>${esc(d.no)}</b></td><td class="k">Invoice Date</td><td class="v"><b>${esc(dmy(d.ts))}</b></td></tr>
          <tr><td class="k">Challan No</td><td class="v"></td><td class="k">Challan Date</td><td class="v"></td></tr>
          <tr><td class="k">Payment</td><td class="v">${esc(d.method || '')}</td><td class="k">Served by</td><td class="v">${c.showServed ? esc(d.servedBy || '') : ''}</td></tr>
          <tr><td class="k">Transport</td><td class="v"></td><td class="k">Vehicle</td><td class="v"></td></tr>
        </table></td>
      </tr></table>
      ${c.head ? `<div class="g-box g-head">${lines2(c.head)}</div>` : ''}
      <table class="g-box g-items">
        <thead><tr><th class="c">Sr. No.</th><th>Name of Product / Service</th>${bHead}${eHead}<th class="c">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
        <tbody>
          ${rows}
          ${d.discount ? side('Less: Discount', '− ' + money(d.discount)) : ''}
          ${d.charges ? side('Additional charges', money(d.charges)) : ''}
          ${taxOn ? side(taxLabel + (pctText ? ' (' + pctText + ')' : ''), money(d.tax || 0)) : ''}
          ${filler(cols, d.lines.length + (taxOn ? 1 : 0), 260)}
        </tbody>
        <tfoot><tr class="tot"><td></td><td class="r">Total</td>${blanks(extra)}<td class="c">${esc(qtyTotal)}</td><td></td><td class="r">${esc(money(d.total))}</td></tr></tfoot>
      </table>
      <table class="g-box g-words"><tr>
        <td><div class="small">Total in words</div><b>${esc(words.toUpperCase())}</b></td>
        <td class="r small">(E &amp; O.E.)</td>
      </tr></table>
      ${taxOn ? `<table class="g-box g-taxsum">
        <thead><tr><th>Taxable Value</th><th>${esc(taxLabel)} %</th><th>${esc(taxLabel)} Amount</th><th>Total</th></tr></thead>
        <tbody><tr><td class="r">${esc(money(taxable))}</td><td class="c">${esc(pctText)}</td><td class="r">${esc(money(d.tax || 0))}</td><td class="r">${esc(money(taxable + (d.tax || 0)))}</td></tr></tbody>
      </table>
      <div class="g-box g-taxwords">Total Tax in words: <b>${esc([numberToWords(d.tax || 0), 'Only'].join(' ').toUpperCase())}</b></div>` : ''}
      ${d.due ? `<div class="g-box g-taxwords">Balance due: <b>${esc(money(d.due))}</b></div>` : ''}
      <table class="g-box g-bottom"><tr>
        <td class="g-bank">
          <div class="g-cap">Bank Details</div>
          <div class="g-bankrow"><div>${d.firmBank ? lines2(d.firmBank) : '&nbsp;'}</div>${c.code ? `<div class="g-code">${c.code}</div>` : ''}</div>
        </td>
        <td class="g-sig">
          <div class="small">Certified that the particulars given above are true and correct.</div>
          <div class="g-cap">For ${esc(d.firmName)}</div>
          ${d.signature ? `<img class="signimg" src="${esc(d.signature)}" />` : '<div style="height:44px"></div>'}
          <div class="small"><b>Authorised Signatory</b></div>
        </td>
      </tr><tr>
        <td class="g-terms"><div class="g-cap">Terms and Conditions</div>${lines2(d.terms || d.firmTerms || '')}</td>
        <td class="g-cust-sign"><div style="height:36px"></div><b>Customer Signature</b></td>
      </tr></table>
      ${d.note ? `<div class="g-note">Note: ${esc(d.note)}</div>` : ''}
      <div class="g-thanks">${footLine}</div>
    </div>`;
    const css = `
      .gst { font-size: 10.5px; color: #111; }
      .gst table { width: 100%; border-collapse: collapse; }
      .gst .g-top { display: flex; justify-content: space-between; align-items: center; }
      .gst .g-name { font-size: 26px; font-weight: 900; color: var(--accent); letter-spacing: .5px; }
      .gst .g-logo .logo { max-height: 18mm; max-width: 40mm; }
      .gst .g-band { background: #1A9E8F; color: #fff; font-weight: 700; font-size: 12px; padding: 5px 12px; margin-top: 4px; width: 72%; }
      .gst .g-thin { height: 4px; padding: 0; }
      .gst .g-addr { display: flex; justify-content: space-between; gap: 16px; margin: 8px 0 8px; line-height: 14px; }
      .gst .r { text-align: right; } .gst .c { text-align: center; } .gst .l { text-align: left; }
      .gst .small { font-size: 9.5px; }
      .gst .g-box { border: 1px solid #000; margin-top: -1px; }
      .gst .g-hdr td { padding: 4px 6px; width: 33%; }
      .gst .g-title { font-size: 14px; font-weight: 800; }
      .gst .g-info > tbody > tr > td { vertical-align: top; padding: 0; }
      .gst .g-cust { width: 45%; border-right: 1px solid #000; }
      .gst .g-cap { font-weight: 800; text-align: center; border-bottom: 1px solid #000; padding: 2px 4px; }
      .gst .g-info td.k { padding: 3px 6px; width: 28%; font-weight: 700; vertical-align: top; }
      .gst .g-info td.v { padding: 3px 6px; vertical-align: top; }
      .gst .g-meta td.k { width: 22%; }
      .gst .g-head { padding: 4px 6px; }
      .gst .g-items th { font-size: 9.5px; border: 1px solid #000; padding: 4px; }
      .gst .g-items td { border-left: 1px solid #000; border-right: 1px solid #000; padding: ${4 * pad}px 5px; vertical-align: top; }
      .gst .g-items tr.fill td { padding: 0; }
      .gst .g-items tr.tot td { border-top: 1px solid #000; padding: 4px 5px; font-weight: 800; }
      .gst .g-words td { padding: 4px 6px; vertical-align: top; }
      .gst .g-taxsum th, .gst .g-taxsum td { border: 1px solid #000; padding: 3px 5px; font-size: 9.5px; }
      .gst .g-taxwords { padding: 4px 6px; }
      .gst .g-bottom td { vertical-align: top; border: 1px solid #000; padding: 0; width: 50%; }
      .gst .g-bankrow { display: flex; justify-content: space-between; gap: 8px; padding: 5px 6px; line-height: 15px; }
      .gst .g-code .code { margin-top: 0; }
      .gst .g-sig { text-align: center; padding-bottom: 6px !important; }
      .gst .g-sig .small:first-child { padding: 3px; border-bottom: 1px solid #000; }
      .gst .signimg { max-height: 16mm; max-width: 40mm; }
      .gst .g-terms { padding-bottom: 6px !important; line-height: 14px; }
      .gst .g-terms .g-cap { margin-bottom: 3px; }
      .gst .g-cust-sign { vertical-align: bottom !important; padding: 4px 6px !important; }
      .gst .g-note { margin-top: 6px; }
      .gst .g-thanks { margin-top: 8px; }`;
    return { body, css };
  }

  // plain
  const rows = d.lines.map((l, i) => `<tr>
    <td class="n">${i + 1}</td>
    <td class="l">${esc(l.name)}</td>
    ${bCell(l)}${eCell(l)}
    <td class="r">${l.qty} ${esc(l.unit || '')}</td>
    <td class="r">${esc(money(l.price))}</td>
    <td class="r">${esc(money(l.qty * l.price))}</td>
  </tr>`).join('');
  const totalRow = (label: string, value: string, strong = false) =>
    `<tr class="${strong ? 'strong' : ''}"><td class="l">${esc(label)}</td><td class="r">${esc(value)}</td></tr>`;
  const totals = [
    totalRow('Subtotal', money(d.subtotal)),
    d.discount ? totalRow('Discount', '− ' + money(d.discount)) : '',
    d.charges ? totalRow('Additional charges', money(d.charges)) : '',
    taxOn ? totalRow(taxLabel, money(d.tax || 0)) : '',
    totalRow('TOTAL', money(d.total), true),
    d.paid !== undefined ? totalRow('Paid', money(d.paid)) : '',
    d.due ? totalRow('Balance due', money(d.due), true) : '',
  ].filter(Boolean).join('');
  const firmLines = [
    d.firmDescription, d.firmAddress, d.firmPhone, d.firmWhatsapp ? 'WhatsApp ' + d.firmWhatsapp : '',
    d.firmEmail, d.firmWebsite, d.firmTin ? 'TIN ' + d.firmTin : '',
  ].filter(Boolean).map((x) => `<div class="muted">${esc(x)}</div>`).join('');
  const body = `<div class="plain">
    <div class="top">
      <div class="firm">${logo}<div><h1>${esc(d.firmName)}</h1>${firmLines}</div></div>
      <div class="title">
        <div class="kind">${esc(d.kind)}</div>
        <div class="kv"><span>Number</span><b>${esc(d.no)}</b></div>
        <div class="kv"><span>Date</span><span>${esc(dmy(d.ts))}</span></div>
        ${d.method ? `<div class="kv"><span>Payment</span><span>${esc(d.method)}</span></div>` : ''}
      </div>
    </div>
    ${c.head ? `<div class="head">${lines2(c.head)}</div>` : ''}
    ${partyOn ? `<div class="party"><div class="lbl">${partyLabel}</div><b>${esc(d.partyName)}</b>
      ${d.partyPhone ? `<div>${esc(d.partyPhone)}</div>` : ''}${d.partyAddress ? `<div>${lines2(d.partyAddress)}</div>` : ''}</div>` : ''}
    <table class="lines"><thead><tr><th class="n">#</th><th class="l">Item</th>${bHead}${eHead}<th class="r">Qty</th><th class="r">Price</th><th class="r">Amount</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <div class="sum"><table>${totals}</table></div>
    ${served}
    ${d.note ? `<div class="foot">Note: ${esc(d.note)}</div>` : ''}
    ${d.terms ? `<div class="foot">Terms: ${esc(d.terms)}</div>` : ''}
    ${d.signature ? `<div class="sign"><img src="${esc(d.signature)}" /><div class="signline">Authorised signature</div></div>` : ''}
    ${c.code}
    <div class="foot">${footLine}</div>
  </div>`;
  const css = `
    .plain .top { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; }
    .plain .firm { display: flex; gap: 14px; align-items: flex-start; }
    .plain .firm .logo { max-width: 38mm; max-height: 24mm; }
    .plain h1 { font-size: 20px; margin: 0 0 4px; }
    .plain .muted { color: #555; font-size: 11px; margin-top: 1px; }
    .plain .title { text-align: right; min-width: 60mm; }
    .plain .kind { font-size: 18px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 8px; }
    .plain .kv { display: flex; justify-content: space-between; gap: 16px; font-size: 11.5px; padding: 1px 0; }
    .plain .head { margin-top: 14px; font-size: 11.5px; color: #333; }
    .plain .party { margin-top: 18px; padding: 10px 12px; background: #f4f4f4; border-radius: 6px; font-size: 12px; }
    .plain .party .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .8px; color: #777; margin-bottom: 2px; }
    .plain table.lines { width: 100%; border-collapse: collapse; margin-top: 18px; }
    .plain table.lines th { font-size: 10.5px; text-transform: uppercase; letter-spacing: .6px; color: #555; border-bottom: 1.5px solid #222; padding: 6px 4px; }
    .plain table.lines td { border-bottom: 1px solid #ddd; padding: ${7 * pad}px 4px; vertical-align: top; }
    .plain .n { width: 22px; color: #888; text-align: left; }
    .plain .l { text-align: left; } .plain .r { text-align: right; white-space: nowrap; } .plain .c { text-align: center; }
    .plain .sum { display: flex; justify-content: flex-end; margin-top: 10px; }
    .plain .sum table { width: 75mm; border-collapse: collapse; font-size: 12px; }
    .plain .sum td { padding: 3px 0; }
    .plain .strong td { font-weight: 800; font-size: 14px; border-top: 1.5px solid #222; padding-top: 6px; }
    .plain .foot { text-align: center; color: #555; font-size: 10.5px; margin-top: 12px; }
    .plain .sign { margin-top: 26px; text-align: right; }
    .plain .sign img { max-width: 50mm; max-height: 18mm; }
    .plain .signline { border-top: 1px solid #999; width: 55mm; margin-left: auto; margin-top: 2px; padding-top: 3px; text-align: center; color: #666; font-size: 10px; }`;
  return { body, css };
}
