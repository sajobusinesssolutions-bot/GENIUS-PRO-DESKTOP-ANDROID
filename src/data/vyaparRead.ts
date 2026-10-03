/**
 * Opening a Vyapar backup on the phone.
 *
 * A .vyb is a zip with one SQLite database inside (.vyp). It is unzipped in
 * memory and its database opened from memory too, and the tables the importer
 * needs read out as plain rows. No copy is written to the phone; nothing of
 * Vyapar's is kept beyond what is imported.
 */
import { File } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { unzipSync } from 'fflate';
import { VyTables, VY_TABLES } from './vyapar';

/**
 * Reads the backup from a picked file. A File from File.pickFileAsync carries
 * the read permission Android granted for it; a plain address is opened as one.
 */
export async function readVyaparBackup(source: string | File): Promise<VyTables> {
  const raw = await (typeof source === 'string' ? new File(source) : source).bytes();
  // a .vyb is a zip; a bare .vyp database is accepted too
  const isZip = raw[0] === 0x50 && raw[1] === 0x4b;
  let db = raw as Uint8Array;
  if (isZip) {
    const files = unzipSync(raw);
    const name = Object.keys(files).find((n) => /\.vyp$/i.test(n)) || Object.keys(files)[0];
    if (!name) throw new Error('This backup is empty.');
    db = files[name];
  }
  // "SQLite format 3" — anything else is not a Vyapar database
  if (String.fromCharCode(...db.slice(0, 15)) !== 'SQLite format 3') {
    throw new Error('This is not a Vyapar backup. Choose the .vyb file Vyapar saved.');
  }

  // Opened straight from memory: writing it to a file first and opening that
  // by path could land expo-sqlite on a fresh, empty database of the same name.
  // A database saved in WAL mode is marked as the classic kind on this copy —
  // the data is the same, and an in-memory database cannot use a WAL file.
  const copy = new Uint8Array(db);
  if (copy[18] === 2) copy[18] = 1;
  if (copy[19] === 2) copy[19] = 1;
  const conn = await SQLite.deserializeDatabaseAsync(copy);
  try {
    const have = new Set((await conn.getAllAsync<{ name: string }>("select name from sqlite_master where type='table'")).map((r) => r.name));
    if (!have.has('kb_transactions') || !have.has('kb_names')) {
      throw new Error('This database does not look like Vyapar’s — it has no transactions table (' + have.size + ' tables found).');
    }
    const out = {} as VyTables;
    for (const t of VY_TABLES) {
      (out as any)[t] = have.has(t) ? await conn.getAllAsync(`select * from ${t}`) : [];
    }
    return out;
  } finally {
    await conn.closeAsync().catch(() => {});
  }
}
