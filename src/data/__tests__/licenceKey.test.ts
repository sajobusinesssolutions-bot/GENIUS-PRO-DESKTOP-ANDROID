/**
 * Reading a licence token on the device.
 *
 * The failure worth preventing is a forged or tampered token being honoured.
 * The classic route is algorithm confusion — swapping `EdDSA` for `none` or an
 * HMAC and hoping the reader does not look — so that is checked explicitly.
 */
import { LICENCE_PUBLIC_KEY, publicKeyBytes, readLicenceToken } from '../licenceKey';

/** Builds a token the way the server does, without signing it. */
function token(header: object, claims: object, sig = 'x'.repeat(86)) {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64(header)}.${b64(claims)}.${sig}`;
}

const future = Math.floor(Date.now() / 1000) + 20 * 86400;
const past = Math.floor(Date.now() / 1000) - 60 * 86400;

const claims = (over: object = {}) => ({
  sub: 'acct_1', email: 'owner@example.com', plan: 'pro', term: 'yearly',
  seats: 3, features: ['sync'], businesses: ['biz_1'],
  iat: 0, exp: future, jti: 'j1', ...over,
});

describe('the embedded public key', () => {
  it('is a PEM public key, not a private one', () => {
    expect(LICENCE_PUBLIC_KEY).toContain('BEGIN PUBLIC KEY');
    expect(LICENCE_PUBLIC_KEY).not.toContain('PRIVATE');
  });

  it('decodes to the 32 bytes an Ed25519 key actually is', () => {
    expect(publicKeyBytes().length).toBe(32);
  });

  it('decodes to the same bytes every time', () => {
    expect(Array.from(publicKeyBytes())).toEqual(Array.from(publicKeyBytes()));
  });
});

describe('readLicenceToken', () => {
  it('reads the claims out of a well-formed token', () => {
    const r = readLicenceToken(token({ alg: 'EdDSA' }, claims()));
    expect(r.authentic).toBe(true);
    expect(r.claims?.email).toBe('owner@example.com');
    expect(r.claims?.seats).toBe(3);
    expect(r.verdict).toBe('active');
  });

  it('refuses a token that claims no signature at all', () => {
    const r = readLicenceToken(token({ alg: 'none' }, claims()));
    expect(r.authentic).toBe(false);
    expect(r.claims).toBeNull();
    expect(r.verdict).toBe('expired');
  });

  it('refuses one signed with the wrong kind of algorithm', () => {
    const r = readLicenceToken(token({ alg: 'HS256' }, claims()));
    expect(r.authentic).toBe(false);
  });

  it('refuses anything that is not three parts', () => {
    expect(readLicenceToken('').authentic).toBe(false);
    expect(readLicenceToken('one.two').authentic).toBe(false);
    expect(readLicenceToken('not a token at all').authentic).toBe(false);
  });

  it('refuses a token whose claims are not readable', () => {
    expect(readLicenceToken('eyJhbGciOiJFZERTQSJ9.!!!!.sig').authentic).toBe(false);
  });

  it('calls an old token stale rather than dead, for a shop simply offline', () => {
    const almost = Math.floor(Date.now() / 1000) - 3 * 86400;
    expect(readLicenceToken(token({ alg: 'EdDSA' }, claims({ exp: almost }))).verdict).toBe('stale');
  });

  it('calls a long-dead token expired', () => {
    expect(readLicenceToken(token({ alg: 'EdDSA' }, claims({ exp: past }))).verdict).toBe('expired');
  });

  it('calls a token issued to another owner unbound', () => {
    const r = readLicenceToken(token({ alg: 'EdDSA' }, claims()), 'acct_someone_else');
    expect(r.verdict).toBe('unbound');
  });

  it('names a trial as a trial', () => {
    expect(readLicenceToken(token({ alg: 'EdDSA' }, claims({ plan: 'trial' }))).verdict).toBe('trial');
  });
});

describe('licenceFromToken honours what the server says', () => {
  const { licenceFromToken } = require('../licenceKey');

  it('stops a blocked account even while its token is still in date', () => {
    const l = licenceFromToken(token({ alg: 'EdDSA' }, claims({ status: 'blocked' })));
    expect(l.status).toBe('blocked');
  });

  it('treats a lapsed subscription as expired though the token is fresh', () => {
    expect(licenceFromToken(token({ alg: 'EdDSA' }, claims({ status: 'expired' }))).status).toBe('expired');
  });

  it('reports the subscription end rather than the token\'s', () => {
    const until = new Date(Date.now() + 200 * 86400000).toISOString();
    const l = licenceFromToken(token({ alg: 'EdDSA' }, claims({ status: 'active', until })));
    expect(l.licence.daysLeft).toBeGreaterThanOrEqual(199);
  });

  it('shows no end date for a lifetime licence', () => {
    const l = licenceFromToken(token({ alg: 'EdDSA' }, claims({ status: 'active', until: null, term: 'lifetime' })));
    expect(l.licence.daysLeft).toBeNull();
    expect(l.status).toBe('active');
  });
});
