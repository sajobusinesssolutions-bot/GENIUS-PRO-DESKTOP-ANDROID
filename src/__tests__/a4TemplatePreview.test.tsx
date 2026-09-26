/**
 * An A4 template's preview used to render as the exact same narrow,
 * single-column receipt mock as an 80mm roll template — same shape, same
 * "TOTAL" line centred under a dashed rule — which is not what an A4
 * invoice looks like, and not what docHtml() actually produces for one.
 * Opening "A4 document" (or a Tally/QuickBooks-preset template) in the
 * editor should show something that reads as a page, not a receipt.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

const mockDb: any = {
  settings: { theme: 'light', currencyName: 'Ugandan shilling' },
  session: { role: 'owner' },
  firm: { name: 'Corner Shop', address: '123 Main St' },
  users: [{ id: 'u1', name: 'Amina', active: true }],
  parties: [{ id: 'p1', name: 'Taylor & Co' }],
  sales: [{
    id: 's1', no: 'INV-0001', ts: '2026-09-19T10:00:00Z', status: 'complete',
    partyId: 'p1', userId: 'u1', total: 10000, tax: 0,
    lines: [{ name: 'Sugar 1kg', qty: 2, price: 5000, unit: 'pcs' }],
  }],
  printer: { device: '', width: '80mm', copies: 1, autoPrint: false, openDrawer: false, showLogo: true, header: '', footer: '' },
  printServer: { on: false, status: 'unknown' },
  templates: [
    { id: 'tpl_receipt', name: 'Thermal receipt', paper: '80mm', kind: 'thermal', showLogo: true, showTax: true, showServed: true, showParty: true, showSaved: true, showAddress: true, showBatch: true, showExpiry: true, showImei: false, showWarranty: false, showUnit: true, showRate: true, code: 'none', codeData: 'no', codeCaption: false, density: 'normal', head: '', foot: '', copies: 1 },
    { id: 'tpl_a4', name: 'A4 document', paper: 'A4', kind: 'page', boxed: true, showLogo: true, showTax: true, showServed: true, showParty: true, showSaved: false, showAddress: true, showBatch: true, showExpiry: true, showImei: false, showWarranty: false, showUnit: true, showRate: true, code: 'none', codeData: 'no', codeCaption: false, density: 'normal', head: '', foot: '', copies: 1 },
  ],
  templateFor: { receipt: 'tpl_receipt', invoice: 'tpl_a4' },
};

jest.mock('../data/AppDataContext', () => ({
  useAppData: () => ({
    db: mockDb,
    updateTemplate: jest.fn(),
    setTemplateFor: jest.fn(),
    templateFor: (k: string) => mockDb.templates.find((t: any) => t.id === mockDb.templateFor[k]),
  }),
  useAppDataSafe: () => ({ db: mockDb }),
}));

import { PrintingTemplatesScreen } from '../screens/PrintingScreen';

function renderIt() {
  return render(<PrintingTemplatesScreen />);
}

describe('an A4 template\'s preview', () => {
  // The screen behind the editor sheet keeps its own "Live preview" of the
  // default receipt template mounted the whole time, so "TOTAL" (the
  // receipt mock's own giveaway line) is legitimately on screen regardless
  // of which template is open in the sheet — these check the sheet's own
  // preview specifically, by what it alone can show.
  it('shows a page-shaped invoice, not the 80mm receipt mock', () => {
    renderIt();
    // the template name also appears in "Which template each document uses";
    // [0] is the row in the Templates list itself, which opens the editor
    fireEvent.press(screen.getAllByText('A4 document')[0]);
    expect(screen.getByText('Tax Invoice')).toBeTruthy();
    expect(screen.getByText('Taylor & Co')).toBeTruthy();
  });

  it('still shows the ordinary receipt mock for an 80mm template', () => {
    renderIt();
    fireEvent.press(screen.getAllByText('Thermal receipt')[0]);
    expect(screen.queryByText('Tax Invoice')).toBeNull();
    expect(screen.queryByText('Taylor & Co')).toBeNull();
  });
});
