/**
 * Opening a branch is staged, and nothing is written until the last step. These
 * tests hold both halves of that: a step that is not filled in does not let you
 * past, and walking the whole way calls openBranch exactly once, with what was
 * actually typed.
 *
 * The failure worth preventing is a half-opened branch — one that exists with no
 * drawer, or whose stock moved but whose float never posted.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

const mockGo = jest.fn();
jest.mock('../nav/navigate', () => ({ useGo: () => mockGo }));

const mockOpenBranch = jest.fn((plan: any) => ({
  warehouseId: 'wh_new', cashAccountId: 'acc_wh_new', moved: 0, shortfalls: [] as any[],
}));
const mockError = jest.fn();
const mockSuccess = jest.fn();
jest.mock('../components/Toast', () => ({
  useToast: () => ({ error: mockError, success: mockSuccess, info: jest.fn(), show: jest.fn() }),
}));

const mockState: any = { role: 'owner' };

jest.mock('../data/AppDataContext', () => {
  const db = {
    get session() { return { role: mockState.role, userId: 'u1', till: 'Till 1', warehouse: 'w1' }; },
    settings: { theme: 'light', currency: 'Sh' },
    warehouses: [{ id: 'w1', name: 'Main shop', active: true }],
    products: [
      { id: 'p1', name: 'Sugar', sku: 'SUG', unit: 'kg', active: true, kind: 'product', stock: { w1: 12 } },
    ],
    users: [{ id: 'u1', name: 'Ada', role: 'owner', active: true }],
  };
  // Built on each call, not once: the factory runs while the mock consts
  // above are still being initialised, so capturing them here would freeze in
  // whatever they were at that moment.
  const api = () => ({
    db,
    money: (n: number) => 'Sh ' + Math.round(n),
    openBranch: (plan: any) => (mockOpenBranch as any)(plan),
  });
  return { useAppData: () => api(), useAppDataSafe: () => api() };
});

import NewBranchScreen from '../screens/NewBranchScreen';

beforeEach(() => {
  mockGo.mockClear();
  mockOpenBranch.mockClear();
  mockError.mockClear();
  mockSuccess.mockClear();
  mockState.role = 'owner';
});

/** Fills the name and walks to the last step. */
function walkToReview(name = 'Lakeside') {
  render(<NewBranchScreen />);
  fireEvent.changeText(screen.getByPlaceholderText('The name customers know it by'), name);
  for (let i = 0; i < 5; i += 1) fireEvent.press(screen.getByText('Next'));
}

describe('who may open a branch', () => {
  it('refuses anyone but the owner, and does not mount the form', () => {
    mockState.role = 'manager';
    render(<NewBranchScreen />);
    expect(screen.getByText('Opening a branch is owner work')).toBeTruthy();
    expect(screen.queryByText('The shop')).toBeNull();
  });
});

describe('the stages', () => {
  it('starts on the first step and says where you are', () => {
    render(<NewBranchScreen />);
    expect(screen.getByText('The shop')).toBeTruthy();
    expect(screen.getByText('1 of 6')).toBeTruthy();
  });

  it('will not move on until the branch has a name', () => {
    render(<NewBranchScreen />);
    fireEvent.press(screen.getByText('Next'));
    expect(mockError).toHaveBeenCalledWith('Give the branch a name first.');
    expect(screen.getByText('1 of 6')).toBeTruthy();
  });

  it('refuses a name another branch already has', () => {
    render(<NewBranchScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('The name customers know it by'), 'main shop');
    fireEvent.press(screen.getByText('Next'));
    expect(mockError).toHaveBeenCalledWith('There is already a branch called main shop.');
  });

  it('moves on once it has one, and can come back', () => {
    render(<NewBranchScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('The name customers know it by'), 'Lakeside');
    fireEvent.press(screen.getByText('Next'));
    expect(screen.getByText('2 of 6')).toBeTruthy();
    fireEvent.press(screen.getByText('Back'));
    expect(screen.getByText('1 of 6')).toBeTruthy();
  });

  it('leaves the whole thing on the first Back', () => {
    render(<NewBranchScreen />);
    fireEvent.press(screen.getByText('Cancel'));
    expect(mockGo).toHaveBeenCalledWith('Branches');
  });

  it('shows what the branch\'s bills will read before it is opened', () => {
    walkToReview();
    expect(screen.getByText('INV-00042')).toBeTruthy();
  });
});

describe('nothing is written until the end', () => {
  it('writes nothing while stepping through', () => {
    render(<NewBranchScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('The name customers know it by'), 'Lakeside');
    fireEvent.press(screen.getByText('Next'));
    fireEvent.press(screen.getByText('Next'));
    expect(mockOpenBranch).not.toHaveBeenCalled();
  });

  it('opens the branch once, with what was typed', () => {
    walkToReview('Lakeside');
    fireEvent.press(screen.getByText('Open Lakeside'));

    expect(mockOpenBranch).toHaveBeenCalledTimes(1);
    const plan = mockOpenBranch.mock.calls[0][0] as any;
    expect(plan.name).toBe('Lakeside');
    expect(plan.makeActive).toBe(true);
    expect(plan.openingFloat).toBe(0);
    expect(plan.stockFrom).toBeNull();
    expect(plan.stockLines).toEqual([]);
  });

  it('says so and goes back to the list when it worked', () => {
    walkToReview('Lakeside');
    fireEvent.press(screen.getByText('Open Lakeside'));
    expect(mockSuccess).toHaveBeenCalledWith('Lakeside is open — you are now working in it');
    expect(mockGo).toHaveBeenCalledWith('Branches');
  });

  it('reports a refusal instead of pretending the branch opened', () => {
    mockOpenBranch.mockImplementationOnce(() => { throw new Error('There is already a branch called Lakeside.'); });
    walkToReview('Lakeside');
    fireEvent.press(screen.getByText('Open Lakeside'));
    expect(mockError).toHaveBeenCalledWith('There is already a branch called Lakeside.');
    expect(mockSuccess).not.toHaveBeenCalled();
  });

  it('says plainly when less stock was moved than was asked for', () => {
    mockOpenBranch.mockImplementationOnce(() => ({
      warehouseId: 'wh_new', cashAccountId: 'acc_wh_new', moved: 2,
      shortfalls: [{ productId: 'p1', name: 'Sugar', wanted: 9, had: 2 }],
    }));
    walkToReview('Lakeside');
    fireEvent.press(screen.getByText('Open Lakeside'));
    expect(mockError.mock.calls[0][0]).toMatch(/Sugar \(2 of 9\)/);
    expect(mockSuccess).not.toHaveBeenCalled();
  });
});
