/**
 * Every pop-up in the app, in the app's own look.
 *
 * The app asks things with React Native's Alert.alert in some two hundred
 * places, which Android draws as its grey system box: small type, capital
 * text buttons, nothing to say whether it is a warning or a question. Rather
 * than change every call, this host takes Alert.alert over once it is mounted
 * and draws the same title, message and buttons as a card: an icon in the
 * tone of what is asked (a delete is red, a refusal amber, the rest blue),
 * the message in readable type, and real buttons — the main one filled, a
 * Cancel outlined, a destructive one red. Three or more buttons stack.
 */
import React from 'react';
import { Alert, AlertButton, AlertOptions, Animated, Easing, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useTheme, fonts } from '../theme';
import { Icon } from './icons';

type Ask = { id: number; title: string; message?: string; buttons: AlertButton[]; options?: AlertOptions };
type Tone = 'danger' | 'warn' | 'info' | 'good';

let push: ((a: Ask) => void) | null = null;
let seq = 0;
const systemAlert = Alert.alert;

function toneOf(a: Ask): Tone {
  if (a.buttons.some((b) => b.style === 'destructive')) return 'danger';
  const t = (a.title + ' ' + (a.message || '')).toLowerCase();
  if (/^(cannot|could not|can't|not allowed|no |failed|did not|didn't|error|problem|limit)/.test(a.title.toLowerCase()) || /refus|not enough|denied|went wrong|try again/.test(t)) return 'warn';
  if (/saved|sent|done|ready|added|paid|printed|restored|success/.test(a.title.toLowerCase())) return 'good';
  return 'info';
}

