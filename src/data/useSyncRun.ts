/**
 * ONE SYNC RUN.
 *
 * Wire the phone and the business, push what is queued, then send a whole copy
 * of the books. It lived inside the Sync screen, so it only ever happened when
 * somebody opened that screen and pressed the button. Now the screen and the
 * background keeper (SyncKeeper) both call this, and the books reach the
 * account without anyone remembering to.
 *
 * The copy is what makes "choose a business" after signing in work: a phone
 * that has never held a shop's books can fetch them.
 */
import { useCallback, useRef } from 'react';
import { useAppData } from './AppDataContext';
import { useAuth } from './AuthContext';
import { refreshSession } from './authApi';
import { ensureWiring, pushQueue, pullOps, uploadSnapshot } from './syncClient';
import { plural } from './helpers';

export interface RunOutcome {
  ok: boolean;
  sent: number;
  message: string;
  seq?: number;
}

/**
 * Shared across every component that calls useSyncRun (the Sync screen and
 * the background SyncKeeper both do), not one ref per hook instance. Two
 * instances used to each keep their own flag, so a manual tap on the Sync
 * screen and an automatic run from SyncKeeper never actually saw each other
 * — both could be mid-push at once, racing to write dbRef.current.
 */
let syncRunning = false;

/**
 * A sign-in token lasts longer than a few minutes, so one is reused rather than
 * asked for on every run: the quick "anything new?" check runs every few
 * seconds, and refreshing the session each time would double its cost.
 */
let tokenCache: { refresh: string; token: string; at: number } | null = null;
const TOKEN_REUSE_MS = 4 * 60 * 1000;

/** The whole copy of the books is heavy; it goes up this often, not every run. */
const SNAPSHOT_EVERY_MS = 30 * 60 * 1000;
let lastSnapshotAt = 0;

