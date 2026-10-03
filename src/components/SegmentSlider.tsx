/**
 * A two- or three-way switch whose highlighted thumb slides between the
 * options — Product / Service. The thumb moves on the native thread.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Animated, LayoutChangeEvent } from 'react-native';
import { Pressable } from './Press';
import { useTheme, fonts } from '../theme';
import { Icon, IconName } from './icons';

export default function SegmentSlider<T extends string>({ value, options, onChange, style }: {
  value: T; options: { v: T; l: string; i?: IconName }[]; onChange: (v: T) => void; style?: object;
}) {
  const { colors } = useTheme();
  const [w, setW] = useState(0);
  const idx = Math.max(0, options.findIndex((o) => o.v === value));
  const x = useRef(new Animated.Value(idx)).current;
  useEffect(() => {
    Animated.spring(x, { toValue: idx, useNativeDriver: true, damping: 18, stiffness: 220, mass: 0.7 }).start();
  }, [idx, x]);
  const seg = w ? (w - 8) / options.length : 0;
  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
      style={[{ flexDirection: 'row', padding: 4, borderRadius: 14, backgroundColor: colors.sunk, borderWidth: 1, borderColor: colors.line, marginBottom: 16 }, style]}
      accessibilityRole="tablist"
    >
      {seg ? (
        <Animated.View style={{
          position: 'absolute', top: 4, bottom: 4, left: 4, width: seg, borderRadius: 11, backgroundColor: colors.surface,
          shadowColor: '#0B1D2A', shadowOpacity: 0.1, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
          transform: [{ translateX: x.interpolate({ inputRange: [0, Math.max(1, options.length - 1)], outputRange: [0, seg * Math.max(1, options.length - 1)] }) }],
        }} />
      ) : null}
      {options.map((o) => {
        const on = o.v === value;
        return (
          <Pressable
            key={o.v}
            onPress={() => onChange(o.v)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={{ flex: 1, height: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }}
          >
            {o.i ? <Icon name={o.i} size={16} color={on ? colors.accent : colors.faint} /> : null}
            <Text style={{ fontFamily: on ? fonts.uiBold : fonts.uiSemi, fontSize: 15, color: on ? colors.ink : colors.faint }}>{o.l}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
