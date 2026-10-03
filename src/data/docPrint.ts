/**
 * Printing and sharing for the documents the shop raises — bills, purchases,
 * receipts and statements. Report exporting lives in ./exporters; this covers
 * the single-document case, where the layout is a receipt rather than a table.
 */
import { escposDoc, imeiTexts, shows, qtyText } from './escpos';
import { printBluetooth, testNetwork } from './rawPrinter';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import qrcode from 'qrcode-generator';
import { code128Html } from './code128';
import { a4Layout, esc, numberToWords } from './invoiceLayouts';

export { numberToWords };
import type { Paper, PrintTemplate, DocKind, Printer, SoldSerial } from './types';

/**
 * Renders a PDF and returns a URI in this app's own cache that sharing can read.
 * The print engine's own output path is refused on some Android builds ("Missing
 * READ permission"), even for a move — so the bytes are written out here instead.
 */
export async function printPdfToCache(opts: Print.FilePrintOptions, name: string): Promise<string> {
  const printed = await Print.printToFileAsync({ ...opts, base64: true });
  const dest = new File(Paths.cache, name);
  // a path to a file that is not there shares as "nothing attached"
  const written = () => {
    try { return dest.exists && (dest.size ?? 0) > 0; } catch { return false; }
  };
  if (printed?.base64) {
    try {
      if (dest.exists) dest.delete();
      dest.create({ overwrite: true, intermediates: true });
      dest.write(printed.base64, { encoding: 'base64' });
      if (written()) return dest.uri;
    } catch {
      // fall through to moving the printed file
    }
  }
  const uri = printed?.uri || '';
  if (!uri) return '';
  try {
    if (dest.exists) dest.delete();
    // move() is async on SDK 57 — not awaiting it returned a path before the file was there
    await new File(uri).move(dest);
    if (written()) return dest.uri;
  } catch {
    // keep the printer's own path
  }
  return uri;
}

export interface DocLine {
  name: string;
  qty: number;
  price: number;
  unit?: string;
  /** The phones sold on this line: IMEI 1, IMEI 2 and condition. */
  serials?: SoldSerial[];
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
  /** A second number the shop takes WhatsApp messages on. */
  firmWhatsapp?: string;
  firmWebsite?: string;
  /** Bank name, account and branch — the GST invoice prints it beside the payment QR. */
  firmBank?: string;
  /** Standing terms, used when the document has none of its own. */
  firmTerms?: string;
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
  /** Settings → Currency's full name, e.g. "Ugandan shilling" — for "Amount in words" on a boxed A4 invoice. */
  currencyName?: string;
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
  /** Settings → Tax name, e.g. "VAT" — what the tax line is called on paper. */
  taxLabel?: string;
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
  /** The printer it is going to. A receipt printer this phone connected to itself is sent ESC/POS directly. */
  printer?: Printer;
  /** Kick the cash drawer wired to that printer (sales receipts only). */
  openDrawer?: boolean;
}

