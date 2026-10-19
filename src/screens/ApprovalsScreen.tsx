/**
 * APPROVALS — what staff have asked the owner to allow, from the owner's phone.
 *
 * When the owner is not at the counter, a cashier who needs a go-ahead (a
 * discount over the limit, a sale below cost) can send the request instead of
 * waiting for the owner's PIN. It arrives here by sync; Approve or Decline is
 * sent back, and the cashier's screen carries on by itself.
 */
import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Pressable } from '../components/Press';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Icon } from '../components/icons';
import { explain } from '../data/refusal';
import { fmtDate } from '../data/helpers';

export default function ApprovalsScreen() {
  const { colors } = useTheme();
  const { db, decideApproval } = useAppData();
  if (!db) return null;
  const all = [...(db.approvals || [])].sort((a, b) => b.at.localeCompare(a.at));
  const pending = all.filter((a) => a.status === 'pending');
  const done = all.filter((a) => a.status !== 'pending').slice(0, 30);

  const decide = (id: string, ok: boolean) => { try { decideApproval(id, ok); } catch (e) { explain(e); } };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, letterSpacing: 0.8, textTransform: 'uppercase', color: colors.faint, marginBottom: 10 }}>
        Waiting for you · {pending.length}
      </Text>
      {pending.map((a) => (
        <View key={a.id} style={{ borderRadius: 4, padding: 16, marginBottom: 12, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.warn }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Icon name="lock" size={18} color={colors.warn} />
            <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{a.by} asks</Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{fmtDate(a.at)}</Text>
          </View>
          <Text style={{ fontFamily: fonts.ui, fontSize: 14.5, lineHeight: 21, color: colors.soft, marginTop: 10 }}>{a.what}</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            <Pressable onPress={() => decide(a.id, false)} style={{ flex: 1, height: 46, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.dangerSoft }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 14.5, color: colors.danger }}>Decline</Text>
            </Pressable>
            <Pressable onPress={() => decide(a.id, true)} style={{ flex: 1, height: 46, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.good }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 14.5, color: '#fff' }}>Approve</Text>
            </Pressable>
          </View>
        </View>
      ))}
      {!pending.length ? (
        <View style={{ alignItems: 'center', paddingVertical: 30, gap: 8 }}>
          <Icon name="check" size={30} color={colors.good} />
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>Nothing waiting</Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 13, color: colors.faint, textAlign: 'center', maxWidth: 300 }}>
            When staff need your go-ahead and you are not at the counter, their request appears here.
          </Text>
        </View>
      ) : null}

      {done.length ? (
        <>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, letterSpacing: 0.8, textTransform: 'uppercase', color: colors.faint, marginTop: 18, marginBottom: 10 }}>Answered</Text>
          <View style={{ borderRadius: 4, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' }}>
            {done.map((a, i) => (
              <View key={a.id} style={{ padding: 14, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 13.5, color: colors.ink }} numberOfLines={1}>{a.by}</Text>
                  <Text style={{ fontFamily: fonts.uiBold, fontSize: 12, color: a.status === 'approved' ? colors.good : colors.danger }}>
                    {a.status === 'approved' ? 'Approved' : 'Declined'}{a.decidedBy ? ' by ' + a.decidedBy : ''}
                  </Text>
                </View>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 4 }} numberOfLines={2}>{a.what}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}
