/**
 * Icons load their font over a promise, which resolves after a test has
 * finished and triggers a React act() warning that buries real output. The
 * glyphs are not what any of these tests are checking, so they are stubbed.
 */
jest.mock('@expo/vector-icons/Feather', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: (p) => React.createElement(Text, null, '') };
});
jest.mock('@expo/vector-icons/MaterialCommunityIcons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { __esModule: true, default: (p) => React.createElement(Text, null, '') };
});

/** Safe-area insets need a provider that only exists on a device. */
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default);

/** AsyncStorage has no native module under Jest; the package ships a mock. */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

/** Reanimated needs native worklets on a device; auth tests only need its view and hook shapes. */
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const RN = require('react-native');
  const interpolate = (value, input, output) => {
    if (value <= input[0]) return output[0];
    if (value >= input[input.length - 1]) return output[output.length - 1];
    for (let i = 1; i < input.length; i += 1) {
      if (value <= input[i]) {
        const t = (value - input[i - 1]) / (input[i] - input[i - 1]);
        return output[i - 1] + (output[i] - output[i - 1]) * t;
      }
    }
    return output[output.length - 1];
  };
  const Animated = {
    View: RN.View,
    Text: RN.Text,
    createAnimatedComponent: (Component) => Component,
  };
  return {
    __esModule: true,
    default: Animated,
    Easing: { linear: (value) => value },
    Extrapolation: { CLAMP: 'clamp' },
    interpolate,
    interpolateColor: (_value, _input, output) => output[0],
    useAnimatedProps: (factory) => factory(),
    useAnimatedStyle: (factory) => factory(),
    useSharedValue: (value) => ({ value }),
    withRepeat: (value) => value,
    withTiming: (value) => value,
  };
});

// TEST_NOW=2026-11-14T22:30:00Z runs the tests as if started at that moment (the
// clock keeps running from there): with TZ=Africa/Kampala that is 01:30, when
// the local day and the UTC day differ — the hour a day mix-up shows.
if (process.env.TEST_NOW) {
  const RealDate = Date;
  const shift = new RealDate(process.env.TEST_NOW).getTime() - RealDate.now();
  class ShiftedDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + shift); }
    static now() { return RealDate.now() + shift; }
  }
  global.Date = ShiftedDate;
}
