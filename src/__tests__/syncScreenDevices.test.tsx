/**
 * "Refresh licence" — renamed "Check devices linked" — used to fetch a fresh
 * access token, use it to refresh the licence, then call loadDevices(),
 * which fetched a *second* fresh access token to list devices. One button
 * press did two round trips to /v1/auth/refresh for what only ever needed
 * one, and ran the licence check and the device list one after another
 * instead of together. This pins down the fix: one refresh, both requests
 * at once.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react-native';

const mockDb: any = {
  settings: { theme: 'light' },
  session: { role: 'owner', online: true },
  sync: { on: true, pending: [], log: [], lastPush: null, businessId: 'biz_1' },
  queue: [],
};

jest.mock('../data/AppDataContext', () => ({
  useAppData: () => ({
    db: mockDb,
    setSync: jest.fn(),
    licFeature: () => true,
    refreshLicence: mockRefreshLicence,
  }),
  useAppDataSafe: () => ({ db: mockDb }),
}));
jest.mock('../data/AuthContext', () => ({
  useAuth: () => ({ account: { id: 'acct_1', email: 'owner@shop.com', refresh: 'refresh-token', localOnly: false } }),
}));
jest.mock('../nav/navigate', () => ({ useGo: () => jest.fn() }));
jest.mock('../data/useSyncRun', () => ({ useSyncRun: () => ({ run: jest.fn() }) }));

const mockRefreshSession = jest.fn();
const mockListDevices = jest.fn();
jest.mock('../data/authApi', () => ({
  refreshSession: (...a: any[]) => mockRefreshSession(...a),
  listDevices: (...a: any[]) => mockListDevices(...a),
  revokeDevice: jest.fn(),
}));

const mockRefreshLicence = jest.fn();

import { ToastProvider } from '../components/Toast';
import SyncScreen from '../screens/SyncScreen';

beforeEach(() => {
  jest.useFakeTimers();
  mockRefreshSession.mockReset();
  mockListDevices.mockReset();
  mockRefreshLicence.mockReset();
});
afterEach(() => { jest.useRealTimers(); });

describe('"Check devices linked"', () => {
  it('fetches one access token and runs the licence check and device list together', async () => {
    let resolveLicence!: (v: string) => void;
    let resolveDevices!: (v: any) => void;
    mockRefreshSession.mockResolvedValue({ ok: true, value: { access: 'tok_1' } });
    mockRefreshLicence.mockReturnValue(new Promise((r) => { resolveLicence = r; }));
    mockListDevices.mockReturnValue(new Promise((r) => { resolveDevices = r; }));

    render(<ToastProvider><SyncScreen /></ToastProvider>);
    fireEvent.press(screen.getByText('Check devices linked'));

    // both requests are in flight before either has resolved — proof they
    // run together rather than one after the other
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
    expect(mockRefreshLicence).toHaveBeenCalledWith('tok_1', 'acct_1');
    expect(mockListDevices).toHaveBeenCalledWith('tok_1');

    await act(async () => {
      resolveLicence('active');
      resolveDevices({ ok: true, value: { devices: [{ id: 'd1', name: 'Counter phone', kind: 'phone', created_at: '2026-01-01', last_seen: '2026-01-02' }] } });
      await Promise.resolve();
      await Promise.resolve();
    });

    // only ever one call to /v1/auth/refresh for the whole button press
    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Counter phone')).toBeTruthy();
  });
});
