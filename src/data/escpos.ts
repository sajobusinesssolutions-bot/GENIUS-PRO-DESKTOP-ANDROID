/**
 * A RECEIPT, AS A RECEIPT PRINTER READS IT.
 *
 * Bluetooth and network till printers do not take pages; they take ESC/POS —
 * plain text with a few control codes for bold, size, alignment, QR codes,
 * barcodes, the paper cut and the cash drawer. Sending that straight to the
 * printer is what makes "print after sale" instant: no print dialog, no PDF,
 * no choosing the printer each time.
 *
 * The layout follows the roll receipt in docPrint.ts (docHtml) field for
 * field, and reads the same template switches, so what prints matches what
 * the Receipt settings preview shows.
 */
import type { DocLine, DocMeta } from './docPrint';
import type { Paper, PrintTemplate, SoldSerial } from './types';

/** "IMEI 356… / 356… · Used" — one line per phone sold on a line. */
export function imeiTexts(serials?: SoldSerial[]): string[] {
  return (serials || []).map((s) => 'IMEI ' + s.imei + (s.imei2 ? ' / ' + s.imei2 : '')
    + (s.condition ? ' · ' + (s.condition === 'used' ? 'Used' : 'New') : ''));
}

/** What a template shows, with the defaults for templates saved before a switch existed. */
export function shows(tpl?: PrintTemplate) {
  return {
    tax: tpl ? tpl.showTax : true,
    served: tpl ? tpl.showServed : true,
    party: tpl ? tpl.showParty : true,
    batch: tpl ? tpl.showBatch : true,
    expiry: tpl ? tpl.showExpiry : true,
    imei: tpl ? tpl.showImei !== false : true,
    unit: tpl ? tpl.showUnit !== false : true,
    rate: tpl ? tpl.showRate !== false : true,
    paid: tpl ? tpl.showPaid !== false : true,
    style: (tpl && tpl.receiptStyle) || 'classic',
  };
}

/** "2 pcs × Sh 5,000", honouring the unit and rate switches. */
export function qtyText(l: { qty: number; unit?: string; price: number }, money: (n: number) => string, sh: ReturnType<typeof shows>, times = ' x '): string {
  return l.qty + (sh.unit && l.unit ? ' ' + l.unit : '') + (sh.rate ? times + money(l.price) : '');
}

const ESC = 0x1b, GS = 0x1d, LF = 0x0a;

export interface EscposOpts {
  paper?: Paper;
  tpl?: PrintTemplate;
  /** Kick the cash drawer wired to the printer. */
  openDrawer?: boolean;
  /** Text the template's QR code or barcode carries (docPrint's codeText). */
  codeText?: string;
}

/** Characters per line on the common thermal fonts. */
export const lineWidth = (paper?: Paper) => (paper === '58mm' ? 32 : 48);

/*
 * Receipt printers print a single-byte code page. Anything outside plain
 * ASCII is turned into its nearest plain form rather than printed as '?'.
 */
const SWAP: Record<string, string> = {
  '×': 'x', '−': '-', '–': '-', '—': '-', '·': '-', '•': '*', '…': '...',
  '‘': "'", '’': "'", '“': '"', '”': '"',
  ' ': ' ', ' ': ' ', ' ': ' ', '₹': 'Rs', '€': 'EUR', '£': 'GBP',
};
export function ascii(s: string): string {
  let out = '';
  for (const ch of String(s ?? '')) {
    if (SWAP[ch] !== undefined) { out += SWAP[ch]; continue; }
    const c = ch.charCodeAt(0);
    if (c >= 32 && c < 127) { out += ch; continue; }
    const plain = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out += /^[\x20-\x7e]+$/.test(plain) ? plain : '?';
  }
  return out;
}

