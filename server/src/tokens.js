/**
 * Sessions and licences.
 *
 * Three different things are signed here and they are deliberately kept apart:
 *
 *  · **access tokens** — short-lived, HMAC, prove who is calling an endpoint;
 *  · **refresh tokens** — opaque random strings, never signed, stored only as a
 *    hash so a database leak does not hand out sessions;
 *  · **licence tokens** — Ed25519, because the app verifies these *offline*
 *    with only the public half. An HMAC would mean shipping the signing secret
 *    inside the APK, which is the same as not signing at all.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SignJWT, importPKCS8 } from 'jose';

const enc = new TextEncoder();

const ACCESS_SECRET = enc.encode(process.env.ACCESS_TOKEN_SECRET || '');
const PEPPER = process.env.REFRESH_TOKEN_PEPPER || '';
const ACCESS_TTL = Number(process.env.ACCESS_TOKEN_TTL || 900);

let licenceKey = null;
async function signingKey() {
  if (!licenceKey) {
    const pem = readFileSync(process.env.LICENCE_PRIVATE_KEY_PATH, 'utf8');
    licenceKey = await importPKCS8(pem, 'EdDSA');
  }
  return licenceKey;
}

/* ---------------------------------------------------------------- access */

export async function issueAccess(account) {
  return new SignJWT({ email: account.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(account.id)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ACCESS_TTL)
    .sign(ACCESS_SECRET);
}

export async function readAccess(token) {
  const { jwtVerify } = await import('jose');
  const { payload } = await jwtVerify(token, ACCESS_SECRET, { algorithms: ['HS256'] });
  return payload;
}

/* --------------------------------------------------------------- refresh */

/**
 * Refresh tokens are random, not signed.
 *
 * A signed token cannot be revoked without keeping a list of revocations, which
 * is the same amount of database work as simply storing the token — so we store
 * it, and deleting the row is what revocation means. Only a hash is kept, so
 * a copy of the table is not a set of working sessions.
 */
export function newRefresh() {
  return randomBytes(32).toString('base64url');
}

export function hashRefresh(token) {
  return createHash('sha256').update(PEPPER + token).digest('hex');
}

/** Constant-time, so a timing difference cannot be used to guess a token. */
export function refreshMatches(token, storedHash) {
  const a = Buffer.from(hashRefresh(token), 'hex');
  const b = Buffer.from(String(storedHash || ''), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/* --------------------------------------------------------------- licence */

/**
 * The licence the app verifies offline.
 *
 * `exp` is deliberately much shorter than the subscription — a fresh token is
 * issued on every heartbeat — so that revoking a licence takes effect within a
 * month even for a device that is rarely online, without a shop losing its till
 * the moment it goes out of signal.
 */
export async function issueLicence({ account, licence, businesses }) {
  const days = Number(process.env.LICENCE_TOKEN_TTL_DAYS || 30);
  const now = Math.floor(Date.now() / 1000);
  const key = await signingKey();

  return new SignJWT({
    email: account.email,
    plan: licence.plan,
    term: licence.term,
    seats: licence.seats,
    features: licence.plan === 'pro' ? ['sync', 'multiFirm', 'secondaryUnit'] : ['sync'],
    businesses,
  })
    .setProtectedHeader({ alg: 'EdDSA' })
    .setSubject(account.id)
    .setIssuedAt(now)
    .setExpirationTime(now + days * 86400)
    .setJti(randomBytes(12).toString('hex'))
    .sign(key);
}
