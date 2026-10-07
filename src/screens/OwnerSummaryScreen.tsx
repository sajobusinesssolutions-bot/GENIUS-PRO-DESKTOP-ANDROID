/**
 * OWNER'S DAILY SUMMARY — Settings → Owner's daily summary.
 *
 * Where the evening message goes and when: an email the server sends on its
 * own, and a WhatsApp message the owner's phone offers to send. Below, today's
 * summary as it would go out right now (takings, the drawers' variance, best
 * sellers, the financial report and anything expiring), with Send now.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Pressable } from '../components/Press';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useAuthSafe } from '../data/AuthContext';
import { useToast } from '../components/Toast';
import { Icon } from '../components/icons';
import { Button } from '../components/ui';
import { Field, ToggleRow } from '../components/form';
import { explain } from '../data/refusal';
import { daySummary } from '../data/daySummary';
import { emailToday, todayKey, whatsappToday } from '../data/ownerSummarySend';

const TIMES = ['18:00', '19:00', '20:00', '21:00', '22:00', '23:00'];

export default function OwnerSummaryScreen() {
  const { colors } = useTheme();
  const { db, money, setSetting } = useAppData();
  const account = useAuthSafe()?.account;
  const { success, error } = useToast();
  const cur = db?.settings.ownerSummary;
  const owner = db?.users.find((u) => u.role === 'owner');
  const [on, setOn] = useState(cur?.on ?? false);
  const [time, setTime] = useState(cur?.time || '20:00');
  const [email, setEmail] = useState(cur?.email || db?.firm?.email || '');
  const [whatsapp, setWhatsapp] = useState(cur?.whatsapp || db?.firm?.phone || '');
  const [autoEmail, setAutoEmail] = useState(cur?.autoEmail ?? true);
  const [askWhatsapp, setAskWhatsapp] = useState(cur?.askWhatsapp ?? true);
  const [busy, setBusy] = useState(false);
  if (!db) return null;

  const text = daySummary(db, money);
  const sentToday = db.settings.ownerSummarySentOn === todayKey();
  const signedIn = !!account?.refresh && !account.localOnly;

  function save() {
    const e = email.trim();
    if (on && autoEmail && e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { error('That email address does not look right.'); return; }
    if (on && !(autoEmail && e) && !(askWhatsapp && whatsapp.trim())) { error('Add an email address or a WhatsApp number for the summary to go to.'); return; }
    try {
      setSetting({ ownerSummary: { on, time, email: e || undefined, whatsapp: whatsapp.trim() || undefined, autoEmail, askWhatsapp } });
      success(on ? 'The summary goes out every day at ' + time : 'Daily summary switched off');
    } catch (x) { explain(x); }
  }

  async function sendEmailNow() {
    setBusy(true);
    const r = await emailToday(db!, money, account?.localOnly ? undefined : account?.refresh, email);
    setBusy(false);
    if (r.ok) success('Summary emailed to ' + email.trim());
    else error(r.why);
  }

  const card = { borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, padding: 14, marginBottom: 12 };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <View style={card}>
        <ToggleRow
          label="Send me a summary every evening"
          sub="Takings by payment method, the drawers' variance, best sellers, the financial report and anything expiring"
          on={on}
          onChange={setOn}
        />
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.faint, marginTop: 10, marginBottom: 8 }}>Send it at</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {TIMES.map((t) => {
            const sel = t === time;
            return (
              <Pressable key={t} onPress={() => setTime(t)} style={{ paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.4, borderColor: sel ? colors.ink : colors.line, backgroundColor: sel ? colors.ink : colors.surface }}>
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 13.5, color: sel ? colors.bg : colors.ink }}>{t}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 8 }}>
          Sent by whichever phone of the business is open at that time, once a day. Closing the day also offers it.
        </Text>
      </View>

      <View style={card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Icon name="mail" size={18} color={colors.ink} />
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>Email</Text>
        </View>
        <Field label={'Email for ' + (owner?.name || 'the owner')} keyboard="email-address" value={email} onChangeText={setEmail} placeholder="owner@example.com" />
        <ToggleRow label="Email it automatically" sub="Arrives without anyone tapping anything" on={autoEmail} onChange={setAutoEmail} />
        {!signedIn ? (
          <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.warn, marginTop: 8 }}>
            Email is sent through your Genius Pro account. Sign in under Settings → Cloud for it to work.
          </Text>
        ) : null}
      </View>

      <View style={card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Icon name="phone" size={18} color={colors.ink} />
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>WhatsApp</Text>
        </View>
        <Field label="WhatsApp number" keyboard="phone-pad" value={whatsapp} onChangeText={setWhatsapp} placeholder="0772 123456" />
        <ToggleRow
          label="Offer it on WhatsApp"
          sub="At the hour, the owner's phone asks to send it. WhatsApp only sends a message after a tap; it cannot be sent on its own."
          on={askWhatsapp}
          onChange={setAskWhatsapp}
        />
      </View>

      <Button variant="pri" label="Save" onPress={save} />

      <View style={{ height: 22 }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.faint }}>Today's summary so far</Text>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: sentToday ? colors.good : colors.faint }}>{sentToday ? 'Emailed today' : 'Not sent yet today'}</Text>
      </View>
      <View style={[card, { backgroundColor: colors.sunk }]}>
        <Text selectable style={{ fontFamily: fonts.mono || fonts.ui, fontSize: 12.5, lineHeight: 19, color: colors.ink }}>{text.replace(/\*/g, '')}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><Button label={busy ? 'Sending…' : 'Email now'} icon={<Icon name="mail" size={15} color={colors.ink} />} disabled={busy || !email.trim()} onPress={sendEmailNow} /></View>
        <View style={{ flex: 1 }}><Button label="WhatsApp now" icon={<Icon name="phone" size={15} color={colors.ink} />} onPress={() => { void whatsappToday({ ...db, settings: { ...db.settings, ownerSummary: { ...(cur || { on, time }), whatsapp } } }, money); }} /></View>
      </View>
    </ScrollView>
  );
}
