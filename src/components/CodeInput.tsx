/**
 * THE SIX-DIGIT EMAIL CODE.
 *
 * One component for every place a code is typed: creating an account,
 * resetting a password, resetting the owner PIN.
 *
 *  - Six boxes over one hidden field, so paste and the keyboard's one-time-code
 *    suggestion fill all six at once.
 *  - The moment the sixth digit is in, `onComplete` checks it with the server
 *    and the boxes say how that went: blue while checking, green with a tick
 *    when right, red with a shake when wrong.
 *  - Under it, where the code went, a reminder to look in spam, and a resend
 *    button that waits out a cooldown so a second code cannot be asked for
 *    while the first is still on its way.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Animated, ActivityIndicator } from 'react-native';
import { Pressable } from './Press';
import { useTheme, fonts } from '../theme';
import { Icon } from './icons';

export type CodeState = 'idle' | 'checking' | 'ok' | 'bad';

export const CODE_COOLDOWN = 60;

export function CodeInput({ value, onChange, onComplete, state, message, autoFocus = true }: {
  value: string;
  onChange: (v: string) => void;
  /** Called once when the sixth digit goes in. */
  onComplete?: (code: string) => void;
  state: CodeState;
  /** Shown under the boxes: why it was refused, or that it is right. */
  message?: string;
  autoFocus?: boolean;
}) {
  const { colors } = useTheme();
  const input = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const shake = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (state === 'bad') {
      shake.setValue(0);
      Animated.sequence([10, -10, 7, -7, 3, 0].map((x) =>
        Animated.timing(shake, { toValue: x, duration: 45, useNativeDriver: true }))).start();
    }
    if (state === 'ok') {
      pop.setValue(0.92);
      Animated.spring(pop, { toValue: 1, useNativeDriver: true, damping: 9, stiffness: 260 }).start();
    }
  }, [state, shake, pop]);

  function change(t: string) {
    const digits = t.replace(/[^0-9]/g, '').slice(0, 6);
    onChange(digits);
    if (digits.length === 6 && digits !== value) onComplete?.(digits);
  }

  const tone = state === 'ok' ? colors.good : state === 'bad' ? colors.danger : colors.accent;
  const fill = state === 'ok' ? colors.goodSoft : state === 'bad' ? colors.dangerSoft : colors.surface;
  const locked = state === 'checking' || state === 'ok';

  return (
    <View>
      <Pressable onPress={() => input.current?.focus()} accessibilityLabel="Six-digit code" disabled={locked}>
        <Animated.View style={{ flexDirection: 'row', gap: 8, transform: [{ translateX: shake }, { scale: pop }] }}>
          {Array.from({ length: 6 }).map((_, i) => {
            const ch = value[i] || '';
            const current = focused && !locked && i === Math.min(value.length, 5);
            const border = state !== 'idle' && state !== 'checking' ? tone : current ? colors.accent : ch ? colors.lineHard : colors.line;
            return (
              <View key={i} style={{
                flex: 1, aspectRatio: 0.86, maxHeight: 64, borderRadius: 14, borderWidth: current ? 2 : 1.5,
                borderColor: border, backgroundColor: ch ? fill : colors.surface,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Text style={{ fontFamily: fonts.uiExtra, fontSize: 26, color: state === 'bad' ? colors.danger : colors.ink }}>{ch}</Text>
                {current && !ch ? <View style={{ position: 'absolute', bottom: 12, width: 14, height: 2, borderRadius: 1, backgroundColor: colors.accent }} /> : null}
              </View>
            );
          })}
        </Animated.View>
      </Pressable>
      <TextInput
        ref={input}
        testID="code-input"
        value={value}
        onChangeText={change}
        editable={!locked}
        autoFocus={autoFocus}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={6}
        caretHidden
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
      />
      <View style={{ minHeight: 26, flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10 }}>
        {state === 'checking' ? (
          <>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.accent }}>Checking the code…</Text>
          </>
        ) : state === 'ok' ? (
          <>
            <Icon name="check" size={16} color={colors.good} />
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: colors.good }}>{message || 'Code confirmed'}</Text>
          </>
        ) : state === 'bad' ? (
          <>
            <Icon name="alert" size={16} color={colors.danger} />
            <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.danger }}>{message || 'That code is not right. Check it and try again.'}</Text>
          </>
        ) : null}
      </View>
    </View>
  );
}

/** Seconds left before another code may be sent; `restart()` after each send. */
export function useCooldown(seconds = CODE_COOLDOWN) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return { left, restart: () => setLeft(seconds) };
}

/** Where the code went, look in spam, and resend once the cooldown is over. */
export function CodeSentNote({ to, left, busy, onResend }: {
  to: string; left: number; busy?: boolean; onResend: () => void;
}) {
  const { colors } = useTheme();
  const wait = left > 0;
  return (
    <View style={{ marginTop: 14, gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 10, padding: 13, borderRadius: 14, backgroundColor: colors.accentSoft }}>
        <Icon name="mail" size={18} color={colors.accent} />
        <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 19, color: colors.ink }}>
          Sent to <Text style={{ fontFamily: fonts.uiBold }}>{to}</Text>. It can take a minute.{' '}
          Not in your inbox? <Text style={{ fontFamily: fonts.uiBold }}>Open your Spam or Junk folder</Text>
          {' '}and mark it "Not spam" so the next one arrives normally.
        </Text>
      </View>
      <Pressable
        onPress={onResend}
        disabled={wait || busy}
        hitSlop={8}
        accessibilityRole="button"
        style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 }}
      >
        <Icon name={wait ? "clock" : "arrow"} size={15} color={wait || busy ? colors.faint : colors.accent} />
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: wait || busy ? colors.faint : colors.accent }}>
          {busy ? 'Sending…' : wait ? 'Send a new code in 0:' + String(left).padStart(2, '0') : 'Send a new code'}
        </Text>
      </Pressable>
    </View>
  );
}
