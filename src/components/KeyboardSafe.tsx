/**
 * KEEPING FIELDS ABOVE THE KEYBOARD — for every screen at once.
 *
 * Android now draws apps edge to edge, and in that mode the window is no longer
 * resized when the keyboard opens. Every form therefore kept its full height
 * and simply scrolled its fields, and its Save button, underneath the keyboard.
 * It affected most of the app because it is not a property of any one form.
 *
 * This fixes it where every screen is mounted rather than form by form:
 *
 *  · It measures where the screen actually sits in the window and how far the
 *    keyboard reaches up into it. Measuring, rather than guessing a header
 *    height, means the same code is right under a header, without one, inside
 *    a tab, and inside a bottom sheet — and is simply a no-op on a phone where
 *    the window does still resize, because the overlap there comes out as zero.
 *
 *  · It shrinks the screen's own box by that much (a margin, not padding).
 *    The sticky Save bars are positioned absolutely at the bottom of the
 *    screen, and absolute children follow the box, not its padding — so they
 *    rise with it and stay reachable.
 *
 *  · Android's scroll view does NOT bring its focused field back into view when
 *    it shrinks (only when focus moves), so a Description box low on a form
 *    stayed under the keyboard. Once the screen has shrunk, revealFocused()
 *    finds the field being typed in, the scroll view holding it, and scrolls
 *    just far enough to show it. Field calls it too when focus moves between
 *    boxes while the keyboard is already open.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, View, ViewStyle, KeyboardEvent, TextInput, UIManager, findNodeHandle } from 'react-native';

/** Where the top of the keyboard is in the window, while it is open. */
let keyboardTop: number | null = null;
/** Room left between the field and the keyboard. */
const MARGIN = 28;

/**
 * Scrolls the field being typed in clear of the keyboard, if it is under it.
 * Quietly does nothing when there is no keyboard, no field, or no scroll view.
 */
export function revealFocused(delay = 80) {
  if (Platform.OS === 'web') return;
  setTimeout(() => {
    const top = keyboardTop;
    const input: any = (TextInput as any)?.State?.currentlyFocusedInput?.();
    if (top == null || !input?.measureInWindow) return;
    input.measureInWindow((_x: number, y: number, _w: number, h: number) => {
      const over = y + h + MARGIN - top;
      if (over <= 0) return;
      try {
        // the nearest scroll view above the field
        let el = input.parentElement;
        while (el && !/ScrollView$/.test(String(el.tagName || '')) ) el = el.parentElement;
        if (!el || /Horizontal/.test(String(el.tagName))) return;
        // the public way to send a scroll view a command: its view tag and the command name
        const tag = findNodeHandle(el);
        if (tag != null) UIManager.dispatchViewManagerCommand(tag, 'scrollTo', [0, Math.max(0, (el.scrollTop || 0) + over), true]);
      } catch {
        // older renderers have no element tree to walk; the field stays where it is
      }
    });
  }, delay);
}

export default function KeyboardSafe({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const outer = useRef<View>(null);
  const [lift, setLift] = useState(0);

  useEffect(() => {
    // iOS announces the keyboard before it moves, Android only once it has.
    const showEv = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEv = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (e: KeyboardEvent) => {
      const top = e.endCoordinates.screenY;
      keyboardTop = top;
      outer.current?.measureInWindow((_x, y, _w, h) => {
        // how far the keyboard reaches up into this screen, if at all
        setLift(Math.max(0, Math.round(y + h - top)));
        // after the screen has shrunk, bring the field being typed in into view
        revealFocused(120);
      });
    };
    const onHide = () => { keyboardTop = null; setLift(0); };

    const a = Keyboard.addListener(showEv, onShow);
    const b = Keyboard.addListener(hideEv, onHide);
    // on Android the keyboard can change height while open (suggestions bar)
    const c = Platform.OS === 'android' ? Keyboard.addListener('keyboardDidChangeFrame', onShow) : null;
    return () => { a.remove(); b.remove(); c?.remove(); };
  }, []);

  return (
    <View ref={outer} testID="keyboard-safe" collapsable={false} style={[{ flex: 1, marginBottom: lift }, style]}>
      <View testID="keyboard-safe-body" style={{ flex: 1 }}>{children}</View>
    </View>
  );
}
