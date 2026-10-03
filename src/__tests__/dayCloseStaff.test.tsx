/**
 * Day close lists every active member of staff, not just the open tills.
 */
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react-native';

const today = new Date().toISOString();
const mockDb: any = {
  settings: { theme: 'light' },
  session: { role: 'owner', till: 'Till 1' },
  users: [
    { id: 'u1', name: 'Amina', role: 'cashier', active: true },
    { id: 'u2', name: 'Brian', role: 'cashier', active: true },
    { id: 'u3', name: 'Old Staff', role: 'cashier', active: false },
  ],
  shifts: [{ id: 'sh1', userId: 'u1', till: 'Till 7', openedAt: today, openingFloat: 0 }],
  sales: [{ id: 's1', userId: 'u2', total: 4000, status: 'done', ts: today }],
};

jest.mock('../data/AppDataContext', () => ({
  useAppData: () => ({
    db: mockDb, money: (n: number) => 'Sh ' + n, cur: () => 'Sh', me: () => mockDb.users[0],
    user: (id: string) => mockDb.users.find((u: any) => u.id === id),
    activeShift: () => undefined, openShift: jest.fn(), closeShift: jest.fn(), lastClosedShift: () => undefined,
    can: () => true,
    shiftTotals: () => ({ cash: 1000, momo: 0, bank: 0, credit: 0, expected: 1000, total: 1000, count: 1, recv: 0, paidOut: 0 }),
  }),
  useAppDataSafe: () => ({ db: mockDb }),
}));
jest.mock('../nav/navigate', () => ({ useGo: () => jest.fn() }));
jest.mock('../data/branch', () => ({ activeBranchId: () => undefined }));

import ShiftScreen from '../screens/ShiftScreen';

afterEach(cleanup);

describe('Day close', () => {
  it('shows every active member of staff, on shift or not, and no till names', () => {
    render(<ShiftScreen route={{ params: { close: true } }} />);
    expect(screen.getByText('All staff · 2')).toBeTruthy();
    expect(screen.getAllByText('Amina').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Brian').length).toBeGreaterThan(0);
    expect(screen.queryByText('Old Staff')).toBeNull();
    expect(screen.queryByText(/Till 7/)).toBeNull();
    expect(screen.getByText(/Not on shift · 1 sale today/)).toBeTruthy();
    expect(screen.getByText('1 of 2 on shift')).toBeTruthy();
  });

  it('closing is offered only for staff who have a shift open', () => {
    render(<ShiftScreen route={{ params: { close: true } }} />);
    expect(screen.getByText('Close 1 shift')).toBeTruthy();
    fireEvent.press(screen.getAllByText('Brian')[0]);
    expect(screen.queryByText('Close 1 shift')).toBeNull();
    expect(screen.getByText(/nothing to close/)).toBeTruthy();
  });
});
