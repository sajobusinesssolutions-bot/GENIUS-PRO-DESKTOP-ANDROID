/**
 * THE APP'S SCROLL VIEW — keeps the box being typed in above the keyboard.
 *
 * Android draws edge to edge, so the window no longer shrinks for the
 * keyboard and a field low on a form (Description, Notes) was left under it.
 * Walking the element tree to find the scroll view did not work on the new
 * renderer, so each scroll view now offers itself to the fields inside it
 * (ScrollHost), and a field that gains focus asks the one around it to bring
 * it up near the top. While the keyboard is open the content gets room below
 * it, so even the last box on a short sheet can be lifted clear.
 */
import React, { createContext, forwardRef, useContext, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Dimensions, Keyboard, Platform, TextInput, ScrollView as RNScrollView, ScrollViewProps, View, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';

type Measurable = { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void };
type Host = { reveal: (input: Measurable | null) => void; release: () => void };

const ScrollHost = createContext<Host | null>(null);

/** The scroll view around a field, if there is one. */
export function useScrollHost() { return useContext(ScrollHost); }

/** Where the top of the keyboard is in the window while it is open, and its height. */
let kbTop: number | null = null;
let kbHeight = 0;

const KeyScroll = forwardRef<RNScrollView, ScrollViewProps>(function KeyScroll(props, ref) {
  const outer = useContext(ScrollHost);
  const inner = useRef<RNScrollView>(null);
  useImperativeHandle(ref, () => inner.current as RNScrollView);
  const offset = useRef(0);
  const last = useRef<Measurable | null>(null);
  const [room, setRoom] = useState(0);

  const bring = () => {
    const input = last.current;
    const sv: any = inner.current;
    if (!input || !sv?.measureInWindow) return;
    sv.measureInWindow((_sx: number, sy: number, _sw: number, sh: number) => {
      input.measureInWindow((_x, y, _w, h) => {
        /* inside a sheet Android often sends no keyboard events: then the keyboard is
           taken to cover the lower half, which is where it sits on every phone */
        const kb = kbTop ?? Dimensions.get('window').height * 0.5;
        const bottom = Math.min(sy + sh, kb) - 12;
        // already in full view, and not hidden under anything: leave it be
        if (y >= sy + 8 && y + h <= bottom) return;
        // up near the top, with its label showing above it
        const to = Math.max(0, offset.current + (y - (sy + 36)));
        sv.scrollTo({ y: to, animated: true });
      });
    });
  };

  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const showEv = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEv = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const a = Keyboard.addListener(showEv, (e) => {
      kbTop = e.endCoordinates.screenY;
      kbHeight = e.endCoordinates.height;
      // room below the content only where a field is being typed in
      if (last.current) { setRoom(kbHeight); setTimeout(bring, 60); }
    });
    const b = Keyboard.addListener(hideEv, () => { kbTop = null; kbHeight = 0; setRoom(0); last.current = null; });
    return () => { a.remove(); b.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const host = useRef<Host>({
    /* a field let go: unless another one took over, the room below goes */
    release: () => {
      setTimeout(() => {
        const now = (TextInput as any).State?.currentlyFocusedInput?.();
        if (!now) { last.current = null; setRoom(0); }
      }, 150);
    },
    reveal: (input) => {
      last.current = input;
      setRoom(kbHeight > 0 ? kbHeight : Math.round(Dimensions.get('window').height * 0.45));
      // the keyboard may still be on its way up; try now and once it has settled
      setTimeout(bring, 80);
      setTimeout(bring, 320);
    },
  }).current;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.y;
    props.onScroll?.(e);
  };

  const horizontal = !!props.horizontal;
  return (
    <ScrollHost.Provider value={horizontal ? outer : host}>
      <RNScrollView
        keyboardShouldPersistTaps="handled"
        {...props}
        ref={inner}
        onScroll={onScroll}
        scrollEventThrottle={props.scrollEventThrottle ?? 16}
      >
        {props.children}
        {!horizontal && room > 0 ? <View style={{ height: room }} /> : null}
      </RNScrollView>
    </ScrollHost.Provider>
  );
});

export default KeyScroll;
