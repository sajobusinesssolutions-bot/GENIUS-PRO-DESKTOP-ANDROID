/**
 * EVERY BUSINESS ON THIS PHONE HAS ITS OWN BOOK. The open business lives in
 * the app's store; each of the others is kept here, sealed like a backup, the
 * moment another is opened. Opening one again reads its own book back from
 * here — instant, offline, nothing downloaded or replaced — and sync then
 * brings it up to date. Only a business this phone has never held is
 * downloaded from the account.
 *
 * One file per business (its firm id), the newest copy only, beside a small
 * note of its name and when it was kept, so the list reads without opening it.
 */
import { Directory, File, Paths } from 'expo-file-system';
import type { DB } from './types';
import { sealBook, readBackup } from './deviceBackup';
import { wholeBook } from './storage';

export interface ParkedBook {
  id: string;
  name: string;
  /** When it was kept here. */
  keptAt: string;
  /** When the business was first set up, as far as the book says. */
  createdAt?: string;
  /** Its business on the account, when it had one. */
  businessId?: string;
  sales: number;
  /** Whether it had changes not yet on the account. */
  unsynced: boolean;
}

function folder(): Directory {
  const dir = new Directory(Paths.document, 'parked-books');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}
const safe = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '_');

/** Keeps the books about to be replaced. Quietly does nothing for an empty or demo book. */
export async function parkBook(db: DB | null | undefined): Promise<ParkedBook | null> {
  if (!db || db.demo || !db.onboarded || !db.firm?.id) return null;
  if (!db.sales.length && !db.products.length && !db.parties.length) return null;
  const whole = await wholeBook(db);
  const id = safe(db.firm.id);
  const dir = folder();
  const book = new File(dir, id + '.sa');
  if (book.exists) book.delete();
  book.create();
  book.write(sealBook(whole));
  const first = [...(db.auditLog || [])].map((a: any) => a.ts).filter(Boolean).sort()[0];
  const note: ParkedBook = {
    id, name: db.firm.name || 'Business', keptAt: new Date().toISOString(),
    createdAt: (db.firm as any).createdAt || first, businessId: db.sync?.businessId || undefined,
    sales: whole.sales.length, unsynced: !db.sync?.businessId || (db.queue || []).length > 0,
  };
  const meta = new File(dir, id + '.json');
  if (meta.exists) meta.delete();
  meta.create();
  meta.write(JSON.stringify(note));
  return note;
}

/** Every business kept on this phone, newest first. */
export function listParked(): ParkedBook[] {
  try {
    return folder().list()
      .filter((x): x is File => x instanceof File && x.name.endsWith('.json'))
      .map((f) => { try { return JSON.parse(f.textSync()) as ParkedBook; } catch { return null; } })
      .filter((x): x is ParkedBook => !!x && new File(folder(), x.id + '.sa').exists)
      .sort((a, b) => b.keptAt.localeCompare(a.keptAt));
  } catch { return []; }
}

/** The kept books of one business, ready to restore. */
export async function readParked(id: string): Promise<DB> {
  return readBackup(new File(folder(), safe(id) + '.sa'));
}

/** Lets a kept copy go (after it is restored, or when it is no longer wanted). */
export function forgetParked(id: string): void {
  for (const ext of ['.sa', '.json']) {
    const f = new File(folder(), safe(id) + ext);
    if (f.exists) f.delete();
  }
}
