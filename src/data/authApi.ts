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
  | 'tooManyDevices'
  | 'deviceRemoved'
  | 'server';

export interface AuthError {
  failure: AuthFailure;
  /** What the person reads. Says what happened and what to do next. */
  message: string;
  /** The rest of what the server said, such as the device list with tooManyDevices. */
  detail?: any;
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
  tooManyDevices:
    'All the devices your plan allows are in use. Remove one to use this device.',
  deviceRemoved:
    'This device was removed from your linked devices. Sign in to keep using it.',
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

async function request<T>(path: string, body: unknown, token?: string, method: 'POST' | 'GET' | 'DELETE' | 'PATCH' = 'POST'): Promise<Result<T>> {
  if (!serverConfigured()) return fail<T>('notConfigured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(SERVER_URL.replace(/\/$/, '') + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();
    const json = text ? JSON.parse(text) : {};

    if (res.ok) return { ok: true, value: json as T };

    // the server names its own failure; anything unrecognised is 'server'
    const code = (json && json.error) as AuthFailure | undefined;
    const known = code && code in MESSAGES ? code : 'server';
    return { ok: false, error: { ...authError(known as AuthFailure, json?.message), detail: json } };
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
  claims?: LicenceClaims;
}

export function normaliseLicenceResponse(value: unknown): { ok: true; token: string } | { ok: false } {
  if (!value || typeof value !== 'object') return { ok: false };
  const token = (value as { token?: unknown }).token;
  if (typeof token !== 'string' || token.trim().length === 0) return { ok: false };
  return { ok: true, token };
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
export function verifyCode(email: string, code: string, purpose: 'signup' | 'reset' | 'pin' = 'signup') {
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

/** Emails the owner a code for resetting the owner PIN. */
export function requestPinCode(email: string) {
  return request<{ sent: true }>('/v1/auth/otp/request', { email, purpose: 'pin' });
}

/** Spends that code. On success the app lets the owner choose a new PIN. */
export function confirmPinCode(email: string, code: string) {
  return request<{ ok: true }>('/v1/auth/pin/reset', { email, code });
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

/**
 * Kept so that sync, the licence check, app updates and every screen share one
 * access token, instead of each asking for its own. Fifteen screens doing that
 * ran past the server's sign-in limit, and everything after it was refused.
 */
const ACCESS_REUSE_MS = 10 * 60 * 1000; // the token lasts fifteen
let held: { refresh: string; at: number; result: Promise<Awaited<ReturnType<typeof requestRefresh>>> } | null = null;

function requestRefresh(refresh: string) {
  return request<{ access: string }>('/v1/auth/refresh', { refresh });
}

/** Trades the stored refresh token for a fifteen-minute access token, reusing a recent one. */
export function refreshSession(refresh: string) {
  if (held && held.refresh === refresh && Date.now() - held.at < ACCESS_REUSE_MS) return held.result;
  const mine = { refresh, at: Date.now(), result: requestRefresh(refresh) };
  held = mine;
  // a refusal or a dropped connection is not kept: the next caller asks again
  mine.result.then((r) => { if (!r.ok && held === mine) held = null; }, () => { if (held === mine) held = null; });
  return mine.result;
}

/** Drops the kept access token, for sign-out or a token the server turned down. */
export function forgetAccess() {
  held = null;
}

export interface LinkedDevice { id: string; name: string; kind: string; platform: string; created_at: string; last_seen: string; current?: boolean }

/**
 * Links this device to the account, tied to the session signing in made. The
 * same session asking again gets the same device. Refused with
 * `tooManyDevices` — the list is in `error.detail.devices` — when every seat
 * is taken.
 */
export function registerDevice(access: string, o: { name: string; kind: string; platform: string }) {
  return request<{ deviceId: string; seats?: number }>('/v1/devices', o, access);
}

/** Whether this device is still linked. A removed one is refused with `deviceRemoved`. */
export function deviceStatus(access: string) {
  return request<{ linked: boolean; deviceId: string | null }>('/v1/devices/me', undefined, access, 'GET');
}

export function listDevices(access: string) {
  return request<{ devices: LinkedDevice[] }>('/v1/devices', undefined, access, 'GET');
}

export function revokeDevice(access: string, id: string) {
  return request<{ revoked: boolean }>('/v1/devices/' + id, undefined, access, 'DELETE');
}

export function fetchLicence(access: string) {
  return request<LicenceResponse>('/v1/licence/heartbeat', {}, access);
}

/** Deletes the signed-in account and everything kept for it on the server. `confirm` is its email, typed. */
/** Emails the code that deleting the account needs. */
export function requestDeleteCode(email: string) {
  return request<{ sent: true }>('/v1/auth/otp/request', { email, purpose: 'delete' });
}

export function deleteAccount(access: string, confirm: string, code: string) {
  return request<{ ok: boolean }>('/v1/account/delete', { confirm, code }, access);
}

/** Emails the code that signing this device out needs, as on the desktop. */
export function requestSignOutCode(email: string) {
  return request<{ sent: true }>('/v1/auth/otp/request', { email, purpose: 'signout' });
}

/** Signs this device out with the emailed code; the session ends on the server too. */
export function confirmSignOut(access: string, code: string) {
  return request<{ signedOut: boolean }>('/v1/auth/signout', { code }, access);
}