/** Word-wraps to `w` columns; a word longer than a line is broken. */
export function wrap(text: string, w: number): string[] {
  const out: string[] = [];
  for (const para of ascii(text).split('\n')) {
    let line = '';
    for (let word of para.split(/\s+/).filter(Boolean)) {
      while (word.length > w) {
        if (line) { out.push(line); line = ''; }
        out.push(word.slice(0, w));
        word = word.slice(w);
      }
      if (!line) line = word;
      else if (line.length + 1 + word.length <= w) line += ' ' + word;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

/** Left text and right text on one line, the right one kept whole. */
export function lr(left: string, right: string, w: number): string[] {
  const r = ascii(right);
  const room = Math.max(1, w - r.length - 1);
  const lines = wrap(left, room);
  const last = lines.pop() || '';
  return [...lines, last + ' '.repeat(Math.max(1, w - last.length - r.length)) + r];
}

class Out {
  bytes: number[] = [];
  raw(...b: number[]) { this.bytes.push(...b); return this; }
  text(s: string) { for (const ch of ascii(s)) this.bytes.push(ch.charCodeAt(0) & 0xff); return this; }
  line(s = '') { return this.text(s).raw(LF); }
  lines(ls: string[]) { ls.forEach((l) => this.line(l)); return this; }
  align(a: 'left' | 'center' | 'right') { return this.raw(ESC, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2); }
  bold(on: boolean) { return this.raw(ESC, 0x45, on ? 1 : 0); }
  /** Character size: 1 = normal, 2 = double width and height. */
  size(n: 1 | 2) { return this.raw(GS, 0x21, n === 2 ? 0x11 : 0x00); }
  rule(w: number, ch = '-') { return this.line(ch.repeat(w)); }
  feed(n: number) { return this.raw(ESC, 0x64, n); }

  qr(data: string, moduleSize: number) {
    const d = Array.from(ascii(data)).map((c) => c.charCodeAt(0) & 0xff).slice(0, 700);
    const len = d.length + 3;
    return this
      .raw(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00) // model 2
      .raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, moduleSize) // module size
      .raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31) // error correction M
      .raw(GS, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30, ...d) // store
      .raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30); // print
  }

  barcode(data: string, narrow: boolean) {
    const d = Array.from(ascii(data).slice(0, 40)).map((c) => c.charCodeAt(0));
    return this
      .raw(GS, 0x68, narrow ? 60 : 80) // height
      .raw(GS, 0x77, narrow ? 1 : 2) // module width
      .raw(GS, 0x48, 0) // no human-readable line: the caption is printed apart
      .raw(GS, 0x6b, 73, d.length + 2, 0x7b, 0x42, ...d); // CODE128, code set B
  }
}

