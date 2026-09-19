/**
 * THE CLIENT for the account and licence endpoints in docs/SYNC_BACKEND.md.
 *
 * This module is explicit about the two worlds it can be in:
 *
 *   · **configured** — `SERVER_URL` is set, so every call is a real request and
 *     a failure is a real failure the person is told about;
 *   · **not configured** — there is no server to talk to, so the calls that
 *     cannot possibly work say so with `notConfigured`, and the screens degrade
 *     to setting the app up on this device alone.
 *
 * Nothing here ever invents a confirmation code or reports a sign-in that did
 * not happen. An account created before the server exists is marked
 * `localOnly`, and the app does not claim the books are safe anywhere else
 * while that is true.
 *
 * `SERVER_URL` points at the live server. Blanking it puts the app back into
 * on-this-phone-only mode, which is what a development build without a server
 * should do rather than failing in a way that looks like a bug.
 */
import type { LicenceClaims } from './syncProtocol';

/**
 * Where the server lives. Empty until the VPS is up.
 *
 * Kept as a constant rather than read from the environment so that shipping a
 * build cannot accidentally point a shop's till at a development box.
 */
export const SERVER_URL = 'https://api.saljoetech.tech';

export const REQUEST_TIMEOUT_MS = 20000;

export function serverConfigured(): boolean {
  return SERVER_URL.trim().length > 0;
}

/* ---------------------------------------------------------------- */

export type AuthFailure =
  | 'notConfigured'
  | 'offline'
  | 'timeout'
  | 'badCredentials'
  | 'emailTaken'
  | 'unknownEmail'
  | 'badCode'
  | 'codeExpired'
  | 'rateLimited'
  | 'seatsFull'
  | 'server';

export interface AuthError {
  failure: AuthFailure;
  /** What the person reads. Says what happened and what to do next. */
  message: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: AuthError };

const MESSAGES: Record<AuthFailure, string> = {
  notConfigured:
    'This copy of the app is not connected to an account server yet, so it cannot sign in online.',
  offline:
    'No internet connection. Check the phone is online and try again.',
  timeout:
    'The server did not answer in time. Check the connection and try again.',
  badCredentials:
    'That email and password do not match. Try again, or reset the password by email.',
  emailTaken:
    'There is already an account with that email. Sign in instead, or reset the password.',
  unknownEmail:
    'No account was found with that email address.',
  badCode:
    'That code is not right. Check the six digits in the email and try again.',
  codeExpired:
    'That code has expired. Ask for a new one.',
  rateLimited:
    'Too many attempts. Wait a few minutes before trying again.',
  seatsFull:
    'Your licence does not cover another device. Remove a device from your account, or add seats, then try again.',
  server:
    'The server had a problem. Try again in a moment.',
};

export function authError(failure: AuthFailure, message?: string): AuthError {
  return { failure, message: message || MESSAGES[failure] };
}

const fail = <T>(failure: AuthFailure, message?: string): Result<T> =>
  ({ ok: false, error: authError(failure, message) });

/* ---------------------------------------------------------------- */

async function request<T>(path: string, body: unknown, token?: string): Promise<Result<T>> {
  if (!serverConfigured()) return fail<T>('notConfigured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(SERVER_URL.replace(/\/$/, '') + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    const json = text ? JSON.parse(text) : {};

    if (res.ok) return { ok: true, value: json as T };

    // the server names its own failure; anything unrecognised is 'server'
    const code = (json && json.error) as AuthFailure | undefined;
    const known = code && code in MESSAGES ? code : 'server';
    return fail<T>(known as AuthFailure, json?.message);
  } catch (e: any) {
    if (e?.name === 'AbortError') return fail<T>('timeout');
    return fail<T>('offline');
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------- */

export interface Session {
  accountId: string;
  email: string;
  name: string;
  access: string;
  refresh: string;
}

export interface LicenceResponse {
  token: string;
  claims: LicenceClaims;
}

/** Starts a sign-up. The server sends a six-digit code to the address. */
export function requestSignUpCode(email: string, name: string) {
  return request<{ sent: true }>('/v1/auth/otp/request', { email, name, purpose: 'signup' });
}

/**
 * Checks a code without spending it.
 *
 * Lets the app refuse a wrong code the moment it is typed, rather than after
 * somebody has chosen a password and only then been sent back three screens.
 * The code is still consumed later, by register or reset.
 */
export function verifyCode(email: string, code: string, purpose: 'signup' | 'reset' = 'signup') {
  return request<{ ok: true }>('/v1/auth/otp/verify', { email, code, purpose });
}

/** Confirms the address, then sets the password. One call, so a half-made account cannot exist. */
export function completeSignUp(o: {
  email: string; name: string; phone?: string; code: string; password: string;
}) {
  return request<Session>('/v1/auth/register', o);
}

export function signIn(email: string, password: string) {
  return request<Session>('/v1/auth/login', { email, password });
}

/** Sends a code to sign in with, for someone who has forgotten the password. */
export function requestResetCode(email: string) {
  return request<{ sent: true }>('/v1/auth/otp/request', { email, purpose: 'reset' });
}

export function resetPassword(email: string, code: string, password: string) {
  return request<Session>('/v1/auth/password/reset', { email, code, password });
}

/**
 * Where the browser is sent to start a Google sign-in.
 *
 * The app opens this on our own server rather than on Google. The server holds
 * the client id and secret and drives the whole exchange; the phone only needs
 * to know where to come back to. Nothing Google-specific is configured here.
 */
export function googleStartUrl(returnTo: string): string {
  return SERVER_URL.replace(/[/]$/, '') + '/v1/auth/google/start?redirect=' + encodeURIComponent(returnTo);
}

/**
 * Trades the one-time ticket from the redirect for a real session.
 *
 * The server puts a ticket in the redirect URL rather than a session token,
 * because a URL is written to browser history and to the system log, where a
 * token would sit long after the sign-in was over. The ticket is single use.
 */
export function redeemGoogleTicket(ticket: string) {
  return request<Session>('/v1/auth/google/redeem', { ticket });
}

/** Trades the stored refresh token for a fresh fifteen-minute access token. */
export function refreshSession(refresh: string) {
  return request<{ access: string }>('/v1/auth/refresh', { refresh });
}

/** Claims a device seat. Refused with `seatsFull` when the licence has none left. */
export function registerDevice(access: string, o: { name: string; kind: string; platform: string }) {
  return request<{ deviceId: string; token: string }>('/v1/devices', o, access);
}

export function fetchLicence(access: string) {
  return request<LicenceResponse>('/v1/licence/heartbeat', {}, access);
}
