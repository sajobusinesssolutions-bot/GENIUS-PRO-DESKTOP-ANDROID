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
    const file = {
      base64: async () => (uri.includes('missing') ? Promise.reject(new Error('gone')) : 'QUJD'),
      exists: false,
      delete: jest.fn(),
      create: jest.fn(),
      write: jest.fn(),
      move: jest.fn(function (dest: any) { this.uri = dest?.uri || dest || uri; return this; }),
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

describe('the classic boxed ledger invoice (Tally / GST style)', () => {
  const withTax: DocMeta = { ...doc, tax: 1800, currencyName: 'Ugandan shilling', firmTin: '0125178M' };

  it('is a genuinely different layout, not the plain A4 doc with borders added', () => {
    const html = docHtml(withTax, money, { paper: 'A4', tpl: tpl({ paper: 'A4', boxed: true }) });
    expect(html).toContain('class="doc a4 classic"');
    expect(html).toContain('Sl No.');
    expect(html).toContain('Description of Goods');
    expect(html).toContain('Amount Chargeable (in words)');
    expect(html).toContain('Declaration');
    expect(html).toContain('Authorised Signatory');
    expect(html).toContain('This is a Computer Generated');
  });

  it('spells the total out in words, in the shop\'s own currency name', () => {
    const html = docHtml(withTax, money, { paper: 'A4', tpl: tpl({ paper: 'A4', boxed: true }) });
    expect(html).toContain('Ugandan shilling Ten Thousand Only');
  });

  it('names the tax line "VAT" and shows the TIN, matching the reference invoices', () => {
    const html = docHtml(withTax, money, { paper: 'A4', tpl: tpl({ paper: 'A4', boxed: true, showTax: true }) });
    expect(html).toContain('VAT');
    expect(html).toContain("Company's TIN : 0125178M");
  });

  it('leaves A4 as the plain airy layout by default', () => {
    const html = docHtml(doc, money, { paper: 'A4', tpl: tpl({ paper: 'A4', boxed: false }) });
    expect(html).toContain('class="doc a4"');
    expect(html).not.toContain('class="doc a4 classic"');
  });
});

describe('the modern accent-coloured invoice (QuickBooks style)', () => {
  it('is a genuinely different layout, with the bar, a boxed grey panel and a clean table', () => {
    const html = docHtml(doc, money, { paper: 'A4', tpl: tpl({ paper: 'A4', accentColor: '#1DA362' }) });
    expect(html).toContain('class="doc a4 modern"');
    expect(html).toContain('--accent: #1DA362');
    expect(html).toContain('<div class="bar"></div>');
    expect(html).toContain('table class="mgrid"');
    expect(html).toContain('Product/service');
  });

  it('shows who the bill is to inside the grey panel', () => {
    const withParty: DocMeta = { ...doc, partyName: 'Taylor & Company' };
    const html = docHtml(withParty, money, { paper: 'A4', tpl: tpl({ paper: 'A4', accentColor: '#1DA362', showParty: true }) });
    expect(html).toContain('Taylor &amp; Company');
  });
});

describe('choosing between the three A4 looks', () => {
  it('never draws the classic grid or the accent bar on thermal paper, whatever the template says', () => {
    const html = docHtml(doc, money, { paper: '80mm', tpl: tpl({ paper: 'A4', boxed: true, accentColor: '#1DA362' }) });
    expect(html).not.toContain('classic');
    expect(html).not.toContain('class="bar"');
  });

  it('prefers the classic grid over the accent look when a template somehow sets both', () => {
    const html = docHtml(doc, money, { paper: 'A4', tpl: tpl({ paper: 'A4', boxed: true, accentColor: '#1DA362' }) });
    expect(html).toContain('class="doc a4 classic"');
    expect(html).not.toContain('class="doc a4 modern"');
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
