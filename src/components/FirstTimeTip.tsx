/**
 * A tip shown the first time a screen is opened on this phone, until it is
 * dismissed — the first sale, the first price list, the first kitchen printer.
 * Remembered per phone; never in the way twice.
 */
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Pressable } from './Press';
import { useTheme, fonts } from '../theme';
import { Icon } from './icons';

const KEY = 'genius.tips.seen';
let seen: Set<string> | null = null;
const listeners = new Set<() => void>();

async function load(): Promise<Set<string>> {
  if (seen) return seen;
  try { seen = new Set(JSON.parse((await AsyncStorage.getItem(KEY)) || '[]')); } catch { seen = new Set(); }
  return seen;
}

function markSeen(id: string) {
  if (!seen) seen = new Set();
  seen.add(id);
  AsyncStorage.setItem(KEY, JSON.stringify([...seen])).catch(() => {});
  listeners.forEach((f) => f());
}

/** Shows every tip again, from Settings → Help. */
export async function resetTips() {
  seen = new Set();
  try { await AsyncStorage.removeItem(KEY); } catch { /* nothing to clear */ }
  listeners.forEach((f) => f());
}

export default function FirstTimeTip({ id, title, text, when = true, style }: {
  id: string; title: string; text: string;
  /** Only while this holds — e.g. while the list is still empty. */
  when?: boolean;
  style?: object;
}) {
  const { colors } = useTheme();
  const [show, setShow] = useState(false);

  useEffect(() => {
    let live = true;
    const check = () => { void load().then((s) => { if (live) setShow(!s.has(id)); }); };
    check();
    listeners.add(check);
    return () => { live = false; listeners.delete(check); };
  }, [id]);

  if (!show || !when) return null;
  return (
    <View style={[{ flexDirection: 'row', gap: 12, padding: 14, borderRadius: 4, backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accent }, style]}>
      <Icon name="bulb" size={20} color={colors.accent} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: colors.ink }}>{title}</Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 13, lineHeight: 19, color: colors.soft, marginTop: 3 }}>{text}</Text>
      </View>
      <Pressable onPress={() => markSeen(id)} hitSlop={10} accessibilityLabel="Got it">
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: colors.accent }}>Got it</Text>
      </Pressable>
    </View>
  );
}
