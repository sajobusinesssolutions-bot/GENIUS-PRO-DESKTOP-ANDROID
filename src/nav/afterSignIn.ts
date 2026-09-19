/**
 * What happens the moment somebody is signed in.
 *
 * Every way into the app — password, Google, a password reset — ends the same
 * way, and each one was doing it differently or, in two cases, not at all: the
 * account was adopted, a toast said "Signed in", and the screen simply stayed
 * where it was. Putting it in one place means a new route into the app cannot
 * quietly forget a step.
 *
 * Two things have to happen, in this order:
 *
 *  1. The books on this phone are claimed for whoever just signed in. Two
 *     people sharing one phone is ordinary in a shop, and without this the
 *     second person would be handed the first one's stock and takings.
 *  2. The app goes where that person should be: through business setup if the
 *     shop has not been set up, otherwise to the PIN screen. The stack is reset
 *     so the back button cannot walk into the sign-in screens behind it.
 */
import { useCallback } from 'react';
import { useAppData } from '../data/AppDataContext';
import { useGoReset } from './navigate';

export function useAfterSignIn() {
  const { db, claimBooksFor } = useAppData();
  const goReset = useGoReset();

  return useCallback((email: string): { replacedBooks: boolean } => {
    const replacedBooks = claimBooksFor(email);
    // `replacedBooks` means the books were wiped for a different owner, so the
    // shop is unset by definition and setup is where they belong.
    const needsSetup = replacedBooks || !db?.onboarded;
    goReset(needsSetup ? 'Onboarding' : 'PinLock');
    return { replacedBooks };
  }, [claimBooksFor, db?.onboarded, goReset]);
}
