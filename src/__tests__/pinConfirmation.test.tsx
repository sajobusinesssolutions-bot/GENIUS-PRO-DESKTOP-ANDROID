/**
 * Two PIN-confirmation gates were still comparing a typed PIN straight
 * against the stored value with `===` after PINs started being stored
 * hashed (see src/data/pinHash.ts) — `useWho`'s "who is recording this?"
 * confirmation and `useOwnerPin`'s bulk-edit approval. Since a hash never
 * equals the four digits someone types, both gates could no longer be
 * passed by anyone, for any PIN, once a shop's PINs were hashed. Neither
 * had a test, which is exactly how that went unnoticed until now.
 */
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { hashPin } from '../data/pinHash';

const mockDb: any = {
  settings: { theme: 'light', askWhoOnSave: true, requirePinOnSave: true },
  session: { userId: 'u1' },
  users: [
    { id: 'u1', name: 'Amina', role: 'owner', pin: hashPin('1234'), active: true },
    { id: 'u2', name: 'Grace', role: 'cashier', pin: hashPin('5678'), active: true },
  ],
};

jest.mock('../data/AppDataContext', () => ({
  useAppData: () => ({ db: mockDb, me: () => mockDb.users.find((u: any) => u.id === mockDb.session.userId) }),
  useAppDataSafe: () => ({ db: mockDb }),
}));

import { useWho } from '../components/WhoSheet';
import { useOwnerPin } from '../components/OwnerPin';

function type(digits: string) {
  digits.split('').forEach((d) => fireEvent.press(screen.getByText(d)));
}

describe('useWho — "who is recording this?"', () => {
  function Harness() {
    const { ask, sheet } = useWho();
    const [result, setResult] = React.useState('');
    return (
      <View>
        <Pressable onPress={() => ask((who) => setResult(who.userName))}><Text>go</Text></Pressable>
        <Text testID="result">{result}</Text>
        {sheet}
      </View>
    );
  }

  it('accepts the real PIN, hashed or not', () => {
    render(<Harness />);
    fireEvent.press(screen.getByText('go'));
    fireEvent.press(screen.getByText('Grace')); // switch off the signed-in default
    fireEvent.press(screen.getByText('Confirm · Grace')); // Grace's till requires a PIN
    type('5678');
    expect(screen.getByTestId('result').children.join('')).toBe('Grace');
  });

  it('still refuses the wrong PIN', () => {
    render(<Harness />);
    fireEvent.press(screen.getByText('go'));
    fireEvent.press(screen.getByText('Grace'));
    fireEvent.press(screen.getByText('Confirm · Grace'));
    type('0000');
    expect(screen.getByText('That PIN is not right.')).toBeTruthy();
    expect(screen.getByTestId('result').children.join('')).toBe('');
  });
});

describe('useOwnerPin — bulk-edit approval', () => {
  function Harness() {
    const { ask, sheet } = useOwnerPin();
    const [approved, setApproved] = React.useState(false);
    return (
      <View>
        <Pressable onPress={() => ask('Change 40 prices at once', () => setApproved(true))}><Text>go</Text></Pressable>
        <Text testID="approved">{approved ? 'yes' : 'no'}</Text>
        {sheet}
      </View>
    );
  }

  it('lets the approval through on the real owner PIN', () => {
    render(<Harness />);
    fireEvent.press(screen.getByText('go'));
    type('1234');
    expect(screen.getByTestId('approved').children.join('')).toBe('yes');
  });

  it('refuses a PIN that is not an owner\'s', () => {
    render(<Harness />);
    fireEvent.press(screen.getByText('go'));
    type('5678'); // Grace's real PIN, but Grace is not an owner
    expect(screen.getByText('That is not an owner PIN.')).toBeTruthy();
    expect(screen.getByTestId('approved').children.join('')).toBe('no');
  });
});
