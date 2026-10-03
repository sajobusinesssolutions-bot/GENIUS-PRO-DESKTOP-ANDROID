/**
 * SKELETONS — the shape of a screen before its content.
 *
 * Opening a screen used to build all of it while the slide-in animation was
 * running, and a heavy screen (a report, a long list) cost the animation its
 * frames. Now a screen that is being pushed shows a light outline of itself
 * during the slide, and its real content is built the moment the slide ends.
 * The animation has nothing to wait for, and the screen never looks empty.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Animated, Easing, ViewStyle, StyleProp } from 'react-native';
import { useTheme } from '../theme';

/** One shimmering block. All blocks on screen share a single pulse. */
const pulse = new Animated.Value(0.55);
let pulsing = 0;
let loop: Animated.CompositeAnimation | null = null;
function startPulse() {
  if (pulsing++ > 0) return;
  loop = Animated.loop(Animated.sequence([
    Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
    Animated.timing(pulse, { toValue: 0.55, duration: 650, useNativeDriver: true }),
  ]));
  loop.start();
}
function stopPulse() {
  if (--pulsing > 0) return;
  loop?.stop();
  loop = null;
}

export function Bone({ w = '100%', h = 14, r = 8, style }: { w?: number | string; h?: number; r?: number; style?: StyleProp<ViewStyle> }) {
  const { colors, dark } = useTheme();
  // a soft tint of the page, never a dark block — in either theme
  const tint = dark ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.06)';
  return <Animated.View style={[{ width: w as any, height: h, borderRadius: r, backgroundColor: tint, opacity: pulse }, style]} />;
}

/** A card of rows — the shape most screens in the app take. */
export function ScreenSkeleton({ rows = 6 }: { rows?: number }) {
  const { colors } = useTheme();
  useEffect(() => { startPulse(); return stopPulse; }, []);
  const card = { backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.line };
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: 16 }} accessibilityLabel="Loading">
      <View style={[card, { padding: 16, gap: 12 }]}>
        <Bone w="45%" h={12} />
        <Bone w="70%" h={26} r={10} />
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
          <Bone w="31%" h={46} r={12} />
          <Bone w="31%" h={46} r={12} />
          <Bone w="31%" h={46} r={12} />
        </View>
      </View>
      <Bone w="30%" h={11} style={{ marginTop: 24, marginBottom: 10, marginLeft: 4 }} />
      <View style={card}>
        {Array.from({ length: rows }).map((_, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 13, padding: 15, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
            <Bone w={36} h={36} r={11} />
            <View style={{ flex: 1, gap: 7 }}>
              <Bone w={i % 2 ? '55%' : '72%'} h={13} />
              <Bone w={i % 3 ? '35%' : '48%'} h={10} />
            </View>
            <Bone w={52} h={13} />
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * How a pushed screen arrives on Android. The system's screen animations are
 * off (they faded, and a fading screen draws every card's shadow as a dark
 * block); instead the screen's own content slides the last few points into
 * place — movement only, never transparency, so there is nothing to go dark.
 * The skeleton rides that slide, and the real content replaces it the moment
 * the slide ends, so the slide never waits on a heavy screen being built.
 */
export function AfterTransition({ children }: { children: React.ReactNode; subscribe?: unknown }) {
  const [ready, setReady] = useState(false);
  const x = useRef(new Animated.Value(24)).current;
  useEffect(() => {
    let live = true;
    Animated.timing(x, { toValue: 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true })
      .start(() => {
        // build the screen once the slide is over and the frame is free
        requestIdleCallback(() => { if (live) setReady(true); });
      });
    const t = setTimeout(() => { if (live) setReady(true); }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [x]);
  return (
    <Animated.View style={{ flex: 1, transform: [{ translateX: x }] }}>
      {ready ? children : <ScreenSkeleton />}
    </Animated.View>
  );
}
