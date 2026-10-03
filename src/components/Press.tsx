/**
 * React Native's Pressable, with its touch area kept.
 *
 * A Pressable with no background is "layout only" to Android, which then
 * removes its native view to save work — and with it the area between the
 * label and the edge, so only the words could be tapped. `collapsable={false}`
 * keeps the view, so the whole box answers the finger.
 */
import React from 'react';
import { Pressable as RNPressable, PressableProps, View } from 'react-native';

export const Pressable = React.forwardRef<View, PressableProps>((props, ref) => (
  <RNPressable ref={ref} collapsable={false} {...props} />
));
Pressable.displayName = 'Pressable';

export default Pressable;
