/**
 * The Genius mark, drawn from its vector path so it is sharp at any size and
 * takes the theme's ink: black on light, white on dark.
 */
import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../theme';
import { LOGO_PATH, LOGO_VIEWBOX } from './logoPath';

export function Logo({ size = 64, color }: { size?: number; color?: string }) {
  const { colors } = useTheme();
  return (
    <Svg width={size} height={size} viewBox={LOGO_VIEWBOX} accessibilityLabel="Genius">
      <Path d={LOGO_PATH} fill={color || colors.ink} fillRule="evenodd" />
    </Svg>
  );
}

export default Logo;
