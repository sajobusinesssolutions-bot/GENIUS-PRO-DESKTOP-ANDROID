/**
 * Two buttons on this screen used to claim they did something real and
 * didn't: "Test print" showed "A test page has been queued" without ever
 * calling the print engine, and "Test connection" saved the draft and
 * described what *would* happen without asking the server anything. Both
 * now do the real thing; these pin that down so neither quietly reverts to
 * a canned alert.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, act } from '@testing-library/react-native';

const mockPrinter = {
  id: 'p1', name: 'Counter printer', kind: 'wifi', width: '80mm',
  address: '192.168.1.50', port: 9100, dflt: true, online: true, note: '',
};
const mockDb: any = {
  settings: { theme: 'light' },
  session: { role: 'owner' },
  firm: { name: 'Corner Shop', address: '', phone: '' },
  printers: [mockPrinter],
  printer: { device: '', width: '80mm', copies: 1, autoPrint: false, openDrawer: false, showLogo: true, header: '', footer: '' },
  printServer: { on: false, name: '', host: '', port: 0, path: '', key: '', secure: false, timeout: 8, queue: 'retry', lastSeen: '', status: 'unknown' },
  templates: [],
  templateFor: {},
};

const mockPrintDoc = jest.fn();
jest.mock('../data/docPrint', () => ({ printDoc: (...a: any[]) => mockPrintDoc(...a) }));

const mockGo = jest.fn();
jest.mock('../nav/navigate', () => ({ useGo: () => mockGo }));

jest.mock('../data/AppDataContext', () => ({
  useAppData: () => ({
    db: mockDb,
    money: (n: number) => 'Sh ' + n,
    setPrinter: jest.fn(),
    makeDefaultPrinter: jest.fn(),
    removePrinter: jest.fn(),
    addPrinter: jest.fn(),
    updatePrinter: jest.fn(),
    setPrintServer: (patch: any) => Object.assign(mockDb.printServer, patch),
    updateTemplate: jest.fn(),
    setTemplateFor: jest.fn(),
    templateFor: () => undefined,
  }),
  useAppDataSafe: () => ({ db: mockDb }),
}));

// Printers, Templates, Print server and Wording are each their own screen
// now (the "too many tabs" pass), not panes behind a tab row on one screen —
// so these render the destination screens directly, the way the navigator
// reaches them, rather than switching a tab inside PrintingScreen itself.
import PrintingScreen, { PrintersScreen, PrintServerScreen } from '../screens/PrintingScreen';

beforeEach(() => {
  mockPrintDoc.mockReset();
  mockGo.mockReset();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (global as any).fetch = jest.fn();
});
afterEach(() => { (Alert.alert as jest.Mock).mockRestore(); delete (global as any).fetch; });

describe('the Printing hub', () => {
  it('lists the four destinations rather than cramming them into tabs on one screen', () => {
    render(<PrintingScreen />);
    expect(screen.getByText('Printers')).toBeTruthy();
    expect(screen.getByText('Templates')).toBeTruthy();
    expect(screen.getByText('Print server')).toBeTruthy();
    expect(screen.getByText('Wording')).toBeTruthy();
  });

  it('navigates to each destination as its own screen', () => {
    render(<PrintingScreen />);
    fireEvent.press(screen.getByText('Printers'));
    expect(mockGo).toHaveBeenCalledWith('PrintingPrinters');
    fireEvent.press(screen.getByText('Print server'));
    expect(mockGo).toHaveBeenCalledWith('PrintingServer');
  });
});

describe('"Test print"', () => {
  it('calls the real print engine for the default printer', async () => {
    mockPrintDoc.mockResolvedValue(undefined);
    render(<PrintersScreen />);
    await act(async () => {
      fireEvent.press(screen.getByText('Test print'));
    });
    expect(mockPrintDoc).toHaveBeenCalledTimes(1);
    const [doc] = mockPrintDoc.mock.calls[0];
    expect(doc.kind).toBe('Test Print');
    expect(doc.footer).toContain('Counter printer');
  });

  it('reports a real failure instead of claiming the page was queued', async () => {
    mockPrintDoc.mockRejectedValue(new Error('Printer offline'));
    render(<PrintersScreen />);
    await act(async () => {
      fireEvent.press(screen.getByText('Test print'));
    });
    expect(Alert.alert).toHaveBeenCalledWith('Test print', 'Printer offline');
  });
});

describe('"Test connection"', () => {
  it('actually asks the server, and reports a genuine answer', async () => {
    mockDb.printServer = { ...mockDb.printServer, host: '192.168.1.10', port: 6631, path: '/print' };
    ((global as any).fetch as jest.Mock).mockResolvedValue({ ok: true, status: 200 });
    render(<PrintServerScreen />);
    await act(async () => {
      fireEvent.press(screen.getByText('Test connection'));
    });
    expect((global as any).fetch).toHaveBeenCalledWith('http://192.168.1.10:6631/print', expect.anything());
    expect(mockDb.printServer.status).toBe('ok');
  });

  it('marks it unreachable on a real failure, not just an unchecked guess', async () => {
    mockDb.printServer = { ...mockDb.printServer, host: '192.168.1.10', port: 6631, path: '/print', status: 'unknown' };
    ((global as any).fetch as jest.Mock).mockRejectedValue(new Error('Network request failed'));
    render(<PrintServerScreen />);
    await act(async () => {
      fireEvent.press(screen.getByText('Test connection'));
    });
    expect(mockDb.printServer.status).toBe('bad');
  });
});
