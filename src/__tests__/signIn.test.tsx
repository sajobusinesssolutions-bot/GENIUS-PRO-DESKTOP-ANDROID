/**
 * Signing in has to *go* somewhere.
 *
 * The bug these cover: the account was adopted, the session was issued, a toast
 * said "Signed in" — and the screen stayed exactly where it was, so it read as
 * a failure. It happened on both the password and the Google routes, because
 * each one ended by itself and neither ended by navigating.
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

const mockGoReset = jest.fn();
jest.mock('../nav/navigate', () => ({
  useGo: () => jest.fn(),
  useGoReset: () => mockGoReset,
  TAB_ROUTES: [],
}));

const mockState: any = { onboarded: true, replaced: false };
const mockClaim = jest.fn((email: string) => mockState.replaced as boolean);
jest.mock('../data/AppDataContext', () => {
  const api = () => ({
    get db() { return { settings: { theme: 'light' }, onboarded: mockState.onboarded }; },
    claimBooksFor: (e: string) => mockClaim(e),
  });
  return { useAppData: () => api(), useAppDataSafe: () => api() };
});

const mockApi: any = { signIn: jest.fn() };
jest.mock('../data/authApi', () => ({
  serverConfigured: () => true,
  signIn: (...a: any[]) => mockApi.signIn(...a),
  requestResetCode: jest.fn(),
  resetPassword: jest.fn(),
  verifyCode: jest.fn(),
  requestSignUpCode: jest.fn(),
  completeSignUp: jest.fn(),
  googleStartUrl: jest.fn(),
  redeemGoogleTicket: jest.fn(),
}));

import { SignInScreen } from '../screens/AuthScreens';

const nav: any = { navigate: jest.fn(), replace: jest.fn(), goBack: jest.fn() };

beforeEach(() => {
  mockAdopt.mockClear();
  mockError.mockClear();
  mockSuccess.mockClear();
  mockGoReset.mockClear();
  mockClaim.mockClear();
  mockState.onboarded = true;
  mockState.replaced = false;
  mockApi.signIn = jest.fn(async () => ({
    ok: true,
    value: { accountId: 'a1', email: 'owner@example.com', name: 'Ada', access: 'x', refresh: 'y' },
  }));
});

function signIn() {
  render(<SignInScreen navigation={nav} route={{ key: 'k', name: 'SignIn' } as any} />);
  fireEvent.changeText(screen.getByPlaceholderText('Your email address'), 'owner@example.com');
  fireEvent.changeText(screen.getByPlaceholderText('Your password'), 'sugar and salt and rice');
  fireEvent.press(screen.getByText('Sign in'));
}

describe('a successful sign-in', () => {
  it('adopts the account', async () => {
    signIn();
    await waitFor(() => expect(mockAdopt).toHaveBeenCalled());
    expect(mockAdopt.mock.calls[0][0]).toMatchObject({ email: 'owner@example.com', method: 'password' });
  });

  it('leaves the sign-in screen instead of sitting there', async () => {
    signIn();
    await waitFor(() => expect(mockGoReset).toHaveBeenCalled());
  });

  // business first, then the person, then the PIN
  it('goes to the list of businesses on the account', async () => {
    signIn();
    await waitFor(() => expect(mockGoReset).toHaveBeenCalledWith('Businesses'));
  });

  it('goes to the list even when the shop has not been set up — it may be on the account', async () => {
    mockState.onboarded = false;
    signIn();
    await waitFor(() => expect(mockGoReset).toHaveBeenCalledWith('Businesses'));
  });

  it('claims the books for whoever signed in', async () => {
    signIn();
    await waitFor(() => expect(mockClaim).toHaveBeenCalledWith('owner@example.com'));
  });

  it('says so when the books belonged to somebody else, and goes to the list', async () => {
    mockState.replaced = true;
    signIn();
    await waitFor(() => expect(mockGoReset).toHaveBeenCalledWith('Businesses'));
    expect(mockSuccess.mock.calls[0][0]).toMatch(/starting fresh books/);
  });
});

describe('a refused sign-in', () => {
  it('stays put and says why', async () => {
    mockApi.signIn = jest.fn(async () => ({
      ok: false, error: { failure: 'badCredentials', message: 'That email and password do not match.' },
    }));
    signIn();
    await waitFor(() => expect(mockError).toHaveBeenCalledWith('That email and password do not match.'));
    expect(mockGoReset).not.toHaveBeenCalled();
    expect(mockAdopt).not.toHaveBeenCalled();
  });

  it('does not call the server for a malformed email', () => {
    render(<SignInScreen navigation={nav} route={{ key: 'k', name: 'SignIn' } as any} />);
    fireEvent.changeText(screen.getByPlaceholderText('Your email address'), 'nope');
    fireEvent.changeText(screen.getByPlaceholderText('Your password'), 'whatever12');
    fireEvent.press(screen.getByText('Sign in'));
    expect(mockApi.signIn).not.toHaveBeenCalled();
    expect(mockError).toHaveBeenCalledWith('Check the email address.');
  });

  it('asks for a password rather than sending an empty one', () => {
    render(<SignInScreen navigation={nav} route={{ key: 'k', name: 'SignIn' } as any} />);
    fireEvent.changeText(screen.getByPlaceholderText('Your email address'), 'owner@example.com');
    fireEvent.press(screen.getByText('Sign in'));
    expect(mockApi.signIn).not.toHaveBeenCalled();
    expect(mockError).toHaveBeenCalledWith('Enter your password.');
  });
});

describe('an email with no account', () => {
  it('says so and offers to create the account with that email', async () => {
    mockApi.signIn = jest.fn(async () => ({
      ok: false, error: { failure: 'unknownEmail', message: 'There is no Genius account with that email.' },
    }));
    signIn();
    await waitFor(() => expect(screen.getByText('No account uses this email')).toBeTruthy());
    fireEvent.press(screen.getByText('Create an account'));
    expect(nav.replace).toHaveBeenCalledWith('CreateAccount', { email: 'owner@example.com' });
  });
});
