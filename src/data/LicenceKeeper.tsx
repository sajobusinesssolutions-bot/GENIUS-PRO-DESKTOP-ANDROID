/**
 * Keeps the device's licence in step with the account.
 *
 * Nothing did this before. The server issued every new account a trial, the
 * app had the code to fetch and verify it, and nothing ever called that code —
 * so the licence on every phone stayed at "never checked" for good. This asks
 * whenever it has a reason to: when the app opens, when an account signs in,
 * and when the app comes back to the front after a while.
 *
 * A failure is left alone. The licence already on the phone has its own grace
 * window, and a shop out of signal must not be downgraded for it.
 */
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useAuth } from './AuthContext';
import { useAppData } from './AppDataContext';
import { refreshSession, serverConfigured } from './authApi';

/** Asking more often than this buys nothing: tokens last a month. */
const MIN_GAP_MS = 6 * 60 * 60 * 1000;

export default function LicenceKeeper() {
  const { account } = useAuth();
  const { ready, refreshLicence } = useAppData();
  const last = useRef(0);

  const check = useCallback(async (force = false) => {
    if (!ready || !account?.refresh || account.localOnly || !serverConfigured()) return;
    if (!force && Date.now() - last.current < MIN_GAP_MS) return;
    last.current = Date.now();
    const s = await refreshSession(account.refresh);
    if (!s.ok) return;
    await refreshLicence(s.value.access, account.id);
  }, [ready, account?.refresh, account?.localOnly, account?.id, refreshLicence]);

  // on open, and again the moment a (different) account signs in
  useEffect(() => { void check(true); }, [account?.id, ready]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') void check(); });
    return () => sub.remove();
  }, [check]);

  return null;
}
