/**
 * WHO IS SIGNED IN on this device.
 *
 * Separate from AppDataContext on purpose: the account outlives any particular
 * shop's books, and a person may have an account before they have a shop.
 *
 * The distinction this holds is between two different "who":
 *
 *   · the **account** — the owner's email, which owns the licence and the
 *     cloud copy. Asked for once, on first run.
 *   · the **user** — a member of staff, who unlocks the app with a PIN the
 *     owner set. Asked for every time the app opens after that.
 */
import React, { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Account, loadAccount, saveAccount, clearAccount, newAccount, SignInMethod,
} from './account';

interface AuthCtx {
  /** False until the stored account has been read from disk. */
  ready: boolean;
  account: Account | null;
  /** True once an account exists on this device, however it was made. */
  signedIn: boolean;
  /** Records a successful sign-in or sign-up. */
  adopt: (o: {
    email: string; name: string; phone?: string;
    method: SignInMethod; verified: boolean; localOnly: boolean;
    id?: string; refresh?: string;
  }) => Promise<void>;
  patch: (p: Partial<Account>) => Promise<void>;
  /** Forgets the account on this device. The shop's books are left alone. */
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      setAccount(await loadAccount());
      setReady(true);
    })();
  }, []);

  const adopt = useCallback(async (o: Parameters<AuthCtx['adopt']>[0]) => {
    const a = newAccount(o);
    setAccount(a);
    await saveAccount(a);
  }, []);

  const patch = useCallback(async (p: Partial<Account>) => {
    setAccount((cur) => {
      if (!cur) return cur;
      const next = { ...cur, ...p };
      void saveAccount(next);
      return next;
    });
  }, []);

  const signOut = useCallback(async () => {
    setAccount(null);
    await clearAccount();
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({ ready, account, signedIn: !!account, adopt, patch, signOut }),
    [ready, account, adopt, patch, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used inside AuthProvider');
  return c;
}

/** For components that may render before the provider exists, such as the theme. */
export function useAuthSafe(): AuthCtx | null {
  return useContext(Ctx);
}
