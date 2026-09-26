/**
 * "Send on WhatsApp" used whatsapp://send?phone=…&text=… for a document with
 * a customer phone number attached. That scheme is unofficial and has become
 * unreliable at carrying both a phone number and pre-filled text together —
 * WhatsApp often opens straight to the chat with the text box empty, which
 * from the till reads as "nothing to send" even though the app did open.
 * wa.me is Meta's own documented link format and reliably carries both.
 */
import React from 'react';
import { Linking } from 'react-native';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react-native';

const mockDb: any = { settings: { theme: 'light' }, printers: [] };

jest.mock('../data/AppDataContext', () => ({
  useAppData: () => ({ db: mockDb, money: (n: number) => 'Sh ' + n }),
  useAppDataSafe: () => ({ db: mockDb }),
}));

import { ToastProvider } from '../components/Toast';
import { DocActions } from '../components/DocActions';
import type { DocMeta } from '../data/docPrint';

const doc: DocMeta = {
  kind: 'Tax Invoice', no: 'INV-0001', ts: '2026-01-01T10:00:00Z', firmName: 'Corner Shop',
  lines: [{ name: 'Sugar 1kg', qty: 1, price: 5000 }], subtotal: 5000, total: 5000,
};

function renderIt(phone?: string) {
  return render(
    <ToastProvider>
      <DocActions doc={() => doc} phone={phone} />
    </ToastProvider>,
  );
}

async function openWhatsapp() {
  await act(async () => { fireEvent.press(screen.getByLabelText('More options')); });
  await act(async () => { fireEvent.press(screen.getByText('Send on WhatsApp')); });
}

const canOpenURL = jest.spyOn(Linking, 'canOpenURL');
const openURL = jest.spyOn(Linking, 'openURL');

beforeEach(() => {
  jest.useFakeTimers();
  canOpenURL.mockReset().mockResolvedValue(true);
  openURL.mockReset().mockResolvedValue(true as any);
});
afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  cleanup();
});

describe('"Send on WhatsApp" with a customer phone number', () => {
  it('uses a wa.me link, not the unreliable whatsapp://send?phone= scheme', async () => {
    renderIt('+256 700 111 222');
    await openWhatsapp();
    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/wa\.me\/256700111222\?text=/));
  });

  it('carries the document text through the link', async () => {
    renderIt('+256 700 111 222');
    await openWhatsapp();
    const url = openURL.mock.calls[0][0];
    expect(decodeURIComponent(url)).toContain('INV-0001');
  });

  it('does not gate on canOpenURL, so a real number is never wrongly reported as "not installed"', async () => {
    canOpenURL.mockResolvedValue(false);
    renderIt('+256 700 111 222');
    await openWhatsapp();
    expect(Linking.openURL).toHaveBeenCalled();
  });
});

describe('"Send on WhatsApp" with no phone number', () => {
  it('still uses the plain app-scheme link to let the person choose a contact', async () => {
    renderIt();
    await openWhatsapp();
    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringMatching(/^whatsapp:\/\/send\?text=/));
  });

  it('reports "not installed" when WhatsApp itself cannot be opened', async () => {
    canOpenURL.mockResolvedValue(false);
    renderIt();
    await openWhatsapp();
    expect(Linking.openURL).not.toHaveBeenCalled();
    expect(screen.getByText('WhatsApp is not installed.')).toBeTruthy();
  });
});
