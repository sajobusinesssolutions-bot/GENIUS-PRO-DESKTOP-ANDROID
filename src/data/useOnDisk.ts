/**
 * Reads what a windowed book left on disk, for the few screens that look past
 * the window by record rather than by date. All of these do nothing while the
 * whole book is in memory.
 */
import { useEffect, useState } from 'react';
import { useAppData } from './AppDataContext';
import { isPartialBook, rowsOnDisk, countOnDisk } from './storage';
import type { DB } from './types';

/** Reads one record from disk into the live book when it is older than what is in memory, so its screen (and Edit, Void, Return from there) works on the real record. */
export function useOnDisk(coll: string, id: string | null | undefined, present: boolean): void {
  const { ensureLoaded } = useAppData();
  useEffect(() => {
    if (!id || present) return;
    ensureLoaded(coll, [id]).catch(() => undefined);
  }, [coll, id, present, ensureLoaded]);
}

/** One item's older movements (or other rows) left on disk; `[]` with the whole book in memory. */
export function useOlderRows<T extends { id: string }>(live: DB | null, coll: string, item: string | undefined): T[] {
  const partial = isPartialBook(live);
  const [rows, setRows] = useState<T[]>([]);
  useEffect(() => {
    if (!partial || !item) { setRows([]); return undefined; }
    let alive = true;
    rowsOnDisk<T>(live, coll, { item }).then((r) => { if (alive) setRows(r); }).catch(() => undefined);
    return () => { alive = false; };
    // re-read only when the window or the item changes, not on every save
  }, [partial, coll, item]); // eslint-disable-line react-hooks/exhaustive-deps
  return rows;
}

/** Joins the older rows to the ones in memory, each record once. */
export function withOlder<T extends { id: string }>(inMemory: T[], older: T[]): T[] {
  if (!older.length) return inMemory;
  const seen = new Set(inMemory.map((r) => r.id));
  return [...older.filter((r) => !seen.has(r.id)), ...inMemory];
}

/** How many older records match, counted on disk; 0 with the whole book in memory. */
export function useOlderCount(live: DB | null, coll: string, eq: Record<string, string> | null, notEq?: Record<string, string>): number {
  const partial = isPartialBook(live);
  const key = JSON.stringify([eq, notEq]);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!partial || !eq) { setN(0); return undefined; }
    let alive = true;
    countOnDisk(live, coll, { eq, notEq }).then((c) => { if (alive) setN(c); }).catch(() => undefined);
    return () => { alive = false; };
  }, [partial, coll, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return n;
}
