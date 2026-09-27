/**
 * The printing screens: a hub that connects a printer and prints a real test
 * page, and Receipt / Invoice settings whose Save writes every field to the
 * place the printout actually reads it from.
 */
import React from 'react';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react-native';

const mockPrinter = {
  id: 'p1', name: 'Counter printer', kind: 'wifi', width: '80mm',
  address: '192.168.1.50', port: 9100, dflt: true, online: true, note: '',
};
const tplReceipt = {
  id: 'tpl_receipt', name: 'Thermal receipt', paper: '80mm', kind: 'thermal', showLogo: true, showTax: true,
  showServed: true, showParty: true, showSaved: true, showAddress: true, showBatch: false, showExpiry: false,
  showImei: false, showWarranty: false, showUnit: true, showRate: true, code: 'none', codeData: 'no',
  codeCaption: false, density: 'normal', head: 'Open 8am-8pm', foot: '', copies: 1,
};
const tplA4 = { ...tplReceipt, id: 'tpl_a4', name: 'A4 document', paper: 'A4', kind: 'page', head: '' };
let mockDb: any;

const mockFns = {
  printDoc: jest.fn(), go: jest.fn(), goBack: jest.fn(),
  addPrinter: jest.fn(), updatePrinter: jest.fn(), makeDefaultPrinter: jest.fn(), removePrinter: jest.fn(),
  updateTemplate: jest.fn(), updateFirm: jest.fn(), setSetting: jest.fn(), setPrinter: jest.fn(),
};

jest.mock('../data/docPrint', () => ({ printDoc: (...a: any[]) => mockFns.printDoc(...a) }));
jest.mock('../nav/navigate', () => ({ useGo: () => mockFns.go }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: mockFns.goBack }) }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('../data/photos', () => ({ keepPhoto: (u: string) => u, dropPhoto: jest.fn() }));
jest.mock('../data/AppDataContext', () => ({
  useAppData: () => ({
    db: mockDb,
    money: (n: number) => 'Sh ' + n,
    ...mockFns,
    templateFor: (k: string) => mockDb.templates.find((t: any) => t.id === mockDb.templateFor[k]),
  }),
  useAppDataSafe: () => ({ db: mockDb }),
}));

import { ToastProvider } from '../components/Toast';
import PrintingScreen, { ReceiptSettingsScreen, InvoiceSettingsScreen, validHost } from '../screens/PrintingScreen';

const wrap = (el: React.ReactElement) => render(<ToastProvider>{el}</ToastProvider>);

beforeEach(() => {
  jest.useFakeTimers();
  Object.values(mockFns).forEach((f) => f.mockReset());
  mockFns.addPrinter.mockImplementation((p: any) => ({ ...p, id: 'p2' }));
  mockDb = {
    settings: { theme: 'light', taxName: 'VAT', taxRate: 18 },
    session: { role: 'owner' },
    firm: { name: 'Corner Shop', address: 'Kampala Rd', phone: '0700', phone2: '', email: '', description: '' },
    printers: [mockPrinter],
    printer: { device: '', width: '80mm', copies: 1, autoPrint: false, openDrawer: false, showLogo: true, header: '', footer: '' },
    templates: [tplReceipt, tplA4],
    templateFor: { receipt: 'tpl_receipt', invoice: 'tpl_a4' },
  };
});
afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers(); cleanup(); });

