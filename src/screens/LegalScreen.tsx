/**
 * Legal — the privacy policy and the terms of use.
 *
 * The wording describes what this app actually does: the books live on the
 * phone, cloud sync is off until the owner turns it on, there is no analytics
 * or advertising SDK, and sign-in and licence checks talk to our own server.
 * Change it when any of that changes.
 */
import React from 'react';
import { View, Text, ScrollView } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme, fonts } from '../theme';
import { Panel, ListRow } from '../components/kit';
import { useGo } from '../nav/navigate';
import type { RootStackParamList } from '../nav/types';
import { SUPPORT_EMAIL } from '../data/support';

export const LEGAL_UPDATED = '27 September 2026';
/** Where people write to about privacy. Empty hides the line. */
export const LEGAL_CONTACT = SUPPORT_EMAIL;

type Block = { h: string; p: string[] };

export const PRIVACY: Block[] = [
  { h: 'Who we are', p: [
    'Genius POS ("the app", "we") is point-of-sale and bookkeeping software for shops. This policy explains what information the app handles, where it is kept and what control you have over it.',
  ] },
  { h: 'What the app stores', p: [
    'Your business records: sales, purchases, payments, stock, customers and suppliers, staff names and roles, and your settings. These are entered by you and your staff.',
    'Your account: the email address and name you sign in with, and a record of the devices linked to your licence.',
    'Pictures you choose, such as your logo, signature or product photos. They are copied into the app\'s own storage on the phone.',
  ] },
  { h: 'Where it is kept', p: [
    'By default everything stays on the phone. Staff PINs are stored as salted hashes, never as the PIN itself.',
    'If the owner turns on Cloud sync, the business records are uploaded to our server so they can be backed up and shared between the shop\'s own devices. Turning sync off stops further uploads.',
  ] },
  { h: 'What we send and why', p: [
    'Signing in and checking your licence send your account email, a device identifier and licence details to our server. This is needed to confirm that the app is licensed and to show which devices are linked.',
    'The app contains no advertising and no third-party analytics or tracking.',
    'We do not sell your information or share it with anyone for their own marketing.',
  ] },
  { h: 'Your customers\' information', p: [
    'Customer names and phone numbers you record belong to your business. You are responsible for having a lawful reason to keep them. When you send a receipt by WhatsApp or share a PDF, it goes through the app you choose, under that app\'s own terms.',
  ] },
  { h: 'Permissions', p: [
    'Camera and photos: only when you choose to add a logo, signature or product picture, or scan a barcode. Bluetooth and network: only to reach a printer you set up.',
  ] },
  { h: 'Keeping and deleting', p: [
    'Records stay on the phone until you delete them or remove the app. Synced records are kept on our server while your account is active. The owner can ask us to delete the account and its synced data.',
  ] },
  { h: 'Security', p: [
    'Connections to our server are encrypted. No system is perfectly secure, so keep the phone locked and give each member of staff their own PIN.',
  ] },
  { h: 'Changes', p: [
    'We will update this page when the app\'s handling of information changes, and change the date at the top.',
  ] },
];

export const TERMS: Block[] = [
  { h: 'Agreement', p: [
    'By using Genius POS you agree to these terms. If you use it for a business, you accept them on that business\'s behalf.',
  ] },
  { h: 'Your licence', p: [
    'We grant you a non-exclusive, non-transferable right to use the app on the number of devices your plan allows, for as long as your plan or trial is active. You may not copy, resell, reverse-engineer or get around the licence checks.',
  ] },
  { h: 'Your account and staff', p: [
    'Keep your sign-in details and staff PINs private. You are responsible for what is done in the app under your account, including by the staff you add.',
  ] },
  { h: 'Your records', p: [
    'Your business records remain yours. You are responsible for checking that they are accurate, for keeping backups, and for meeting your own tax, invoicing and record-keeping duties. The app is a tool to help with those duties; it does not replace an accountant or tax adviser.',
  ] },
  { h: 'Payments and plans', p: [
    'Paid plans are charged for the period shown when you buy. If a plan lapses, some features may stop working until it is renewed, but your existing records stay on the phone.',
  ] },
  { h: 'Acceptable use', p: [
    'Do not use the app for anything unlawful, to store information you have no right to hold, or to interfere with our servers or other customers.',
  ] },
  { h: 'Availability', p: [
    'The app is designed to keep working offline. Online features such as sync and licence checks depend on our server and your connection, and may occasionally be unavailable.',
  ] },
  { h: 'Liability', p: [
    'The app is provided as it is. To the extent the law allows, we are not liable for lost profits, lost data or indirect losses arising from its use. Nothing in these terms limits rights you have under consumer law that cannot be excluded.',
  ] },
  { h: 'Ending', p: [
    'You may stop using the app at any time. We may suspend a licence that is used in breach of these terms.',
  ] },
  { h: 'Changes', p: [
    'We may update these terms. Continuing to use the app after a change means you accept the new terms.',
  ] },
];

type Props = NativeStackScreenProps<RootStackParamList, 'Legal'>;

export default function LegalScreen({ route }: Props) {
  const { colors } = useTheme();
  const go = useGo();
  const docKey = route.params?.doc;

  if (!docKey) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16 }}>
        <Panel flush>
          <ListRow icon="shield" tone="accent" title="Privacy policy" subtitle="What the app stores, and where" onPress={() => go('Legal', { doc: 'privacy' })} />
          <ListRow icon="doc" tone="accent" title="Terms and conditions" subtitle="The rules for using Genius POS" onPress={() => go('Legal', { doc: 'terms' })} last />
        </Panel>
      </ScrollView>
    );
  }

  const blocks = docKey === 'privacy' ? PRIVACY : TERMS;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 18, paddingBottom: 40 }}>
      <Text style={{ fontFamily: fonts.uiExtra, fontSize: 24, color: colors.ink }}>
        {docKey === 'privacy' ? 'Privacy policy' : 'Terms and conditions'}
      </Text>
      <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 4 }}>Last updated {LEGAL_UPDATED}</Text>
      {blocks.map((b, i) => (
        <View key={b.h} style={{ marginTop: 20 }}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{i + 1}. {b.h}</Text>
          {b.p.map((para, j) => (
            <Text key={j} style={{ fontFamily: fonts.ui, fontSize: 15, lineHeight: 21, color: colors.soft, marginTop: 8 }}>{para}</Text>
          ))}
        </View>
      ))}
      {LEGAL_CONTACT ? (
        <Text style={{ fontFamily: fonts.ui, fontSize: 15, lineHeight: 21, color: colors.soft, marginTop: 24 }}>
          Questions? Write to {LEGAL_CONTACT}.
        </Text>
      ) : null}
    </ScrollView>
  );
}
