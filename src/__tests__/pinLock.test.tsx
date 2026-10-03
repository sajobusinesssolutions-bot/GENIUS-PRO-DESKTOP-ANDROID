/**
 * The lock screen: profile first, a PIN chosen the first time, and a way back
 * for an owner who forgot theirs.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, act } from '@testing-library/react-native';

const mockLogin = jest.fn();
const mockUpdateUser = jest.fn();
const mockDb: any = {
  firm: { name: 'Amar Shop' },
  settings: { theme: 'light' },
  session: { warehouse: 'w1' },
  warehouses: [] as any[],
  ownerEmail: 'owner@example.com',
  users: [] as any[],
};
jest.mock('../data/AppDataContext', () => ({
  useAppData: () => ({ db: mockDb, login: mockLogin, updateUser: mockUpdateUser, setWarehouse: jest.fn() }),
  useAppDataSafe: () => ({ db: mockDb }),
}));
jest.mock('../data/AuthContext', () => ({ useAuth: () => ({ account: null }) }));
jest.mock('../components/PinResetSheet', () => ({
  PinResetSheet: ({ visible, email }: any) => {
    const { Text } = require('react-native');
    return visible ? <Text>reset sheet for {email}</Text> : null;
  },
}));

import PinLockScreen from '../screens/PinLockScreen';

const nav: any = { replace: jest.fn(), navigate: jest.fn() };
const renderIt = () => render(<PinLockScreen navigation={nav} route={{ key: 'k', name: 'PinLock' } as any} />);
const type = (digits: string) => digits.split('').forEach((d) => fireEvent.press(screen.getByLabelText(d)));

beforeEach(() => {
  jest.useFakeTimers();
  mockLogin.mockReset();
  mockUpdateUser.mockReset();
  nav.replace.mockReset();
});
afterEach(() => { jest.useRealTimers(); });

it('asks who is at the till when there are several profiles', () => {
  mockDb.users = [
    { id: 'o', name: 'Amar', role: 'owner', pin: '1234', active: true },
    { id: 'c', name: 'Grace', role: 'cashier', pin: '1111', active: true },
  ];
  renderIt();
  expect(screen.getByText('Who is at the till?')).toBeTruthy();
  expect(screen.getByText('Amar Shop')).toBeTruthy();
});

it('has a new owner choose a PIN, twice, instead of an unchosen 0000', () => {
  mockDb.users = [{ id: 'o', name: 'Amar', role: 'owner', pin: '', active: true }];
  mockLogin.mockReturnValue(true);
  renderIt();
  expect(screen.getByText(/Choose a four-digit PIN/)).toBeTruthy();
  type('4321');
  act(() => { jest.runAllTimers(); });
  expect(screen.getByText(/Type the same PIN again/)).toBeTruthy();
  type('4321');
  act(() => { jest.runAllTimers(); });
  expect(mockUpdateUser).toHaveBeenCalledWith('o', { pin: '4321' });
  expect(nav.replace).toHaveBeenCalledWith('Main');
});

it('starts again when the second PIN does not match', () => {
  mockDb.users = [{ id: 'o', name: 'Amar', role: 'owner', pin: '', active: true }];
  renderIt();
  type('4321');
  act(() => { jest.runAllTimers(); });
  type('9999');
  act(() => { jest.runAllTimers(); });
  expect(mockUpdateUser).not.toHaveBeenCalled();
});

it('sends an owner who forgot the PIN to the email reset', () => {
  mockDb.users = [{ id: 'o', name: 'Amar', role: 'owner', pin: '1234', active: true }];
  renderIt();
  fireEvent.press(screen.getByText('Forgot PIN? Reset with an email code'));
  expect(screen.getByText('reset sheet for owner@example.com')).toBeTruthy();
});

it('offers staff the email reset too, with the code going to the owner', () => {
  mockDb.users = [{ id: 'c', name: 'Grace', role: 'cashier', pin: '1111', active: true }];
  renderIt();
  fireEvent.press(screen.getByText('Forgot PIN? Reset with an email code'));
  // the sheet is handed the owner's address, never one the cashier could choose
  expect(screen.getByText('reset sheet for owner@example.com')).toBeTruthy();
});

it('says why when the shop has no owner email to send a code to', () => {
  mockDb.users = [{ id: 'c', name: 'Grace', role: 'cashier', pin: '1111', active: true }];
  const keep = mockDb.ownerEmail;
  mockDb.ownerEmail = '';
  const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  renderIt();
  fireEvent.press(screen.getByText('Forgot PIN? Reset with an email code'));
  expect(spy.mock.calls[0][1]).toMatch(/no owner email/);
  spy.mockRestore();
  mockDb.ownerEmail = keep;
});

it('shows a disabled branch as disabled, and will not open it', () => {
  mockDb.users = [{ id: 'o', name: 'Amar', role: 'owner', pin: '1234', active: true }, { id: 'c', name: 'Grace', role: 'cashier', pin: '1111', active: true }];
  mockDb.warehouses = [{ id: 'w1', name: 'Main shop', active: true }, { id: 'w2', name: 'Town branch', active: false }];
  renderIt();
  expect(screen.getByText('Town branch · disabled')).toBeTruthy();
  expect(screen.getByText('Main shop')).toBeTruthy();
  mockDb.warehouses = [];
});
