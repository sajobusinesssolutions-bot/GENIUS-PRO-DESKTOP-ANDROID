/**
 * "Send anything waiting" used to call a leftover flushQueue() that marked
 * every queued sale as sent and emptied the queue without contacting the
 * server at all — the button did the opposite of what it said. This pins
 * down the fix: the button must go through the real sync engine and report
 * whatever that engine actually says happened, nothing invented locally.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, screen, fireEvent, act } from '@testing-library/react-native';

const mockDb: any = {
  settings: { theme: 'light', backupSchedule: 'off' },
  products: [], parties: [], sales: [], purchases: [], journal: [],
  queue: [{ id: 'q1', ts: '2026-01-01', kind: 'sale', ref: 's1' }],
  archivedFinancialYears: [],
  financialYear: null,
};

jest.mock('../data/AppDataContext', () => ({
  useAppData: () => ({
    db: mockDb,
    startFinancialYear: jest.fn(),
    restoreBackup: jest.fn(),
    addProduct: jest.fn(),
    setSetting: jest.fn(),
  }),
  useAppDataSafe: () => ({ db: mockDb }),
}));

const mockRun = jest.fn();
jest.mock('../data/useSyncRun', () => ({ useSyncRun: () => ({ run: mockRun }) }));

import { DataToolsScreen } from '../screens/AdminScreens';

beforeEach(() => {
  mockRun.mockReset();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => { (Alert.alert as jest.Mock).mockRestore(); });

describe('"Send anything waiting"', () => {
  it('calls the real sync engine rather than clearing the queue itself', async () => {
    mockRun.mockResolvedValue({ ok: true, sent: 1, message: '1 change sent, 0 changes received' });
    render(<DataToolsScreen />);

    await act(async () => {
      fireEvent.press(screen.getByText('Send anything waiting'));
    });

    expect(mockRun).toHaveBeenCalledWith('manual');
    // the queue itself is never touched here — only a real, acknowledged
    // push (dropQueued, driven by the server's response) may empty it
    expect(mockDb.queue.length).toBe(1);
  });

  it('reports whatever the sync engine actually said, not an invented success', async () => {
    mockRun.mockResolvedValue({ ok: false, sent: 0, message: 'This phone has no internet right now.' });
    render(<DataToolsScreen />);

    await act(async () => {
      fireEvent.press(screen.getByText('Send anything waiting'));
    });

    expect(Alert.alert).toHaveBeenCalledWith('Sync', 'This phone has no internet right now.');
  });
});
