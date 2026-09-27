/**
 * Cloud sync: connection, queue health, linked devices and the cloud copy.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react-native';

let mockDb: any;
const mockFns = {
  setSync: jest.fn(), refreshLicence: jest.fn(), restoreBackup: jest.fn(), run: jest.fn(),
  refreshSession: jest.fn(), listDevices: jest.fn(), revokeDevice: jest.fn(), downloadSnapshot: jest.fn(),
  writeBackup: jest.fn(), go: jest.fn(),
};
let mockPro = true;

jest.mock('../data/AppDataContext', () => ({
  useAppData: () => ({
    db: mockDb, setSync: mockFns.setSync, licFeature: () => mockPro,
    refreshLicence: mockFns.refreshLicence, restoreBackup: mockFns.restoreBackup,
  }),
  useAppDataSafe: () => ({ db: mockDb }),
}));
jest.mock('../data/AuthContext', () => ({
  useAuth: () => ({ account: { id: 'acct_1', email: 'owner@shop.com', refresh: 'refresh-token', localOnly: false } }),
}));
jest.mock('../nav/navigate', () => ({ useGo: () => mockFns.go }));
jest.mock('../data/useSyncRun', () => ({ useSyncRun: () => ({ run: mockFns.run }) }));
jest.mock('../data/authApi', () => ({
  refreshSession: (...a: any[]) => mockFns.refreshSession(...a),
  listDevices: (...a: any[]) => mockFns.listDevices(...a),
  revokeDevice: (...a: any[]) => mockFns.revokeDevice(...a),
}));
jest.mock('../data/syncClient', () => ({ downloadSnapshot: (...a: any[]) => mockFns.downloadSnapshot(...a) }));
jest.mock('../data/deviceBackup', () => ({ writeBackup: (...a: any[]) => mockFns.writeBackup(...a) }));

import { ToastProvider } from '../components/Toast';
import SyncScreen, { failedRuns } from '../screens/SyncScreen';

const book = { v: 1, firm: { name: 'Corner Shop' }, products: [{ id: 'p' }], sales: [{ id: 's' }, { id: 't' }], journal: [] };
const devices = [
  { id: 'dev_me', name: 'Counter phone', kind: 'phone', platform: 'Android', created_at: '2026-09-17T10:00:00Z', last_seen: '' },
  { id: 'dev_old', name: 'Old tablet', kind: 'tablet', platform: 'Android', created_at: '2026-01-02T10:00:00Z', last_seen: '' },
];

const wrap = async () => {
  render(<ToastProvider><SyncScreen /></ToastProvider>);
  await act(async () => { await Promise.resolve(); });
};

beforeEach(() => {
  jest.useFakeTimers();
  mockPro = true;
  Object.values(mockFns).forEach((f) => f.mockReset());
  mockFns.refreshSession.mockResolvedValue({ ok: true, value: { access: 'tok' } });
  mockFns.listDevices.mockResolvedValue({ ok: true, value: { devices } });
  mockDb = {
    settings: { theme: 'light' },
    session: { role: 'owner', online: true },
    sync: { on: true, pending: [], log: [], lastPush: '2026-09-27T06:00:00Z', businessId: 'biz_1', deviceId: 'dev_me' },
    queue: [],
    licence: { licence: { limits: { devices: 4 } } },
  };
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers(); (Alert.alert as jest.Mock).mockRestore(); cleanup(); });

describe('Cloud sync', () => {
  it('shows it is connected and the queue is healthy', async () => {
    await wrap();
    expect(screen.getByText('Connected to the cloud')).toBeTruthy();
    expect(screen.getByText('Pending: 0')).toBeTruthy();
    expect(screen.getByText('Deferred: 0')).toBeTruthy();
    expect(screen.getByText('Failed: 0')).toBeTruthy();
    expect(screen.getByText(/Queue is healthy/)).toBeTruthy();
  });

  it('counts waiting changes and failed runs since the last good one', async () => {
    mockDb.queue = [{ id: 'q1' }, { id: 'q2' }];
    mockDb.sync.log = [{ id: 'a', ok: false, note: 'old', ts: '' }, { id: 'b', ok: true, note: 'ok', ts: '' }, { id: 'c', ok: false, note: 'No internet', ts: '' }];
    await wrap();
    expect(screen.getByText('Pending: 2')).toBeTruthy();
    expect(screen.getByText('Failed: 1')).toBeTruthy();
    expect(screen.getByText(/failed: No internet/)).toBeTruthy();
    expect(failedRuns([{ ok: true }, { ok: false }, { ok: false }])).toBe(2);
    expect(failedRuns([])).toBe(0);
  });

  it('lists the linked devices against the licence limit and marks this one', async () => {
    await wrap();
    expect(mockFns.listDevices).toHaveBeenCalledWith('tok');
    expect(screen.getByText('2 / 4')).toBeTruthy();
    expect(screen.getByText('Counter phone')).toBeTruthy();
    expect(screen.getByText('This device')).toBeTruthy();
  });

  it('checking linked devices refreshes the licence at the same time, with one token', async () => {
    await wrap();
    mockFns.refreshSession.mockClear();
    await act(async () => { fireEvent.press(screen.getByLabelText('Check devices linked')); });
    expect(mockFns.refreshSession).toHaveBeenCalledTimes(1);
    expect(mockFns.refreshLicence).toHaveBeenCalledWith('tok', 'acct_1');
  });

  it('removes a device after asking', async () => {
    mockFns.revokeDevice.mockResolvedValue({ ok: true, value: {} });
    await wrap();
    fireEvent.press(screen.getByLabelText('Remove Old tablet'));
    const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    await act(async () => { await buttons.find((b: any) => b.text === 'Remove').onPress(); });
    expect(mockFns.revokeDevice).toHaveBeenCalledWith('tok', 'dev_old');
    expect(screen.queryByText('Old tablet')).toBeNull();
  });

  it('Back up now runs the real sync', async () => {
    mockFns.run.mockResolvedValue({ ok: true, message: 'Everything is up to date' });
    await wrap();
    await act(async () => { fireEvent.press(screen.getByText('Back up now')); });
    expect(mockFns.run).toHaveBeenCalledWith('manual');
    expect(screen.getByText('Everything is up to date')).toBeTruthy();
  });

  it('loads the cloud copy and restores it only after saving the current books on the phone', async () => {
    mockFns.downloadSnapshot.mockResolvedValue({ ok: true, value: { data: book, updatedAt: '2026-09-26T18:00:00Z', version: 7 } });
    await wrap();
    await act(async () => { fireEvent.press(screen.getByText('Load cloud backup')); });
    expect(mockFns.downloadSnapshot).toHaveBeenCalledWith('tok', 'biz_1');
    expect(screen.getByText('Latest cloud copy · version 7')).toBeTruthy();
    fireEvent.press(screen.getByText('Restore this copy'));
    const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    act(() => { buttons.find((b: any) => b.text === 'Restore').onPress(); });
    expect(mockFns.writeBackup).toHaveBeenCalledWith(mockDb, false);
    expect(mockFns.restoreBackup.mock.calls[0][0].firm.name).toBe('Corner Shop');
  });

  it('disconnecting asks first', async () => {
    await wrap();
    fireEvent.press(screen.getByLabelText('Disconnect'));
    expect(mockFns.setSync).not.toHaveBeenCalled();
    const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    buttons.find((b: any) => b.text === 'Disconnect').onPress();
    expect(mockFns.setSync).toHaveBeenCalledWith({ on: false });
  });

  it('turning it on connects and backs up straight away', async () => {
    mockDb.sync.on = false;
    mockFns.run.mockResolvedValue({ ok: true, message: 'Everything is up to date' });
    await wrap();
    expect(screen.getByText('Cloud sync is off')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByText('Connect and back up')); });
    expect(mockFns.setSync).toHaveBeenCalledWith({ on: true });
    expect(mockFns.run).toHaveBeenCalledWith('manual');
  });

  it('explains Pro instead of offering a switch that does nothing', async () => {
    mockPro = false;
    await wrap();
    expect(screen.getByText('Cloud sync is part of Pro')).toBeTruthy();
    fireEvent.press(screen.getByText('See plans and licence'));
    expect(mockFns.go).toHaveBeenCalledWith('Plans');
  });
});
