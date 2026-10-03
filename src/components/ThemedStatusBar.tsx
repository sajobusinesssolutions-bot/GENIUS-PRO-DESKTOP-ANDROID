/**
 * The phone's status bar (clock, battery, signal) in the app's own theme.
 *
 * "auto" follows the phone's theme, so a phone in dark mode running the app
 * in light mode drew white icons on a white bar — invisible. The icons now
 * follow the theme the app is actually showing.
 */
import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from '../theme';

export default function ThemedStatusBar() {
  const { dark } = useTheme();
  return <StatusBar style={dark ? 'light' : 'dark'} />;
}
