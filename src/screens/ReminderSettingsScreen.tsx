/**
 * Settings → Payment reminders. Switch reminders on or off, say how old an
 * invoice must be before it is listed, and write the message for each way of
 * sending — WhatsApp, SMS (kept short) and email — with fields such as {name}
 * and {total} filled in for each customer, and a live preview.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Pressable } from '../components/Press';
import { useTheme, fonts, radius } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useToast } from '../components/Toast';
import { Button, Field, StickyBar, ToggleRow, Card, Cap } from '../components/ui';
import SegmentSlider from '../components/SegmentSlider';
import { useDueReminders } from '../components/Reminders';
import { DEFAULT_REMINDERS, REMINDER_FIELDS, ReminderSettings, fillReminder, reminderSettings } from '../data/messages';

type Ch = 'whatsapp' | 'sms' | 'email';

export default function ReminderSettingsScreen({ navigation }: any) {
  const { colors } = useTheme();
  const { db, setSetting, money } = useAppData();
  const { success } = useToast();
  const [cfg, setCfg] = useState<ReminderSettings>(() => reminderSettings(db?.settings.reminders));
  const [ch, setCh] = useState<Ch>('whatsapp');
  const due = useDueReminders();

  // the preview uses a real customer who owes, or an example
  const sample = useMemo(() => due[0] || {
    name: 'Acme School', bills: [
      { no: 'INV-0012', ts: new Date(Date.now() - 20 * 86400000).toISOString(), total: 450000, due: 450000 },
      { no: 'INV-0019', ts: new Date(Date.now() - 6 * 86400000).toISOString(), total: 300000, due: 120000 },
    ],
  }, [due]);

  if (!db) return null;
  const firm = { name: db.firm.name, phone: db.firm.phone };
  const set = (p: Partial<ReminderSettings>) => setCfg((c) => ({ ...c, ...p }));
  const text = cfg[ch];
  const preview = fillReminder(text, { partyName: sample.name, bills: sample.bills, firm, money });

  function save() {
    setSetting({ reminders: cfg });
    success('Reminder settings saved');
    navigation.goBack();
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <ToggleRow
          label="Payment reminders"
          sub="List customers with open invoices on Home and in Notifications, each with a Remind button"
          on={cfg.enabled}
          onChange={(v) => set({ enabled: v })}
        />

        {cfg.enabled ? (
          <>
            <Cap style={{ marginTop: 6, marginBottom: 8 }}>List an invoice once it is</Cap>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
              {[0, 7, 14, 30].map((n) => {
                const on = cfg.afterDays === n;
                return (
                  <Pressable
                    key={n}
                    onPress={() => set({ afterDays: n })}
                    style={{
                      height: 38, paddingHorizontal: 14, borderRadius: 19, justifyContent: 'center',
                      backgroundColor: on ? colors.accent : colors.surface, borderWidth: 1.2, borderColor: on ? colors.accent : colors.line,
                    }}
                  >
                    <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13.5, color: on ? colors.accentInk : colors.ink }}>{n ? n + ' days old' : 'Any age'}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Cap style={{ marginBottom: 8 }}>The message</Cap>
            <SegmentSlider
              value={ch}
              onChange={setCh}
              style={{ marginBottom: 12 }}
              options={[
                { v: 'whatsapp', l: 'WhatsApp', i: 'phone' },
                { v: 'sms', l: 'SMS', i: 'mail' },
                { v: 'email', l: 'Email', i: 'mail' },
              ]}
            />

            {ch === 'email' ? (
              <Field label="Subject" value={cfg.emailSubject} onChangeText={(v) => set({ emailSubject: v })} style={{ marginBottom: 10 }} />
            ) : null}
            <Field label={ch === 'sms' ? 'SMS text (keep it short)' : 'Message'} value={text} onChangeText={(v) => set({ [ch]: v } as any)} multiline style={{ marginBottom: 8 }} />
            {ch === 'sms' ? (
              <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: preview.length > 160 ? colors.warn : colors.faint, marginTop: -4, marginBottom: 8 }}>
                {preview.length} characters{preview.length > 160 ? ' — longer than one text message' : ''}
              </Text>
            ) : null}

            {/* tap a field to add it at the end of the message */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
              {REMINDER_FIELDS.map((fl) => (
                <Pressable
                  key={fl.key}
                  onPress={() => set({ [ch]: (text.endsWith(' ') || text.endsWith('\n') || !text ? text : text + ' ') + fl.key } as any)}
                  style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: colors.accentSoft }}
                >
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12, color: colors.accent }}>+ {fl.label}</Text>
                </Pressable>
              ))}
            </View>

            <Cap style={{ marginBottom: 8 }}>Preview{due[0] ? ' · ' + due[0].name : ' · example'}</Cap>
            <Card style={{ padding: 14, marginBottom: 12, backgroundColor: ch === 'whatsapp' ? '#E7FFDB' : colors.surface, borderRadius: radius.md }}>
              {ch === 'email' ? (
                <Text style={{ fontFamily: fonts.uiBold, fontSize: 13.5, color: '#111', marginBottom: 8 }}>
                  {fillReminder(cfg.emailSubject, { partyName: sample.name, bills: sample.bills, firm, money })}
                </Text>
              ) : null}
              <Text style={{ fontFamily: fonts.ui, fontSize: 13.5, lineHeight: 19, color: ch === 'whatsapp' ? '#111' : colors.ink }}>{preview}</Text>
            </Card>

            <Pressable
              onPress={() => set(ch === 'email' ? { email: DEFAULT_REMINDERS.email, emailSubject: DEFAULT_REMINDERS.emailSubject } : { [ch]: DEFAULT_REMINDERS[ch] } as any)}
              hitSlop={8}
              style={{ alignSelf: 'flex-start' }}
            >
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 13, color: colors.accent }}>Reset this message to the default</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>

      <StickyBar>
        <Button label="Save" variant="pri" onPress={save} />
      </StickyBar>
    </View>
  );
}
