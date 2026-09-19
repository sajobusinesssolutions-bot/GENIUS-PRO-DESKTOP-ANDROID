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
  ownerEmail: 'owner@example.com',
  users: [] as any[],
};
jest.mock('../data/AppDataContext', () => ({
  useAppData: () => ({ db: mockDb, login: mockLogin, updateUser: mockUpdateUser }),
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
  fireEvent.press(screen.getByText('Forgot PIN?'));
  expect(screen.getByText('reset sheet for owner@example.com')).toBeTruthy();
});

it('tells staff to ask the owner, rather than offering a reset', () => {
  mockDb.users = [{ id: 'c', name: 'Grace', role: 'cashier', pin: '1111', active: true }];
  const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  renderIt();
  fireEvent.press(screen.getByText('Forgot PIN?'));
  expect(spy.mock.calls[0][1]).toMatch(/Ask the owner/);
  expect(screen.queryByText(/reset sheet/)).toBeNull();
  spy.mockRestore();
});
