/**
 * Linking a device happens on sign-in. A full plan asks which device to
 * remove; a device removed elsewhere is locked until someone signs in.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';

const mockPatch = jest.fn(async () => {});
const mockSignOut = jest.fn(async () => {});
const mockSetSync = jest.fn();
let mockAccount: any;

jest.mock('../data/AuthContext', () => ({
  useAuth: () => ({ account: mockAccount, patch: mockPatch, signOut: mockSignOut }),
  useAuthSafe: () => null,
}));
jest.mock('../data/AppDataContext', () => ({
  useAppData: () => ({ db: { session: { online: true, till: 'Till 2' }, settings: { theme: 'light' } }, setSync: mockSetSync }),
  useAppDataSafe: () => ({ db: { settings: { theme: 'light' } } }),
}));
jest.mock('../nav/RootNavigator', () => ({ navRef: { isReady: () => true, reset: jest.fn() } }));

const mockApi = {
  refreshSession: jest.fn(),
  registerDevice: jest.fn(),
  deviceStatus: jest.fn(),
  revokeDevice: jest.fn(),
  listDevices: jest.fn(),
};
jest.mock('../data/authApi', () => ({
  refreshSession: (...a: any[]) => mockApi.refreshSession(...a),
  registerDevice: (...a: any[]) => mockApi.registerDevice(...a),
  deviceStatus: (...a: any[]) => mockApi.deviceStatus(...a),
  revokeDevice: (...a: any[]) => mockApi.revokeDevice(...a),
  listDevices: (...a: any[]) => mockApi.listDevices(...a),
}));

import DeviceGate from '../components/DeviceGate';

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.refreshSession.mockResolvedValue({ ok: true, value: { access: 'tok' } });
});

it('links the device straight after signing in', async () => {
  mockAccount = { refresh: 'r1', localOnly: false };
  mockApi.registerDevice.mockResolvedValue({ ok: true, value: { deviceId: 'dev-9' } });
  render(<DeviceGate />);
  await waitFor(() => expect(mockPatch).toHaveBeenCalledWith({ deviceId: 'dev-9' }));
  expect(mockSetSync).toHaveBeenCalledWith({ deviceId: 'dev-9' });
  expect(screen.queryByText('Too many devices')).toBeNull();
});

it('asks which device to remove when the plan is full, and links once one is removed', async () => {
  mockAccount = { refresh: 'r1', localOnly: false };
  mockApi.registerDevice
    .mockResolvedValueOnce({ ok: false, error: { failure: 'tooManyDevices', message: 'All in use.', detail: { seats: 1, devices: [{ id: 'old', name: 'Old till', last_seen: '2026-10-01' }] } } })
    .mockResolvedValueOnce({ ok: true, value: { deviceId: 'dev-new' } });
  mockApi.revokeDevice.mockResolvedValue({ ok: true, value: { revoked: true } });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons: any) => buttons[1].onPress());

  render(<DeviceGate />);
  expect(await screen.findByText('Too many devices')).toBeTruthy();
  expect(screen.getByText('Old till')).toBeTruthy();

  await act(async () => { fireEvent.press(screen.getByText('Remove')); });
  await waitFor(() => expect(mockApi.revokeDevice).toHaveBeenCalledWith('tok', 'old'));
  await waitFor(() => expect(mockPatch).toHaveBeenCalledWith({ deviceId: 'dev-new' }));
  expect(screen.queryByText('Too many devices')).toBeNull();
  alert.mockRestore();
});

it('locks a removed device until someone signs in', async () => {
  mockAccount = { refresh: 'r1', localOnly: false, deviceId: 'dev-1' };
  mockApi.refreshSession.mockResolvedValue({ ok: false, error: { failure: 'deviceRemoved', message: '' } });
  render(<DeviceGate />);
  expect(await screen.findByText(/removed from your linked devices/)).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByText('Sign in')); });
  expect(mockSignOut).toHaveBeenCalled();
});

it('does not lock anyone out for a dropped connection', async () => {
  mockAccount = { refresh: 'r1', localOnly: false, deviceId: 'dev-1' };
  mockApi.refreshSession.mockResolvedValue({ ok: false, error: { failure: 'offline', message: '' } });
  render(<DeviceGate />);
  await waitFor(() => expect(mockApi.refreshSession).toHaveBeenCalled());
  expect(screen.queryByText('Sign in to continue')).toBeNull();
});

it('on a server without the linked check, locks once the device is gone from the list', async () => {
  mockAccount = { refresh: 'r1', localOnly: false, deviceId: 'dev-1' };
  mockApi.deviceStatus.mockResolvedValue({ ok: false, error: { failure: 'server', message: '' } });
  mockApi.listDevices.mockResolvedValue({ ok: true, value: { devices: [{ id: 'dev-2', name: 'Other' }] } });
  render(<DeviceGate />);
  expect(await screen.findByText(/removed from your linked devices/)).toBeTruthy();
});

it('stays open while the device is still on the list', async () => {
  mockAccount = { refresh: 'r1', localOnly: false, deviceId: 'dev-1' };
  mockApi.deviceStatus.mockResolvedValue({ ok: false, error: { failure: 'server', message: '' } });
  mockApi.listDevices.mockResolvedValue({ ok: true, value: { devices: [{ id: 'dev-1', name: 'This' }] } });
  render(<DeviceGate />);
  await waitFor(() => expect(mockApi.listDevices).toHaveBeenCalled());
  expect(screen.queryByText('Sign in to continue')).toBeNull();
});
