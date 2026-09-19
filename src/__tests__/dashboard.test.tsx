/**
 * The dashboard was rewritten to answer four questions and stop there. These
 * tests hold it to that: the figure that matters is on screen, and the blocks
 * that only sometimes matter stay away when they do not.
 *
 * A screen that quietly shows an extra empty card is exactly the kind of creep
 * that turned the old one into nine blocks, and nothing at the data layer can
 * see it happen.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

const now = new Date();
const iso = (daysBack: number) => new Date(now.getTime() - daysBack * 86400000).toISOString();

function sale(over: any = {}) {
  return {
    id: 's1', no: 'INV-001', ts: iso(0), status: 'ok', total: 1000, due: 0,
    partyId: null, lines: [], ...over,
  };
}

const mockState: any = {
  sales: [],
  parties: [],
  products: [],
  purchaseOrders: [],
  stockTakes: [],
  estimates: [],
  claims: [],
  queue: [],
  balances: {} as Record<string, number>,
  recurring: [] as any[],
  online: true,
};

const mockGo = jest.fn();
jest.mock('../nav/navigate', () => ({ useGo: () => mockGo }));

jest.mock('../data/AppDataContext', () => {
  const db = {
    get sales() { return mockState.sales; },
    get parties() { return mockState.parties; },
    get products() { return mockState.products; },
    get purchaseOrders() { return mockState.purchaseOrders; },
    get stockTakes() { return mockState.stockTakes; },
    get estimates() { return mockState.estimates; },
    get claims() { return mockState.claims; },
    get queue() { return mockState.queue; },
    get session() { return { role: 'owner', userId: 'u1', online: mockState.online }; },
    firm: { name: 'Corner Shop' },
    settings: { theme: 'light' },
  };
  const api = {
    db,
    money: (n: number) => 'Sh ' + Math.round(n).toLocaleString('en-GB'),
    me: () => ({ id: 'u1', name: 'Ada' }),
    stockOf: (p: any) => p.qty ?? 0,
    party: (id: string) => mockState.parties.find((x: any) => x.id === id),
    partyBalance: (id: string) => mockState.balances[id] || 0,
    accountBalance: () => mockState.balances.cash || 0,
    dueRecurring: () => mockState.recurring,
  };
  return { useAppData: () => api, useAppDataSafe: () => api };
});

import DashboardScreen from '../screens/DashboardScreen';

function reset() {
  mockState.sales = [];
  mockState.parties = [];
  mockState.products = [];
  mockState.purchaseOrders = [];
  mockState.stockTakes = [];
  mockState.estimates = [];
  mockState.claims = [];
  mockState.queue = [];
  mockState.balances = {};
  mockState.recurring = [];
  mockState.online = true;
  mockGo.mockClear();
}

beforeEach(reset);

describe('the takings card', () => {
  it('leads with one figure — the day\'s takings', () => {
    mockState.sales = [sale({ total: 1000 }), sale({ id: 's2', total: 500 })];
    render(<DashboardScreen />);
    expect(screen.getByTestId('takings')).toHaveTextContent('Sh 1,500');
    expect(screen.getByText('2 bills · Sh 750 average')).toBeTruthy();
  });

  it('says so plainly on a quiet day rather than showing an average of nothing', () => {
    render(<DashboardScreen />);
    expect(screen.getByTestId('takings')).toHaveTextContent('Sh 0');
    expect(screen.getByText('No bills yet')).toBeTruthy();
  });

  it('changes the figure when the period is changed', () => {
    // one today, one four days ago: the week holds both
    mockState.sales = [sale({ total: 1000 }), sale({ id: 's2', ts: iso(4), total: 400 })];
    render(<DashboardScreen />);
    expect(screen.getByTestId('takings')).toHaveTextContent('Sh 1,000');

    fireEvent.press(screen.getByText('Week'));
    expect(screen.getByTestId('takings')).toHaveTextContent('Sh 1,400');
  });

  it('opens the reports, where the detail it no longer shows now lives', () => {
    render(<DashboardScreen />);
    fireEvent.press(screen.getByTestId('takings'));
    expect(mockGo).toHaveBeenCalledWith('Reports');
  });
});

describe('the money tiles', () => {
  it('shows the drawer and what is owed', () => {
    mockState.balances = { cash: 2500, p1: 700 };
    mockState.parties = [{ id: 'p1', name: 'Juma' }];
    render(<DashboardScreen />);
    expect(screen.getByText('In the drawer')).toBeTruthy();
    expect(screen.getByText('Sh 2,500')).toBeTruthy();
    expect(screen.getByText('Owed to you')).toBeTruthy();
    expect(screen.getByText('Sh 700')).toBeTruthy();
  });

  it('says nothing about overdue money when none is overdue', () => {
    mockState.balances = { cash: 100, p1: 700 };
    mockState.parties = [{ id: 'p1', name: 'Juma' }];
    mockState.sales = [sale({ due: 700, ts: iso(3) })];
    render(<DashboardScreen />);
    expect(screen.queryByText(/late/)).toBeNull();
  });

  it('marks the late share once a bill passes thirty days', () => {
    mockState.balances = { cash: 100, p1: 700 };
    mockState.parties = [{ id: 'p1', name: 'Juma' }];
    mockState.sales = [sale({ due: 700, ts: iso(40) })];
    render(<DashboardScreen />);
    expect(screen.getByText('Sh 700 late')).toBeTruthy();
  });
});

describe('"Needs you"', () => {
  it('is absent entirely when nothing needs doing', () => {
    render(<DashboardScreen />);
    expect(screen.queryByText('Needs you')).toBeNull();
  });

  it('appears when something does, and leads with the costliest to ignore', () => {
    mockState.sales = [sale({ due: 500, ts: iso(45) })];
    mockState.products = [{ id: 'p', name: 'Sugar', active: true, reorder: 5, qty: 1 }];
    render(<DashboardScreen />);
    expect(screen.getByText('Needs you')).toBeTruthy();
    expect(screen.getByText('1 bill over 30 days')).toBeTruthy();
  });

  it('caps the list and offers the rest, instead of growing without limit', () => {
    mockState.sales = [sale({ due: 500, ts: iso(45) })];
    mockState.products = [{ id: 'p', name: 'Sugar', active: true, reorder: 5, qty: 1 }];
    mockState.purchaseOrders = [{ id: 'po', status: 'open' }];
    mockState.stockTakes = [{ id: 'st', status: 'open' }];
    mockState.estimates = [{ id: 'e', status: 'open' }];
    render(<DashboardScreen />);
    // five things to do, three shown, the remainder offered as a link
    expect(screen.getByText('2 more')).toBeTruthy();
    expect(screen.queryByText('1 quotation open')).toBeNull();
  });
});

describe('what the redesign took away', () => {
  it('shows no banner when there is nothing to say about syncing', () => {
    render(<DashboardScreen />);
    expect(screen.queryByText(/waiting/)).toBeNull();
    expect(screen.queryByText(/synced/)).toBeNull();
  });

  it('still speaks up when the device is offline', () => {
    mockState.online = false;
    mockState.queue = [{ id: 'q1' }];
    render(<DashboardScreen />);
    expect(screen.getByText('Offline — 1 change waiting')).toBeTruthy();
  });

  it('no longer carries the quick-action grid, which the tab bar already holds', () => {
    render(<DashboardScreen />);
    expect(screen.queryByText('Quick actions')).toBeNull();
  });

  it('no longer carries a category breakdown or a second week card', () => {
    mockState.sales = [sale({ total: 1000 })];
    render(<DashboardScreen />);
    expect(screen.queryByText('This week')).toBeNull();
    expect(screen.queryByText('Bills · Today')).toBeNull();
  });
});

describe('latest bills', () => {
  it('lists the most recent first, with who and how much', () => {
    mockState.parties = [{ id: 'p1', name: 'Juma' }];
    mockState.sales = [
      sale({ id: 'a', no: 'INV-001', total: 100, ts: iso(2) }),
      sale({ id: 'b', no: 'INV-002', total: 200, partyId: 'p1' }),
    ];
    render(<DashboardScreen />);
    expect(screen.getByText('Juma')).toBeTruthy();
    expect(screen.getByText('Walk-in')).toBeTruthy();
  });

  it('opens the bill that was tapped', () => {
    mockState.sales = [sale({ id: 'a', no: 'INV-001', total: 100 })];
    render(<DashboardScreen />);
    fireEvent.press(screen.getByText('Walk-in'));
    expect(mockGo).toHaveBeenCalledWith('SaleDetail', { saleId: 'a' });
  });

  it('invites a first sale when there are none', () => {
    render(<DashboardScreen />);
    expect(screen.getByText('No sales yet')).toBeTruthy();
  });
});
