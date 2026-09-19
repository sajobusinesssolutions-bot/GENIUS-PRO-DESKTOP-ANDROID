import { useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';

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
