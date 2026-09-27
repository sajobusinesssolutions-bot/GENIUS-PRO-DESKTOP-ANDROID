/**
 * The app's one pressable: every button, row and tab goes through here, so
 * a press feels the same everywhere.
 *
 *  - soft:   a small press-down, for rows and list entries.
 *  - spring: a deeper press that springs back past its size and settles —
 *            for buttons, icon buttons and tabs.
 *  - burst:  spring, plus a ring that blooms out from the exact spot the
 *            finger landed and fades — for the primary action on a screen.
 *
 * A light haptic tick goes with spring and burst. Everything is skipped when
 * the phone's "Reduce motion" setting is on. Uses the core Animated API on
 * the native driver, so it runs off the JS thread and needs no worklets.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, Animated, Easing, GestureResponderEvent, LayoutChangeEvent, Pressable,
  PressableProps, StyleProp, StyleSheet, View, ViewStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';

export type Feel = 'soft' | 'spring' | 'burst' | 'none';

let reduceMotion = false;
try {
  AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { reduceMotion = !!v; }).catch(() => {});
  AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => { reduceMotion = !!v; });
} catch { /* not available — keep the motion */ }

function tick(kind: 'light' | 'select') {
  try {
    const p = kind === 'select' ? Haptics.selectionAsync() : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    (p as any)?.catch?.(() => {});
  } catch { /* no haptics on this device */ }
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type StyleArg = StyleProp<ViewStyle> | ((s: { pressed: boolean }) => StyleProp<ViewStyle>);

export type TapProps = Omit<PressableProps, 'style' | 'children'> & {
  style?: StyleArg;
  children?: React.ReactNode | ((s: { pressed: boolean }) => React.ReactNode);
  feel?: Feel;
  /** How far it presses in. Defaults by feel. */
  scaleTo?: number;
  /** The burst ring's colour. */
  burstColor?: string;
  haptic?: boolean;
};

export function Tap({
  style, children, feel = 'spring', scaleTo, burstColor = '#FFFFFF', haptic, onPressIn, onPressOut, onPress, disabled, ...rest
}: TapProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const [pressed, setPressed] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const to = scaleTo ?? (feel === 'soft' ? 0.985 : feel === 'burst' ? 0.95 : 0.94);
  const moves = feel !== 'none' && !disabled;

  const handleIn = (e: GestureResponderEvent) => {
    setPressed(true);
    if (moves && !reduceMotion) {
      Animated.spring(scale, { toValue: to, speed: 50, bounciness: 0, useNativeDriver: true }).start();
      if (feel === 'burst') {
        const { locationX, locationY } = e.nativeEvent || ({} as any);
        setAt({ x: locationX ?? box.w / 2, y: locationY ?? box.h / 2 });
        ring.setValue(0);
        Animated.timing(ring, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      }
    }
    if (moves && (haptic ?? feel !== 'soft')) tick(feel === 'burst' ? 'light' : 'select');
    onPressIn?.(e);
  };

  const handleOut = (e: GestureResponderEvent) => {
    if (mounted.current) setPressed(false);
    if (moves && !reduceMotion) {
      Animated.spring(scale, {
        toValue: 1, speed: feel === 'soft' ? 30 : 16, bounciness: feel === 'soft' ? 4 : 12, useNativeDriver: true,
      }).start();
    }
    onPressOut?.(e);
  };

  const resolved = StyleSheet.flatten(typeof style === 'function' ? style({ pressed }) : style) || {};
  const radius = (resolved.borderRadius as number) || 0;
  const d = Math.max(box.w, box.h) * 2.4;

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPress={onPress}
      onPressIn={handleIn}
      onPressOut={handleOut}
      onLayout={(e: LayoutChangeEvent) => {
        setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
        rest.onLayout?.(e);
      }}
      style={[resolved, moves ? { transform: [{ scale }] } : null]}
    >
      {feel === 'burst' && at && box.w ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}>
          <Animated.View
            style={{
              position: 'absolute', width: d, height: d, borderRadius: d / 2,
              left: at.x - d / 2, top: at.y - d / 2, backgroundColor: burstColor,
              opacity: ring.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.28, 0] }),
              transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.05, 1] }) }],
            }}
          />
        </View>
      ) : null}
      {typeof children === 'function' ? children({ pressed }) : children}
    </AnimatedPressable>
  );
}

export default Tap;

/** False while the phone asks for reduced motion. */
export function motionOK(): boolean {
  return !reduceMotion;
}

/**
 * A surface that eases in when a screen opens: a short fade and a 6px rise.
 * Used by Panel and Card, so every screen built from them arrives the same way.
 */
export function Rise({ style, children }: { style?: StyleProp<ViewStyle>; children?: React.ReactNode }) {
  const t = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    Animated.timing(t, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [t]);
  return (
    <Animated.View
      style={[style, {
        opacity: t,
        transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
      }]}
    >
      {children}
    </Animated.View>
  );
}
