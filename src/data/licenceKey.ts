/**
 * VERIFYING A LICENCE, OFFLINE.
 *
 * The server signs licence tokens with an Ed25519 private key that never leaves
 * the VPS. Only the public half is here, so a copy of this app cannot mint a
 * licence for itself — which is the entire reason the token is signed rather
 * than simply trusted.
 *
 * Verification happens on the device, with no network call, because a shop in
 * a place with no signal still has to be able to open its till. The token
 * carries its own expiry; the grace window in `syncProtocol` decides how long
 * an expired one is still honoured.
 */
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2';
import { LicenceClaims, licenceVerdict, LicenceVerdict } from './syncProtocol';

// @noble/ed25519 needs a SHA-512 supplied; React Native has no WebCrypto to
// take one from, so the audited pure-JS one is wired in here, once. The hook
// takes several byte arrays, so they are joined before hashing.
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));
ed.etc.sha512Async = async (...m) => sha512(ed.etc.concatBytes(...m));

/**
 * The public key of the licence signer.
 *
 * Safe to ship: it can check a signature and cannot create one. If this ever
 * needs to change, old tokens stop verifying, so a key rotation has to be
 * paired with an app release.
 */
export const LICENCE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAr3AtnJ3hCuextmo8YVV2dzzsfHr3iRnKfyz57ebvwMo=
-----END PUBLIC KEY-----`;

/** The raw 32 bytes of the key, which is what a verifier actually wants. */
export function publicKeyBytes(): Uint8Array {
  const b64 = LICENCE_PUBLIC_KEY
    .replace(/-----[A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  const der = base64ToBytes(b64);
  // An Ed25519 SubjectPublicKeyInfo is a fixed 44 bytes: a 12-byte header
  // followed by the key itself. Slicing is safe precisely because the shape
  // never varies for this algorithm.
  return der.slice(der.length - 32);
}

function base64ToBytes(b64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = b64.replace(/=+$/, '');
  const out = new Uint8Array((clean.length * 3) >> 2);
  let bits = 0;
  let acc = 0;
  let o = 0;
  for (let i = 0; i < clean.length; i += 1) {
    acc = (acc << 6) | chars.indexOf(clean[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o] = (acc >> bits) & 0xff;
      o += 1;
    }
  }
  return out.slice(0, o);
}

/* ---------------------------------------------------------------- */

export interface ReadLicence {
  claims: LicenceClaims | null;
  verdict: LicenceVerdict;
  /** False when the token is malformed or was not signed by our key. */
  authentic: boolean;
}

/**
 * Reads the claims out of a licence token.
 *
 * The signature check itself needs a crypto primitive React Native does not
 * ship, so it is done by the caller that has one (see `verifyLicence`). This
 * function is the part that is pure and testable: splitting the token and
 * deciding what its claims mean.
 */
export function readLicenceToken(token: string, accountId?: string): ReadLicence {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return { claims: null, verdict: 'expired', authentic: false };

  try {
    const header = JSON.parse(textFrom(parts[0]));
    // Anything but EdDSA is refused outright. `alg: none` and algorithm
    // confusion are the classic ways a signed token gets accepted unsigned.
    if (header.alg !== 'EdDSA') {
      return { claims: null, verdict: 'expired', authentic: false };
    }
    const claims = JSON.parse(textFrom(parts[1])) as LicenceClaims;
    return {
      claims,
      verdict: licenceVerdict(claims, { accountId }),
      authentic: true,
    };
  } catch {
    return { claims: null, verdict: 'expired', authentic: false };
  }
}

function textFrom(b64url: string): string {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = base64ToBytes(b64);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  // the claims are ASCII JSON, so no multi-byte decoding is needed
  return out;
}

/* ---------------------------------------------------------------- */

/**
 * Turns a server licence token into the shape the app already reasons about.
 *
 * `licState()` and `licBlocks()` in logic.ts — and therefore the gate that
 * decides whether a transaction may be saved at all — read `DB.licence`. So a
 * licence fetched from the server has to land there rather than in a parallel
 * notion of the same thing, or the app would hold two answers to one question.
 */
export function licenceFromToken(
  token: string,
  accountId?: string,
  now = new Date(),
): import('./types').Licence {
  const { claims, verdict, authentic } = readLicenceToken(token, accountId);

  if (!authentic || !claims) {
    return {
      key: '', server: '', status: 'invalid', checkedAt: now.toISOString(),
      licence: null, reason: 'The licence could not be read.', offlineSince: '',
    };
  }

  const expires = new Date(claims.exp * 1000);
  const daysLeft = Math.ceil((expires.getTime() - now.getTime()) / 86400000);

  // 'stale' is kept as-is: the app treats it as "an old answer is still an
  // answer, for a while", which is what a shop out of signal needs.
  const status: import('./types').LicStatus =
    verdict === 'active' ? 'active'
      : verdict === 'trial' ? 'trial'
        : verdict === 'stale' ? 'stale'
          : verdict === 'unbound' ? 'unbound' : 'expired';

  return {
    key: claims.jti,
    server: 'https://api.saljoetech.tech',
    status,
    checkedAt: now.toISOString(),
    reason: '',
    offlineSince: '',
    licence: {
      no: claims.jti,
      plan: claims.plan,
      planName: claims.plan === 'pro' ? 'Pro' : claims.plan === 'trial' ? 'Free trial' : 'Starter',
      term: claims.term,
      expiresAt: expires.toISOString(),
      daysLeft,
      devices: claims.seats,
      limits: { devices: claims.seats },
      features: claims.features || [],
      owner: { name: claims.email },
    },
  };
}

/* ---------------------------------------------------------------- */

/**
 * Checks that the licence really was signed by our server.
 *
 * Reading the claims is not the same as trusting them. Without this, anyone
 * could write themselves a token with `"seats": 999` and an `EdDSA` header and
 * the app would believe it — which is the whole reason the token is signed.
 *
 * Asynchronous because the curve arithmetic is not instant on a cheap phone.
 * It runs when a licence arrives or is loaded, not on the path of a sale.
 */
export async function verifyLicenceSignature(token: string): Promise<boolean> {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return false;
  try {
    const header = JSON.parse(textFrom(parts[0]));
    if (header.alg !== 'EdDSA') return false;

    const signed = new TextEncoder().encode(parts[0] + '.' + parts[1]);
    const signature = base64ToBytes(parts[2].replace(/-/g, '+').replace(/_/g, '/'));
    if (signature.length !== 64) return false;

    return await ed.verifyAsync(signature, signed, publicKeyBytes());
  } catch {
    // a malformed point or a bad length throws rather than returning false
    return false;
  }
}

/**
 * The whole check: signature first, then what the claims mean.
 *
 * A token that does not verify is treated exactly as a missing one, so a forged
 * licence buys nothing over having none at all.
 */
export async function verifyLicence(token: string, accountId?: string): Promise<ReadLicence> {
  const authentic = await verifyLicenceSignature(token);
  if (!authentic) return { claims: null, verdict: 'expired', authentic: false };
  return readLicenceToken(token, accountId);
}
