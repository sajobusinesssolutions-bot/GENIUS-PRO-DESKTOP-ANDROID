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
import { wholeBook, isPartialBook } from './storage';
import { useAppData } from './AppDataContext';
import { useAuth } from './AuthContext';
import { refreshSession } from './authApi';
import { ensureWiring, pushQueue, pullOps, uploadSnapshot } from './syncClient';
import { plural } from './helpers';
import { needsNewerApp } from './appVersion';
import { inlineImage } from './docPrint';

/* The logo and signature live in files on this phone; the computer and other
   phones need the pictures themselves. Made once per picture, under 400 KB
   (the computer's limit), and the business's full details sent once. */
async function firmShare(f: import('./types').Firm | undefined): Promise<Partial<import('./types').Firm> | null> {
  if (!f) return null;
  const patch: Partial<import('./types').Firm> = {};
  const pairs: Array<['logo' | 'signature', 'logoData' | 'signatureData', 'logoFor' | 'signatureFor']> = [['logo', 'logoData', 'logoFor'], ['signature', 'signatureData', 'signatureFor']];
  for (const [k, dk, fk] of pairs) {
    const u = f[k];
    if (u && f[fk] !== u) {
      const data = u.startsWith('data:') ? u : await inlineImage(u);
      patch[dk] = data && data.length <= 400 * 1024 ? data : '';
      patch[fk] = u;
    } else if (!u && f[dk]) { patch[dk] = ''; patch[fk] = ''; }
  }
  if (!f.sharedV2) patch.sharedV2 = true;
  return Object.keys(patch).length ? patch : null;
}

export interface RunOutcome {
  ok: boolean;
  /** Another run held the line: not a failure, nothing to back off from. */
  busy?: boolean;
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
  const { db, setSync, dropQueued, applyRemoteOps, logAudit, licFeature, shareFirm } = useAppData();
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

