/**
 * Two addresses for one account server.
 *
 * api.saljoe.tech is the server's main name; api.saljoetech.tech is the same
 * server under the name the business started with, kept as the backup. Every
 * call in the app is written against the main name (SERVER_URL). This sits in
 * front of fetch: when the main name cannot be reached at all — its DNS
 * failing, the connection refused — the very same request is made once more on
 * the backup, and the backup is used straight away for the next few minutes.
 *
 * Only "no connection at all" moves to the backup. An answer of any kind,
 * an error included, came from the server and is passed on; and a request that
 * timed out may have arrived, so it is not sent a second time.
 */
export const PRIMARY = 'https://api.saljoe.tech';
export const BACKUP = 'https://api.saljoetech.tech';

/** How long to stay on the backup once the main name has failed. */
const STAY_MS = 5 * 60 * 1000;
let onBackupUntil = 0;

export function usingBackup(now = Date.now()): boolean { return now < onBackupUntil; }
export function resetServerChoice() { onBackupUntil = 0; }

type Fetch = typeof fetch;

/** fetch that falls back from the main name to the backup (exported for tests). */
export function withFailover(inner: Fetch): Fetch {
  return (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url;
    if (typeof url !== 'string' || !url.startsWith(PRIMARY)) return inner(input, init);
    const backupUrl = BACKUP + url.slice(PRIMARY.length);
    const again = (u: string) => (typeof input === 'string' ? inner(u, init) : inner(new Request(u, input), init));
    if (usingBackup()) return again(backupUrl);
    try {
      return await inner(input, init);
    } catch (e: any) {
      // a timeout or a cancel is not "unreachable": the request may have landed
      if (e?.name === 'AbortError' || init?.signal?.aborted) throw e;
      onBackupUntil = Date.now() + STAY_MS;
      return again(backupUrl);
    }
  }) as Fetch;
}

let installed = false;
/** Puts the fallback in front of the app's fetch, once, before anything calls the server. */
export function installServerFailover() {
  if (installed || typeof globalThis.fetch !== 'function') return;
  installed = true;
  globalThis.fetch = withFailover(globalThis.fetch.bind(globalThis));
}
