/**
 * What goes to the printer.
 *
 * Three things never worked: the logo and signature (file paths the print view
 * cannot load), the barcode (drawn with background colours, which printers
 * drop), and the templates — paper, QR, copies — which were saved and ignored.
 */
jest.mock('expo-print', () => ({
  printAsync: jest.fn(),
  printToFileAsync: jest.fn().mockResolvedValue({ uri: 'file:///tmp/report.pdf' }),
  selectPrinterAsync: jest.fn(),
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('expo-intent-launcher', () => ({ startActivityAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation((a: any, b?: string) => {
    // new File(uri) and new File(directory, name) both happen in real code
    // (docPrint.ts and exporters.ts both move a printed PDF into Paths.cache
    // this way) — the mock needs to join the two, not just fall back to a
    // fixed placeholder, or a moved file's URI never actually reflects its
    // new name and every content:// assertion downstream is trivially wrong.
    const uri = typeof a === 'string' ? a : ((a?.uri || 'file:///tmp') + '/' + (b || 'generated.pdf'));
    // tracks what is on "disk", so a path returned before its file exists is caught
    const disk: Map<string, number> = (global as any).__mockDisk || ((global as any).__mockDisk = new Map());
    const file = {
      base64: async () => (uri.includes('missing') ? Promise.reject(new Error('gone')) : 'QUJD'),
      get exists() { return disk.has(uri); },
      get size() { return disk.get(uri) ?? null; },
      delete: jest.fn(() => { disk.delete(uri); }),
      create: jest.fn(() => { disk.set(uri, 0); }),
      write: jest.fn((content: string) => { disk.set(uri, String(content).length); }),
      // async on SDK 57, like the real one
      move: jest.fn(async (dest: any) => { disk.set(dest.uri, disk.get(uri) ?? 100); disk.delete(uri); }),
      contentUri: uri.replace('file://', 'content://'),
      uri,
    };
    return file;
  }),
  Paths: { cache: { uri: 'file:///cache' }, document: { uri: 'file:///document' } },
}));

import { docHtml, qrSvg, inlineImage, pageSize, numberToWords, DocMeta } from '../docPrint';
import { printOptsFor, docKindOf, paperOf } from '../printSetup';
import { defaultTemplates, defaultTemplateFor } from '../defaults';
import { tagHtml } from '../../screens/PriceTagScreen';
import { preview, reportShareMessage, shareTo, toPdf } from '../exporters';
import * as Print from 'expo-print';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';

const money = (n: number) => 'UGX ' + n;
const doc: DocMeta = {
  kind: 'Tax Invoice', no: 'INV-00042', ts: '2026-09-19T10:00:00Z', firmName: 'Amar Shop',
  lines: [{ name: 'Sugar 1kg', qty: 2, price: 5000, unit: 'pcs' }],
  subtotal: 10000, total: 10000, paid: 10000,
};
const tpl = (over: any = {}) => ({ ...defaultTemplates()[0], ...over });

describe('paper', () => {
  it('lays a roll out at the width of the roll', () => {
    expect(docHtml(doc, money, { paper: '58mm' })).toContain('size: 58mm auto');
    expect(docHtml(doc, money, { paper: '80mm' })).toContain('size: 80mm auto');
  });

  it('gives A4 a real invoice layout, with columns', () => {
    const html = docHtml(doc, money, { paper: 'A4' });
    expect(html).toContain('size: A4');
    expect(html).toContain('<th class="r">Qty</th>');
  });

  it('makes a roll page as long as the receipt, and A4 the size of A4', () => {
    expect(pageSize('A4')).toEqual({ width: 595, height: 842 });
    expect(pageSize('80mm', 30).height).toBeGreaterThan(pageSize('80mm', 3).height);
    expect(pageSize('58mm').width).toBeLessThan(pageSize('80mm').width);
  });
});

describe('codes', () => {
  it('prints the template barcode as SVG, not background colours', () => {
    const html = docHtml(doc, money, { paper: '80mm', tpl: tpl({ code: 'barcode' }) });
    expect(html).toContain('<rect');
    expect(html).not.toContain('background:#000');
  });

  it('prints a QR code when the template asks for one', () => {
    const html = docHtml(doc, money, { paper: 'A4', tpl: tpl({ code: 'qr', codeData: 'verify' }) });
    expect(html).toContain('Scan to check this tax invoice');
    expect(qrSvg('INV-00042')).toMatch(/^<svg[\s\S]*<rect/);
  });

  it('prints no code when the template says none', () => {
    const html = docHtml(doc, money, { paper: '80mm', tpl: tpl({ code: 'none' }) });
    expect(html).not.toContain('<rect');
  });
});

describe('the template', () => {
  it('prints as many copies as it says', () => {
    const html = docHtml(doc, money, { paper: '80mm', tpl: tpl({ copies: 3 }) });
    expect(html.split('<section').length - 1).toBe(3);
  });

  it('leaves the logo off when the template does', () => {
    const d = { ...doc, logo: 'data:image/png;base64,AAA' };
    expect(docHtml(d, money, { paper: '80mm', tpl: tpl({ showLogo: false }) })).not.toContain('AAA');
    expect(docHtml(d, money, { paper: '80mm', tpl: tpl({ showLogo: true }) })).toContain('AAA');
  });
});

describe('batch, expiry and salesperson', () => {
  // These three used to be settings-screen decoration: the toggle changed
  // the preview on the Templates pane but docHtml() — what actually reaches
  // the printer — never looked at any of them, so switching one off changed
  // nothing about the printed page.
  const withBatch: DocMeta = { ...doc, lines: [{ ...doc.lines[0], batchNo: 'B12', expiry: '2027-06-01' }] };

  it('shows the batch number only when the template says to', () => {
    expect(docHtml(withBatch, money, { paper: '80mm', tpl: tpl({ showBatch: true, showExpiry: false }) })).toContain('Batch B12');
    expect(docHtml(withBatch, money, { paper: '80mm', tpl: tpl({ showBatch: false, showExpiry: false }) })).not.toContain('Batch B12');
  });

  it('shows the expiry date only when the template says to, independently of batch', () => {
    const html = docHtml(withBatch, money, { paper: '80mm', tpl: tpl({ showBatch: false, showExpiry: true }) });
    expect(html).not.toContain('Batch B12');
    expect(html).toContain('Exp');
  });

  it('prints nothing extra under the line when neither is on, even if the sale carries them', () => {
    const html = docHtml(withBatch, money, { paper: '80mm', tpl: tpl({ showBatch: false, showExpiry: false }) });
    expect(html).not.toContain('Batch');
    expect(html).not.toContain('Exp ');
  });

  it('names the salesperson only when the template says to', () => {
    const served: DocMeta = { ...doc, servedBy: 'Amina' };
    const on = docHtml(served, money, { paper: '80mm', tpl: tpl({ showServed: true }) });
    expect(on).toContain('Served by');
    expect(on).toContain('Amina');
    expect(docHtml(served, money, { paper: '80mm', tpl: tpl({ showServed: false }) })).not.toContain('Amina');
  });
});

describe('numberToWords — the classic invoice\'s "amount in words" line', () => {
  it('spells out a plain number', () => {
    expect(numberToWords(42)).toBe('Forty-Two');
    expect(numberToWords(7)).toBe('Seven');
  });

  it('handles the teens, which do not follow the tens-and-ones pattern', () => {
    expect(numberToWords(13)).toBe('Thirteen');
    expect(numberToWords(19)).toBe('Nineteen');
  });

  it('handles hundreds and thousands together', () => {
    expect(numberToWords(185600)).toBe('One Hundred Eighty-Five Thousand Six Hundred');
  });

  it('skips a zero chunk rather than saying "Zero Thousand"', () => {
    expect(numberToWords(1000000)).toBe('One Million');
    expect(numberToWords(1000050)).toBe('One Million Fifty');
  });

  it('is zero for zero, and rounds a fractional amount to the nearest whole unit', () => {
    expect(numberToWords(0)).toBe('Zero');
    expect(numberToWords(99.6)).toBe('One Hundred');
  });
});

describe('A4 invoice layouts', () => {
  const full: DocMeta = {
    ...doc, tax: 1800, currencyName: 'Ugandan shilling', firmTin: '0125178M', partyName: 'Taylor & Company',
    partyAddress: 'P.O. Box 45865', method: 'Cash', firmWebsite: 'www.amar.shop', firmBank: 'Stanbic · 9030001234',
    firmDescription: 'Hardware and paint',
  };
  const a4 = (over: any, d: DocMeta = full) => docHtml(d, money, { paper: 'A4', tpl: tpl({ paper: 'A4', ...over }) });

  it('Tally: ruled ledger with reference boxes, amount in words, declaration and signatory', () => {
    const html = a4({ style: 'tally' });
    expect(html).toContain('class="tally"');
    for (const s of ['Invoice No.', 'Delivery Note', 'Mode/Terms of Payment', "Supplier's Ref.", "Buyer's Order No.",
      'Despatched through', 'Terms of Delivery', 'Description of Goods', 'Amount Chargeable (in words)',
      'Ugandan shilling Ten Thousand Only', 'E. &amp; O.E', 'Declaration', 'Authorised Signatory', 'This is a Computer Generated']) {
      expect(html).toContain(s);
    }
    expect(html).toContain("Company's TIN No.");
    expect(html).toContain('Taylor &amp; Company');
  });

  it('QuickBooks: bar, Bill to / Ship to / Details band, customer message beside the totals', () => {
    const html = a4({ style: 'quickbooks', accentColor: '#2CA01C' });
    expect(html).toContain('class="qb"');
    expect(html).toContain('--accent:#2CA01C');
    for (const s of ['Bill to', 'Ship to', 'Details', 'Product/service', 'Customer message', 'Subtotal', 'www.amar.shop']) {
      expect(html).toContain(s);
    }
  });

  it('GST: letterhead band, tax invoice panels, tax summary, bank details and both signatures', () => {
    const html = a4({ style: 'gst', showTax: true });
    expect(html).toContain('class="gst"');
    for (const s of ['AMAR SHOP', 'Hardware and paint', 'ORIGINAL FOR RECIPIENT', 'Customer Detail', 'M/S',
      'Name of Product / Service', 'Total in words', 'Taxable Value', 'Total Tax in words', 'Bank Details',
      'Stanbic · 9030001234', 'Terms and Conditions', 'Customer Signature', 'Authorised Signatory']) {
      expect(html).toContain(s);
    }
  });

  it('older templates keep their look: boxed means Tally, an accent colour means QuickBooks', () => {
    expect(a4({ boxed: true })).toContain('class="tally"');
    expect(a4({ accentColor: '#1DA362' })).toContain('class="qb"');
    expect(a4({ boxed: false })).toContain('class="plain"');
    expect(a4({ boxed: true, accentColor: '#1DA362' })).toContain('class="tally"');
  });

  it('names the tax line with the shop\'s own tax name', () => {
    expect(a4({ style: 'tally', showTax: true }, { ...full, taxLabel: 'VAT' })).toContain('<b>VAT</b>');
  });

  it('never draws an A4 layout on thermal paper', () => {
    const html = docHtml(full, money, { paper: '80mm', tpl: tpl({ style: 'gst', boxed: true, accentColor: '#1DA362' }) });
    expect(html).not.toMatch(/class="(tally|qb|gst)"/);
  });

  describe('batch and expiry', () => {
    const dated: DocMeta = {
      ...full,
      lines: [
        { name: 'Amoxicillin', qty: 2, price: 5000, unit: 'box', batchNo: 'B-102', expiry: '2027-03-31' },
        { name: 'Gloves', qty: 1, price: 3000, unit: 'box' },
      ],
    };
    for (const style of ['plain', 'tally', 'quickbooks', 'gst']) {
      it(style + ': each gets its own column, not a line under the item name', () => {
        const html = a4({ style, showBatch: true, showExpiry: true }, dated);
        expect(html).toContain('<th class="c">Batch</th>');
        expect(html).toContain('<th class="c">Expiry</th>');
        expect(html).toContain('<td class="c">B-102</td>');
        expect(html).toContain('<td class="c">31-Mar-2027</td>');
        expect(html).not.toContain('Batch B-102');
      });
    }

    it('drops a column that is switched off, or that no line has anything for', () => {
      expect(a4({ style: 'tally', showBatch: false, showExpiry: true }, dated)).not.toContain('>Batch</th>');
      expect(a4({ style: 'tally', showBatch: true, showExpiry: true }, doc)).not.toContain('>Batch</th>');
    });
  });
});

describe('what Receipt and Invoice settings put on paper', () => {
  it('calls the tax line by the shop\'s own tax name', () => {
    const d = { ...doc, tax: 1800, taxLabel: 'GST' };
    expect(docHtml(d, money, { paper: '80mm', tpl: tpl() })).toContain('>GST<');
    expect(docHtml(d, money, { paper: 'A4', tpl: tpl({ paper: 'A4', boxed: true }) })).toContain('>GST<');
  });

  it('prints the WhatsApp number under the shop name', () => {
    expect(docHtml({ ...doc, firmWhatsapp: '0777 123456' }, money, { paper: '80mm', tpl: tpl() })).toContain('WhatsApp 0777 123456');
  });

  it('prints the template footer in place of the default thank-you, not as well as it', () => {
    const html = docHtml({ ...doc, footer: 'Shop footer' }, money, { paper: '80mm', tpl: tpl({ foot: 'No returns\nafter 7 days' }) });
    expect(html).toContain('No returns<br/>after 7 days');
    expect(html).not.toContain('Shop footer');
    expect(docHtml({ ...doc, footer: 'Shop footer' }, money, { paper: '80mm', tpl: tpl({ foot: '' }) })).toContain('Shop footer');
  });
});

describe('pictures', () => {
  it('embeds a picture from the phone, since the print view cannot open file paths', async () => {
    expect(await inlineImage('file:///doc/logo.png')).toBe('data:image/png;base64,QUJD');
    expect(await inlineImage('file:///doc/sign.jpg')).toBe('data:image/jpeg;base64,QUJD');
  });

  it('leaves out a picture that cannot be read, rather than failing the print', async () => {
    expect(await inlineImage('file:///missing.png')).toBeUndefined();
    expect(await inlineImage(undefined)).toBeUndefined();
  });
});

describe('which printer, which template', () => {
  const db: any = {
    templates: defaultTemplates(),
    templateFor: defaultTemplateFor(),
    printer: { copies: 2 },
    printers: [
      { id: 'a', name: 'Till', kind: 'bluetooth', width: '58mm', dflt: true },
      { id: 'b', name: 'PDF', kind: 'pdf', width: '80mm', dflt: false },
    ],
  };

  it('takes the paper from the printer it is going to', () => {
    expect(printOptsFor(db, 'invoice').paper).toBe('58mm');
    expect(printOptsFor(db, 'invoice', db.printers[1]).paper).toBe('A4');
    expect(paperOf(undefined, 'A4')).toBe('A4');
  });

  it('uses the shop\'s copies per bill', () => {
    expect(printOptsFor(db, 'receipt').tpl?.copies).toBe(2);
  });

  it('finds the template from the document title', () => {
    expect(docKindOf('Purchase Bill')).toBe('purchase');
    expect(docKindOf('Receipt')).toBe('receipt');
    expect(docKindOf('Tax Invoice')).toBe('invoice');
    expect(docKindOf('Quotation')).toBe('estimate');
  });
});

describe('price tags', () => {
  const style: any = {
    shopName: true, name: true, sku: true, category: false, price: true, barcode: true, unit: false,
    priceSize: 'medium', barcodeSize: 'medium', perRow: 3,
  };
  const p: any = { id: 'p1', name: 'Tin', sku: 'TIN-1', price: 3000, unit: 'pcs', barcodes: ['6001234567890'] };

  it('prints as many tags as asked for each item', () => {
    const html = tagHtml([{ p, n: 4 }], style, 'Shop', money, 'A4');
    expect(html.split('class="tag"').length - 1).toBe(4);
  });

  it('puts one tag per label on a roll, and a grid on A4', () => {
    expect(tagHtml([{ p, n: 1 }], style, 'Shop', money, '58mm')).toContain('size: 58mm auto');
    expect(tagHtml([{ p, n: 1 }], style, 'Shop', money, 'A4')).toContain('width:31.5%');
  });

  it('uses the item\'s own barcode when it has one', () => {
    expect(tagHtml([{ p, n: 1 }], style, 'Shop', money, 'A4')).toContain('6001234567890');
  });
});

describe('report PDF — where the file actually ends up', () => {
  // Print.printToFileAsync() writes into expo-print's own cache directory,
  // and on Android a share intent is not always allowed to read a file
  // there — Sharing.shareAsync() rejected it outright with "Not allowed to
  // read file under given URL" when toPdf() handed that URI straight over.
  // docPrint.ts's shareDoc() already solved this for documents by moving
  // the file into this app's own File-API cache directory first; toPdf()
  // never got the same treatment.
  const rep = { title: 'Daily sales', cols: [{ h: 'Date' }], rows: [['2026-09-10']] };

  it('moves the printed file into this app\'s own cache directory rather than handing over the print engine\'s own path', async () => {
    const uri = await toPdf(rep);
    expect(uri).toContain('file:///cache/');
    expect(uri).not.toBe('file:///tmp/report.pdf'); // the raw path Print.printToFileAsync returned
  });

  it('names the moved file after the report, not the print engine\'s random name', async () => {
    const uri = await toPdf(rep);
    expect(uri).toMatch(/daily-sales-\d{8}-\d{4}\.pdf$/);
  });

  it('writes the PDF bytes into its own cache file, never touching the print engine\'s path ("Missing READ permission")', async () => {
    const fs = require('expo-file-system');
    (Print.printToFileAsync as jest.Mock).mockResolvedValueOnce({ uri: 'file:///print/x.pdf', base64: 'JVBERi0=' });
    fs.File.mockClear();
    const uri = await toPdf(rep);
    expect(uri).toMatch(/^file:\/\/\/cache\/daily-sales-.*\.pdf$/);
    expect(Print.printToFileAsync).toHaveBeenLastCalledWith(expect.objectContaining({ base64: true }));
    const made = fs.File.mock.results.map((r: any) => r.value);
    expect(made.find((f: any) => f.uri.startsWith('file:///cache/')).write).toHaveBeenCalledWith('JVBERi0=', { encoding: 'base64' });
    expect(made.some((f: any) => f.uri === 'file:///print/x.pdf')).toBe(false);
  });

  it('falls back to the print engine\'s own path rather than losing the file if the move fails', async () => {
    const fs = require('expo-file-system');
    const original = fs.File;
    fs.File = jest.fn().mockImplementation(() => ({
      exists: false,
      move: () => { throw new Error('Not allowed to read file under given URL'); },
    }));
    try {
      const uri = await toPdf(rep);
      expect(uri).toBe('file:///tmp/report.pdf');
    } finally {
      fs.File = original;
    }
  });

  // move() is async on SDK 57. Not awaiting it returned the cache path before
  // the file was there, so the chosen app received nothing to attach — and its
  // "Missing READ permission" rejection went uncaught.
  it('waits for the move and only hands over a path once the file is really there', async () => {
    const disk: Map<string, number> = (global as any).__mockDisk;
    disk.set('file:///tmp/report.pdf', 5000);
    const fs = require('expo-file-system');
    const real = fs.File.getMockImplementation();
    fs.File.mockImplementation((a: any, b?: string) => {
      const f = real(a, b);
      f.move = jest.fn((dest: any) => new Promise<void>((resolve) => setTimeout(() => {
        disk.set(dest.uri, 5000); resolve();
      }, 5)));
      return f;
    });
    try {
      const uri = await toPdf(rep);
      expect(uri).toMatch(/^file:\/\/\/cache\/daily-sales-/);
      expect(disk.get(uri)).toBe(5000);
    } finally {
      fs.File.mockImplementation(real);
    }
  });

  it('catches an async move rejection and keeps the original file instead of an empty path', async () => {
    const fs = require('expo-file-system');
    const real = fs.File.getMockImplementation();
    fs.File.mockImplementation((a: any, b?: string) => {
      const f = real(a, b);
      f.move = jest.fn(() => Promise.reject(new Error("Missing 'READ' permission for accessing the file.")));
      return f;
    });
    try {
      expect(await toPdf(rep)).toBe('file:///tmp/report.pdf');
    } finally {
      fs.File.mockImplementation(real);
    }
  });
});

describe('report PDF — layout, columns and file name', () => {
  const { pickColumns, toHtml: html, fileNameFor: nameFor } = require('../exporters');
  const rep = {
    title: 'Sale Report',
    cols: [{ h: 'Date' }, { h: 'Ref No.' }, { h: 'Party Name' }, { h: 'Total Amount', r: true }],
    rows: [['16/09/2026', '111', 'TURYATUNGA EMMANUEL', 'Sh 271,000']],
    foot: ['Total', '', '', 'Sh 271,000'],
    stats: [{ k: 'Total Sale', v: 'Sh 5,420,990' }],
  };
  const meta = {
    firm: 'Saljoe Tech', firmAddress: 'Kichuleta, Fortportal', firmPhone: '0753201462', firmEmail: 'x@y.com',
    from: new Date(2026, 8, 1).getTime(), to: new Date(2026, 8, 30, 23, 59).getTime(),
  };

  it('prints the business, underlined title, username, duration and firm like the reference', () => {
    const out = html(rep, meta);
    expect(out).toContain('SALJOE TECH');
    expect(out).toContain('Address: Kichuleta, Fortportal, Ph. no.: 0753201462, Email: x@y.com');
    expect(out).toContain('text-decoration: underline');
    expect(out).toContain('Username: All Users');
    expect(out).toContain('Duration: From 01/09/2026 to 30/09/2026');
    expect(out).toContain('Firm: Saljoe Tech');
    expect(out).toContain('Total Sale: Sh 5,420,990');
    expect(out).toContain('Generated on');
  });

  it('leaves out the date stamp and the totals when unticked', () => {
    const out = html(rep, { ...meta, showGenerated: false, showTotals: false });
    expect(out).not.toContain('Generated on');
    expect(out).not.toContain('Total Sale:');
    expect(out).not.toContain('<tfoot>');
  });

  it('keeps only the ticked columns, in rows and totals alike', () => {
    const cut = pickColumns(rep, [true, false, true, true]);
    expect(cut.cols.map((c: any) => c.h)).toEqual(['Date', 'Party Name', 'Total Amount']);
    expect(cut.rows[0]).toEqual(['16/09/2026', 'TURYATUNGA EMMANUEL', 'Sh 271,000']);
    expect(cut.foot).toEqual(['Total', '', 'Sh 271,000']);
    expect(html(cut, meta)).not.toContain('Ref No.');
  });

  it('keeps every column when nothing, or everything, is ticked', () => {
    expect(pickColumns(rep, [false, false, false, false])).toBe(rep);
    expect(pickColumns(rep, [true, true, true, true])).toBe(rep);
  });

  it('names the file after the report and its period, or what the person typed', () => {
    expect(nameFor(rep, 'pdf', meta)).toBe('Sale_Report_01-09-2026_to_30-09-2026.pdf');
    expect(nameFor(rep, 'xlsx', { ...meta, fileName: 'September sales' })).toBe('September_sales.xlsx');
    expect(nameFor(rep, 'pdf', { ...meta, fileName: 'bad/name?.pdf' })).toBe('bad_name_.pdf');
  });
});

describe('report export', () => {
  it('opens a native A4 preview when asked for print preview', async () => {
    const spy = jest.spyOn(Print, 'printAsync');
    await preview({
      title: 'Daily sales',
      cols: [{ h: 'Date' }, { h: 'Total' }],
      rows: [['2026-09-10', 1200]],
      foot: ['Total', 1200],
    }, { firm: 'Amar Shop', range: 'Last 30 days' });

    expect(spy).toHaveBeenCalledWith({ html: expect.stringContaining('Daily sales'), width: 595, height: 842 });
  });

  it('uses the share sheet for WhatsApp PDF exports instead of an unsupported Android send intent', async () => {
    const prev = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    const intentSpy = jest.spyOn(IntentLauncher, 'startActivityAsync').mockResolvedValue(undefined as any);
    const shareSpy = jest.spyOn(require('expo-sharing'), 'shareAsync').mockResolvedValue(undefined as any);
    try {
      const result = {
        title: 'Daily sales',
        cols: [{ h: 'Date' }, { h: 'Total' }],
        rows: [['2026-09-10', 1200]],
        foot: ['Total', 1200],
        stats: [{ k: 'Cash', v: 'UGX 1,200' }],
      };

      const text = reportShareMessage(result, { firm: 'Amar Shop', range: 'Last 30 days' });
      expect(text).toContain('Hello,');
      expect(text).toContain('Document amount/total: 1200');
      expect(text).toContain('Regards,');

      const outcome = await shareTo(result, 'whatsapp', { firm: 'Amar Shop', range: 'Last 30 days' });
      expect(outcome.ok).toBe(true);
      expect(intentSpy).not.toHaveBeenCalled();
      expect(shareSpy).toHaveBeenCalledWith(expect.stringMatching(/.*\.pdf$/), expect.objectContaining({ mimeType: 'application/pdf' }));
    } finally {
      Object.defineProperty(Platform, 'OS', { value: prev, configurable: true });
      jest.restoreAllMocks();
    }
  });

  it('falls back to an Android content-URI send when the share sheet rejects the PDF', async () => {
    const prev = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    const intentSpy = jest.spyOn(IntentLauncher, 'startActivityAsync').mockResolvedValue(undefined as any);
    const sharing = require('expo-sharing');
    jest.spyOn(sharing, 'isAvailableAsync').mockResolvedValue(true);
    jest.spyOn(sharing, 'shareAsync').mockRejectedValue(new Error('No app can handle this file'));
    try {
      const outcome = await shareTo({
        title: 'Daily sales',
        cols: [{ h: 'Date' }],
        rows: [['2026-09-10']],
      }, 'whatsapp', { firm: 'Amar Shop' });
      expect(outcome.ok).toBe(true);
      expect(intentSpy).toHaveBeenCalledWith('android.intent.action.SEND', expect.objectContaining({
        type: 'application/pdf',
        extra: expect.objectContaining({
          'android.intent.extra.STREAM': expect.stringContaining('content://'),
          'android.intent.extra.TEXT': expect.stringContaining('Hello,'),
        }),
      }));
    } finally {
      Object.defineProperty(Platform, 'OS', { value: prev, configurable: true });
      jest.restoreAllMocks();
    }
  });

  it('carries the real reason the share sheet failed, instead of just "saved instead"', async () => {
    // Not Android, so there is no content-URI fallback to try — this pins
    // down that a genuine failure reports why, rather than silently landing
    // on "no app accepted it" with the real cause thrown away.
    const prev = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const sharing = require('expo-sharing');
    jest.spyOn(sharing, 'isAvailableAsync').mockResolvedValue(true);
    jest.spyOn(sharing, 'shareAsync').mockRejectedValue(new Error('Exposed beyond app'));
    try {
      const outcome = await shareTo({
        title: 'Daily sales',
        cols: [{ h: 'Date' }],
        rows: [['2026-09-10']],
      }, 'whatsapp', { firm: 'Amar Shop' });
      expect(outcome.ok).toBe(false);
      expect(outcome.reason).toBe('Exposed beyond app');
    } finally {
      Object.defineProperty(Platform, 'OS', { value: prev, configurable: true });
      jest.restoreAllMocks();
    }
  });
});
