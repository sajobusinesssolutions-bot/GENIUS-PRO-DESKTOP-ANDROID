/**
 * Printing and sharing for the documents the shop raises — bills, purchases,
 * receipts and statements. Report exporting lives in ./exporters; this covers
 * the single-document case, where the layout is a receipt rather than a table.
 */
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import qrcode from 'qrcode-generator';
import { code128Html } from './code128';
import type { Paper, PrintTemplate, DocKind } from './types';

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
  /** Which print template applies (Settings, Printing). */
  docKind?: DocKind;
  no: string;
  ts: string;
  firmName: string;
  firmAddress?: string;
  firmTin?: string;
  firmPhone?: string;
  firmEmail?: string;
  /** One line under the shop name saying what the business does. */
  firmDescription?: string;
  /** A local file URI. Printed at the top; simply absent when there is none. */
  logo?: string;
  /** A local file URI, printed above the signature line. */
  signature?: string;
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

/* ================================================================
   How a document is laid out and where it goes
   ================================================================ */

/**
 * What the print template and the chosen printer add to a document. Before
 * this, every document printed the same 420px column whatever the paper, and
 * the template's logo, barcode, QR, header, footer and copies settings were
 * saved and never read.
 */
export interface PrintOpts {
  /** The paper actually in the printer. Decides the layout. */
  paper?: Paper;
  tpl?: PrintTemplate;
  /** iOS only: a printer picked with Print.selectPrinterAsync. */
  printerUrl?: string;
}

/** Page size in points (1/72 inch), which is what expo-print measures in. */
const MM = 72 / 25.4;
export function pageSize(paper: Paper, lines = 10): { width: number; height: number } {
  if (paper === 'A4') return { width: 595, height: 842 };
  const w = paper === '58mm' ? 58 : 80;
  // A roll has no page length, so the page is made as long as the receipt:
  // a short page cuts a long bill in two, a long one wastes paper.
  const mm = 110 + lines * (paper === '58mm' ? 11 : 9);
  return { width: Math.round(w * MM), height: Math.round(Math.min(mm, 1200) * MM) };
}

/**
 * Turns a picture on the phone into something the print engine can draw.
 *
 * The print view is a sandboxed web page and will not load file:// paths, so
 * the logo and the signature were silently missing from every printout. The
 * picture is read and embedded in the page itself instead.
 */
export async function inlineImage(uri?: string): Promise<string | undefined> {
  if (!uri) return undefined;
  if (uri.startsWith('data:') || uri.startsWith('http')) return uri;
  try {
    const b64 = await new File(uri).base64();
    const ext = (uri.split('?')[0].split('.').pop() || '').toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
    return 'data:' + mime + ';base64,' + b64;
  } catch {
    return undefined;
  }
}

