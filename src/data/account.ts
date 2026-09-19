/**
 * THE OWNER'S ACCOUNT on this device.
 *
 * The app now opens on a sign-in rather than straight into a shop. The account
 * is the owner's email address: it is what a licence attaches to, what the
 * books sync under, and what a lost phone is recovered through.
 *
 * Kept in its own AsyncStorage key, not inside the shop's DB blob. Two reasons:
 * a person may sign in before any shop exists, and wiping a shop's books must
 * not sign them out of their account.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'genius.account.v1';

export type SignInMethod = 'password' | 'google' | 'otp';

export interface Account {
  /** The server's id once registered. Empty until the server has seen us. */
  id: string;
  email: string;
  name: string;
  phone?: string;
  /** How this person last got in. */
  method: SignInMethod;
  /** Whether the email has been confirmed by a code. */
  verified: boolean;
  /**
   * True when this account was created while no server was configured, so it
   * exists only here and still owes a registration. The app must not claim the
   * books are backed up while this is true.
   */
  localOnly: boolean;
  createdAt: string;
  lastSignIn: string;
  /** Opaque refresh token. Access tokens are short-lived and kept in memory. */
  refresh?: string;
  /** The device seat this install holds, once registered. */
  deviceId?: string;
}

export async function loadAccount(): Promise<Account | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as Account;
    return a && a.email ? a : null;
  } catch {
    return null;
  }
}

export async function saveAccount(a: Account): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    // storage unavailable — the session still works until the app is closed
  }
}

export async function clearAccount(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {}
}

export function newAccount(o: {
  email: string; name: string; phone?: string;
  method: SignInMethod; verified: boolean; localOnly: boolean;
  id?: string; refresh?: string;
}): Account {
  const now = new Date().toISOString();
  return {
    id: o.id || '',
    email: o.email.trim().toLowerCase(),
    name: o.name.trim(),
    phone: o.phone?.trim(),
    method: o.method,
    verified: o.verified,
    localOnly: o.localOnly,
    createdAt: now,
    lastSignIn: now,
    refresh: o.refresh,
  };
}

/* ---------------------------------------------------------------- */

/**
 * Good enough to catch a typo, deliberately not a full RFC check.
 *
 * Over-strict email validation rejects real addresses, and the confirmation
 * code is what actually proves the address works.
 */
export function emailLooksReal(email: string): boolean {
  const e = email.trim();
  if (e.length < 6 || e.length > 254) return false;
  if (/\s/.test(e)) return false;
  const at = e.indexOf('@');
  if (at < 1 || at !== e.lastIndexOf('@')) return false;
  const domain = e.slice(at + 1);
  if (domain.indexOf('.') < 1 || domain.endsWith('.')) return false;
  return true;
}

export interface PasswordVerdict { ok: boolean; why: string; strength: 0 | 1 | 2 | 3 }

/**
 * What makes an acceptable password here.
 *
 * Length does more for a password than a zoo of required character classes, and
 * rules that force a symbol mostly produce `Password1!`. So: twelve characters,
 * or eight with some variety, and a refusal that says which it was.
 */
export function checkPassword(pw: string, email = ''): PasswordVerdict {
  const p = pw || '';
  if (p.length < 8) return { ok: false, why: 'Use at least 8 characters.', strength: 0 };

  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((r) => r.test(p)).length;
  const local = email.split('@')[0].toLowerCase();
  if (local.length > 2 && p.toLowerCase().includes(local)) {
    return { ok: false, why: 'Do not use your email address in your password.', strength: 0 };
  }
  if (/^(.)\1+$/.test(p)) return { ok: false, why: 'That is the same character repeated.', strength: 0 };

  if (p.length < 12 && classes < 3) {
    return {
      ok: false,
      why: 'Either make it 12 characters or longer, or mix in capitals, numbers or symbols.',
      strength: 1,
    };
  }
  const strength: 0 | 1 | 2 | 3 = p.length >= 16 || (p.length >= 12 && classes >= 3) ? 3 : 2;
  return { ok: true, why: '', strength };
}

/** A six-digit confirmation code, as typed. */
export function codeLooksReal(code: string): boolean {
  return /^\d{6}$/.test((code || '').trim());
}
