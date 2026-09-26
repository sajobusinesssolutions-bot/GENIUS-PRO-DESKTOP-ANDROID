/**
 * Sends the books up without anyone pressing a button.
 *
 * With sync on, this runs a sync when the app opens, when it comes back to the
 * front, when the phone gets its connection back, and every few minutes while
 * there is work waiting. The Sync screen shows the last result either way.
 *
 * A failure backs off rather than simply being "tried again next time": a
 * server that is down or rejecting this device would otherwise be hit every
 * fifteen seconds forever, for as long as the app stayed open — burning
 * battery and data for retries that cannot succeed. Each consecutive failure
 * doubles the wait, capped at ten minutes, and one success resets it to the
 * normal cadence. A run started from the Sync screen's own button is
 * unaffected — a person pressing it is always allowed to try right now.
 */
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useAppData } from './AppDataContext';
import { useAuth } from './AuthContext';
import { useSyncRun } from './useSyncRun';
import { useToast } from '../components/Toast';

/** How often to try while changes are waiting, once nothing has gone wrong. */
const EVERY_MS = 15 * 1000;
/** However long the backoff has grown, never wait longer than this between tries. */
const MAX_BACKOFF_MS = 10 * 60 * 1000;
/** A copy of the books goes up at least this often even with nothing queued. */
const SNAPSHOT_EVERY_MS = 30 * 60 * 1000;
/** Stay quiet about a blip; only speak up once trouble looks ongoing. */
const NOTIFY_AFTER_FAILURES = 3;

export default function SyncKeeper() {
  const { db, ready, licFeature } = useAppData();
  const { account } = useAuth();
  const { run } = useSyncRun();
  const { error: toastError } = useToast();
  const last = useRef(0);
  const failures = useRef(0);
  const notified = useRef(false);

  const on = !!db?.sync.on && !!account && !account.localOnly && licFeature('sync');
  const online = db?.session.online !== false;
  const waiting = db?.queue.length || 0;
  const previousWaiting = useRef(waiting);

  const backoffMs = () => Math.min(EVERY_MS * Math.pow(2, failures.current), MAX_BACKOFF_MS);

  const attempt = useRef<() => void>(() => {});
  attempt.current = () => {
    void run('auto').then((outcome) => {
      if (outcome.ok) {
        failures.current = 0;
        notified.current = false;
        return;
      }
      failures.current += 1;
      if (failures.current >= NOTIFY_AFTER_FAILURES && !notified.current) {
        notified.current = true;
        toastError('Cloud sync is having trouble: ' + outcome.message);
      }
    });
  };

  const tick = useRef<() => void>(() => {});
  tick.current = () => {
    if (!ready || !on || !online) return;
    const since = Date.now() - last.current;
    if (since < backoffMs()) return;
    last.current = Date.now();
    attempt.current();
  };

  // open, sign-in, back online, or the moment a new local operation appears —
  // but only jump the queue while nothing is currently failing. Mid-outage,
  // ringing up ten sales should not mean ten immediate retries; it waits for
  // the same backoff everything else is waiting out.
  useEffect(() => {
    if (!ready || !on || !online) return;
    if (waiting > previousWaiting.current && failures.current === 0) {
      last.current = Date.now();
      attempt.current();
    } else {
      tick.current();
    }
    previousWaiting.current = waiting;
  }, [ready, on, online, waiting]);

  useEffect(() => {
    const t = setInterval(() => tick.current(), EVERY_MS);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') tick.current(); });
    return () => { clearInterval(t); sub.remove(); };
  }, []);

  return null;
}
