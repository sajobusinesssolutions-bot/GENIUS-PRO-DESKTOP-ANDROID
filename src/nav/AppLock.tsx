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
 *
 * Also: when the owner changes what the person on the counter may do — their
 * role, the switches on that role, or switches them off — this phone hears of
 * it (here, or by sync) and goes straight back to the PIN screen. Signing in
 * again reads the new role, so the change applies at once rather than whenever
 * that person next happens to lock the app.
 */
import { useEffect, useRef } from 'react';
import { Alert, AppState } from 'react-native';
import { CommonActions, NavigationContainerRefWithCurrent } from '@react-navigation/native';
import { useAppData } from '../data/AppDataContext';
import { useAuth } from '../data/AuthContext';

/** Screens that are already outside the till, where locking would be meaningless. */
const OUTSIDE = new Set(['PinLock', 'AuthGate', 'SignIn', 'CreateAccount', 'GoogleSignIn', 'Onboarding', 'LicenceStop', 'Welcome']);

export default function AppLock({ nav }: { nav: NavigationContainerRefWithCurrent<any> }) {
  const { db } = useAppData();
  const { signedIn } = useAuth();
  const leftAt = useRef<number | null>(null);

  // what the signed-in person may do, as one string that changes when any of it does
  const me = db?.users.find((u) => u.id === db?.session.userId);
  const myRole = db?.roles?.find((r) => r.id === me?.role);
  const access = me ? [me.role, me.active, me.pin, myRole ? JSON.stringify(myRole.perms) : ''].join('|') : '';
  const seen = useRef<{ user: string; access: string } | null>(null);
  useEffect(() => {
    const user = db?.session.userId || '';
    const before = seen.current;
    seen.current = { user, access };
    // only a change for the same person counts — signing in as someone else is not one
    if (!before || before.user !== user || before.access === access || !access) return;
    if (!db?.onboarded || !signedIn || !nav.isReady()) return;
    if (OUTSIDE.has(nav.getCurrentRoute()?.name || '')) return;
    // the owner keeps everything, so their own edits never lock them out
    if (me?.role === 'owner' && before.access.split('|')[0] === 'owner') return;
    nav.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'PinLock' }] }));
    Alert.alert('Your access changed', 'The owner changed what ' + (me?.name || 'you') + ' can do. Enter your PIN again to carry on with the new access.');
  }, [access, db?.session.userId]);

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
