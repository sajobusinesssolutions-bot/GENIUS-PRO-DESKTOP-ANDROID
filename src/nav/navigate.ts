import { useCallback } from 'react';
import { useNavigation, CommonActions } from '@react-navigation/native';

/** The four tab roots — reference BAR at line 5408. */
export const TAB_ROUTES = ['DashboardTab', 'SalesTab', 'ItemsTab', 'MenuTab'] as const;

/**
 * One navigate() for the whole app: tab roots switch the bottom bar,
 * everything else pushes onto the root stack.
 */
export function useGo() {
  const nav = useNavigation<any>();
  return useCallback((route: string, params?: Record<string, unknown>) => {
    if ((TAB_ROUTES as readonly string[]).includes(route)) {
      nav.navigate('Main', { screen: route });
      return;
    }
    nav.navigate(route, params);
  }, [nav]);
}

/**
 * Goes somewhere and forgets everything behind it.
 *
 * Used when signing out: leaving the shop's screens on the back stack would let
 * the hardware back button walk straight into the books of an account that has
 * just been signed out of.
 */
export function useGoReset() {
  const nav = useNavigation<any>();
  return useCallback((route: string, params?: Record<string, unknown>) => {
    nav.dispatch(CommonActions.reset({ index: 0, routes: [{ name: route, params }] }));
  }, [nav]);
}
