/**
 * Device backups: encrypted .sa files kept in this app's own storage.
 *
 * Kept in the app's documents folder, so they survive a restart but not an
 * uninstall. Each one can be shared to Drive, email or WhatsApp for safe
 * keeping off the phone. Scheduled backups prune themselves to the newest
 * AUTO_KEEP; ones made by hand are only removed by hand.
 */
import { Directory, File, Paths } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { validateBackup } from './storage';
import { BACKUP_EXT, fromBase64, fromUtf8, isSealed, openBackup, sealBackup, toBase64 } from './backupCrypto';
import type { DB } from './types';

export const AUTO_KEEP = 10;
export type BackupSchedule = 'off' | 'daily' | 'weekly' | 'monthly';

export interface DeviceBackup {
  name: string; uri: string; size: number; at: number; auto: boolean;
  /** Also written to the chosen folder in Downloads. */
  outside?: boolean;
}

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
  /* A book loaded with only recent trade in memory is not the whole book.
     Refuse rather than write a backup that silently lacks old sales; callers
     pass wholeBook(db) from storage.ts. */
  if ((db as { __window?: unknown }).__window) throw new Error('This backup would be incomplete. Try again in a moment.');
  const raw = JSON.stringify(db);
  const checked = validateBackup(raw);
  if (!checked.ok) throw new Error(checked.reason);
  return sealBackup(raw);
}

export function writeBackup(db: DB, auto = false): DeviceBackup {
  const name = backupName(db.firm.name, auto);
  const file = new File(backupFolder(), name);
  file.create({ overwrite: true, intermediates: true });
  const data = toBase64(sealBook(db));
  file.write(data, { encoding: 'base64' });
  if (!file.exists || !(file.size && file.size > 0)) throw new Error('The backup file could not be written.');
  if (auto) pruneAuto();
  // a second copy in the phone's own Downloads folder, which survives an uninstall
  const outside = copyToChosenFolder(name, data);
  return { name, uri: file.uri, size: file.size || 0, at: Date.now(), auto, outside };
}

/* ---------------- a folder in Downloads ----------------
 *
 * The app's own storage goes when the app is uninstalled. So backups are also
 * written to a folder the person can see in their file manager —
 * Downloads/Genius Pro Backups. Android lets an app write outside its own
 * storage only to a folder the person has picked once; the permission is kept,
 * so after that every backup lands there by itself.
 */
export const OUTSIDE_FOLDER = 'Genius Pro Backups';
const FOLDER_KEY = 'genius.backupFolderUri';
const DOWNLOADS_URI = 'content://com.android.externalstorage.documents/tree/primary%3ADownload';
let chosenFolder: string | null = null;

/** Reads the folder picked before, once, when the app starts. */
export async function loadChosenFolder(): Promise<string | null> {
  try { chosenFolder = await AsyncStorage.getItem(FOLDER_KEY); } catch { chosenFolder = null; }
  return chosenFolder;
}

export function chosenFolderUri(): string | null { return chosenFolder; }

/** Where backups also go, in words: "Download/Genius Pro Backups". */
export function chosenFolderText(): string | null {
  if (!chosenFolder) return null;
  const tail = decodeURIComponent(chosenFolder).split(/[:/]/).filter(Boolean).slice(-2).join('/');
  return tail || OUTSIDE_FOLDER;
}

/**
 * Asks the person to allow Downloads (Android opens the folder picker there),
 * then makes "Genius Pro Backups" inside whatever they chose and remembers it.
 */
export async function chooseBackupFolder(): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  const picked = await Directory.pickDirectoryAsync(DOWNLOADS_URI);
  if (!picked) return null;
  let target: Directory = picked;
  // they may have picked the backup folder itself; otherwise make it inside
  if (!/Genius(%20| )Pro(%20| )Backups/i.test(picked.uri)) {
    const existing = picked.list().find((x) => x instanceof Directory && x.name === OUTSIDE_FOLDER);
    target = (existing as Directory) || picked.createDirectory(OUTSIDE_FOLDER);
  }
  chosenFolder = target.uri;
  try { await AsyncStorage.setItem(FOLDER_KEY, target.uri); } catch { /* kept for this run only */ }
  return target.uri;
}

export async function forgetBackupFolder(): Promise<void> {
  chosenFolder = null;
  try { await AsyncStorage.removeItem(FOLDER_KEY); } catch { /* nothing to forget */ }
}

/** Writes a copy into the chosen folder. Quietly false when there is none or it is gone. */
export function copyToChosenFolder(name: string, base64: string): boolean {
  if (!chosenFolder) return false;
  try {
    const dir = new Directory(chosenFolder);
    const file = dir.createFile(name, BACKUP_MIME_OUT);
    file.write(base64, { encoding: 'base64' });
    return true;
  } catch {
    return false;
  }
}
const BACKUP_MIME_OUT = 'application/octet-stream';

/** A backup's bytes as base64, for sending to Google Drive. */
export async function backupBase64(uri: string): Promise<string> {
  return new File(uri).base64();
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
export async function readBackup(source: string | File): Promise<DB> {
  const bytes = fromBase64(await (typeof source === 'string' ? new File(source) : source).base64());
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
