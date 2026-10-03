/**
 * Sending a document or a reminder: the message, ready-written and editable,
 * and one button per way to send it — WhatsApp (straight to the person's
 * chat), SMS, email, or any other app on the phone.
 */
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { Pressable } from './Press';
import { useTheme, fonts } from '../theme';
import { useToast } from './Toast';
import Sheet from './Sheet';
import { Field } from './ui';
import { Icon, IconName } from './icons';
import { Channel, sendVia } from '../data/messages';

export default function SendSheet({ visible, onClose, title, to, phone, email, subject, text }: {
  visible: boolean;
  onClose: () => void;
  title: string;
  /** Who it goes to, shown at the top. */
  to?: string;
  phone?: string;
  email?: string;
  subject?: string;
  /** The ready-made message; the person can change it before sending. */
  text: string;
}) {
  const { colors } = useTheme();
  const { error } = useToast();
  const [msg, setMsg] = useState(text);
  useEffect(() => { if (visible) setMsg(text); }, [visible, text]);

  async function send(ch: Channel) {
    if (ch === 'sms' && !phone) { error('There is no phone number for ' + (to || 'this contact') + '.'); return; }
    const ok = await sendVia(ch, { text: msg, phone, email, subject });
    if (!ok) error(ch === 'whatsapp' ? 'WhatsApp could not be opened.' : 'That app could not be opened.');
    else onClose();
  }

  const ways: { ch: Channel; l: string; i: IconName; tint: string; sub: string }[] = [
    { ch: 'whatsapp', l: 'WhatsApp', i: 'phone', tint: '#25D366', sub: phone ? 'To ' + phone : 'Choose the chat' },
    { ch: 'sms', l: 'SMS', i: 'mail', tint: colors.accent, sub: phone ? 'To ' + phone : 'No number' },
    { ch: 'email', l: 'Email', i: 'mail', tint: colors.warn, sub: email || 'Choose who' },
    { ch: 'other', l: 'Other apps', i: 'share', tint: colors.soft, sub: 'Telegram, Gmail…' },
  ];

  return (
    <Sheet visible={visible} title={title} subtitle={to ? 'To ' + to : undefined} icon="share" full onClose={onClose}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {ways.map((w) => (
          <Pressable
            key={w.ch}
            onPress={() => void send(w.ch)}
            style={{
              width: '48%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12,
              borderRadius: 14, borderWidth: 1.2, borderColor: colors.line, backgroundColor: colors.surface,
              opacity: w.ch === 'sms' && !phone ? 0.45 : 1,
            }}
          >
            <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: w.tint + '22', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={w.i} size={17} color={w.tint} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: fonts.uiBold, fontSize: 14, color: colors.ink }}>{w.l}</Text>
              <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 11.5, color: colors.faint }}>{w.sub}</Text>
            </View>
          </Pressable>
        ))}
      </View>
      <Field label="Message" value={msg} onChangeText={setMsg} multiline />
      <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>
        Change anything above before you send it; the app you pick opens with it filled in.
      </Text>
    </Sheet>
  );
}