export default function AlertHost() {
  const { colors } = useTheme();
  const [queue, setQueue] = React.useState<Ask[]>([]);
  const fade = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    push = (a) => setQueue((q) => [...q, a]);
    Alert.alert = (title: string, message?: string, buttons?: AlertButton[], options?: AlertOptions) => {
      push?.({ id: ++seq, title: String(title ?? ''), message: message == null ? undefined : String(message), buttons: buttons && buttons.length ? buttons : [{ text: 'OK' }], options });
    };
    return () => { push = null; Alert.alert = systemAlert; };
  }, []);

  const cur = queue[0];
  React.useEffect(() => {
    if (!cur) return;
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 170, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [cur?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!cur) return null;
  const close = (b?: AlertButton) => {
    setQueue((q) => q.slice(1));
    // after the card has gone, so a button that opens another pop-up queues behind nothing
    if (b?.onPress) setTimeout(() => b.onPress?.(), 0);
  };
  const dismiss = () => {
    const cancel = cur.buttons.find((b) => b.style === 'cancel');
    if (cancel) return close(cancel);
    if (cur.options?.cancelable === false) return;
    if (cur.buttons.length === 1) return close(cur.buttons[0]);
    setQueue((q) => q.slice(1));
    cur.options?.onDismiss?.();
  };

  const tone = toneOf(cur);
  const T = {
    danger: { fg: colors.danger, bg: colors.dangerSoft, icon: 'trash' as const },
    warn: { fg: colors.warn, bg: colors.warnSoft || colors.sunk, icon: 'alert' as const },
    good: { fg: colors.good || colors.accent, bg: colors.goodSoft || colors.accentSoft, icon: 'check' as const },
    info: { fg: colors.accent, bg: colors.accentSoft, icon: 'bell' as const },
  }[tone];
  if (tone === 'danger' && !/delet|remov|discard|clear|void|cancel/i.test(cur.buttons.find((b) => b.style === 'destructive')?.text || '')) T.icon = 'alert' as never;

  // the main button: the last that is not Cancel; Cancel and the others are quieter
  const mainIdx = (() => { for (let i = cur.buttons.length - 1; i >= 0; i--) if (cur.buttons[i].style !== 'cancel') return i; return cur.buttons.length - 1; })();
  const stacked = cur.buttons.length > 2 || cur.buttons.some((b) => String(b.text || '').length > 16);
  const ordered = stacked
    ? [cur.buttons[mainIdx], ...cur.buttons.filter((_, i) => i !== mainIdx && cur.buttons[i].style !== 'cancel'), ...cur.buttons.filter((b, i) => i !== mainIdx && b.style === 'cancel')]
    : cur.buttons;

  const Btn = ({ b }: { b: AlertButton }) => {
    const main = b === cur.buttons[mainIdx] && cur.buttons.length > 1 || (cur.buttons.length === 1);
    const danger = b.style === 'destructive';
    const bg = main ? (danger ? colors.danger : tone === 'warn' && cur.buttons.length === 1 ? colors.ink : colors.accent) : colors.surface;
    const fg = main ? (danger || bg === colors.ink ? (bg === colors.ink ? colors.surface : '#fff') : colors.accentInk) : danger ? colors.danger : colors.ink;
    return (
      <Pressable onPress={() => close(b)} style={({ pressed }) => ({
        flex: stacked ? undefined : 1, height: 46, borderRadius: 6, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center',
        backgroundColor: !main && pressed ? colors.sunk : bg, opacity: main && pressed ? 0.88 : 1,
        borderWidth: main ? 0 : 1, borderColor: danger ? colors.danger : colors.lineHard,
      })}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 14.5, color: fg }}>{b.text || 'OK'}</Text>
      </Pressable>
    );
  };

  // a message of bullet lines ("• Table 7 — UGX 15,000") is drawn as a list
  const lines = String(cur.message || '').split('\n');
  const bullets = lines.filter((l) => /^\s*[•·-]\s/.test(l));

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={dismiss}>
      <Animated.View style={{ flex: 1, backgroundColor: 'rgba(8,12,20,0.58)', alignItems: 'center', justifyContent: 'center', padding: 22, opacity: fade }}>
        <Pressable style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} onPress={dismiss} />
        <Animated.View style={{
          width: '100%', maxWidth: 420, borderRadius: 12, backgroundColor: colors.surface, overflow: 'hidden',
          borderWidth: 1, borderColor: colors.line, elevation: 12,
          transform: [{ scale: fade.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }],
        }}>
          <View style={{ height: 4, backgroundColor: T.fg }} />
          <View style={{ padding: 20, paddingBottom: 18 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 14 }}>
              <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: T.bg, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={T.icon} size={21} color={T.fg} />
              </View>
              <View style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
                <Text style={{ fontFamily: fonts.uiSemi, fontSize: 17, lineHeight: 22, color: colors.ink }}>{cur.title}</Text>
                {cur.message ? (
                  <ScrollView style={{ maxHeight: 320, marginTop: 6 }} showsVerticalScrollIndicator={false}>
                    {lines.filter((l) => !bullets.includes(l)).join('\n').trim() ? (
                      <Text style={{ fontFamily: fonts.ui, fontSize: 14, lineHeight: 20, color: colors.soft }}>
                        {lines.filter((l) => !bullets.includes(l)).join('\n').trim()}
                      </Text>
                    ) : null}
                    {bullets.length ? (
                      <View style={{ marginTop: 10, borderRadius: 6, backgroundColor: colors.sunk, paddingVertical: 4 }}>
                        {bullets.map((l, i) => {
                          const [left, right] = l.replace(/^\s*[•·-]\s*/, '').split(/\s[—–]\s/);
                          return (
                            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 12, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
                              <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>{left}</Text>
                              {right ? <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }}>{right}</Text> : null}
                            </View>
                          );
                        })}
                      </View>
                    ) : null}
                  </ScrollView>
                ) : null}
              </View>
            </View>
            <View style={{ flexDirection: stacked ? 'column' : 'row', gap: 10, marginTop: 20 }}>
              {ordered.map((b, i) => <Btn key={i} b={b} />)}
            </View>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