describe('the Printing hub', () => {
  it('opens Receipt and Invoice settings as their own screens', () => {
    wrap(<PrintingScreen />);
    fireEvent.press(screen.getByText('Receipt settings'));
    expect(mockFns.go).toHaveBeenCalledWith('PrintingReceipt');
    fireEvent.press(screen.getByText('Invoice PDF settings'));
    expect(mockFns.go).toHaveBeenCalledWith('PrintingInvoice');
  });

  it('shows the printer in use and prints a real test page to it', async () => {
    mockFns.printDoc.mockResolvedValue(undefined);
    wrap(<PrintingScreen />);
    expect(screen.getByText(/Counter printer · Wi-Fi/)).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByText('Test print')); });
    expect(mockFns.printDoc).toHaveBeenCalledTimes(1);
    expect(mockFns.printDoc.mock.calls[0][0].footer).toContain('Counter printer');
  });

  it('refuses an address that is not one, instead of saving a printer that can never work', async () => {
    wrap(<PrintingScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Printer IP address'), '192.168.1.300');
    await act(async () => { fireEvent.press(screen.getByText('Connect / Test')); });
    expect(mockFns.addPrinter).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter the printer's IP address/)).toBeTruthy();
  });

  it('saves a new network printer, makes it the one in use, and sends it a test page', async () => {
    mockFns.printDoc.mockResolvedValue(undefined);
    wrap(<PrintingScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Printer IP address'), '192.168.1.77');
    fireEvent.changeText(screen.getByDisplayValue('9100'), '9101');
    await act(async () => { fireEvent.press(screen.getByText('Connect / Test')); });
    expect(mockFns.addPrinter).toHaveBeenCalledWith(expect.objectContaining({ kind: 'wifi', address: '192.168.1.77', port: 9101, dflt: true }));
    expect(mockFns.makeDefaultPrinter).toHaveBeenCalledWith('p2');
    expect(mockFns.printDoc).toHaveBeenCalledTimes(1);
  });

  it('updates the saved printer when the same address is connected again', async () => {
    mockFns.printDoc.mockResolvedValue(undefined);
    wrap(<PrintingScreen />);
    fireEvent.changeText(screen.getByDisplayValue('9100'), '9200');
    await act(async () => { fireEvent.press(screen.getByText('Connect / Test')); });
    expect(mockFns.addPrinter).not.toHaveBeenCalled();
    expect(mockFns.updatePrinter).toHaveBeenCalledWith('p1', expect.objectContaining({ port: 9200 }));
  });

  it('adds a paired Bluetooth printer by name', () => {
    wrap(<PrintingScreen />);
    fireEvent.press(screen.getByText('Bluetooth'));
    fireEvent.changeText(screen.getByPlaceholderText("Paired printer's name"), 'MTP-II');
    fireEvent.press(screen.getByText('Add Bluetooth printer'));
    expect(mockFns.addPrinter).toHaveBeenCalledWith(expect.objectContaining({ name: 'MTP-II', kind: 'bluetooth' }));
  });
});

describe('validHost', () => {
  it('accepts IPv4 addresses and host names, and rejects nonsense', () => {
    expect(validHost('192.168.1.50')).toBe(true);
    expect(validHost('printer.local')).toBe(true);
    expect(validHost('256.1.1.1')).toBe(false);
    expect(validHost('')).toBe(false);
    expect(validHost('192.168.1')).toBe(false);
  });
});

describe('Receipt settings', () => {
  it('saves every field to where the receipt printout reads it', () => {
    wrap(<ReceiptSettingsScreen />);
    fireEvent.press(screen.getByText('58 mm'));
    fireEvent.changeText(screen.getByPlaceholderText('Header line 2'), 'Sundays closed');
    fireEvent.changeText(screen.getByPlaceholderText('WhatsApp number'), '0777');
    fireEvent.changeText(screen.getByPlaceholderText('Thank you for your business!'), 'Goods once sold are not returned');
    fireEvent.press(screen.getByText('Show batch number'));
    fireEvent.press(screen.getByText('Save settings'));

    expect(mockFns.updateTemplate).toHaveBeenCalledWith('tpl_receipt', expect.objectContaining({
      paper: '58mm', head: 'Open 8am-8pm\nSundays closed', foot: 'Goods once sold are not returned', showBatch: true,
    }));
    expect(mockFns.updateFirm).toHaveBeenCalledWith(expect.objectContaining({ phone2: '0777' }));
    expect(mockFns.setSetting).toHaveBeenCalledWith({ taxName: 'VAT' });
    expect(mockFns.setPrinter).toHaveBeenCalledWith(expect.objectContaining({ width: '58mm' }));
    // the roll in the printer decides the layout, so it follows the chosen paper
    expect(mockFns.updatePrinter).toHaveBeenCalledWith('p1', { width: '58mm' });
  });

  it('shows the header and tax label in the live preview', () => {
    wrap(<ReceiptSettingsScreen />);
    expect(screen.getByText('Open 8am-8pm')).toBeTruthy();
    expect(screen.getByText('VAT')).toBeTruthy();
  });
});

