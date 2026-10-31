/**
 * Asks before throwing away a half-filled form. Back, the header arrow and
 * Back-to-tab all leave through the navigator, so one listener covers them.
 * A screen that is leaving because it saved calls `allow()` first.
 */
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';

export function useConfirmLeave(navigation: any, dirty: boolean, what = 'this') {
  const ok = useRef(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => navigation.addListener('beforeRemove', (e: any) => {
    if (ok.current || !dirtyRef.current) return;
    e.preventDefault();
    Alert.alert('Discard ' + what + '?', 'What you entered has not been saved.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => { ok.current = true; navigation.dispatch(e.data.action); } },
    ]);
  }), [navigation, what]);
  /** Call just before leaving after a save. */
  return () => { ok.current = true; };
}
