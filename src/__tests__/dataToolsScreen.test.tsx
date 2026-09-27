/**
 * Device backups on the Data tools screen: encrypted .sa files, a schedule,
 * and a restore that always keeps a copy of the books it replaces.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react-native';

let mockDb: any;
const mockFns = {
  setSetting: jest.fn(), restoreBackup: jest.fn(), addProduct: jest.fn(), startFinancialYear: jest.fn(),
  writeBackup: jest.fn(), listBackups: jest.fn(), readBackup: jest.fn(), deleteBackup: jest.fn(),
};

jest.mock('../data/AppDataContext', () => ({
  useAppData: () => ({ db: mockDb, ...mockFns }),
  useAppDataSafe: () => ({ db: mockDb }),
}));
jest.mock('../data/deviceBackup', () => ({
  writeBackup: (...a: any[]) => mockFns.writeBackup(...a),
  listBackups: () => mockFns.listBackups(),
  readBackup: (...a: any[]) => mockFns.readBackup(...a),
  deleteBackup: (...a: any[]) => mockFns.deleteBackup(...a),
  backupFolderPath: () => '/data/user/0/app/files/backups',
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => undefined) }));
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({ exists: false, delete: jest.fn() })),
  Paths: { document: { uri: 'file:///doc' }, cache: { uri: 'file:///cache' } },
}));

import { ToastProvider } from '../components/Toast';
import DataToolsScreen from '../screens/DataToolsScreen';

const wrap = () => render(<ToastProvider><DataToolsScreen /></ToastProvider>);
const sample = { name: 'GeniusPOS_Corner-Shop_2026-09-27_060509.sa', uri: 'file:///doc/backups/a.sa', size: 20480, at: Date.now(), auto: false };

beforeEach(() => {
  jest.useFakeTimers();
  Object.values(mockFns).forEach((f) => f.mockReset());
  mockFns.listBackups.mockReturnValue([]);
  mockFns.writeBackup.mockReturnValue({ ...sample });
  mockDb = {
    settings: { theme: 'light', backupSchedule: 'off', lastBackupAt: '' },
    firm: { name: 'Corner Shop' },
    products: [], parties: [], sales: [], purchases: [], journal: [], queue: [],
    archivedFinancialYears: [], financialYear: null,
  };
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers(); (Alert.alert as jest.Mock).mockRestore(); cleanup(); });

describe('Device backup', () => {
  it('says so when there are none yet', () => {
    wrap();
    expect(screen.getByText('No device backups found.')).toBeTruthy();
  });

  it('writes an encrypted backup and records when', () => {
    wrap();
    fireEvent.press(screen.getByText('Backup now'));
    expect(mockFns.writeBackup).toHaveBeenCalledWith(mockDb, false);
    expect(mockFns.setSetting).toHaveBeenCalledWith({ lastBackupAt: expect.any(String) });
    expect(screen.getByText(/Encrypted backup saved/)).toBeTruthy();
  });

  it('reports a backup that failed instead of claiming it worked', () => {
    mockFns.writeBackup.mockImplementation(() => { throw new Error('This file is not a complete Genius POS backup.'); });
    wrap();
    fireEvent.press(screen.getByText('Backup now'));
    expect(mockFns.setSetting).not.toHaveBeenCalled();
    expect(screen.getByText('This file is not a complete Genius POS backup.')).toBeTruthy();
  });

  it('sets the automatic schedule, including monthly', () => {
    wrap();
    fireEvent.press(screen.getByText('Monthly'));
    expect(mockFns.setSetting).toHaveBeenCalledWith({ backupSchedule: 'monthly' });
  });

  it('lists the backups on the phone', () => {
    mockFns.listBackups.mockReturnValue([sample]);
    wrap();
    expect(screen.getByText(sample.name)).toBeTruthy();
    expect(screen.getByText(/20 KB/)).toBeTruthy();
  });

  it('saves the current books before a restore replaces them', async () => {
    mockFns.listBackups.mockReturnValue([sample]);
    const restored = { firm: { name: 'Corner Shop' } };
    mockFns.readBackup.mockResolvedValue(restored);
    wrap();
    fireEvent.press(screen.getByLabelText('Restore ' + sample.name));
    const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    await act(async () => { await buttons.find((b: any) => b.text === 'Restore').onPress(); });
    expect(mockFns.readBackup).toHaveBeenCalledWith(sample.uri);
    expect(mockFns.writeBackup).toHaveBeenCalledWith(mockDb, false);
    expect(mockFns.restoreBackup).toHaveBeenCalledWith(restored);
    expect(mockFns.writeBackup.mock.invocationCallOrder[0]).toBeLessThan(mockFns.restoreBackup.mock.invocationCallOrder[0]);
  });

  it('does not touch the books when the backup cannot be read', async () => {
    mockFns.listBackups.mockReturnValue([sample]);
    mockFns.readBackup.mockRejectedValue(new Error('This backup is damaged or has been changed, so it cannot be restored.'));
    wrap();
    fireEvent.press(screen.getByLabelText('Restore ' + sample.name));
    const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    await act(async () => { await buttons.find((b: any) => b.text === 'Restore').onPress(); });
    expect(mockFns.restoreBackup).not.toHaveBeenCalled();
    expect(screen.getByText(/damaged or has been changed/)).toBeTruthy();
  });

  it('deletes a backup only after asking', () => {
    mockFns.listBackups.mockReturnValue([sample]);
    wrap();
    fireEvent.press(screen.getByLabelText('Delete ' + sample.name));
    expect(mockFns.deleteBackup).not.toHaveBeenCalled();
    const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    buttons.find((b: any) => b.text === 'Delete').onPress();
    expect(mockFns.deleteBackup).toHaveBeenCalledWith(sample.uri);
  });
});
