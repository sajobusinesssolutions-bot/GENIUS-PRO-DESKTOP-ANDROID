/**
 * Whether the signed-in account may open the developer console, and a fresh
 * access token for talking to it.
 *
 * Asked of the server, never decided here: the list of developers lives in the
 * server's own configuration, so a phone cannot talk itself into the console.
 */
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { refreshSession, serverConfigured } from './authApi';
import { isDeveloper } from './devApi';

export function useDeveloper() {
  const { account } = useAuth();
  const [developer, setDeveloper] = useState(false);

  /** Access tokens last fifteen minutes, so one is fetched per use, not stored. */
  const access = useCallback(async (): Promise<string | null> => {
    if (!account?.refresh || !serverConfigured()) return null;
    const r = await refreshSession(account.refresh);
    return r.ok ? r.value.access : null;
  }, [account?.refresh]);

  useEffect(() => {
    let live = true;
    (async () => {
      const a = await access();
      if (!a) { if (live) setDeveloper(false); return; }
      const r = await isDeveloper(a);
      if (live) setDeveloper(r.ok && r.value.developer);
    })();
    return () => { live = false; };
  }, [access]);

  return { developer, access };
}
