/**
 * PINs are stored hashed now (see src/data/pinHash.ts), so the profile sheet
 * can no longer show a staff member's real PIN when editing them — there is
 * nothing to decrypt. This locks in the fix that went with that: the field
 * starts blank on an edit rather than showing the (unreadable) stored hash,
 * and leaving it blank must not overwrite the existing PIN with nothing.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

const mockUpdateUser = jest.fn();
const mockAddUser = jest.fn();

const mockDb: any = {
  settings: { theme: 'light' },
  session: { userId: 'u1', role: 'owner' },
  sync: { businessId: undefined },
  businessAccess: [],
  shifts: [],
  sales: [],
  users: [
    { id: 'u1', name: 'Amina', role: 'owner', pin: 'a1b2c3d4e5f6g7h8$deadbeefdeadbeef', active: true },
  ],
};

const roleList = [
  { id: 'owner', name: 'Owner', description: '', builtin: true, perms: {} },
  { id: 'cashier', name: 'Cashier', description: '', builtin: true, perms: {} },
];

jest.mock('../data/AppDataContext', () => ({
  useAppData: () => ({
    db: mockDb,
    money: (n: number) => 'Sh ' + n,
    can: () => true,
    roles: () => roleList,
    role: (id: string) => roleList.find((r) => r.id === id),
    saveRole: jest.fn(),
    duplicateRole: jest.fn(),
    removeRole: jest.fn(),
    updateUser: mockUpdateUser,
    addUser: mockAddUser,
    user: (id: string) => mockDb.users.find((u: any) => u.id === id),
    canRemoveUser: () => true,
    grantBusinessAccess: jest.fn(),
    revokeBusinessAccess: jest.fn(),
  }),
  useAppDataSafe: () => ({ db: mockDb }),
}));
jest.mock('../data/AuthContext', () => ({ useAuth: () => ({ account: null }) }));

import UsersRolesScreen from '../screens/UsersRolesScreen';

beforeEach(() => {
  mockUpdateUser.mockReset();
  mockAddUser.mockReset();
});

// "Amina" appears twice: once in the "Business access" row (grant chips,
// not the profile sheet) and once in "Staff profiles" (opens the sheet this
// file is testing). The second is always the one that opens it.
const openAminaProfile = () => fireEvent.press(screen.getAllByText('Amina')[1]);

describe('editing an existing profile\'s PIN', () => {
  it('leaves the PIN field blank rather than showing the stored hash', () => {
    render(<UsersRolesScreen />);
    openAminaProfile();
    expect(screen.getByPlaceholderText('Leave blank to keep it').props.value).toBe('');
  });

  it('does not touch the PIN when saved with the field left blank', () => {
    render(<UsersRolesScreen />);
    openAminaProfile();
    fireEvent.press(screen.getByText('Save'));
    expect(mockUpdateUser).toHaveBeenCalledTimes(1);
    const patch = mockUpdateUser.mock.calls[0][1];
    expect(patch).not.toHaveProperty('pin');
  });

  it('sets a new PIN when one is typed', () => {
    render(<UsersRolesScreen />);
    openAminaProfile();
    fireEvent.changeText(screen.getByPlaceholderText('Leave blank to keep it'), '5678');
    fireEvent.press(screen.getByText('Save'));
    const patch = mockUpdateUser.mock.calls[0][1];
    expect(patch.pin).toBe('5678');
  });
});

describe('adding a new profile', () => {
  it('defaults an untyped PIN to 0000, as before', () => {
    render(<UsersRolesScreen />);
    fireEvent.press(screen.getByText('Add someone'));
    fireEvent.changeText(screen.getByPlaceholderText('Their name'), 'New Person');
    fireEvent.press(screen.getByText('Save'));
    expect(mockAddUser).toHaveBeenCalledTimes(1);
    expect(mockAddUser.mock.calls[0][0].pin).toBe('0000');
  });
});
