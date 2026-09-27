/**
 * Device backups: encrypted .sa files kept in this app's own storage.
 *
 * Kept in the app's documents folder, so they survive a restart but not an
 * uninstall. Each one can be shared to Drive, email or WhatsApp for safe
 * keeping off the phone. Scheduled backups prune themselves to the newest
 * AUTO_KEEP; ones made by hand are only removed by hand.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { validateBackup } from './storage';
import { BACKUP_EXT, fromBase64, fromUtf8, isSealed, openBackup, sealBackup, toBase64 } from './backupCrypto';
import type { DB } from './types';

export const AUTO_KEEP = 10;
export type BackupSchedule = 'off' | 'daily' | 'weekly' | 'monthly';

export interface DeviceBackup { name: string; uri: string; size: number; at: number; auto: boolean }

const DAY = 86400000;
export const SCHEDULE_MS: Record<Exclude<BackupSchedule, 'off'>, number> = {
  daily: DAY, weekly: 7 * DAY, monthly: 30 * DAY,
};

export function backupFolder(): Directory {
  const dir = new Directory(Paths.document, 'backups');
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** The folder as a path a person can read. */
export function backupFolderPath(): string {
  try { return decodeURIComponent(backupFolder().uri.replace(/^file:\/\//, '')); } catch { return 'App storage / backups'; }
}

function stamp(d = new Date()): string {
  const p = (n: number) => (n < 10 ? '0' + n : String(n));
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function slug(s: string): string {
  return (s || 'shop').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'shop';
}

export function backupName(firm: string, auto: boolean, when = new Date()): string {
  return `GeniusPOS_${slug(firm)}_${stamp(when)}${auto ? '_auto' : ''}${BACKUP_EXT}`;
}

/** The whole book as encrypted bytes, checked before anything is written. */
export function sealBook(db: DB): Uint8Array {
  const raw = JSON.stringify(db);
  const checked = validateBackup(raw);
  if (!checked.ok) throw new Error(checked.reason);
  return sealBackup(raw);
}

export function writeBackup(db: DB, auto = false): DeviceBackup {
  const name = backupName(db.firm.name, auto);
  const file = new File(backupFolder(), name);
  file.create({ overwrite: true, intermediates: true });
  file.write(toBase64(sealBook(db)), { encoding: 'base64' });
  if (!file.exists || !(file.size && file.size > 0)) throw new Error('The backup file could not be written.');
  if (auto) pruneAuto();
  return { name, uri: file.uri, size: file.size || 0, at: Date.now(), auto };
}

export function listBackups(): DeviceBackup[] {
  try {
    return backupFolder().list()
      .filter((x): x is File => x instanceof File && x.name.toLowerCase().endsWith(BACKUP_EXT))
      .map((f) => ({
        name: f.name, uri: f.uri, size: f.size || 0,
        at: (f as any).modificationTime || (f as any).creationTime || 0,
        auto: f.name.includes('_auto'),
      }))
      .sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));
  } catch {
    return [];
  }
}

export function deleteBackup(uri: string): void {
  const f = new File(uri);
  if (f.exists) f.delete();
}

function pruneAuto(): void {
  listBackups().filter((b) => b.auto).slice(AUTO_KEEP).forEach((b) => deleteBackup(b.uri));
}

/**
 * Reads a backup — an encrypted .sa, or an older plain .json one — and checks
 * it is a complete book before handing it back.
 */
export async function readBackup(uri: string): Promise<DB> {
  const bytes = fromBase64(await new File(uri).base64());
  const json = isSealed(bytes) ? openBackup(bytes) : fromUtf8(bytes);
  const checked = validateBackup(json);
  if (!checked.ok || !checked.db) throw new Error(checked.reason || 'This backup could not be read.');
  return checked.db;
}

export function backupDue(schedule: BackupSchedule | undefined, lastAt: string | undefined, now = Date.now()): boolean {
  if (!schedule || schedule === 'off') return false;
  if (!lastAt) return true;
  const last = new Date(lastAt).getTime();
  return !Number.isFinite(last) || now - last >= SCHEDULE_MS[schedule];
}