/** A QR code as inline SVG — ink, so it prints. Empty if the text will not fit. */
export function qrSvg(text: string, px = 110): string {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    const cell = Math.max(1, Math.floor(px / (n + 2)));
    const size = (n + 2) * cell;
    let rects = '';
    for (let r = 0; r < n; r += 1) {
      for (let c = 0; c < n; c += 1) {
        if (qr.isDark(r, c)) rects += `<rect x="${(c + 1) * cell}" y="${(r + 1) * cell}" width="${cell}" height="${cell}"/>`;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><g fill="#000">${rects}</g></svg>`;
  } catch {
    return '';
  }
}

/** What the template's code carries. */
function codeText(d: DocMeta, tpl: PrintTemplate, money: (n: number) => string): string {
  switch (tpl.codeData) {
    case 'total': return d.no + ' ' + money(d.total);
    case 'party': return d.partyName ? d.partyName + ' · ' + d.no : d.no;
    case 'verify': return [d.firmName, d.kind + ' ' + d.no, new Date(d.ts).toISOString().slice(0, 10), 'Total ' + money(d.total), d.firmTin ? 'TIN ' + d.firmTin : ''].filter(Boolean).join('\n');
    case 'custom': return d.footer || d.no;
    default: return d.no;
  }
}

function codeBlock(d: DocMeta, tpl: PrintTemplate | undefined, money: (n: number) => string, paper: Paper): string {
  if (!tpl || tpl.code === 'none') return '';
  const text = codeText(d, tpl, money);
  const narrow = paper === '58mm';
  const parts: string[] = [];
  if (tpl.code === 'barcode' || tpl.code === 'both') {
    // a barcode holds one line; the number is what a scanner at the till looks up
    const bars = code128Html(tpl.codeData === 'no' ? d.no : text.split('\n')[0], narrow ? 34 : 44, narrow ? 1 : 2);
    if (bars) parts.push(`<div class="code">${bars}${tpl.codeCaption ? `<div class="cap">${esc(d.no)}</div>` : ''}</div>`);
  }
  if (tpl.code === 'qr' || tpl.code === 'both') {
    const qr = qrSvg(text, narrow ? 96 : paper === 'A4' ? 120 : 116);
    if (qr) parts.push(`<div class="code">${qr}${tpl.codeCaption ? `<div class="cap">Scan to check this ${esc(d.kind.toLowerCase())}</div>` : ''}</div>`);
  }
  return parts.join('');
}

/**
 * The document as a page. A receipt for 58mm and 80mm rolls — one narrow
 * column sized to the paper — and a proper invoice layout for A4. Batch and
 * expiry ride under the line they belong to, because that is what a pharmacy
 * or a grocer needs on the paper for a recall or a return.
 */
export function docHtml(d: DocMeta, money: (n: number) => string, opts: PrintOpts = {}): string {
  const paper: Paper = opts.paper || opts.tpl?.paper || '80mm';
  const tpl = opts.tpl;
  const showLogo = tpl ? tpl.showLogo : true;
  const showTax = tpl ? tpl.showTax : true;
  const showServed = tpl ? tpl.showServed : true;
  const showParty = tpl ? tpl.showParty : true;
  // Independent toggles: a lot number can matter with no expiry date worth
  // printing (hardware, building supplies) and the reverse (perishables
  // dated by the supplier with no lot code of their own).
  const showBatch = tpl ? tpl.showBatch : true;
  const showExpiry = tpl ? tpl.showExpiry : true;
  const boxed = !!tpl?.boxed && paper === 'A4';
  const accent = tpl?.accentColor && paper === 'A4' ? tpl.accentColor : '';
  const tight = tpl?.density === 'tight';
  const head = (tpl?.head || '').trim();
  const foot = (tpl?.foot || '').trim();
  const copies = Math.max(1, Math.min(5, tpl?.copies || 1));
  const code = codeBlock(d, tpl, money, paper);
  const date = new Date(d.ts);

  const batchSub = (l: DocLine) => {
    const b = showBatch && l.batchNo ? 'Batch ' + esc(l.batchNo) : '';
    const e = showExpiry && l.expiry
      ? 'Exp ' + esc(new Date(l.expiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }))
      : '';
    return b || e ? `<div class="sub">${b}${b && e ? ' · ' : ''}${e}</div>` : '';
  };

  const totalRow = (label: string, value: string, strong = false) =>
    `<tr class="${strong ? 'strong' : ''}"><td class="l">${esc(label)}</td><td class="r">${esc(value)}</td></tr>`;
  const totals = [
    totalRow('Subtotal', money(d.subtotal)),
    d.discount ? totalRow('Discount', '− ' + money(d.discount)) : '',
    d.charges ? totalRow('Additional charges', money(d.charges)) : '',
    d.tax && showTax ? totalRow('Tax', money(d.tax)) : '',
    totalRow('TOTAL', money(d.total), true),
    d.paid !== undefined ? totalRow('Paid', money(d.paid)) : '',
    d.due ? totalRow('Balance due', money(d.due), true) : '',
  ].filter(Boolean).join('');

  const firmLines = [
    d.firmDescription, d.firmAddress, d.firmPhone, d.firmEmail, d.firmTin ? 'TIN ' + d.firmTin : '',
  ].filter(Boolean).map((x) => `<div class="muted">${esc(x)}</div>`).join('');

  const partyLabel = /purchase/i.test(d.kind) ? 'Supplier' : 'Customer';
  const endMatter = `
    ${d.note ? `<div class="foot">Note: ${esc(d.note)}</div>` : ''}
    ${d.terms ? `<div class="foot">Terms: ${esc(d.terms)}</div>` : ''}
    ${d.signature ? `<div class="sign"><img src="${esc(d.signature)}" /><div class="signline">Authorised signature</div></div>` : ''}
    ${code}
    ${foot ? `<div class="foot">${esc(foot).replace(/\n/g, '<br/>')}</div>` : ''}
    <div class="foot">${esc(d.footer || 'Thank you for your business')}</div>`;

  let doc: string;
  if (paper === 'A4') {
    const rows = d.lines.map((l, i) => `<tr>
      <td class="n">${i + 1}</td>
      <td class="l">${esc(l.name)}${batchSub(l)}</td>
      <td class="r">${l.qty} ${esc(l.unit || '')}</td>
      <td class="r">${esc(money(l.price))}</td>
      <td class="r">${esc(money(l.qty * l.price))}</td>
    </tr>`).join('');
    doc = `<div class="doc a4${boxed ? ' boxed' : ''}"${accent ? ` style="--accent: ${esc(accent)}"` : ''}>
      ${accent ? '<div class="bar"></div>' : ''}
      <div class="top">
        <div class="firm">
          ${showLogo && d.logo ? `<img class="logo" src="${esc(d.logo)}" />` : ''}
          <div><h1>${esc(d.firmName)}</h1>${firmLines}</div>
        </div>
        <div class="title">
          <div class="kind">${esc(d.kind)}</div>
          <div class="kv"><span>Number</span><b>${esc(d.no)}</b></div>
          <div class="kv"><span>Date</span><span>${esc(date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }))}</span></div>
          ${d.method ? `<div class="kv"><span>Payment</span><span>${esc(d.method)}</span></div>` : ''}
        </div>
      </div>
      ${head ? `<div class="head">${esc(head).replace(/\n/g, '<br/>')}</div>` : ''}
      ${showParty && d.partyName ? `<div class="party"><div class="lbl">${partyLabel}</div><b>${esc(d.partyName)}</b>
        ${d.partyPhone ? `<div>${esc(d.partyPhone)}</div>` : ''}${d.partyAddress ? `<div>${esc(d.partyAddress)}</div>` : ''}</div>` : ''}
      <table class="lines"><thead><tr><th class="n">#</th><th class="l">Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Amount</th></tr></thead>
        <tbody>${rows}</tbody></table>
      <div class="sum"><table>${totals}</table></div>
      ${showServed && d.servedBy ? `<div class="foot">Served by ${esc(d.servedBy)}</div>` : ''}
      ${endMatter}
    </div>`;
  } else {
    const rows = d.lines.map((l) => `<tr>
      <td class="l">${esc(l.name)}${batchSub(l)}<div class="sub">${l.qty} ${esc(l.unit || '')} × ${esc(money(l.price))}</div></td>
      <td class="r">${esc(money(l.qty * l.price))}</td>
    </tr>`).join('');
    doc = `<div class="doc roll">
      ${showLogo && d.logo ? `<div class="logo"><img src="${esc(d.logo)}" /></div>` : ''}
      <h1>${esc(d.firmName)}</h1>
      ${firmLines}
      ${head ? `<div class="muted">${esc(head).replace(/\n/g, '<br/>')}</div>` : ''}
      <div class="kind">${esc(d.kind)}</div>
      <div class="rule"></div>
      <div class="meta">
        <div><span>Number</span><strong>${esc(d.no)}</strong></div>
        <div><span>Date</span><span>${esc(date.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}</span></div>
        ${showParty && d.partyName ? `<div><span>${partyLabel}</span><strong>${esc(d.partyName)}</strong></div>` : ''}
        ${showParty && d.partyPhone ? `<div><span>Phone</span><span>${esc(d.partyPhone)}</span></div>` : ''}
        ${d.method ? `<div><span>Paid by</span><span>${esc(d.method)}</span></div>` : ''}
        ${showServed && d.servedBy ? `<div><span>Served by</span><span>${esc(d.servedBy)}</span></div>` : ''}
      </div>
      <div class="rule"></div>
      <table>${rows}</table>
      <div class="rule"></div>
      <table>${totals}</table>
      ${endMatter}
    </div>`;
  }

  const narrow = paper === '58mm';
  const base = paper === 'A4' ? 12 : narrow ? 10 : 11.5;
  const pad = tight ? 0.6 : 1;
  const css = paper === 'A4' ? `
  @page { size: A4; margin: 14mm; }
  body { font-size: ${base}px; }
  .bar { height: 6px; border-radius: 3px; background: var(--accent); margin-bottom: 16px; }
  .top { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; }
  .firm { display: flex; gap: 14px; align-items: flex-start; }
  .firm .logo { max-width: 38mm; max-height: 24mm; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .muted { color: #555; font-size: 11px; margin-top: 1px; }
  .title { text-align: right; min-width: 60mm; }
  .kind { font-size: 18px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 8px; color: var(--accent, #000); }
  .kv { display: flex; justify-content: space-between; gap: 16px; font-size: 11.5px; padding: 1px 0; }
  .head { margin-top: 14px; font-size: 11.5px; color: #333; }
  .party { margin-top: 18px; padding: 10px 12px; background: #f4f4f4; border-radius: 6px; font-size: 12px; }
  .party .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .8px; color: #777; margin-bottom: 2px; }
  table.lines { width: 100%; border-collapse: collapse; margin-top: 18px; }
  table.lines th { font-size: 10.5px; text-transform: uppercase; letter-spacing: .6px; color: #555;
    border-bottom: 1.5px solid #222; padding: 6px 4px; }
  table.lines td { border-bottom: 1px solid #ddd; padding: ${7 * pad}px 4px; vertical-align: top; }
  .n { width: 22px; color: #888; text-align: left; }
  .l { text-align: left; } .r { text-align: right; white-space: nowrap; }
  .sub { color: #777; font-size: 10px; margin-top: 2px; }
  .sum { display: flex; justify-content: flex-end; margin-top: 10px; }
  .sum table { width: 75mm; border-collapse: collapse; font-size: 12px; }
  .sum td { padding: 3px 0; }
  .strong td { font-weight: 800; font-size: 14px; border-top: 1.5px solid #222; padding-top: 6px; }
  .foot { text-align: center; color: #555; font-size: 10.5px; margin-top: 12px; }
  .code { text-align: center; margin-top: 16px; }
  .cap { font-size: 9.5px; color: #555; margin-top: 3px; }
  .sign { margin-top: 26px; text-align: right; }
  .sign img { max-width: 50mm; max-height: 18mm; }
  .signline { border-top: 1px solid #999; width: 55mm; margin-left: auto; margin-top: 2px; padding-top: 3px; text-align: center; color: #666; font-size: 10px; }
  /* "boxed": the classic ledger look — every block ruled off, like a printed
     account book page, rather than the airy default. */
  .boxed .top { border: 1.4px solid #000; padding: 10px 14px; }
  .boxed .party { background: none; border: 1.4px solid #000; border-radius: 0; border-top: none; margin-top: 0; }
  .boxed table.lines { border: 1.4px solid #000; margin-top: 0; }
  .boxed table.lines th, .boxed table.lines td { border: 1px solid #000; }
  .boxed .sum { justify-content: stretch; }
  .boxed .sum table { width: 100%; border: 1.4px solid #000; border-top: none; }
  .boxed .sum td { padding: 4px 10px; }`
  : `
  @page { size: ${narrow ? 58 : 80}mm auto; margin: ${narrow ? 1.5 : 3}mm; }
  body { font-size: ${base}px; }
  .doc { width: 100%; }
  h1 { font-size: ${narrow ? 13 : 16}px; margin: 0; text-align: center; }
  .muted { color: #444; font-size: ${narrow ? 9 : 10.5}px; text-align: center; margin-top: 2px; }
  .kind { text-align: center; font-size: ${narrow ? 10.5 : 12}px; font-weight: 800; letter-spacing: 1.1px; text-transform: uppercase; margin: 9px 0 2px; }
  .rule { border-top: 1px dashed #000; margin: ${8 * pad}px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: ${4 * pad}px 0; vertical-align: top; }
  td.l { text-align: left; } td.r { text-align: right; white-space: nowrap; padding-left: 6px; }
  .sub { color: #333; font-size: ${narrow ? 8.5 : 9.5}px; margin-top: 1px; }
  .strong td { font-weight: 800; font-size: ${narrow ? 12 : 14}px; border-top: 1px solid #000; padding-top: 5px; }
  .meta { font-size: ${narrow ? 9 : 10.5}px; }
  .meta div { display: flex; justify-content: space-between; gap: 6px; padding: 1px 0; }
  .foot { text-align: center; color: #222; font-size: ${narrow ? 9 : 10}px; margin-top: 10px; }
  /* thermal paper is monochrome and narrow, so the logo is capped and scaled by height */
  .logo { text-align: center; margin-bottom: 5px; }
  .logo img { max-width: ${narrow ? 40 : 56}mm; max-height: ${narrow ? 16 : 22}mm; filter: grayscale(1); }
  .code { text-align: center; margin-top: 10px; }
  .cap { font-size: 9px; color: #222; margin-top: 2px; }
  .sign { margin-top: 14px; text-align: right; }
  .sign img { max-width: 36mm; max-height: 14mm; }
  .signline { border-top: 1px solid #000; width: 40mm; margin-left: auto; margin-top: 2px; padding-top: 2px; text-align: center; font-size: 9px; }`;

  const pages = Array.from({ length: copies }, (_, i) =>
    `<section style="${i < copies - 1 ? 'page-break-after: always;' : ''}">${doc}</section>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  body { font-family: -apple-system, Roboto, Helvetica, Arial, sans-serif; color: #000; margin: 0; padding: 0; }
  svg { display: inline-block; }
  ${css}
</style></head><body>${pages}</body></html>`;
}

/** Embeds the pictures, so they actually appear on paper. */
async function ready(d: DocMeta, opts: PrintOpts): Promise<DocMeta> {
  const showLogo = opts.tpl ? opts.tpl.showLogo : true;
  const [logo, signature] = await Promise.all([
    showLogo ? inlineImage(d.logo) : Promise.resolve(undefined),
    inlineImage(d.signature),
  ]);
  return { ...d, logo, signature };
}

/** Prints: straight to the chosen printer on iOS, through the system dialog on Android. */
export async function printDoc(d: DocMeta, money: (n: number) => string, opts: PrintOpts = {}): Promise<void> {
  const paper: Paper = opts.paper || opts.tpl?.paper || '80mm';
  const full = await ready(d, opts);
  await Print.printAsync({
    html: docHtml(full, money, { ...opts, paper }),
    ...pageSize(paper, d.lines.length * Math.max(1, Math.min(5, opts.tpl?.copies || 1))),
    ...(opts.printerUrl ? { printerUrl: opts.printerUrl } : null),
  });
}

/** Writes a PDF and hands it to the share sheet. Returns false if sharing is unavailable. */
export async function shareDoc(d: DocMeta, money: (n: number) => string, opts: PrintOpts = {}): Promise<boolean> {
  // a shared PDF is read on a screen or printed on an office printer: A4, unless a roll was asked for
  const paper: Paper = opts.paper || 'A4';
  const full = await ready(d, opts);
  const { uri } = await Print.printToFileAsync({
    html: docHtml(full, money, { ...opts, paper, tpl: opts.tpl ? { ...opts.tpl, copies: 1 } : undefined }),
    ...pageSize(paper, d.lines.length),
  });
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
