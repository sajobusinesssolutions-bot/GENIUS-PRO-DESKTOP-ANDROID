/**
 * HELP & ABOUT — one place for the legal pages, the app and its plan, and
 * every way to reach the people who make it.
 */
import React, { useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Pressable } from '../components/Press';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Panel, ListRow, SectionLabel } from '../components/kit';
import { Icon } from '../components/icons';
import { useToast } from '../components/Toast';
import { useGo } from '../nav/navigate';
import { BUILD } from '../data/defaults';
import { SUPPORT_EMAIL, SUPPORT_WHATSAPP, PUBLISHER, emailUrl, whatsappUrl, open, shareApp } from '../data/support';

export const FAQS: { q: string; a: string }[] = [
  { q: 'Does the app work without internet?', a: 'Yes. Selling, stock, receipts and reports all work offline. With cloud sync on, changes wait in the queue and go up by themselves when the phone is back online.' },
  { q: 'How do I back up my books?', a: 'Menu → Settings → Data & backup → Backup now. Backups are encrypted .sa files. Choose Daily, Weekly or Monthly to take them automatically, and share one to Drive or email so a copy lives off the phone.' },
  { q: 'How do I move my books to a new phone?', a: 'With cloud sync: sign in on the new phone and choose the business. Without it: share a .sa backup to the new phone, then Data & backup → Restore from a file.' },
  { q: 'Can someone open my .sa backup file?', a: 'Not in a file manager, spreadsheet or text editor — it is encrypted and only Genius POS can restore it. A file that has been changed or damaged is refused rather than restored.' },
  { q: 'How do I connect a receipt printer?', a: 'Settings → Printing. For a network printer enter its IP address and tap Connect / Test. For Bluetooth, pair it in the phone\'s Bluetooth settings first, then add it by name.' },
  { q: 'How do I change what prints on receipts and invoices?', a: 'Settings → Printing → Receipt settings or Invoice PDF settings. Every change shows in the preview before you save.' },
  { q: 'How do I choose which columns go on a report PDF?', a: 'Open the report, tap the print button and pick PDF, Excel, Preview or WhatsApp. Tick the columns you want and tap Apply.' },
  { q: 'Why does a staff member not see some sales?', a: 'Each role decides what a person may see. The owner can allow "See other staff\'s sales" under Settings → Staff & roles.' },
  { q: 'How many phones can use one licence?', a: 'Your plan sets the number of devices. Cloud sync → Linked devices shows who is using a place, and the owner can remove an old phone there.' },
  { q: 'I forgot my PIN. What now?', a: 'The owner can reset a staff PIN under Staff & roles. The owner\'s own PIN can be reset with a code sent to the account email.' },
];

export default function HelpScreen() {
  const { colors } = useTheme();
  const go = useGo();
  const { db } = useAppData();
  const { error } = useToast();
  const till = db?.session.till;

  const openOr = async (url: string, what: string) => {
    if (!(await open(url))) error('No app on this phone can open ' + what + '.');
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      <SectionLabel>Get help</SectionLabel>
      <Panel flush>
        <ListRow icon="bulb" tone="accent" title="FAQs & help" subtitle="Answers to common questions" onPress={() => go('Faq')} />
        <ListRow icon="phone" tone="good" title="WhatsApp support" subtitle={'+' + SUPPORT_WHATSAPP} onPress={() => openOr(whatsappUrl('Hello ' + PUBLISHER + ', I need help with Genius POS ' + BUILD + '.'), 'WhatsApp')} />
        <ListRow icon="mail" tone="accent" title="Email support" subtitle={SUPPORT_EMAIL} onPress={() => openOr(emailUrl('Genius POS support', 'Describe what happened:\n\n', till), 'email')} />
        <ListRow icon="pencil" tone="warn" title="Feature request" subtitle="Tell us what would make the app better" onPress={() => openOr(emailUrl('Feature request', 'What I would like the app to do:\n\nWhy it would help my shop:\n\n', till), 'email')} last />
      </Panel>

      <SectionLabel style={{ marginTop: 18 }}>The app</SectionLabel>
      <Panel flush>
        <ListRow icon="shield" tone="accent" title="App & updates" subtitle={'Version ' + BUILD} onPress={() => go('About')} />
        <ListRow icon="money" tone="good" title="Plan & licence" subtitle="Your plan, devices and renewal" onPress={() => go('Plans')} />
        <ListRow icon="up" tone="accent" title="Share the app" subtitle="Tell another shop about Genius POS" onPress={() => { shareApp().catch(() => error('Sharing is not available on this phone.')); }} last />
      </Panel>

      <SectionLabel style={{ marginTop: 18 }}>Legal</SectionLabel>
      <Panel flush>
        <ListRow icon="shield" tone="neutral" title="Privacy policy" subtitle="What the app stores, and where" onPress={() => go('Legal', { doc: 'privacy' })} />
        <ListRow icon="doc" tone="neutral" title="Terms and conditions" subtitle="The rules for using Genius POS" onPress={() => go('Legal', { doc: 'terms' })} last />
      </Panel>

      <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, textAlign: 'center', marginTop: 22 }}>
        Genius POS {BUILD} · made by {PUBLISHER}
      </Text>
    </ScrollView>
  );
}

export function FaqScreen() {
  const { colors } = useTheme();
  const [open, setOpen] = useState<number | null>(0);
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      {FAQS.map((f, i) => {
        const on = open === i;
        return (
          <Pressable
            key={f.q}
            onPress={() => setOpen(on ? null : i)}
            accessibilityRole="button"
            accessibilityState={{ expanded: on }}
            style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: on ? colors.accent : colors.line, padding: 14, marginBottom: 10 }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ flex: 1, fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{f.q}</Text>
              <Icon name={on ? 'up' : 'down'} size={16} color={colors.faint} />
            </View>
            {on ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 20, color: colors.soft, marginTop: 8 }}>{f.a}</Text> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
