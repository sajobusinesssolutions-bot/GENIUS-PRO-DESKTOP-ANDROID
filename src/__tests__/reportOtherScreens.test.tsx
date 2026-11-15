/**
 * The reports that have screens of their own — staff, the day, batches, a
 * party's ledger and the detailed statements — in the same layout as the
 * rest: rows that open in place, no currency in an amount, and the totals on
 * a bar at the foot.
 */
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react-native';
import { seed } from '../data/seed';
import * as logic from '../data/logic';

const mockDb: any = seed();
mockDb.settings.requireShift = false;
mockDb.session.role = 'owner';
const mockNav: any = { setOptions: jest.fn(), setParams: jest.fn(), addListener: () => () => {}, navigate: jest.fn(), goBack: jest.fn() };
let mockParams: any = {};

jest.mock('../data/AppDataContext', () => ({
  useAppData: () => ({
    db: mockDb, money: (n: number) => 'Sh ' + n, cur: () => 'Sh', setSetting: jest.fn(),
    user: (id: string) => mockDb.users.find((u: any) => u.id === id),
    party: (id: string) => mockDb.parties.find((p: any) => p.id === id),
    accountBalance: () => 125000,
    can: () => true,
  }),
  useAppDataSafe: () => ({ db: mockDb }),
}));
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useNavigation: () => mockNav, useRoute: () => ({ params: mockParams }) }));
jest.mock('../nav/navigate', () => ({ useGo: () => jest.fn() }));
jest.mock('../data/useBookFrom', () => ({ useBookFrom: (db: any) => ({ book: db, reading: false }) }));
jest.mock('../components/Gate', () => ({ useCan: () => true, Denied: () => null }));

import StaffReportScreen from '../screens/StaffReportScreen';
import DayReportScreen from '../screens/DayReportScreen';
import BatchReportScreen from '../screens/BatchReportScreen';
import PartyLedgerScreen from '../screens/PartyLedgerScreen';
import ReportDetailScreen from '../screens/ReportDetailScreen';

afterEach(cleanup);

const noCurrency = () => expect(screen.queryAllByText(/(^|\s)Sh \d/).length).toBe(0);
const opened = () => screen.queryAllByRole('button', { expanded: true }).length;
const openFirst = () => {
  const rows = screen.getAllByRole('button', { expanded: false });
  expect(rows.length).toBeGreaterThan(0);
  fireEvent.press(rows[0]);
  expect(opened()).toBe(1);
};

describe('the reports with screens of their own', () => {
  it('staff: a row for each person, opened in place, takings on the bar', () => {
    render(<StaffReportScreen />);
    expect(screen.getByText('Total takings')).toBeTruthy();
    expect(screen.getByLabelText(/^Period: /)).toBeTruthy();
    noCurrency();
    if (screen.queryAllByRole('button', { expanded: false }).length) { openFirst(); expect(screen.getByText('Average bill')).toBeTruthy(); }
  });

  it('the day: plain groups, sales on the bar, Send in the header', () => {
    render(<DayReportScreen />);
    expect(screen.getByText('How it was paid')).toBeTruthy();
    expect(screen.getByText('Cash drawer')).toBeTruthy();
    expect(screen.getByText(/^Sales · \d+ bills?$/)).toBeTruthy();
    expect(screen.getByText('125,000.00')).toBeTruthy();   // cash held now, no currency
    noCurrency();
    const opts = mockNav.setOptions.mock.calls[mockNav.setOptions.mock.calls.length - 1][0];
    expect(opts.headerRight).toBeTruthy();
  });

  it('batches: tabs, an item opened to its batches, and the ageing bands', () => {
    const p = mockDb.products.find((x: any) => x.kind !== 'service');
    p.trackBatches = true;
    p.batches = [{ no: 'B-OLD', qty: 3, expiry: new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10) }, { no: 'B-NEW', qty: 9, expiry: new Date(Date.now() + 200 * 864e5).toISOString().slice(0, 10) }];
    render(<BatchReportScreen />);
    expect(screen.getAllByRole('tab').length).toBe(2);
    expect(screen.getByText('Stock value in batches')).toBeTruthy();
    noCurrency();
    if (screen.queryByText(p.name)) {
      openFirst();
      expect(screen.getByText('Batch B-OLD')).toBeTruthy();
      expect(screen.getByText('View item')).toBeTruthy();
    }
    fireEvent.press(screen.getAllByRole('tab')[1]);
    expect(screen.getByText('Ageing')).toBeTruthy();
    expect(screen.getByText('0–30 days')).toBeTruthy();
    expect(screen.getByText('No expiry date')).toBeTruthy();
  });

  it("a party's ledger: opening, each entry a row, closing on the bar", () => {
    const c = mockDb.parties.find((x: any) => x.type === 'customer');
    logic.recordPayment(mockDb, { partyId: c.id, amount: 5000, direction: 'in', accountId: 'acc_cash' });
    render(<PartyLedgerScreen route={{ params: { partyId: c.id } } as any} navigation={mockNav} />);
    expect(screen.getByText('Opening balance')).toBeTruthy();
    expect(screen.getByText(/^Closing balance · /)).toBeTruthy();
    expect(screen.getAllByText(/Payment received/).length).toBeGreaterThan(0);
    noCurrency();
    openFirst();
    expect(screen.getByText('Balance after')).toBeTruthy();
  });

  it.each(['balance-sheet', 'general-ledger', 'pnl'])('%s, detailed: groups with totals, an account opened in place', (id) => {
    mockParams = { id, detailed: true };
    render(<ReportDetailScreen />);
    noCurrency();
    // the bottom line is on the bar at the foot
    expect(screen.getAllByText(id === 'balance-sheet' ? /^Total assets · / : id === 'general-ledger' ? /^Total debits · / : /^Net (profit|loss) · /).length).toBe(1);
    if (id !== 'pnl') expect(screen.getByText('Total assets')).toBeTruthy();
    openFirst();
    // one at a time
    const others = screen.getAllByRole('button', { expanded: false });
    if (others.length) { fireEvent.press(others[0]); expect(opened()).toBe(1); }
  });
});
