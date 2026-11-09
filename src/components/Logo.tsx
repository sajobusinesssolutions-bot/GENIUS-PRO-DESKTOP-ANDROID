/**
 * The Genius POS mark: the white "g" with the orange price tag on navy — the
 * same as the app icon and the website (assets/genius-mark.png, 256 px). It
 * carries its own colours, so it reads on light, dark and the welcome
 * gradient alike; `color` is kept for the callers that pass one.
 */
import React from 'react';
import { Image } from 'react-native';

const MARK = require('../../assets/genius-mark.png');

export function Logo({ size = 64 }: { size?: number; color?: string }) {
  return (
    <Image
      source={MARK}
      style={{ width: size, height: size }}
      resizeMode="contain"
      accessibilityLabel="Genius POS"
    />
  );
}

export default Logo;
