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
/** How often to ask the cloud for what other phones recorded. */
const PULL_EVERY_MS = 5 * 1000;
/** A screen opening asks at most this often, however fast someone taps around. */
const PULL_GAP_MS = 2 * 1000;

/**
 * Any screen can ask for a fresh look at the cloud — the navigators do it
 * each time a screen comes into view, so what is on it is current.
 */
const pullListeners = new Set<(force?: boolean) => Promise<unknown>>();
/** Resolves once the check is done. `force` skips the short gap between checks — for a pull-to-refresh. */
export function requestSync(force = false): Promise<void> {
  return Promise.all([...pullListeners].map((fn) => fn(force))).then(() => undefined);
}
/** Stay quiet about a blip; only speak up once trouble looks ongoing. */
const NOTIFY_AFTER_FAILURES = 3;

export default function SyncKeeper() {
  const { db, ready, licFeature } = useAppData();
  const { account } = useAuth();
  const { run, pull } = useSyncRun();
  const lastPull = useRef(0);
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

  // the quick pull: on request (a screen opening), and every few seconds
  const pullNow = useRef<(force?: boolean) => Promise<unknown>>(() => Promise.resolve());
  pullNow.current = (force) => {
    if (!ready || !on || !online || failures.current > 0) return Promise.resolve();
    if (!force && Date.now() - lastPull.current < PULL_GAP_MS) return Promise.resolve();
    lastPull.current = Date.now();
    return pull().catch(() => 0);
  };
  useEffect(() => {
    const onAsk = (force?: boolean) => pullNow.current(force);
    pullListeners.add(onAsk);
    const t = setInterval(() => { void pullNow.current(); }, PULL_EVERY_MS);
    return () => { pullListeners.delete(onAsk); clearInterval(t); };
  }, []);

  useEffect(() => {
    const t = setInterval(() => tick.current(), EVERY_MS);
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') tick.current(); });
    return () => { clearInterval(t); sub.remove(); };
  }, []);

  return null;
}
