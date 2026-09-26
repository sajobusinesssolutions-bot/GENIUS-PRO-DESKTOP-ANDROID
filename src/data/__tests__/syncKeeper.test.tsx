/**
 * A server that is down used to be retried every fifteen seconds, forever, for
 * as long as the app stayed open. These pin down the fix: each consecutive
 * failure doubles the wait before the next try, a success resets it, and the
 * operator only hears about it once the trouble looks ongoing rather than on
 * the very first blip.
 */
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';

const mockDb: any = {
  settings: { theme: 'light' },
  sync: { on: true },
  session: { online: true },
  queue: [] as any[],
};

jest.mock('../AppDataContext', () => ({
  useAppData: () => ({ db: mockDb, ready: true, licFeature: () => true }),
  useAppDataSafe: () => ({ db: mockDb }),
}));
jest.mock('../AuthContext', () => ({ useAuth: () => ({ account: { id: 'a1', localOnly: false } }) }));

const mockRun = jest.fn();
jest.mock('../useSyncRun', () => ({ useSyncRun: () => ({ run: mockRun }) }));

import { ToastProvider } from '../../components/Toast';
import SyncKeeper from '../SyncKeeper';

function setup() {
  return render(
    <ToastProvider>
      <SyncKeeper />
    </ToastProvider>,
  );
}

/** Lets a fake-timer tick's fired promise chain (run().then(...)) settle. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => { jest.advanceTimersByTime(ms); });
  await flush();
}

beforeEach(() => {
  jest.useFakeTimers();
  mockRun.mockReset();
  mockDb.queue = [];
});
afterEach(() => { jest.useRealTimers(); });

describe('SyncKeeper backing off after a failure', () => {
  it('tries again fifteen seconds later while nothing has gone wrong', async () => {
    mockRun.mockResolvedValue({ ok: true, sent: 0, message: 'Everything is up to date' });
    setup();
    await flush(); // the attempt made the moment it mounts
    expect(mockRun).toHaveBeenCalledTimes(1);

    await advance(15 * 1000);
    expect(mockRun).toHaveBeenCalledTimes(2);
  });

  it('doubles the wait after each failure instead of retrying on the normal cadence', async () => {
    mockRun.mockResolvedValue({ ok: false, sent: 0, message: 'The server did not respond.' });
    setup();
    await flush();
    expect(mockRun).toHaveBeenCalledTimes(1); // first failure: next wait is 30s

    await advance(15 * 1000);
    expect(mockRun).toHaveBeenCalledTimes(1); // too soon — still backing off

    await advance(15 * 1000); // 30s total since the failure
    expect(mockRun).toHaveBeenCalledTimes(2); // second failure: next wait is 60s

    await advance(30 * 1000);
    expect(mockRun).toHaveBeenCalledTimes(2); // too soon for the doubled wait

    await advance(30 * 1000); // 60s total since the second failure
    expect(mockRun).toHaveBeenCalledTimes(3);
  });

  it('stays quiet through the first couple of failures, then tells the operator', async () => {
    mockRun.mockResolvedValue({ ok: false, sent: 0, message: 'The server did not respond.' });
    setup();
    await flush();
    await advance(30 * 1000);
    expect(screen.queryByText(/Cloud sync is having trouble/)).toBeNull();

    await advance(60 * 1000); // the third consecutive failure
    expect(screen.getByText(/Cloud sync is having trouble.*The server did not respond/)).toBeTruthy();
  });

  it('resets to the normal cadence and forgets it already warned once, after a success', async () => {
    mockRun
      .mockResolvedValueOnce({ ok: false, sent: 0, message: 'The server did not respond.' })
      .mockResolvedValueOnce({ ok: false, sent: 0, message: 'The server did not respond.' })
      .mockResolvedValueOnce({ ok: false, sent: 0, message: 'The server did not respond.' }) // 3rd: warns
      .mockResolvedValue({ ok: true, sent: 0, message: 'Everything is up to date' });
    setup();
    await flush();
    await advance(30 * 1000);
    await advance(60 * 1000);
    expect(screen.getByText(/Cloud sync is having trouble/)).toBeTruthy();

    await advance(10 * 60 * 1000); // a run in here succeeds and resets the backoff
    expect(mockRun.mock.results.length).toBeGreaterThanOrEqual(4);

    mockRun.mockClear();
    mockRun.mockResolvedValue({ ok: false, sent: 0, message: 'The server did not respond.' });
    await advance(15 * 1000); // back to the normal cadence, not still-doubled
    expect(mockRun).toHaveBeenCalledTimes(1);
  });
});
