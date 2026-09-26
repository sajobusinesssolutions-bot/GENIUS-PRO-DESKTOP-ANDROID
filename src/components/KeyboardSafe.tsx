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
 *  · A scroll view that shrinks keeps its focused field in view on Android, so
 *    the field being typed in is lifted clear without any form knowing.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, View, ViewStyle, KeyboardEvent } from 'react-native';

export default function KeyboardSafe({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const outer = useRef<View>(null);
  const [lift, setLift] = useState(0);

  useEffect(() => {
    // iOS announces the keyboard before it moves, Android only once it has.
    const showEv = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEv = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (e: KeyboardEvent) => {
      const top = e.endCoordinates.screenY;
      outer.current?.measureInWindow((_x, y, _w, h) => {
        // how far the keyboard reaches up into this screen, if at all
        setLift(Math.max(0, Math.round(y + h - top)));
      });
    };
    const onHide = () => setLift(0);

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
