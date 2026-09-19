/**
 * Creating the owner's account. The flow is staged, and the stage that matters
 * most is the one that cannot happen yet: with no server there is nobody to
 * send a confirmation code, so that step is skipped rather than faked and the
 * account is marked as living only on this phone.
 *
 * An app that showed a code box and accepted any six digits would be telling
 * the owner their email was checked when it was not — and that email is how a
 * lost phone gets its books back.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

const mockAdopt = jest.fn(async (o: any) => {});
jest.mock('../data/AuthContext', () => ({
  useAuth: () => ({ adopt: mockAdopt, account: null, signedIn: false, ready: true, patch: jest.fn(), signOut: jest.fn() }),
}));

const mockError = jest.fn();
const mockSuccess = jest.fn();
jest.mock('../components/Toast', () => ({
  useToast: () => ({ error: mockError, success: mockSuccess, info: jest.fn(), show: jest.fn() }),
}));

const mockApi: any = { configured: false, signUpCode: jest.fn(), complete: jest.fn(), verify: jest.fn() };
jest.mock('../data/authApi', () => ({
  serverConfigured: () => mockApi.configured,
  requestSignUpCode: (...a: any[]) => mockApi.signUpCode(...a),
  completeSignUp: (...a: any[]) => mockApi.complete(...a),
  verifyCode: (...a: any[]) => mockApi.verify(...a),
  signIn: jest.fn(),
  requestResetCode: jest.fn(),
  resetPassword: jest.fn(),
  googleStartUrl: jest.fn(() => "https://example.test/v1/auth/google/start"),
  redeemGoogleTicket: jest.fn(),
}));

const mockDb: any = { settings: { theme: 'light' } };
const mockFresh = jest.fn((o: any) => {});
jest.mock('../data/AppDataContext', () => ({
  useAppData: () => ({ db: mockDb, startFreshBook: (o: any) => mockFresh(o), claimBooksFor: () => false }),
  useAppDataSafe: () => ({ db: mockDb }),
}));

import { CreateAccountScreen } from '../screens/AuthScreens';

const nav: any = { replace: jest.fn(), goBack: jest.fn(), navigate: jest.fn() };

beforeEach(() => {
  mockAdopt.mockClear();
  mockFresh.mockClear();
  mockError.mockClear();
  mockSuccess.mockClear();
  nav.replace.mockClear();
  mockApi.configured = false;
  mockApi.signUpCode = jest.fn(async () => ({ ok: true, value: { sent: true } }));
  mockApi.verify = jest.fn(async () => ({ ok: true, value: { ok: true } }));
  mockApi.complete = jest.fn(async () => ({
    ok: true,
    value: { accountId: 'acct_1', email: 'owner@example.com', name: 'Ada', access: 'a', refresh: 'r' },
  }));
});

function open() {
  return render(<CreateAccountScreen navigation={nav} route={{ key: 'k', name: 'CreateAccount' } as any} />);
}

const type = (placeholder: string, text: string) =>
  fireEvent.changeText(screen.getByPlaceholderText(placeholder), text);

const next = () => fireEvent.press(screen.getByText('Next'));

describe('the stages', () => {
  it('asks who owns the business first', () => {
    open();
    expect(screen.getByText('Who owns the business?')).toBeTruthy();
  });

  it('will not move on without a name', () => {
    open();
    next();
    expect(mockError).toHaveBeenCalledWith('Enter your name.');
  });

  it('moves to the email once it has one', async () => {
    open();
    type('Your full name', 'Ada Nakato');
    next();
    await waitFor(() => expect(screen.getByText('Your email address')).toBeTruthy());
  });

  it('catches a mistyped email rather than sending a code into the void', async () => {
    open();
    type('Your full name', 'Ada');
    next();
    await waitFor(() => screen.getByText('Your email address'));
    type('Your email address', 'owner@example');
    next();
    expect(mockError).toHaveBeenCalledWith('Check the email address.');
  });
});

describe('with no server configured', () => {
  it('says so on the first stage rather than implying an account will exist', () => {
    open();
    expect(screen.getByText(/not connected to an account server yet/)).toBeTruthy();
  });

  it('skips the confirmation stage instead of faking a code', async () => {
    open();
    type('Your full name', 'Ada');
    next();
    await waitFor(() => screen.getByText('Your email address'));
    type('Your email address', 'owner@example.com');
    next();
    await waitFor(() => expect(screen.getByText('Choose a password')).toBeTruthy());
    expect(screen.queryByText('Confirm your email')).toBeNull();
    expect(mockApi.signUpCode).not.toHaveBeenCalled();
  });

  it('records the account as unverified and local, and goes on to set the shop up', async () => {
    open();
    type('Your full name', 'Ada Nakato');
    next();
    await waitFor(() => screen.getByText('Your email address'));
    type('Your email address', 'owner@example.com');
    next();
    await waitFor(() => screen.getByText('Choose a password'));
    type('At least 8 characters', 'sugar and salt and rice');
    type('The same password', 'sugar and salt and rice');
    fireEvent.press(screen.getByText('Create account'));

    await waitFor(() => expect(mockAdopt).toHaveBeenCalled());
    expect(mockAdopt.mock.calls[0][0]).toMatchObject({
      email: 'owner@example.com', name: 'Ada Nakato', verified: false, localOnly: true,
    });
    expect(nav.replace).toHaveBeenCalledWith('Onboarding');
    // and the shop opens on empty books, not on the demo the app ships with
    expect(mockFresh).toHaveBeenCalledWith({ ownerName: 'Ada Nakato', ownerEmail: 'owner@example.com' });
  });

  it('refuses two passwords that do not match', async () => {
    open();
    type('Your full name', 'Ada');
    next();
    await waitFor(() => screen.getByText('Your email address'));
    type('Your email address', 'owner@example.com');
    next();
    await waitFor(() => screen.getByText('Choose a password'));
    type('At least 8 characters', 'sugar and salt and rice');
    type('The same password', 'sugar and salt and rive');
    fireEvent.press(screen.getByText('Create account'));
    await waitFor(() => expect(mockError).toHaveBeenCalledWith('The two passwords do not match.'));
    expect(mockAdopt).not.toHaveBeenCalled();
  });

  it('refuses a weak password and says which way to fix it', async () => {
    open();
    type('Your full name', 'Ada');
    next();
    await waitFor(() => screen.getByText('Your email address'));
    type('Your email address', 'owner@example.com');
    next();
    await waitFor(() => screen.getByText('Choose a password'));
    type('At least 8 characters', 'shopshop');
    type('The same password', 'shopshop');
    fireEvent.press(screen.getByText('Create account'));
    await waitFor(() => expect(mockError.mock.calls[0][0]).toMatch(/12 characters or longer/));
  });
});

describe('with a server configured', () => {
  beforeEach(() => { mockApi.configured = true; });

  it('sends a code when the email is entered, and asks for it', async () => {
    open();
    type('Your full name', 'Ada');
    next();
    await waitFor(() => screen.getByText('Your email address'));
    type('Your email address', 'owner@example.com');
    next();
    await waitFor(() => expect(screen.getByText('Confirm your email')).toBeTruthy());
    expect(mockApi.signUpCode).toHaveBeenCalledWith('owner@example.com', 'Ada');
  });

  it('does not move past the code stage on a half-typed code', async () => {
    open();
    type('Your full name', 'Ada');
    next();
    await waitFor(() => screen.getByText('Your email address'));
    type('Your email address', 'owner@example.com');
    next();
    await waitFor(() => screen.getByText('Confirm your email'));
    type('000000', '1234');
    next();
    expect(mockError).toHaveBeenCalledWith('The code is six digits.');
  });

  it('stops and explains when the server refuses the code', async () => {
    mockApi.complete = jest.fn(async () => ({
      ok: false, error: { failure: 'badCode', message: 'That code is not right.' },
    }));
    open();
    type('Your full name', 'Ada');
    next();
    await waitFor(() => screen.getByText('Your email address'));
    type('Your email address', 'owner@example.com');
    next();
    await waitFor(() => screen.getByText('Confirm your email'));
    type('000000', '123456');
    next();
    await waitFor(() => screen.getByText('Choose a password'));
    type('At least 8 characters', 'sugar and salt and rice');
    type('The same password', 'sugar and salt and rice');
    fireEvent.press(screen.getByText('Create account'));

    await waitFor(() => expect(mockError).toHaveBeenCalledWith('That code is not right.'));
    expect(mockAdopt).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('records a verified, server-backed account when it all works', async () => {
    open();
    type('Your full name', 'Ada');
    next();
    await waitFor(() => screen.getByText('Your email address'));
    type('Your email address', 'owner@example.com');
    next();
    await waitFor(() => screen.getByText('Confirm your email'));
    type('000000', '123456');
    next();
    await waitFor(() => screen.getByText('Choose a password'));
    type('At least 8 characters', 'sugar and salt and rice');
    type('The same password', 'sugar and salt and rice');
    fireEvent.press(screen.getByText('Create account'));

    await waitFor(() => expect(mockAdopt).toHaveBeenCalled());
    expect(mockAdopt.mock.calls[0][0]).toMatchObject({ verified: true, localOnly: false, id: 'acct_1' });
  });
});

describe('the code is checked the moment it is entered', () => {
  beforeEach(() => { mockApi.configured = true; });

  /** Walks as far as the confirmation step. */
  async function toConfirm() {
    open();
    type('Your full name', 'Ada');
    next();
    await waitFor(() => screen.getByText('Your email address'));
    type('Your email address', 'owner@example.com');
    next();
    await waitFor(() => screen.getByText('Confirm your email'));
  }

  it('checks a code before moving on, not at the end', async () => {
    await toConfirm();
    type('000000', '123456');
    next();
    await waitFor(() => expect(mockApi.verify).toHaveBeenCalledWith('owner@example.com', '123456', 'signup'));
  });

  it('stops on the code step and says why when it is wrong', async () => {
    mockApi.verify = jest.fn(async () => ({
      ok: false, error: { failure: 'badCode', message: 'That code is not right. 4 attempts left.' },
    }));
    await toConfirm();
    type('000000', '999999');
    next();

    await waitFor(() => expect(mockError).toHaveBeenCalledWith('That code is not right. 4 attempts left.'));
    // still on the code step, rather than three screens further on
    expect(screen.getByText('Confirm your email')).toBeTruthy();
    expect(screen.queryByText('Choose a password')).toBeNull();
  });

  it('says so when the code has expired rather than blaming the code', async () => {
    mockApi.verify = jest.fn(async () => ({
      ok: false, error: { failure: 'codeExpired', message: 'That code has expired. Ask for a new one.' },
    }));
    await toConfirm();
    type('000000', '123456');
    next();
    await waitFor(() => expect(mockError).toHaveBeenCalledWith('That code has expired. Ask for a new one.'));
  });

  it('moves on once the code is accepted', async () => {
    await toConfirm();
    type('000000', '123456');
    next();
    await waitFor(() => expect(screen.getByText('Choose a password')).toBeTruthy());
  });

  it('does not call the server for a half-typed code', async () => {
    await toConfirm();
    type('000000', '1234');
    next();
    expect(mockApi.verify).not.toHaveBeenCalled();
    expect(mockError).toHaveBeenCalledWith('The code is six digits.');
  });
});
