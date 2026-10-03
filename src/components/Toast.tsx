import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { Pressable } from './Press';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, fonts } from '../theme';
import { Icon, IconName } from './icons';

export type ToastType = 'info' | 'success' | 'error' | 'warning';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
  action?: { label: string; onPress: () => void };
}

interface ToastContextType {
  show: (message: string, type?: ToastType, duration?: number) => void;
  error: (message: string) => void;
  success: (message: string) => void;
  info: (message: string) => void;
}

interface HostContextType {
  toasts: Toast[];
  dismiss: (id: string) => void;
  /** Modal hosts open right now, newest last. The last one draws the toasts. */
  hosts: number[];
  register: () => { id: number; off: () => void };
}

const ToastContext = createContext<ToastContextType | null>(null);
const HostContext = createContext<HostContextType | null>(null);

export function useToast(): ToastContextType {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

let nextHost = 1;

/**
 * Toasts float over the screen without taking it over.
 *
 * They used to sit in a Modal of their own so they would show above sheets.
 * On Android a Modal takes every touch on the screen, so nothing could be
 * tapped until the toast went away. Now they are a plain overlay whose empty
 * space lets touches through. A sheet (itself a Modal, which would cover
 * that overlay) renders a <ToastHost/> inside itself, and while it is open
 * the toasts are drawn there instead.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [hosts, setHosts] = useState<number[]>([]);

  const dismiss = useCallback((id: string) => setToasts((p) => p.filter((t) => t.id !== id)), []);

  const show = useCallback((message: string, type: ToastType = 'info', duration = 3000) => {
    const id = Math.random().toString(36);
    // one of each message at a time: the same error twice is noise, not news
    setToasts((prev) => [...prev.filter((t) => t.message !== message), { id, message, type, duration }].slice(-3));
    if (duration > 0) setTimeout(() => dismiss(id), duration);
  }, [dismiss]);

  const register = useCallback(() => {
    const id = nextHost++;
    setHosts((h) => [...h, id]);
    return { id, off: () => setHosts((h) => h.filter((x) => x !== id)) };
  }, []);

  const value = React.useMemo<ToastContextType>(() => ({
    show,
    error: (msg) => show(msg, 'error', 6000),
    success: (msg) => show(msg, 'success', 2600),
    info: (msg) => show(msg, 'info', 3000),
  }), [show]);

  return (
    <ToastContext.Provider value={value}>
      <HostContext.Provider value={{ toasts, dismiss, hosts, register }}>
        {children}
        {hosts.length ? null : <ToastStack toasts={toasts} onDismiss={dismiss} />}
      </HostContext.Provider>
    </ToastContext.Provider>
  );
}

/** Put inside any Modal, so toasts raised while it is open show above it. */
export function ToastHost() {
  const ctx = useContext(HostContext);
  const [me, setMe] = useState(0);
  const register = ctx?.register;
  useEffect(() => {
    if (!register) return;
    const { id, off } = register();
    setMe(id);
    return off;
  }, [register]);
  if (!ctx || !me || ctx.hosts[ctx.hosts.length - 1] !== me) return null;
  return <ToastStack toasts={ctx.toasts} onDismiss={ctx.dismiss} />;
}

function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  const insets = useSafeAreaInsets();
  if (!toasts.length) return null;
  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + 10, left: 12, right: 12 }}>
        {toasts.map((t) => <ToastCard key={t.id} toast={t} onDismiss={onDismiss} />)}
      </View>
    </View>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const { colors } = useTheme();
  const toneMap: Record<ToastType, { bg: string; fg: string; icon: IconName }> = {
    info: { bg: colors.accent, fg: colors.accentInk, icon: 'alert' },
    success: { bg: colors.good, fg: '#FFFFFF', icon: 'check' },
    error: { bg: colors.danger, fg: '#FFFFFF', icon: 'alert' },
    warning: { bg: colors.warn, fg: '#FFFFFF', icon: 'alert' },
  };
  const tone = toneMap[toast.type];
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(enter, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 220, mass: 0.8 }).start();
  }, [enter]);
  return (
    <Animated.View style={{
      // slides in, never fades: a fading card with a shadow shows as a dark block on Android
      transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-90, 0] }) }],
      marginBottom: 8,
    }}>
      <Pressable
        onPress={() => onDismiss(toast.id)}
        accessibilityRole="alert"
        accessibilityHint="Tap to dismiss"
        style={{
          backgroundColor: tone.bg, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14,
          flexDirection: 'row', alignItems: 'center', gap: 12,
          shadowColor: '#0B1D2A', shadowOpacity: 0.2, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 12,
        }}
      >
        <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={tone.icon} size={17} color={tone.fg} />
        </View>
        <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 15, lineHeight: 19, color: tone.fg }}>{toast.message}</Text>
        <Icon name="x" size={16} color={tone.fg} />
      </Pressable>
    </Animated.View>
  );
}
