/**
 * A manual journal entry is the one place the app lets someone move money
 * between ledgers with no bill or sale behind it. postJournal() itself
 * refuses anything where debits and credits don't add up (see
 * logic.test.ts's "journal rounding" suite for that layer), but that check
 * only catches an imbalance — it says nothing about *which* account got
 * debited and which got credited. A UI bug that swapped those per side
 * would still balance, and would post a real, wrong entry with nothing
 * downstream able to catch it. This tests that the Simple form's
 * credit/debit toggle builds the two lines the right way round, and that
 * the "not ready" cases show as not ready rather than posting.
 *
 * Note on the "not ready" checks: this app's Button component disables
 * itself by nulling the onPress it hands its inner Pressable, but the
 * *outer* <Button onPress={post} .../> element — as written by the
 * caller — still carries that onPress as an ordinary prop. Testing
 * Library's fireEvent.press walks up the element tree for the nearest
 * onPress it can find, reaches that outer element, and fires post()
 * regardless of disabled — a simulation quirk, not something a real
 * screen tap can do (a real disabled Pressable never dispatches a press
 * to begin with). So "not ready" is checked here by asserting on what
 * the screen shows instead of trying to press a disabled button.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

const mockPostJournal = jest.fn();
const mockDb: any = {
  settings: { theme: 'light', askWhoOnSave: false },
  session: { role: 'owner', userId: 'u1', online: true },
  users: [{ id: 'u1', name: 'Amina', role: 'owner', active: true }],
  coa: [
    { id: 'cash', code: '1000', name: 'Cash', type: 'asset', builtin: true, active: true },
    { id: 'sales', code: '4000', name: 'Sales', type: 'income', builtin: true, active: true },
  ],
};

jest.mock('../data/AppDataContext', () => ({
  useAppData: () => ({
    db: mockDb,
    money: (n: number) => 'Sh ' + n,
    postJournal: mockPostJournal,
    me: () => mockDb.users.find((u: any) => u.id === mockDb.session.userId),
  }),
  useAppDataSafe: () => ({ db: mockDb }),
}));

import { ToastProvider } from '../components/Toast';
import { JournalEntryScreen } from '../screens/AccountingScreens';

const nav: any = { goBack: jest.fn() };
const renderIt = () => render(
  <ToastProvider>
    <JournalEntryScreen navigation={nav} route={{ key: 'k', name: 'JournalEntry' } as any} />
  </ToastProvider>,
);

/** The "this will post" summary only appears once the entry is ready. */
const isReady = () => screen.queryAllByText('Dr').length > 0;

function pickCategory(label: string) {
  // the ledger box opens a searchable list; the name is the last match on screen
  fireEvent.press(screen.getByText('Choose a ledger'));
  const name = label.replace(/^[0-9]+ · /, '');
  const hits = screen.getAllByText(name);
  fireEvent.press(hits[hits.length - 1]);
}

beforeEach(() => {
  jest.useFakeTimers();
  mockPostJournal.mockReset();
  nav.goBack.mockReset();
});
afterEach(() => { jest.useRealTimers(); });

describe('a Simple entry', () => {
  it('credits the chosen ledger and debits the contra account', () => {
    mockPostJournal.mockReturnValue(true);
    renderIt();
    fireEvent.press(screen.getByText('Credit'));
    pickCategory('4000 · Sales');
    fireEvent.changeText(screen.getByPlaceholderText('0'), '5000');
    fireEvent.changeText(screen.getByPlaceholderText('What it is for'), 'Cash sale');
    expect(isReady()).toBe(true);
    fireEvent.press(screen.getByText('Save entry'));

    expect(mockPostJournal).toHaveBeenCalledTimes(1);
    const o = mockPostJournal.mock.calls[0][0];
    expect(o.lines).toEqual([{ acc: 'sales', cr: 5000 }, { acc: 'cash', dr: 5000 }]);
  });

  it('flips to debiting the chosen ledger and crediting the contra account', () => {
    mockPostJournal.mockReturnValue(true);
    renderIt();
    fireEvent.press(screen.getByText('Debit'));
    pickCategory('4000 · Sales');
    fireEvent.changeText(screen.getByPlaceholderText('0'), '5000');
    fireEvent.changeText(screen.getByPlaceholderText('What it is for'), 'Reversal');
    fireEvent.press(screen.getByText('Save entry'));

    const o = mockPostJournal.mock.calls[0][0];
    expect(o.lines).toEqual([{ acc: 'sales', dr: 5000 }, { acc: 'cash', cr: 5000 }]);
  });

  it('is not ready to post against itself — the same ledger on both sides', () => {
    renderIt();
    pickCategory('1000 · Cash'); // same as the contra default (the only asset account)
    fireEvent.changeText(screen.getByPlaceholderText('0'), '5000');
    fireEvent.changeText(screen.getByPlaceholderText('What it is for'), 'Oops');
    expect(isReady()).toBe(false);
  });

  it('is not ready to post with no description', () => {
    renderIt();
    pickCategory('4000 · Sales');
    fireEvent.changeText(screen.getByPlaceholderText('0'), '5000');
    expect(isReady()).toBe(false);
  });

  it('surfaces postJournal\'s own refusal rather than assuming success', () => {
    mockPostJournal.mockReturnValue(false); // e.g. it did not actually balance
    renderIt();
    fireEvent.press(screen.getByText('Credit'));
    pickCategory('4000 · Sales');
    fireEvent.changeText(screen.getByPlaceholderText('0'), '5000');
    fireEvent.changeText(screen.getByPlaceholderText('What it is for'), 'Cash sale');
    fireEvent.press(screen.getByText('Save entry'));
    expect(nav.goBack).not.toHaveBeenCalled();
  });
});
