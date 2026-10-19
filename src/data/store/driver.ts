/**
 * The few SQLite calls the book store needs, behind one small interface.
 *
 * On a phone it is expo-sqlite. Under Jest it is Node's built-in `node:sqlite`
 * (see `__tests__/bookstore.test.ts`), so the tests run real SQL rather than
 * a mock that would agree with whatever the code expected.
 */
export interface Driver {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: unknown[]): Promise<void>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  close?(): Promise<void>;
}

export const BOOK_FILE = 'genius-books.db';

let opener: (() => Promise<Driver>) | null = null;

/** Tests swap the engine; the app never calls this. */
export function setDriverOpener(fn: (() => Promise<Driver>) | null): void {
  opener = fn;
}

export async function openDriver(): Promise<Driver> {
  if (opener) return opener();
  /* Required lazily so a screen test that never touches storage need not load
     the native module. */
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const SQLite = require('expo-sqlite') as typeof import('expo-sqlite');
  const db = await SQLite.openDatabaseAsync(BOOK_FILE);
  return {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params = []) => { await db.runAsync(sql, params as never); },
    all: (sql, params = []) => db.getAllAsync(sql, params as never) as never,
    close: () => db.closeAsync(),
  };
}
