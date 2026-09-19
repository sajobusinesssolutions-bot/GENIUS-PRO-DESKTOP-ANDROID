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
