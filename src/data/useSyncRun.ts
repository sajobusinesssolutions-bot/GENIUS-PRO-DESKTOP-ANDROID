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
import { ensureWiring, pushQueue, uploadSnapshot } from './syncClient';
import { plural } from './helpers';

export interface RunOutcome {
  ok: boolean;
  sent: number;
  message: string;
  seq?: number;
}

export function useSyncRun() {
  const { db, setSync, dropQueued, logAudit, licFeature } = useAppData();
  const { account } = useAuth();
  const running = useRef(false);
  const dbRef = useRef(db);
  dbRef.current = db;

  const accessToken = useCallback(async (): Promise<string | null> => {
    if (!account?.refresh || account.localOnly) return null;
    const r = await refreshSession(account.refresh);
    return r.ok ? r.value.access : null;
  }, [account?.refresh, account?.localOnly]);

  const run = useCallback(async (how: 'manual' | 'auto'): Promise<RunOutcome> => {
    const d = dbRef.current;
    if (!d) return { ok: false, sent: 0, message: 'The books are not loaded yet.' };
    if (!licFeature('sync')) return { ok: false, sent: 0, message: 'Cloud sync is part of Pro. The developer switches it on for your account.' };
    if (!d.sync.on) return { ok: false, sent: 0, message: 'Turn sync on first.' };
    if (!account) return { ok: false, sent: 0, message: 'Sign in to your account first.' };
    if (d.session.online === false) return { ok: false, sent: 0, message: 'This phone has no internet right now.' };
    if (running.current) return { ok: false, sent: 0, message: 'A sync is already running.' };

    running.current = true;
    try {
      const token = await accessToken();
      if (!token) return { ok: false, sent: 0, message: 'Your session has expired. Sign out and in again.' };

      const wiring = await ensureWiring(d, token);
      if (!wiring.ok) return { ok: false, sent: 0, message: wiring.error.message };
      setSync({ businessId: wiring.value.businessId, deviceId: wiring.value.deviceId });

      const r = await pushQueue(d, token, wiring.value);
      if (!r.ok) return { ok: false, sent: 0, message: r.error.message };
      dropQueued([...new Set(r.value.done)]);

      // the copy goes after the push, from the books as they are now
      const snap = await uploadSnapshot(dbRef.current || d, token, wiring.value);

      const now = new Date().toISOString();
      const s = (dbRef.current || d).sync;
      const note = (r.value.sent ? plural(r.value.sent, 'change') + ' sent up' : 'Nothing was waiting')
        + (snap.ok ? '' : ' · the copy of the books did not go up');
      setSync({
        lastPush: now,
        lastAt: now,
        cursor: r.value.seq,
        lamport: (s.lamport || 0) + r.value.sent,
        pending: [],
        log: [
          ...(s.log || []).slice(-49),
          {
            id: 'sy_' + Date.now(), ts: now, how,
            up: r.value.sent, down: 0,
            by: d.users.find((u) => u.id === d.session.userId)?.name || '',
            ok: snap.ok,
            note,
          },
        ],
      });
      if (how === 'manual' || r.value.sent) logAudit('Cloud sync', note);
      return {
        ok: true,
        sent: r.value.sent,
        seq: r.value.seq,
        message: r.value.sent
          ? plural(r.value.sent, 'change') + ' sent to your account'
          : 'Nothing was waiting — everything is already up',
      };
    } finally {
      running.current = false;
    }
  }, [account, accessToken, setSync, dropQueued, logAudit, licFeature]);

  return { run, accessToken };
}
