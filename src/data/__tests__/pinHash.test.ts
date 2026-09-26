/**
 * PINs must never sit at rest as the digits someone typed — see pinHash.ts
 * for why. These tests pin down the two things that matter: a stored PIN
 * cannot be read back out, and a book saved before hashing existed still
 * unlocks on its first load after the upgrade.
 */
import { hashPin, verifyPin, isPinHashed } from '../pinHash';

describe('hashPin', () => {
  it('never stores the PIN itself', () => {
    const stored = hashPin('1234');
    expect(stored).not.toContain('1234');
    expect(isPinHashed(stored)).toBe(true);
  });

  it('leaves "no PIN chosen yet" as the empty string, not a hash of nothing', () => {
    expect(hashPin('')).toBe('');
  });

  it('salts, so two staff who pick the same PIN do not store the same value', () => {
    expect(hashPin('1234')).not.toBe(hashPin('1234'));
  });

  it('is idempotent on an already-hashed value, so re-saving an unchanged PIN cannot double-hash it', () => {
    const once = hashPin('1234');
    expect(hashPin(once)).toBe(once);
  });
});

describe('verifyPin', () => {
  it('accepts the right PIN against its hash', () => {
    expect(verifyPin('1234', hashPin('1234'))).toBe(true);
  });

  it('rejects a wrong PIN against the hash', () => {
    expect(verifyPin('9999', hashPin('1234'))).toBe(false);
  });

  it('rejects everything against no PIN set', () => {
    expect(verifyPin('1234', '')).toBe(false);
    expect(verifyPin('', '')).toBe(false);
  });

  it('still honours a plain-text PIN, so an old book unlocks once more before migrate() rehashes it', () => {
    expect(verifyPin('1234', '1234')).toBe(true);
    expect(verifyPin('9999', '1234')).toBe(false);
  });
});
