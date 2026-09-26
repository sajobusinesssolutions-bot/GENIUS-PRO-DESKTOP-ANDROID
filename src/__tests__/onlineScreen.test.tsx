/**
 * Same bug, same screen family: "Sync now" here called the same leftover
 * flushQueue() as DataToolsScreen's "Send anything waiting" (see
 * dataToolsScreen.test.tsx) and set lastPush/lastAt to "now" regardless of
 * whether anything actually reached the server. This screen is not currently
 * reachable from any menu, but it is live code, and fixed the same way.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, act } from '@testing-library/react-native';

const mockSetSync = jest.fn();
const mockToggleOnline = jest.fn();
const mockDb: any = {
  settings: { theme: 'light' },
  session: { role: 'owner', online: true },
  firm: { name: 'Corner Shop' },
  queue: [{ id: 'q1', ts: '2026-01-01', kind: 'sale', ref: 's1' }],
  sync: {
    on: true, pending: [], strict: false, devices: [],
    lastPush: null, lastPull: null, cursor: 0,
  },
};

jest.mock('../data/AppDataContext', () => ({
  useAppData: () => ({
    db: mockDb,
    setSync: mockSetSync,
    licFeature: () => true,
    toggleOnline: mockToggleOnline,
  }),
  useAppDataSafe: () => ({ db: mockDb }),
}));
jest.mock('../nav/navigate', () => ({ useGo: () => jest.fn() }));

const mockRun = jest.fn();
jest.mock('../data/useSyncRun', () => ({ useSyncRun: () => ({ run: mockRun }) }));

import { OnlineScreen } from '../screens/SystemScreens';

beforeEach(() => {
  mockRun.mockReset();
  mockSetSync.mockReset();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => { (Alert.alert as jest.Mock).mockRestore(); });

describe('"Sync now"', () => {
  it('calls the real sync engine rather than faking a completed push', async () => {
    mockRun.mockResolvedValue({ ok: true, sent: 1, message: '1 change sent, 0 changes received' });
    render(<OnlineScreen />);

    await act(async () => {
      fireEvent.press(screen.getByText('Sync now'));
    });

    expect(mockRun).toHaveBeenCalledWith('manual');
    // the fix removed the direct setSync({ lastPush, lastAt }) call that used
    // to run unconditionally; only a real sync run may set those now
    expect(mockSetSync).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith('Sync', '1 change sent, 0 changes received');
  });

  it('reports a real failure instead of claiming everything was sent', async () => {
    mockRun.mockResolvedValue({ ok: false, sent: 0, message: 'Your session has expired. Sign out and in again.' });
    render(<OnlineScreen />);

    await act(async () => {
      fireEvent.press(screen.getByText('Sync now'));
    });

    expect(Alert.alert).toHaveBeenCalledWith('Sync', 'Your session has expired. Sign out and in again.');
  });
});
