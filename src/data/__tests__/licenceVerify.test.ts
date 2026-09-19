/**
 * The signature check, against a real token issued by the live server.
 *
 * Reading a token's claims is not the same as trusting them. Without this
 * check anyone could write themselves `"seats": 999` with an `EdDSA` header
 * and the app would believe it — so these tests use a genuine token and then
 * try to break it in the ways an attacker actually would.
 *
 * The fixture is a real licence from api.saljoetech.tech. It carries no secret:
 * it is signed data that anybody holding the public key can check and nobody
 * without the private key can produce.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { verifyLicence, verifyLicenceSignature, publicKeyBytes } from '../licenceKey';

const REAL = readFileSync(join(__dirname, 'fixtures-licence.txt'), 'utf8').trim();

/** Rewrites the claims of a token, leaving the original signature attached. */
function tamper(token: string, change: Record<string, unknown>): string {
  const [h, p, s] = token.split('.');
  const claims = { ...JSON.parse(Buffer.from(p, 'base64url').toString()), ...change };
  return `${h}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${s}`;
}

describe('a genuine licence from the server', () => {
  it('verifies against the key embedded in the app', async () => {
    expect(await verifyLicenceSignature(REAL)).toBe(true);
  });

  it('reads back the claims the server put in it', async () => {
    const r = await verifyLicence(REAL);
    expect(r.authentic).toBe(true);
    expect(r.claims?.email).toBe('soloamar2026@gmail.com');
    expect(r.claims?.plan).toBe('trial');
    expect(r.claims?.seats).toBe(2);
  });

  it('is bound to the account it was issued for', async () => {
    const r = await verifyLicence(REAL, 'someone-elses-account');
    expect(r.verdict).toBe('unbound');
  });
});

describe('a licence somebody has edited', () => {
  it('refuses one inflated to 999 seats', async () => {
    expect(await verifyLicenceSignature(tamper(REAL, { seats: 999 }))).toBe(false);
  });

  it('refuses one upgraded from trial to pro', async () => {
    expect(await verifyLicenceSignature(tamper(REAL, { plan: 'pro' }))).toBe(false);
  });

  it('refuses one with its expiry pushed out', async () => {
    const far = Math.floor(Date.now() / 1000) + 3650 * 86400;
    expect(await verifyLicenceSignature(tamper(REAL, { exp: far }))).toBe(false);
  });

  it('refuses one re-pointed at another owner', async () => {
    expect(await verifyLicenceSignature(tamper(REAL, { email: 'thief@example.com' }))).toBe(false);
  });

  it('treats a forged licence exactly as no licence at all', async () => {
    const r = await verifyLicence(tamper(REAL, { seats: 999 }));
    expect(r.authentic).toBe(false);
    expect(r.claims).toBeNull();
    expect(r.verdict).toBe('expired');
  });
});

describe('the ways a signature check is usually got around', () => {
  it('refuses a token claiming no algorithm', async () => {
    const [, p, s] = REAL.split('.');
    const h = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    expect(await verifyLicenceSignature(`${h}.${p}.${s}`)).toBe(false);
  });

  it('refuses a token claiming an HMAC', async () => {
    const [, p, s] = REAL.split('.');
    const h = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
    expect(await verifyLicenceSignature(`${h}.${p}.${s}`)).toBe(false);
  });

  it('refuses an empty signature', async () => {
    const [h, p] = REAL.split('.');
    expect(await verifyLicenceSignature(`${h}.${p}.`)).toBe(false);
  });

  it('refuses a signature of the wrong length', async () => {
    const [h, p] = REAL.split('.');
    expect(await verifyLicenceSignature(`${h}.${p}.${Buffer.alloc(32).toString('base64url')}`)).toBe(false);
  });

  it('refuses rubbish without throwing', async () => {
    expect(await verifyLicenceSignature('')).toBe(false);
    expect(await verifyLicenceSignature('a.b.c')).toBe(false);
    expect(await verifyLicenceSignature('not a token')).toBe(false);
  });
});

describe('the embedded key', () => {
  it('is 32 bytes, which is what an Ed25519 public key is', () => {
    expect(publicKeyBytes().length).toBe(32);
  });
});