  const runOnce = useCallback(async (how: 'manual' | 'auto'): Promise<RunOutcome> => {
    // The quick pull runs every few seconds, so a save very often lands while
    // one is in flight. Giving up then ("already running") counted as a sync
    // failure, held the sale back for the backoff and stopped this phone
    // pulling other tills' work meanwhile. Wait for the pull to finish instead.
    for (let i = 0; syncRunning && i < 150; i += 1) await new Promise((r) => setTimeout(r, 100));
    if (syncRunning) return { ok: false, busy: true, sent: 0, message: 'A sync is already running.' };
    if (dbRef.current?.sync?.on) { try { const fp = await firmShare(dbRef.current.firm); if (fp) shareFirm(fp); } catch { /* the pictures go next time */ } }
    const d = dbRef.current;
    if (!d) return { ok: false, sent: 0, message: 'The books are not loaded yet.' };
    if (!licFeature('sync')) return { ok: false, sent: 0, message: 'Cloud sync is part of Pro. The developer switches it on for your account.' };
    if (!d.sync.on) return { ok: false, sent: 0, message: 'Turn sync on first.' };
    if (!account) return { ok: false, sent: 0, message: 'Sign in to your account first.' };
    if (d.session.online === false) return { ok: false, sent: 0, message: 'This phone has no internet right now.' };
    // an out-of-date app must not write to books a newer version has opened
    if (needsNewerApp(d)) return { ok: false, sent: 0, message: 'Update the app to keep syncing.' };

    syncRunning = true;
    try {
      const token = await accessToken();
      if (!token) return { ok: false, sent: 0, message: 'Your session has expired. Sign out and in again.' };

      const wiring = await ensureWiring(d, token, account.deviceId);
      if (!wiring.ok) return { ok: false, sent: 0, message: wiring.error.message };
      // written only when it changes: every write re-renders the whole app and re-saves the books
      if (d.sync.businessId !== wiring.value.businessId || d.sync.deviceId !== wiring.value.deviceId) {
        setSync({ businessId: wiring.value.businessId, deviceId: wiring.value.deviceId });
      }

      // the server refuses an app older than the books: show the Update screen
      const stopIfOld = (e: { failure: string; message: string }) => {
        if (String(e.failure) !== 'updateRequired') return;
        const need = /Pro ([\d.]+)/.exec(e.message)?.[1];
        if (need) applyRemoteOps([{ kind: 'record.upsert', payload: { coll: 'firm', doc: { minAppVersion: need } } } as any]);
      };

      const r = await pushQueue(d, token, wiring.value);
      if (!r.ok) { stopIfOld(r.error); return { ok: false, sent: 0, message: r.error.message }; }
      dropQueued([...new Set(r.value.done)]);

      let down = 0;
      let cursor = (dbRef.current || d).sync.cursor || 0;
      let more = true;
      while (more) {
        const pulled = await pullOps(token, wiring.value.businessId, cursor);
        if (!pulled.ok) { stopIfOld(pulled.error); return { ok: false, sent: r.value.sent, message: pulled.error.message }; }
        if (pulled.value.ops.length) {
          down += applyRemoteOps(pulled.value.ops);
          cursor = Math.max(cursor, pulled.value.seq);
        }
        more = pulled.value.more;
      }

      // the copy goes after the push, from the books as they are now — when asked
      // for, or when the last one is old; the changes themselves already went up
      const snapDue = how === 'manual' || !!(dbRef.current || d).sync.snapshotDue || Date.now() - lastSnapshotAt > SNAPSHOT_EVERY_MS;
      const keptVersion = (dbRef.current || d).sync.snapshotVersion || 0;
      let snap = snapDue
        ? await uploadSnapshot((isPartialBook(dbRef.current || d) ? await wholeBook(dbRef.current || d) : dbRef.current || d), token, wiring.value, cursor)
        : { ok: true as const, value: { bytes: 0, version: keptVersion } };
      // Another phone sent a newer copy. This phone's changes already went up
      // and everyone else's came down, so the sync itself worked: the copy is
      // simply skipped this time, not reported as a failure.
      if (!snap.ok && String(snap.error.failure) === 'staleSnapshot') {
        snap = { ok: true as const, value: { bytes: 0, version: keptVersion } };
      }
      if (!snap.ok) {
        return { ok: false, sent: r.value.sent, seq: r.value.seq, message: snap.error.message };
      }
      if (snapDue) lastSnapshotAt = Date.now();

      const now = new Date().toISOString();
      const s = (dbRef.current || d).sync;
      if (dbRef.current) dbRef.current.sync = { ...dbRef.current.sync, snapshotVersion: snap.value.version };
      const note = (r.value.sent ? plural(r.value.sent, 'change') + ' sent up' : 'Nothing was waiting')
        + (snap.ok ? '' : ' · the copy of the books did not go up');
      // The background run every 15 seconds usually finds nothing to do. Writing
      // a log line and re-saving the whole book each time made the entire app
      // re-render and stall several times a minute; an idle run now only notes
      // the time, without a commit.
      const idle = how === 'auto' && !r.value.sent && !down && !snapDue
        && Math.max(r.value.seq, cursor) === (s.cursor || 0) && snap.value.version === (s.snapshotVersion || 0)
        && !(s.pending || []).length;
      if (idle) {
        if (dbRef.current) dbRef.current.sync = { ...dbRef.current.sync, lastAt: now };
        return { ok: true, sent: 0, seq: r.value.seq, message: 'Everything is up to date' };
      }
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
   * A run, with any failure written to the sync log. Failures used to vanish:
   * the log only ever held successes, so a phone refused by the server (an
   * unpaid plan, a business it is not a member of) looked as if it had
   * nothing to send, and nobody could see why other tills never got its sales.
   * A failure is logged once until something changes, not every retry.
   */
  const run = useCallback(async (how: 'manual' | 'auto'): Promise<RunOutcome> => {
    const outcome = await runOnce(how);
    if (!outcome.ok && !outcome.busy) {
      const s = dbRef.current?.sync;
      const last = s?.log?.[s.log.length - 1];
      if (s && !(last && !last.ok && last.note === outcome.message)) {
        const now = new Date().toISOString();
        setSync({
          log: [...(s.log || []).slice(-49), {
            id: 'sy_' + Date.now(), ts: now, how, up: 0, down: 0,
            by: dbRef.current?.users.find((u) => u.id === dbRef.current?.session.userId)?.name || '',
            ok: false, note: outcome.message,
          }],
        });
      }
    }
    return outcome;
  }, [runOnce, setSync]);

  /**
   * The quick check: fetch what other phones have recorded since last time and
   * apply it, nothing more. Cheap enough to run when a screen opens and every
   * few seconds, so a sale rung up on another phone shows here almost at once.
   * Returns how many changes came down (0 when nothing ran).
   */
  const pull = useCallback(async (): Promise<number> => {
    const d = dbRef.current;
    if (!d || !d.sync.on || !account || account.localOnly || d.session.online === false || !licFeature('sync')) return 0;
    if (!d.sync.businessId || syncRunning || needsNewerApp(d)) return 0;
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
