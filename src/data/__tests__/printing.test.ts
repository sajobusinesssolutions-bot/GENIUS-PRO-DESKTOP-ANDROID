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
    const uri = typeof a === 'string' ? a : (b || 'file:///tmp/generated.pdf');
    const file = {
      base64: async () => (uri.includes('missing') ? Promise.reject(new Error('gone')) : 'QUJD'),
      exists: false,
      delete: jest.fn(),
      move: jest.fn(function (dest: any) { this.uri = dest?.uri || dest || uri; return this; }),
      contentUri: uri.replace('file://', 'content://'),
      uri,
    };
    return file;
  }),
  Paths: { cache: { uri: 'file:///cache' }, document: { uri: 'file:///document' } },
}));

import { docHtml, qrSvg, inlineImage, pageSize, DocMeta } from '../docPrint';
import { printOptsFor, docKindOf, paperOf } from '../printSetup';
import { defaultTemplates, defaultTemplateFor } from '../defaults';
import { tagHtml } from '../../screens/PriceTagScreen';
import { preview, reportShareMessage, shareTo } from '../exporters';
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
});
