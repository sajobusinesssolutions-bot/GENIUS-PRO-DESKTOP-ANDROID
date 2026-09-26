import React, { createContext, useContext, useState, useCallback } from 'react';
import { View, Text, Pressable, Modal } from 'react-native';
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

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast(): ToastContextType {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, type: ToastType = 'info', duration = 3000) => {
    const id = Math.random().toString(36);
    setToasts((prev) => [...prev, { id, message, type, duration }]);
    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
  }, []);

  const value: ToastContextType = {
    show,
    error: (msg) => show(msg, 'error', 7000),
    success: (msg) => show(msg, 'success', 3000),
    info: (msg) => show(msg, 'info', 3000),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((p) => p.filter((t) => t.id !== id))} />
    </ToastContext.Provider>
  );
}

/**
 * The stack is itself a Modal.
 *
 * Sheets in this app are Modals, and on Android a Modal draws above everything
 * else in the same tree — a plain overlay shown while a sheet was open ended up
 * behind it, which is how an "insufficient stock" message went unseen. Rendering
 * the stack in its own Modal puts it above whatever is already on screen.
 */
function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  if (!toasts.length) return null;

  const toneMap: Record<ToastType, { bg: string; fg: string; icon: IconName }> = {
    info: { bg: colors.accent, fg: colors.accentInk, icon: 'alert' },
    success: { bg: colors.good, fg: '#FFFFFF', icon: 'check' },
    error: { bg: colors.danger, fg: '#FFFFFF', icon: 'alert' },
    warning: { bg: colors.warn, fg: '#FFFFFF', icon: 'alert' },
  };

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent pointerEvents="box-none" onRequestClose={() => onDismiss(toasts[0].id)}>
      <View
        pointerEvents="box-none"
        style={{ position: 'absolute', top: insets.top + 10, left: 12, right: 12 }}
      >
        {toasts.map((toast) => {
          const tone = toneMap[toast.type];
          return (
            <Pressable
              key={toast.id}
              onPress={() => onDismiss(toast.id)}
              style={{
                backgroundColor: tone.bg,
                borderRadius: 14,
                paddingVertical: 14,
                paddingHorizontal: 15,
                marginBottom: 10,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                shadowColor: '#0B1D2A',
                shadowOpacity: 0.22,
                shadowRadius: 18,
                shadowOffset: { width: 0, height: 8 },
                elevation: 10,
              }}
            >
              <View style={{
                width: 32, height: 32, borderRadius: 11,
                backgroundColor: 'rgba(255,255,255,0.22)',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <Icon name={tone.icon} size={18} color={tone.fg} />
              </View>
              <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 14.5, lineHeight: 20, color: tone.fg }}>
                {toast.message}
              </Text>
              <Icon name="x" size={18} color={tone.fg} />
            </Pressable>
          );
        })}
      </View>
    </Modal>
  );
}
