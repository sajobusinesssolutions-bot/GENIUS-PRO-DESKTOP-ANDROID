/**
 * BACK GOES HOME. The Back key, and the arrow in a screen's header, return to
 * the tab the person came from (Home, Activity, Items, Menu) instead of
 * stepping back through every screen opened on the way. Screens that close
 * themselves after a save still step back one, as before — this is only the
 * person asking to go back.
 */
import { useEffect } from 'react';
import { BackHandler } from 'react-native';
import { StackActions } from '@react-navigation/native';
import { navRef } from './RootNavigator';

/** Takes the person back to the tabs; false when there is nowhere to go. */
export function backToTab(): boolean {
  if (!navRef.isReady()) return false;
  const st: any = navRef.getRootState();
  if (!st || !Array.isArray(st.routes)) return false;
  const main = st.routes.findIndex((r: any) => r.name === 'Main');
  const depth = st.index - main;
  if (main < 0 || depth < 1) return false;
  navRef.dispatch(StackActions.pop(depth));
  return true;
}

/** Wires the phone's Back key to it, for as long as the app runs. */
export function useBackToTab() {
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => backToTab());
    return () => sub.remove();
  }, []);
}