/** One receipt, ready to send to a thermal printer. */
export function escposDoc(doc: DocMeta, money: (n: number) => string, opts: EscposOpts = {}): Uint8Array {
  const tpl = opts.tpl;
  // the template's own title, when it has one, replaces the document's name
  const d: DocMeta = tpl?.title?.trim() ? { ...doc, kind: tpl.title.trim() } : doc;
  const sh = shows(tpl);
  const compact = sh.style === 'compact';
  const detailed = sh.style === 'detailed';
  const boldStyle = sh.style === 'bold';
  const narrow = opts.paper === '58mm';
  const w = lineWidth(opts.paper);
  const showTax = sh.tax;
  const showServed = sh.served && !compact;
  const showParty = sh.party;
  const showBatch = sh.batch;
  const showExpiry = sh.expiry;
  const tight = tpl?.density === 'tight' || compact;
  const head = (tpl?.head || '').trim();
  const foot = (tpl?.foot || '').trim();
  const copies = Math.max(1, Math.min(5, tpl?.copies || 1));
  const date = new Date(d.ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const partyLabel = /purchase/i.test(d.kind) ? 'Supplier' : 'Customer';
  const gap = (o: Out) => { if (!tight) o.line(); };

  const o = new Out();
  o.raw(ESC, 0x40); // reset
  for (let copy = 0; copy < copies; copy++) {
    // the shop
    o.align('center').bold(true).size(narrow ? 1 : 2).lines(wrap(d.firmName, narrow ? w : Math.floor(w / 2))).size(1).bold(false);
    (compact ? [d.firmPhone] : [d.firmDescription, d.firmAddress, d.firmPhone, d.firmWhatsapp ? 'WhatsApp ' + d.firmWhatsapp : '', d.firmEmail, d.firmTin ? 'TIN ' + d.firmTin : ''])
      .filter(Boolean).forEach((x) => o.lines(wrap(String(x), w)));
    if (head && !compact) o.lines(wrap(head, w));
    gap(o);
    o.bold(true).line(d.kind.toUpperCase()).bold(false);
    o.align('left').rule(w);

    // what this bill is
    o.lines(lr('Number', d.no, w)).lines(lr('Date', date, w));
    if (showParty && d.partyName) o.lines(lr(partyLabel, d.partyName, w));
    if (showParty && d.partyPhone) o.lines(lr('Phone', d.partyPhone, w));
    if (d.method && !compact) o.lines(lr('Paid by', d.method, w));
    if (showServed && d.servedBy) o.lines(lr('Served by', d.servedBy, w));
    o.rule(w);

    // the items
    d.lines.forEach((l: DocLine) => {
      if (compact) o.lines(lr(l.qty + ' ' + l.name, money(l.qty * l.price), w));
      else {
        o.lines(wrap(l.name, w));
        o.lines(lr('  ' + qtyText(l, money, sh), money(l.qty * l.price), w));
      }
      if (sh.imei) imeiTexts(l.serials).forEach((t) => o.lines(wrap('  ' + t, w)));
      const b = showBatch && l.batchNo ? 'Batch ' + l.batchNo : '';
      const e = showExpiry && l.expiry ? 'Exp ' + new Date(l.expiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
      if (b || e) o.lines(wrap('  ' + [b, e].filter(Boolean).join(' - '), w));
    });
    if (detailed) o.lines(lr('Items: ' + d.lines.length, 'Qty: ' + d.lines.reduce((a, l) => a + l.qty, 0), w));
    o.rule(w);

    // the money
    o.lines(lr('Subtotal', money(d.subtotal), w));
    if (d.discount) o.lines(lr('Discount', '-' + money(d.discount), w));
    if (d.charges) o.lines(lr('Additional charges', money(d.charges), w));
    if (d.tax && showTax) o.lines(lr(d.taxLabel || 'Tax', money(d.tax), w));
    o.bold(true);
    if (boldStyle) o.rule(w, '=').align('center').size(2).line('TOTAL').lines(wrap(money(d.total), Math.floor(w / 2))).size(1).align('left').rule(w, '=');
    else if (narrow) o.lines(lr('TOTAL', money(d.total), w));
    else o.size(2).lines(lr('TOTAL', money(d.total), Math.floor(w / 2))).size(1);
    o.bold(false);
    if (sh.paid && d.paid !== undefined) o.lines(lr('Paid', money(d.paid), w));
    if (sh.paid && d.paid !== undefined && d.paid > d.total) o.lines(lr('Change', money(d.paid - d.total), w));
    if (d.due) o.bold(true).lines(lr('Balance due', money(d.due), w)).bold(false);

    // the end
    if (d.note) { gap(o); o.lines(wrap('Note: ' + d.note, w)); }
    if (d.terms) { gap(o); o.lines(wrap('Terms: ' + d.terms, w)); }
    if (tpl && tpl.code !== 'none' && opts.codeText) {
      gap(o);
      o.align('center');
      if (tpl.code === 'barcode' || tpl.code === 'both') {
        o.barcode(tpl.codeData === 'no' ? d.no : opts.codeText.split('\n')[0], narrow).line();
        if (tpl.codeCaption) o.line(d.no);
      }
      if (tpl.code === 'qr' || tpl.code === 'both') {
        o.qr(opts.codeText, narrow ? 4 : 6).line();
        if (tpl.codeCaption) o.line('Scan to check this ' + d.kind.toLowerCase());
      }
    }
    gap(o);
    o.align('center').lines(wrap(foot || d.footer || 'Thank you for your business', w)).align('left');
    o.feed(4).raw(GS, 0x56, 0x42, 0x00); // feed past the cutter, then cut
  }
  if (opts.openDrawer) o.raw(ESC, 0x70, 0x00, 0x19, 0xfa); // pulse the drawer
  return Uint8Array.from(o.bytes);
}