describe('Invoice PDF settings', () => {
  it('offers the Tally, QuickBooks, GST and plain templates', () => {
    wrap(<InvoiceSettingsScreen />);
    for (const t of ['Tally', 'QuickBooks', 'GST tax invoice', 'Plain']) expect(screen.getByText(t)).toBeTruthy();
  });

  it('saves QuickBooks with its accent colour on an A4 template', () => {
    wrap(<InvoiceSettingsScreen />);
    fireEvent.press(screen.getByText('QuickBooks'));
    fireEvent.press(screen.getByLabelText('Accent #DC2626'));
    fireEvent.changeText(screen.getByPlaceholderText('Business tagline'), 'Hardware and paint');
    fireEvent.press(screen.getByText('Save settings'));
    return Promise.resolve().then(() => {
      expect(mockFns.updateTemplate).toHaveBeenCalledWith('tpl_a4', expect.objectContaining({
        style: 'quickbooks', accentColor: '#DC2626', boxed: false, paper: 'A4', kind: 'page',
      }));
      expect(mockFns.updateFirm).toHaveBeenCalledWith(expect.objectContaining({ description: 'Hardware and paint' }));
    });
  });

  it('saves the GST template with bank details, website and terms on the business', async () => {
    wrap(<InvoiceSettingsScreen />);
    fireEvent.press(screen.getByText('GST tax invoice'));
    fireEvent.changeText(screen.getByPlaceholderText('Website'), 'www.corner.shop');
    fireEvent.changeText(screen.getByPlaceholderText('Bank, account name and number, branch'), 'Stanbic 9030001234');
    fireEvent.changeText(screen.getByPlaceholderText('Goods once sold will not be taken back.'), 'No returns');
    await act(async () => { fireEvent.press(screen.getByText('Save settings')); });
    expect(mockFns.updateTemplate).toHaveBeenCalledWith('tpl_a4', expect.objectContaining({ style: 'gst', accentColor: '#1E2A78' }));
    expect(mockFns.updateFirm).toHaveBeenCalledWith(expect.objectContaining({
      website: 'www.corner.shop', bankDetails: 'Stanbic 9030001234', terms: 'No returns',
    }));
  });

  it('opens the real page from the print engine with the settings on screen, batch and expiry included', async () => {
    mockFns.printDoc.mockResolvedValue(undefined);
    wrap(<InvoiceSettingsScreen />);
    fireEvent.press(screen.getByText('Tally'));
    fireEvent.press(screen.getByText('Batch column'));
    await act(async () => { fireEvent.press(screen.getByText('See the real page')); });
    const [doc, , opts] = mockFns.printDoc.mock.calls[0];
    expect(opts.paper).toBe('A4');
    expect(opts.tpl).toEqual(expect.objectContaining({ style: 'tally', boxed: true, showBatch: true }));
    expect(doc.lines[0].batchNo).toBeTruthy();
    expect(mockFns.updateTemplate).not.toHaveBeenCalled();
  });

  it('shows Batch and Expiry as their own columns in the preview', () => {
    wrap(<InvoiceSettingsScreen />);
    fireEvent.press(screen.getByText('Batch column'));
    fireEvent.press(screen.getByText('Expiry column'));
    expect(screen.getByText('Batch')).toBeTruthy();
    expect(screen.getByText('Expiry')).toBeTruthy();
    expect(screen.getByText('B-102')).toBeTruthy();
  });

  it('does not turn a template shared with receipts into an A4 page', async () => {
    mockDb.templateFor.invoice = 'tpl_receipt';
    wrap(<InvoiceSettingsScreen />);
    fireEvent.press(screen.getByText('Tally'));
    await act(async () => { fireEvent.press(screen.getByText('Save settings')); });
    const patch = mockFns.updateTemplate.mock.calls[0][1];
    expect(patch.boxed).toBe(true);
    expect(patch.paper).toBeUndefined();
  });
});
