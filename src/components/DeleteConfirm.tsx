/**
 * The step before a transaction is deleted: what it is, what deleting does,
 * and two plain buttons. It was a pink box with a sentence in it; now the
 * document itself is shown, so nobody deletes the wrong one, and what happens
 * after is spelled out line by line.
 */
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTheme, fonts } from '../theme';
import { Icon } from './icons';

export function DeleteConfirm({ title, what, who, amount, when, text, onKeep, onDelete }: {
  /** "Delete sale" */
  title: string;
  /** "Sale #INV-03187" */
  what: string;
  who?: string;
  amount?: string;
  when?: string;
  /** What deleting does, in a sentence or two; each sentence becomes a line. */
  text: string;
  onKeep: () => void;
  onDelete: () => void;
}) {
  const { colors } = useTheme();
  const lines = text.split(/(?<=\.)\s+/).map((x) => x.trim()).filter(Boolean);
  return (
    <View>
      <View style={{ alignItems: 'center', paddingTop: 4, paddingBottom: 14 }}>
        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: colors.dangerSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="trash" size={24} color={colors.danger} />
        </View>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 17, color: colors.ink, marginTop: 10 }}>{title}?</Text>
      </View>

      {/* the document itself */}
      <View style={{ borderRadius: 4, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, paddingVertical: 10, paddingHorizontal: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink }}>{what}</Text>
          {amount ? <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink }}>{amount}</Text> : null}
        </View>
        {who || when ? (
          <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 2 }}>
            {[who, when].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
      </View>

      {/* what deleting does */}
      <View style={{ marginTop: 12, gap: 7 }}>
        {lines.map((l, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: colors.faint, marginTop: 6 }} />
            <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 17, color: colors.soft }}>{l}</Text>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 18 }}>
        <Pressable onPress={onKeep} style={({ pressed }) => ({
          flex: 1, height: 44, borderRadius: 4, alignItems: 'center', justifyContent: 'center',
          borderWidth: 1, borderColor: colors.lineHard, backgroundColor: pressed ? colors.sunk : colors.surface,
        })}>
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink }}>Keep it</Text>
        </Pressable>
        <Pressable onPress={onDelete} style={({ pressed }) => ({
          flex: 1, height: 44, borderRadius: 4, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6,
          backgroundColor: colors.danger, opacity: pressed ? 0.85 : 1,
        })}>
          <Icon name="trash" size={15} color="#fff" />
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: '#fff' }}>Delete</Text>
        </Pressable>
      </View>
    </View>
  );
}
