/**
 * The .sa backup format: the books, encrypted.
 *
 *   "GSA1" | salt (16) | nonce (12) | AES-256-GCM(ciphertext + 16-byte tag)
 *
 * Each file gets its own random salt and nonce, and the key is derived from
 * the app's backup secret with HKDF. GCM authenticates as well as encrypts, so
 * a file that has been edited or damaged is refused instead of restoring
 * garbage. The header is bound in as associated data.
 *
 * The key ships with the app so that a backup restores on any phone running
 * Genius POS. That keeps the file unreadable in a file manager, an email or a
 * cloud drive, and makes it tamper-evident. It does not stand up to someone who
 * pulls the secret out of the app itself.
 */
import { gcm } from '@noble/ciphers/aes';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import * as Crypto from 'expo-crypto';

export const BACKUP_EXT = '.sa';
export const BACKUP_MIME = 'application/octet-stream';

const MAGIC = new Uint8Array([0x47, 0x53, 0x41, 0x31]); // "GSA1"
const SALT = 16;
const NONCE = 12;
const HEAD = MAGIC.length + SALT + NONCE;
const SECRET = utf8('genius-pos:backup:v1:3b9e6f1c0a7d4e2f8c5b1a9d6e3f0c7a');
const INFO = utf8('genius-pos backup key');

/** UTF-8 by hand — not every React Native engine ships TextEncoder/TextDecoder. */
export function utf8(s: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 1) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d < 0xe000) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i += 1; }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(out);
}

export function fromUtf8(b: Uint8Array): string {
  let out = '';
  for (let i = 0; i < b.length;) {
    const c = b[i];
    let cp: number;
    if (c < 0x80) { cp = c; i += 1; }
    else if (c < 0xe0) { cp = ((c & 31) << 6) | (b[i + 1] & 63); i += 2; }
    else if (c < 0xf0) { cp = ((c & 15) << 12) | ((b[i + 1] & 63) << 6) | (b[i + 2] & 63); i += 3; }
    else { cp = ((c & 7) << 18) | ((b[i + 1] & 63) << 12) | ((b[i + 2] & 63) << 6) | (b[i + 3] & 63); i += 4; }
    out += String.fromCodePoint(cp);
  }
  return out;
}

function random(n: number): Uint8Array {
  try {
    const b = Crypto.getRandomBytes(n);
    if (b && b.length === n) return b;
  } catch { /* fall through */ }
  const g = (globalThis as any).crypto;
  if (g?.getRandomValues) return g.getRandomValues(new Uint8Array(n));
  throw new Error('No secure random source on this device.');
}

function keyFor(salt: Uint8Array): Uint8Array {
  return hkdf(sha256, SECRET, salt, INFO, 32);
}

export function isSealed(bytes: Uint8Array): boolean {
  return bytes.length > HEAD && MAGIC.every((b, i) => bytes[i] === b);
}

/** Encrypts the books' JSON into .sa bytes. */
export function sealBackup(json: string): Uint8Array {
  const salt = random(SALT);
  const nonce = random(NONCE);
  const header = new Uint8Array(HEAD);
  header.set(MAGIC, 0);
  header.set(salt, MAGIC.length);
  header.set(nonce, MAGIC.length + SALT);
  const sealed = gcm(keyFor(salt), nonce, header).encrypt(utf8(json));
  const out = new Uint8Array(HEAD + sealed.length);
  out.set(header, 0);
  out.set(sealed, HEAD);
  return out;
}

/** Decrypts .sa bytes back to JSON. Throws a sentence a shopkeeper can read. */
export function openBackup(bytes: Uint8Array): string {
  if (!isSealed(bytes)) throw new Error('This is not a Genius POS backup (.sa) file.');
  const header = bytes.slice(0, HEAD);
  const salt = bytes.slice(MAGIC.length, MAGIC.length + SALT);
  const nonce = bytes.slice(MAGIC.length + SALT, HEAD);
  try {
    const plain = gcm(keyFor(salt), nonce, header).decrypt(bytes.slice(HEAD));
    return fromUtf8(plain);
  } catch {
    throw new Error('This backup is damaged or has been changed, so it cannot be restored.');
  }
}

/* base64 — the file API reads and writes binary through it */

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
      + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=')
      + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out;
}

export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12)
      | ((i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : 0) << 6)
      | (i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : 0);
    out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length) out[o++] = n & 255;
  }
  return out.slice(0, o);
}
