/**
 * PINs are stored hashed, never in plain text.
 *
 * A four-digit PIN only has 10,000 possible values, so hashing does not
 * defend against someone willing to try them all on the till itself — the
 * lock screen's own lockout would have to do that job. What hashing defends
 * against is the far more likely leak: the whole book, PINs included, is
 * written to a local file and uploaded as a cloud snapshot (see storage.ts
 * and syncClient.ts). Before this, anyone who opened that JSON — a backup
 * file, a support screenshot, a stolen phone's storage — could read every
 * staff member's PIN directly. A per-user salt also keeps two staff who
 * picked the same PIN from hashing to the same value.
 *
 * Uses @noble/hashes' pure-JS sha256, already a dependency for licence
 * verification (see licenceKey.ts), so this needs no native module call and
 * stays synchronous — storage.migrate() runs synchronously on every load and
 * cannot await one.
 */
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

const SALT_HEX_CHARS = 16; // 8 bytes of salt

function randomSalt(): string {
  let s = '';
  for (let i = 0; i < SALT_HEX_CHARS; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

function digest(salt: string, pin: string): string {
  return bytesToHex(sha256(utf8ToBytes(salt + '$' + pin)));
}

/** True once a stored value is `salt$hash` rather than a raw typed PIN. */
export function isPinHashed(stored: string): boolean {
  return stored.indexOf('$') > 0 && stored.length > SALT_HEX_CHARS + 1;
}

/**
 * Turns a PIN someone just typed or chose into what actually gets stored.
 * Empty stays empty — that is how "no PIN chosen yet" is represented, and it
 * must stay one recognisable value rather than hash to something random.
 * Already-hashed input is returned unchanged, so this is safe to call
 * wherever a PIN might already have been hashed upstream.
 */
export function hashPin(pin: string): string {
  if (!pin) return '';
  if (isPinHashed(pin)) return pin;
  const salt = randomSalt();
  return salt + '$' + digest(salt, pin);
}

/**
 * Checks a typed PIN against what is stored. Still accepts a stored value
 * that is plain-text digits, so a book saved before hashing existed keeps
 * unlocking on its next load — storage.migrate() rehashes it as soon as the
 * book loads, so this fallback only ever matters for that one load.
 */
export function verifyPin(pin: string, stored: string): boolean {
  if (!stored || !pin) return false;
  if (!isPinHashed(stored)) return stored === pin;
  const sep = stored.indexOf('$');
  const salt = stored.slice(0, sep);
  const hash = stored.slice(sep + 1);
  return digest(salt, pin) === hash;
}
