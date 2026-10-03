/**
 * Keeps the crash reporter told who is signed in and which business is open,
 * so a report can be traced to a shop. Draws nothing.
 */
import { useEffect } from 'react';
import { useAuth } from '../data/AuthContext';
import { useAppDataSafe } from '../data/AppDataContext';
import { refreshSession } from '../data/authApi';
import { setCrashContext } from '../data/crashReporter';

export default function CrashContext() {
  const { account } = useAuth();
  const db = useAppDataSafe()?.db;
  const refresh = account?.refresh;
  useEffect(() => {
    setCrashContext({
      accountId: account?.id,
      businessId: db?.sync?.businessId || db?.firm?.id,
      access: refresh ? async () => { const r = await refreshSession(refresh); return r.ok ? r.value.access : null; } : undefined,
    });
  }, [account?.id, refresh, db?.sync?.businessId, db?.firm?.id]);
  return null;
}
