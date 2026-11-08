/**
 * When this phone last heard from the account server.
 *
 * The quick pull runs every few seconds, so on a phone with a working
 * connection this is never more than a few seconds old. An edit or a delete of
 * something already saved is allowed only while it is fresh: the change then
 * reaches every other till at once, instead of waiting on this phone while
 * another till edits the same sale (and one change silently loses).
 */
let lastOkAt = 0;

/** A pull or a sync run reached the server and came back. */
export function markServerOk(at = Date.now()): void {
  lastOkAt = at;
}

/** Whether the server answered within the last `ms` milliseconds. */
export function serverOkWithin(ms: number, now = Date.now()): boolean {
  return lastOkAt > 0 && now - lastOkAt <= ms;
}

/**
 * Why an edit or a delete may not go ahead right now: the business syncs and
 * the server has not answered within the last 25 seconds. Null when it may.
 */
export function changeNeedsServer(d: { sync?: { on?: boolean; businessId?: string | null } } | null | undefined, what: string, now = Date.now()): { title: string; why: string } | null {
  if (!d || !d.sync?.on || !d.sync.businessId) return null;
  if (serverOkWithin(25 * 1000, now)) return null;
  return {
    title: 'Not saved — no connection to the server',
    why: 'Changing or deleting ' + what + ' has to reach every till at once, and this phone cannot reach the Genius server right now. Check the internet, wait a few seconds, then try again.',
  };
}

/** For tests. */
export function resetServerContact(): void {
  lastOkAt = 0;
}