/** A Bluetooth or network receipt printer this phone talks to itself, rather than through the print dialog. */
export function isDirectPrinter(p?: Printer): p is Printer {
  return !!p && (p.kind === 'bluetooth' || p.kind === 'wifi') && !!p.address;
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
export function codeText(d: DocMeta, tpl: PrintTemplate, money: (n: number) => string): string {
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
export function docHtml(input: DocMeta, money: (n: number) => string, opts: PrintOpts = {}): string {
  const paper: Paper = opts.paper || opts.tpl?.paper || '80mm';
  const tpl = opts.tpl;
  // the template's own title, when it has one, replaces the document's name
  const d: DocMeta = tpl?.title?.trim() ? { ...input, kind: tpl.title.trim() } : input;
  const sh = shows(tpl);
  const rollStyle = paper === 'A4' ? 'classic' : sh.style;
  const imeiHtml = (l: DocLine) => (sh.imei ? imeiTexts(l.serials).map((t) => `<div class="sub imei">${esc(t)}</div>`).join('') : '');
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
  const tight = tpl?.density === 'tight' || rollStyle === 'compact';
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
    d.tax && showTax ? totalRow(d.taxLabel || 'Tax', money(d.tax)) : '',
    totalRow('TOTAL', money(d.total), true),
    sh.paid && d.paid !== undefined ? totalRow('Paid', money(d.paid)) : '',
    sh.paid && d.paid !== undefined && d.paid > d.total ? totalRow('Change', money(d.paid - d.total)) : '',
    d.due ? totalRow('Balance due', money(d.due), true) : '',
  ].filter(Boolean).join('');

  const firmLines = [
    d.firmDescription, d.firmAddress, d.firmPhone, d.firmWhatsapp ? 'WhatsApp ' + d.firmWhatsapp : '', d.firmEmail, d.firmTin ? 'TIN ' + d.firmTin : '',
  ].filter(Boolean).map((x) => `<div class="muted">${esc(x)}</div>`).join('');

  const partyLabel = /purchase/i.test(d.kind) ? 'Supplier' : 'Customer';
  const endMatter = `
    ${d.note ? `<div class="foot">Note: ${esc(d.note)}</div>` : ''}
    ${d.terms ? `<div class="foot">Terms: ${esc(d.terms)}</div>` : ''}
    ${d.signature ? `<div class="sign"><img src="${esc(d.signature)}" /><div class="signline">Authorised signature</div></div>` : ''}
    ${code}
    <div class="foot">${esc(foot || d.footer || 'Thank you for your business').replace(/\n/g, '<br/>')}</div>`;

  let doc: string;
  let a4Css = '';
  if (paper === 'A4') {
    const style = tpl?.style || (boxed ? 'tally' : accent ? 'quickbooks' : 'plain');
    // a page has the room for the IMEIs under each item name; the unit switch blanks the unit column
    const pageDoc: DocMeta = { ...d, lines: d.lines.map((l) => ({ ...l, unit: sh.unit ? l.unit : '' })) };
    const out = a4Layout(style, pageDoc, money, { showLogo, showTax, showServed, showParty, showBatch, showExpiry, head, foot, code, tight, accent, imeiHtml });
    doc = out.body;
    a4Css = out.css;
  } else {
    const rows = d.lines.map((l) => rollStyle === 'compact'
      ? `<tr><td class="l">${l.qty} ${esc(l.name)}${imeiHtml(l)}</td><td class="r">${esc(money(l.qty * l.price))}</td></tr>`
      : `<tr>
      <td class="l">${esc(l.name)}${batchSub(l)}<div class="sub">${esc(qtyText(l, money, sh, ' × '))}</div>${imeiHtml(l)}</td>
      <td class="r">${esc(money(l.qty * l.price))}</td>
    </tr>`).join('');
    const count = rollStyle === 'detailed'
      ? `<div class="meta"><div><span>Items: ${d.lines.length}</span><span>Qty: ${d.lines.reduce((a, l) => a + l.qty, 0)}</span></div></div><div class="rule"></div>`
      : '';
    const bigTotal = rollStyle === 'bold'
      ? `<div class="bigtotal"><div>TOTAL</div><strong>${esc(money(d.total))}</strong></div>`
      : '';
    doc = `<div class="doc roll">
      ${showLogo && d.logo ? `<div class="logo"><img src="${esc(d.logo)}" /></div>` : ''}
      <h1>${esc(d.firmName)}</h1>
      ${rollStyle === 'compact' ? (d.firmPhone ? `<div class="muted">${esc(d.firmPhone)}</div>` : '') : firmLines}
      ${head && rollStyle !== 'compact' ? `<div class="muted">${esc(head).replace(/\n/g, '<br/>')}</div>` : ''}
      <div class="kind">${esc(d.kind)}</div>
      <div class="rule"></div>
      <div class="meta">
        <div><span>Number</span><strong>${esc(d.no)}</strong></div>
        <div><span>Date</span><span>${esc(date.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}</span></div>
        ${showParty && d.partyName ? `<div><span>${partyLabel}</span><strong>${esc(d.partyName)}</strong></div>` : ''}
        ${showParty && d.partyPhone ? `<div><span>Phone</span><span>${esc(d.partyPhone)}</span></div>` : ''}
        ${d.method && rollStyle !== 'compact' ? `<div><span>Paid by</span><span>${esc(d.method)}</span></div>` : ''}
        ${showServed && rollStyle !== 'compact' && d.servedBy ? `<div><span>Served by</span><span>${esc(d.servedBy)}</span></div>` : ''}
      </div>
      <div class="rule"></div>
      <table>${rows}</table>
      <div class="rule"></div>
      ${count}
      ${bigTotal}
      <table>${totals}</table>
      ${endMatter}
    </div>`;
  }

  const narrow = paper === '58mm';
  const base = paper === 'A4' ? 12 : narrow ? 10 : 11.5;
  const pad = tight ? 0.6 : 1;
  const css = paper === 'A4' ? `
  @page { size: A4; margin: 12mm; }
  body { font-size: ${base}px; }
  .code { text-align: center; margin-top: 12px; }
  .cap { font-size: 9.5px; color: #555; margin-top: 3px; }
  ${a4Css}`
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
  .imei { font-family: monospace; color: #000; }
  .bigtotal { text-align: center; border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 6px 0; margin: 6px 0; }
  .bigtotal div { font-size: ${narrow ? 10 : 12}px; font-weight: 800; letter-spacing: 1px; }
  .bigtotal strong { font-size: ${narrow ? 20 : 26}px; }
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

/**
 * Prints. A roll receipt going to a Bluetooth or network receipt printer is
 * sent straight to it as ESC/POS — no dialog, done in a second or two. Every
 * other document (A4, "Save as PDF", a printer added by name) goes through
 * the system print dialog as before, or straight to the chosen AirPrint
 * printer on iOS.
 */
export async function printDoc(d: DocMeta, money: (n: number) => string, opts: PrintOpts = {}): Promise<void> {
  const paper: Paper = opts.paper || opts.tpl?.paper || '80mm';
  const p = opts.printer;
  if (isDirectPrinter(p) && paper !== 'A4') {
    const bytes = escposDoc(d, money, {
      paper, tpl: opts.tpl, openDrawer: opts.openDrawer,
      codeText: opts.tpl && opts.tpl.code !== 'none' ? codeText(d, opts.tpl, money) : undefined,
    });
    if (p.kind === 'bluetooth') await printBluetooth(p.address, bytes);
    else await testNetwork(p.address, p.port || 9100, bytes, 8000);
    return;
  }
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
  // named after the document number, which is what the recipient sees in WhatsApp
  const target = await printPdfToCache({
    html: docHtml(full, money, { ...opts, paper, tpl: opts.tpl ? { ...opts.tpl, copies: 1 } : undefined }),
    ...pageSize(paper, d.lines.length),
  }, safeName(d.kind + '-' + d.no) + '.pdf');
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
