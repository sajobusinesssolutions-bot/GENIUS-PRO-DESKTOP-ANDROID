/**
 * The first tests that render anything.
 *
 * Everything else in this project is tested at the data layer, which cannot see
 * a screen that forgot its permission check — the exact defect these cover.
 * A gate that silently passes everybody looks identical to a working one until
 * somebody opens the books.
 */
import React from 'react';
import { render, screen } from '@testing-library/react-native';

const mockDb: any = { session: { role: 'cashier' }, settings: { theme: 'light' }, coa: [] };

// the screens reach for the book through both of these
jest.mock('../data/AppDataContext', () => ({
  useAppData: () => ({ db: mockDb, money: (n: number) => 'Sh ' + n }),
  useAppDataSafe: () => ({ db: mockDb }),
}));

import { useCan, useIsOwner, Denied } from '../components/Gate';
import { JournalEntryScreen } from '../screens/AccountingScreens';
import { Text } from 'react-native';

function Probe({ perm }: { perm: string }) {
  const allowed = useCan(perm);
  const owner = useIsOwner();
  return <Text>{(allowed ? 'yes' : 'no') + '/' + (owner ? 'owner' : 'not-owner')}</Text>;
}

describe('useCan', () => {
  afterEach(() => { mockDb.session.role = 'cashier'; });

  it('refuses a cashier the finance permissions', () => {
    render(<Probe perm="finance.manage_accounts" />);
    expect(screen.getByText('no/not-owner')).toBeTruthy();
  });

  it('lets a cashier see what a cashier is meant to see', () => {
    render(<Probe perm="sales.create" />);
    expect(screen.getByText('yes/not-owner')).toBeTruthy();
  });

  it('gives the owner everything, and knows they are the owner', () => {
    mockDb.session.role = 'owner';
    render(<Probe perm="finance.manage_accounts" />);
    expect(screen.getByText('yes/owner')).toBeTruthy();
  });
});

describe('Denied', () => {
  it('says what is refused and why, rather than showing an empty screen', () => {
    render(<Denied title="Journal entries are owner work" hint="It needs the finance permission." />);
    expect(screen.getByText('Journal entries are owner work')).toBeTruthy();
    expect(screen.getByText('It needs the finance permission.')).toBeTruthy();
  });
});

describe('JournalEntryScreen', () => {
  afterEach(() => { mockDb.session.role = 'cashier'; });

  it('will not open its form for someone without the finance permission', () => {
    render(<JournalEntryScreen />);
    expect(screen.getByText('Journal entries are owner work')).toBeTruthy();
    // the form itself must not be mounted at all
    expect(screen.queryByText('Amount')).toBeNull();
  });
});
