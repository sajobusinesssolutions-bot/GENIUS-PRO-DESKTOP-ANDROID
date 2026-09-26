/**
 * A run of failed writes to the phone used to leave nothing on screen — see
 * storage.ts's save-status tracking. This checks the other half: the toast
 * actually appears once writing is flagged as failing, and a second one says
 * so once it recovers.
 */
import React from 'react';
import { act, render, screen } from '@testing-library/react-native';

let listener: ((status: 'ok' | 'failing') => void) | null = null;
jest.mock('../storage', () => ({
  currentSaveStatus: () => 'ok',
  onSaveStatus: (cb: (status: 'ok' | 'failing') => void) => {
    listener = cb;
    return () => { listener = null; };
  },
}));

import { ToastProvider } from '../../components/Toast';
import StorageKeeper from '../StorageKeeper';

function setup() {
  return render(
    <ToastProvider>
      <StorageKeeper />
    </ToastProvider>,
  );
}

beforeEach(() => { listener = null; jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe('StorageKeeper', () => {
  it('says nothing while writes are landing', () => {
    setup();
    expect(screen.queryByText(/not being saved/)).toBeNull();
  });

  it('tells the operator once writing is flagged as failing', () => {
    setup();
    act(() => { listener?.('failing'); });
    expect(screen.getByText(/Changes are not being saved on this phone/)).toBeTruthy();
  });

  it('tells the operator again once writing recovers', () => {
    setup();
    act(() => { listener?.('failing'); });
    act(() => { listener?.('ok'); });
    expect(screen.getByText(/Saving is working again/)).toBeTruthy();
  });
});
