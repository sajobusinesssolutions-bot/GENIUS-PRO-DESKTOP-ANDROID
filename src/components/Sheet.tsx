import React from 'react';
import { ToastHost } from './Toast';
import { Modal, View, Text, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { Pressable } from './Press';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, fonts, radius, shadow } from '../theme';
import { Icon, IconName } from './icons';

/**
 * The bottom sheet used for every form and detail panel: a drag handle, an
 * optional tinted icon tile beside the title, a scrolling body and a pinned
 * footer holding the primary action.
 */
export function Sheet({ visible, title, subtitle, icon, iconTone, onClose, children, footer, full }: {
  visible: boolean; title: string; subtitle?: string; onClose: () => void;
  children: React.ReactNode; footer?: React.ReactNode;
  icon?: IconName; iconTone?: 'accent' | 'good' | 'warn' | 'danger';
  /** Opens tall, for pickers whose list needs the room. */
  full?: boolean;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const tint = iconTone === 'good' ? [colors.goodSoft, colors.good]
    : iconTone === 'warn' ? [colors.warnSoft, colors.warn]
      : iconTone === 'danger' ? [colors.dangerSoft, colors.danger]
        : [colors.accentSoft, colors.accent];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/*
        The scrim sits behind the sheet rather than wrapping it. Wrapping put a
        Pressable around the body, and that Pressable competed with the scrolling
        list for the pan gesture — the sheet would only scroll where a touch
        happened to miss it.
      */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
        style={{ flex: 1, justifyContent: 'flex-end' }}
      >
        <Pressable
          testID="sheet-scrim"
          onPress={onClose}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(10,12,18,0.45)' }}
        />
        <View style={{
          width: '100%',
          height: full ? '92%' : '88%',
          flexShrink: 1,
        }}>
        <View style={{
          backgroundColor: colors.surface,
          height: '100%',
          flexShrink: 1,
          borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
          overflow: 'hidden', ...shadow.raised,
        }}>
          <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 2 }}>
            <View style={{ width: 42, height: 4.5, borderRadius: 3, backgroundColor: colors.lineHard }} />
          </View>

          <View style={{
            paddingTop: 12, paddingHorizontal: 18, paddingBottom: 14,
            flexDirection: 'row', alignItems: 'center', gap: 12,
          }}>
            {icon ? (
              <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: tint[0], alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={icon} size={21} color={tint[1]} />
              </View>
            ) : null}
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink, letterSpacing: -0.3 }}>{title}</Text>
              {subtitle ? (
                <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 3 }}>{subtitle}</Text>
              ) : null}
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={{ padding: 6 }}>
              <Icon name="x" size={21} color={colors.faint} />
            </Pressable>
          </View>

          <View style={{ height: 1, backgroundColor: colors.line }} />

          <ScrollView
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            automaticallyAdjustKeyboardInsets
            nestedScrollEnabled
            showsVerticalScrollIndicator
            contentContainerStyle={{ paddingVertical: 18, paddingHorizontal: 18, paddingBottom: 18 + (footer ? 0 : insets.bottom) }}
          >
            {children}
          </ScrollView>

          {footer ? (
            <View style={{
              borderTopWidth: 1, borderTopColor: colors.line,
              paddingHorizontal: 18, paddingTop: 13, paddingBottom: 14 + insets.bottom,
              backgroundColor: colors.surface,
            }}>
              {footer}
            </View>
          ) : null}
        </View>
        </View>
      </KeyboardAvoidingView>
      <ToastHost />
    </Modal>
  );
}

export default Sheet;
