/**
 * A report on the phone: tabs with Period beside them, rows that open in
 * place, no table, no cards above, amounts without the currency, and the
 * totals on a bar at the foot.
 */
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react-native';
import { seed } from '../data/seed';

const mockDb: any = seed();
mockDb.settings.requireShift = false;
mockDb.session.role = 'owner';
const mockSet = jest.fn();
const mockNav: any = { setOptions: jest.fn(), setParams: jest.fn(), addListener: () => () => {}, navigate: jest.fn(), goBack: jest.fn() };
let mockId = 'profit-margin';

jest.mock('../data/AppDataContext', () => ({
  useAppData: () => ({ db: mockDb, money: (n: number) => 'Sh ' + n, cur: () => 'Sh', setSetting: mockSet }),
  useAppDataSafe: () => ({ db: mockDb }),
}));
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useNavigation: () => mockNav, useRoute: () => ({ params: { id: mockId } }) }));
jest.mock('../nav/navigate', () => ({ useGo: () => jest.fn() }));

import ReportDetailScreen from '../screens/ReportDetailScreen';

afterEach(cleanup);

describe('a report on the phone', () => {
  it('lists rows with a figure, not a table, and carries no currency', () => {
    mockId = 'profit-margin';
    render(<ReportDetailScreen />);
    // the header is given the name, the one-line description, Export and More
    const opts = mockNav.setOptions.mock.calls[mockNav.setOptions.mock.calls.length - 1][0];
    expect(opts.subtitle).toBeTruthy();
    // no cell anywhere starts with the currency
    expect(screen.queryAllByText(/^Sh \d/).length).toBe(0);
    // the totals are on the bar at the foot
    expect(screen.getAllByText(/^Total /).length).toBeGreaterThan(0);
  });

  it('opens a row in place to show every column, one at a time', () => {
    mockId = 'profit-margin';
    render(<ReportDetailScreen />);
    const rows = screen.getAllByRole('button', { expanded: false });
    expect(rows.length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('button', { expanded: true }).length).toBe(0);
    fireEvent.press(rows[0]);
    expect(screen.getAllByRole('button', { expanded: true }).length).toBe(1);
    // a second row opened closes the first
    const others = screen.getAllByRole('button', { expanded: false });
    if (others.length) { fireEvent.press(others[0]); expect(screen.getAllByRole('button', { expanded: true }).length).toBe(1); }
    fireEvent.press(screen.getAllByRole('button', { expanded: true })[0]);
    expect(screen.queryAllByRole('button', { expanded: true }).length).toBe(0);
  });

  it('shows the views of a report as tabs, with Period beside them', () => {
    mockId = 'invoice-list';
    render(<ReportDetailScreen />);
    expect(screen.getAllByRole('tab').length).toBeGreaterThan(1);
    expect(screen.getByLabelText(/^Period: /)).toBeTruthy();
    fireEvent.press(screen.getByLabelText(/^Period: /));
    expect(screen.getByText('Select period')).toBeTruthy();
    expect(screen.getByText('Apply')).toBeTruthy();
    expect(screen.getByText('Last month')).toBeTruthy();
  });

  it('draws a statement (trial balance) without failing', () => {
    mockId = 'trial-balance';
    render(<ReportDetailScreen />);
    expect(screen.getByLabelText(/^Period: /)).toBeTruthy();
  });
});
