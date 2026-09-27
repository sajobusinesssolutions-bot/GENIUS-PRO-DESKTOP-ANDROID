/**
 * The .sa backup: encrypted, tamper-evident, and it must come back exactly.
 */
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => require('crypto').randomBytes(n),
}));

import { sealBackup, openBackup, isSealed, toBase64, fromBase64, BACKUP_EXT } from '../backupCrypto';
import { backupDue, backupName } from '../deviceBackup';

const book = JSON.stringify({ v: 1, firm: { name: 'Corner Shop' }, sales: [{ no: 'INV-1', total: 5000 }], note: 'ünïcödé ✓' });

describe('sealing a backup', () => {
  it('round-trips exactly, including non-ASCII text', () => {
    expect(openBackup(sealBackup(book))).toBe(book);
  });

  it('is not readable as text — the shop name and figures do not appear in the file', () => {
    const bytes = sealBackup(book);
    const asText = Buffer.from(bytes).toString('latin1');
    expect(asText).not.toContain('Corner Shop');
    expect(asText).not.toContain('INV-1');
    expect(asText.startsWith('GSA1')).toBe(true);
  });

  it('uses a fresh salt and nonce every time, so two backups of the same books differ', () => {
    expect(toBase64(sealBackup(book))).not.toBe(toBase64(sealBackup(book)));
  });

  it('refuses a file that has been changed', () => {
    const bytes = sealBackup(book);
    bytes[bytes.length - 20] ^= 1;
    expect(() => openBackup(bytes)).toThrow(/damaged or has been changed/);
  });

  it('refuses a changed header too', () => {
    const bytes = sealBackup(book);
    bytes[6] ^= 1; // inside the salt
    expect(() => openBackup(bytes)).toThrow(/damaged or has been changed/);
  });

  it('says plainly when a file is not a backup at all', () => {
    const plain = new TextEncoder().encode(book);
    expect(isSealed(plain)).toBe(false);
    expect(() => openBackup(plain)).toThrow(/not a Genius POS backup/);
  });

  it('files end in .sa', () => {
    expect(BACKUP_EXT).toBe('.sa');
    expect(backupName('Corner Shop', false, new Date(2026, 8, 27, 6, 5, 9))).toBe('GeniusPOS_Corner-Shop_2026-09-27_060509.sa');
    expect(backupName('Corner Shop', true, new Date(2026, 8, 27, 6, 5, 9))).toMatch(/_auto\.sa$/);
  });
});

describe('UTF-8 without TextEncoder', () => {
  it('matches Node for accents, symbols and emoji, both ways', () => {
    const { utf8, fromUtf8 } = require('../backupCrypto');
    for (const s of ['', 'plain', 'Kampala — Sh 5,000', 'ünïcödé ✓ €', 'emoji 🧾🛒 end']) {
      expect(Buffer.from(utf8(s)).toString('utf8')).toBe(s);
      expect(fromUtf8(new Uint8Array(Buffer.from(s, 'utf8')))).toBe(s);
    }
  });
});

describe('base64', () => {
  it('matches Node for every length', () => {
    for (let n = 0; n < 70; n += 1) {
      const b = new Uint8Array(require('crypto').randomBytes(n));
      const s = toBase64(b);
      expect(s).toBe(Buffer.from(b).toString('base64'));
      expect(Array.from(fromBase64(s))).toEqual(Array.from(b));
    }
  });

  it('reads base64 with line breaks, as Android writes it', () => {
    const b = new Uint8Array(require('crypto').randomBytes(200));
    const wrapped = Buffer.from(b).toString('base64').replace(/(.{76})/g, '$1\n');
    expect(Array.from(fromBase64(wrapped))).toEqual(Array.from(b));
  });
});

describe('the backup schedule', () => {
  const now = new Date('2026-09-27T12:00:00Z').getTime();
  const ago = (days: number) => new Date(now - days * 86400000).toISOString();
  it('never runs on Manual', () => expect(backupDue('off', undefined, now)).toBe(false));
  it('runs straight away when there has never been one', () => expect(backupDue('daily', undefined, now)).toBe(true));
  it('runs daily, weekly and monthly on time and not before', () => {
    expect(backupDue('daily', ago(0.5), now)).toBe(false);
    expect(backupDue('daily', ago(1), now)).toBe(true);
    expect(backupDue('weekly', ago(6), now)).toBe(false);
    expect(backupDue('weekly', ago(7), now)).toBe(true);
    expect(backupDue('monthly', ago(29), now)).toBe(false);
    expect(backupDue('monthly', ago(30), now)).toBe(true);
  });
});