export function useSyncRun() {
  const { db, setSync, dropQueued, applyRemoteOps, logAudit, licFeature } = useAppData();
  const { account } = useAuth();
  const dbRef = useRef(db);
  dbRef.current = db;

  const accessToken = useCallback(async (): Promise<string | null> => {
    if (!account?.refresh || account.localOnly) return null;
    if (tokenCache && tokenCache.refresh === account.refresh && Date.now() - tokenCache.at < TOKEN_REUSE_MS) return tokenCache.token;
    const r = await refreshSession(account.refresh);
    if (!r.ok) { tokenCache = null; return null; }
    tokenCache = { refresh: account.refresh, token: r.value.access, at: Date.now() };
    return r.value.access;
  }, [account?.refresh, account?.localOnly]);

  const run = useCallback(async (how: 'manual' | 'auto'): Promise<RunOutcome> => {
    const d = dbRef.current;
    if (!d) return { ok: false, sent: 0, message: 'The books are not loaded yet.' };
    if (!licFeature('sync')) return { ok: false, sent: 0, message: 'Cloud sync is part of Pro. The developer switches it on for your account.' };
    if (!d.sync.on) return { ok: false, sent: 0, message: 'Turn sync on first.' };
    if (!account) return { ok: false, sent: 0, message: 'Sign in to your account first.' };
    if (d.session.online === false) return { ok: false, sent: 0, message: 'This phone has no internet right now.' };
    if (syncRunning) return { ok: false, sent: 0, message: 'A sync is already running.' };

    syncRunning = true;
    try {
      const token = await accessToken();
      if (!token) return { ok: false, sent: 0, message: 'Your session has expired. Sign out and in again.' };

      const wiring = await ensureWiring(d, token);
      if (!wiring.ok) return { ok: false, sent: 0, message: wiring.error.message };
      setSync({ businessId: wiring.value.businessId, deviceId: wiring.value.deviceId });

      const r = await pushQueue(d, token, wiring.value);
      if (!r.ok) return { ok: false, sent: 0, message: r.error.message };
      dropQueued([...new Set(r.value.done)]);

      let down = 0;
      let cursor = (dbRef.current || d).sync.cursor || 0;
      let more = true;
      while (more) {
        const pulled = await pullOps(token, wiring.value.businessId, cursor);
        if (!pulled.ok) return { ok: false, sent: r.value.sent, message: pulled.error.message };
        if (pulled.value.ops.length) {
          down += applyRemoteOps(pulled.value.ops);
          cursor = Math.max(cursor, pulled.value.seq);
        }
        more = pulled.value.more;
      }

      // the copy goes after the push, from the books as they are now — when asked
      // for, or when the last one is old; the changes themselves already went up
      const snapDue = how === 'manual' || !!(dbRef.current || d).sync.snapshotDue || Date.now() - lastSnapshotAt > SNAPSHOT_EVERY_MS;
      const snap = snapDue
        ? await uploadSnapshot(dbRef.current || d, token, wiring.value)
        : { ok: true as const, value: { bytes: 0, version: (dbRef.current || d).sync.snapshotVersion || 0 } };
      if (!snap.ok) {
        return { ok: false, sent: r.value.sent, seq: r.value.seq, message: snap.error.message };
      }
      if (snapDue) lastSnapshotAt = Date.now();

      const now = new Date().toISOString();
      const s = (dbRef.current || d).sync;
      if (dbRef.current) dbRef.current.sync = { ...dbRef.current.sync, snapshotVersion: snap.value.version };
      const note = (r.value.sent ? plural(r.value.sent, 'change') + ' sent up' : 'Nothing was waiting')
        + (snap.ok ? '' : ' · the copy of the books did not go up');
      setSync({
        ...(snapDue ? { snapshotDue: false } : {}),
        lastPush: now,
        lastAt: now,
        cursor: Math.max(r.value.seq, cursor),
        snapshotVersion: snap.value.version,
        lamport: (s.lamport || 0) + r.value.sent,
        pending: [],
        log: [
          ...(s.log || []).slice(-49),
          {
            id: 'sy_' + Date.now(), ts: now, how,
            up: r.value.sent, down,
            by: d.users.find((u) => u.id === d.session.userId)?.name || '',
            ok: true,
            note,
          },
        ],
      });
      if (how === 'manual' || r.value.sent) logAudit('Cloud sync', note);
      return {
        ok: true,
        sent: r.value.sent,
        seq: r.value.seq,
        message: r.value.sent || down
          ? plural(r.value.sent, 'change') + ' sent, ' + plural(down, 'change') + ' received'
          : 'Everything is up to date',
      };
    } finally {
      syncRunning = false;
    }
  }, [account, accessToken, setSync, dropQueued, applyRemoteOps, logAudit, licFeature]);

  /**
   * The quick check: fetch what other phones have recorded since last time and
   * apply it, nothing more. Cheap enough to run when a screen opens and every
   * few seconds, so a sale rung up on another phone shows here almost at once.
   * Returns how many changes came down (0 when nothing ran).
   */
  const pull = useCallback(async (): Promise<number> => {
    const d = dbRef.current;
    if (!d || !d.sync.on || !account || account.localOnly || d.session.online === false || !licFeature('sync')) return 0;
    if (!d.sync.businessId || syncRunning) return 0;
    syncRunning = true;
    try {
      const token = await accessToken();
      if (!token) return 0;
      let down = 0;
      let cursor = d.sync.cursor || 0;
      let more = true;
      while (more) {
        const pulled = await pullOps(token, d.sync.businessId, cursor);
        if (!pulled.ok) return down;
        if (pulled.value.ops.length) {
          down += applyRemoteOps(pulled.value.ops);
          cursor = Math.max(cursor, pulled.value.seq);
        }
        more = pulled.value.more;
      }
      if (cursor !== (d.sync.cursor || 0)) setSync({ cursor });
      return down;
    } catch {
      return 0;
    } finally {
      syncRunning = false;
    }
  }, [account, accessToken, setSync, applyRemoteOps, licFeature]);

  return { run, pull, accessToken };
}
