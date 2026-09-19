/**
 * Locks the till when the phone has been put down.
 *
 * Two settings, which did nothing before:
 *   · "Ask for a PIN when the app opens" — coming back to the app, from any
 *     other app or from the lock screen, asks for a PIN again;
 *   · "Lock after N minutes idle" — only once it has been away that long.
 *
 * The account stays signed in either way; this only asks who is on the counter.
 * A till left open on a shop counter is a till anyone can ring a refund on.
 */
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { CommonActions, NavigationContainerRefWithCurrent } from '@react-navigation/native';
import { useAppData } from '../data/AppDataContext';
import { useAuth } from '../data/AuthContext';

/** Screens that are already outside the till, where locking would be meaningless. */
const OUTSIDE = new Set(['PinLock', 'AuthGate', 'SignIn', 'CreateAccount', 'GoogleSignIn', 'Onboarding', 'LicenceStop', 'Welcome']);

export default function AppLock({ nav }: { nav: NavigationContainerRefWithCurrent<any> }) {
  const { db } = useAppData();
  const { signedIn } = useAuth();
  const leftAt = useRef<number | null>(null);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') {
        if (leftAt.current === null) leftAt.current = Date.now();
        return;
      }
      const away = leftAt.current === null ? 0 : Date.now() - leftAt.current;
      leftAt.current = null;
      if (!db?.onboarded || !signedIn || !nav.isReady()) return;
      if (OUTSIDE.has(nav.getCurrentRoute()?.name || '')) return;

      const mins = Number(db.settings.autoLockMins) || 0;
      const lock = db.settings.lockOnOpen === true || (mins > 0 && away >= mins * 60000);
      if (lock) nav.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'PinLock' }] }));
    });
    return () => sub.remove();
  }, [db?.onboarded, db?.settings.lockOnOpen, db?.settings.autoLockMins, signedIn, nav]);

  return null;
}
