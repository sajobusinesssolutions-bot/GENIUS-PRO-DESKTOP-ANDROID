/**
 * Refuses a screen the signed-in person's role does not allow.
 *
 * Mounted around every screen at once (RootNavigator's screenLayout), so a
 * screen cannot be reached around its permission by any route — a quick
 * action, a notification, a link on another screen. The rule for each screen
 * is in routePerms.ts. The body of a refused screen is never mounted, so
 * nothing in it can run first.
 */
import React from 'react';
import { useAppData } from '../data/AppDataContext';
import { canFor } from '../data/perms';
import { Denied } from '../components/Gate';
import { permFor, refusalFor } from './routePerms';

export default function RouteGuard({ route, params, children }: {
  route: string; params?: unknown; children: React.ReactNode;
}) {
  const { db } = useAppData();
  const need = permFor(route, params);
  if (!need || !db) return <>{children}</>;
  if (canFor(db.session.role, need)) return <>{children}</>;
  return <Denied title="Not allowed for your role" hint={refusalFor(need)} />;
}
