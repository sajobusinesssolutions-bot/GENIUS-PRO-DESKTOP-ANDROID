/**
 * The book as a screen should see it: live while the screen is in front,
 * held as it last was while the screen is behind another.
 *
 * The tabs (Home, Activity, Items, Money) stay mounted. Every sale gives the
 * book a new identity, so each of them worked its figures out again over the
 * whole book after every change — on a pharmacy's book that made adding a
 * sale, going back and opening anything slow, for screens nobody was looking
 * at. Now a screen behind another keeps its last figures and works them out
 * once when it comes back to the front.
 */
import { useContext, useEffect, useRef, useState } from 'react';
import { NavigationContext } from '@react-navigation/native';

export function useScreenFocused(): boolean {
  const nav = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => (nav ? nav.isFocused() : true));
  useEffect(() => {
    if (!nav) return undefined;
    setFocused(nav.isFocused());
    const a = nav.addListener('focus', () => setFocused(true));
    const b = nav.addListener('blur', () => setFocused(false));
    return () => { a(); b(); };
  }, [nav]);
  return focused;
}

/** `value` while the screen is in front; what it was when the screen was last in front, while it is not. */
export function useFocusedBook<T>(value: T): T {
  const focused = useScreenFocused();
  const last = useRef(value);
  if (focused || last.current == null) last.current = value;
  return last.current;
}
