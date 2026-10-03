/**
 * When a screen fails to draw, show a way back instead of closing the app,
 * and report what failed (see crashReporter).
 */
import React from 'react';
import { View, Text } from 'react-native';
import { Pressable } from './Press';
import { reportError } from '../data/crashReporter';
import { useTheme, fonts } from '../theme';
import { Icon } from './icons';

function Fallback({ onRetry }: { onRetry: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
      <View style={{ width: 64, height: 64, borderRadius: 20, backgroundColor: colors.dangerSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="alert" size={28} color={colors.danger} />
      </View>
      <Text style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink, marginTop: 16, textAlign: 'center' }}>Something went wrong</Text>
      <Text style={{ fontFamily: fonts.ui, fontSize: 15, lineHeight: 20, color: colors.faint, marginTop: 8, textAlign: 'center' }}>
        This screen could not be shown. The problem has been reported so it can be fixed. Your books are safe.
      </Text>
      <Pressable
        onPress={onRetry}
        style={({ pressed }) => ({ marginTop: 22, paddingVertical: 13, paddingHorizontal: 26, borderRadius: 14, backgroundColor: pressed ? colors.accentSoft : colors.accent })}
      >
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.accentInk }}>Try again</Text>
      </Pressable>
    </View>
  );
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    void reportError(error, { kind: 'render', fatal: false, extra: { componentStack: String(info?.componentStack || '').slice(0, 4000) } });
  }

  render() {
    if (this.state.failed) return <Fallback onRetry={() => this.setState({ failed: false })} />;
    return this.props.children;
  }
}

export default ErrorBoundary;
