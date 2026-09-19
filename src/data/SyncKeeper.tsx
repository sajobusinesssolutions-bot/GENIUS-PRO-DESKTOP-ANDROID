/**
 * Sends the books up without anyone pressing a button.
 *
 * With sync on, this runs a sync when the app opens, when it comes back to the
 * front, when the phone gets its connection back, and every few minutes while
 * there is work waiting. A failure is simply tried again next time; the Sync
 * screen shows the last result.
 */
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useAppData } from './AppDataContext';
import { useAuth } from './AuthContext';
import { useSyncRun } from './useSyncRun';

/** How often to try while changes are waiting. */
const EVERY_MS = 3 * 60 * 1000;
/** A copy of the books goes up at least this often even with nothing queued. */
const SNAPSHOT_EVERY_MS = 30 * 60 * 1000;

export default function SyncKeeper() {
  const { db, ready } = useAppData();
  const { account } = useAuth();
  const { run } = useSyncRun();
  const last = useRef(0);

  const on = !!db?.sync.on && !!account && !account.localOnly;
  const online = db?.session.online !== false;
  const waiting = db?.queue.length || 0;

  const tick = useRef<() => void>(() => {});
  tick.current = () => {
    if (!ready || !on || !online) return;
    const since = Date.now() - last.current;
    if (waiting === 0 && since < SNAPSHOT_EVERY_MS) return;
    if (since < 20 * 1000) return;
    last.current = Date.now();
    void run('auto');
  };

  // open, sign-in, back online
  useEffect(() => { tick.current(); }, [ready, on, online]);

  useEffect(() => {
    const t = setInterval(() => tick.current(), EVERY_MS);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') tick.current(); });
    return () => { clearInterval(t); sub.remove(); };
  }, []);

  return null;
}
