/**
 * Payment reminders: who owes, and a one-tap way to remind them.
 *
 * The words are the shop's own, set once under Settings → Payment reminders,
 * with a template for each way of sending. Tapping Remind only asks how —
 * WhatsApp, SMS or email — and opens that app with the right message for the
 * right person; nobody has to read or edit a template at the counter.
 */
import React, { useMemo } from 'react';
import { View, Text } from 'react-native';
import { Pressable } from './Press';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useToast } from './Toast';
import Sheet from './Sheet';
import { Icon, IconName } from './icons';
import { ageOfDays, plural } from '../data/helpers';
import { canFor } from '../data/perms';
import { Channel, DueBill, fillReminder, reminderSettings, sendVia } from '../data/messages';

export interface DueParty { partyId: string; name: string; bills: DueBill[]; due: number; oldest: number }

/** Customers with invoices still open, largest debt first — as the reminder settings ask. */
export function useDueReminders(): DueParty[] {
  const { db, party } = useAppData();
  return useMemo(() => {
    if (!db) return [];
    const cfg = reminderSettings(db.settings.reminders);
    if (!cfg.enabled || !canFor(db.session.role, 'sales.view')) return [];
    const by = new Map<string, DueParty>();
    db.sales
      .filter((s) => s.status !== 'void' && s.due > 0.01 && s.partyId && ageOfDays(s.ts) >= cfg.afterDays)
      .forEach((s) => {
        const k = s.partyId as string;
        const o = by.get(k) || { partyId: k, name: party(k)?.name || 'Customer', bills: [], due: 0, oldest: 0 };
        o.bills.push({ no: s.no, ts: s.ts, total: s.total, due: s.due });
        o.due += s.due;
        o.oldest = Math.max(o.oldest, ageOfDays(s.ts));
        by.set(k, o);
      });
    return [...by.values()]
      .map((o) => ({ ...o, bills: o.bills.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()) }))
      .sort((a, b) => b.due - a.due);
  }, [db, party]);
}

/** One customer to remind: who, how much, and the Remind button. */
export function ReminderRow({ r, onRemind, onOpen, last }: { r: DueParty; onRemind: () => void; onOpen?: () => void; last?: boolean }) {
  const { colors } = useTheme();
  const { money } = useAppData();
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 15, paddingVertical: 11,
      borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.line,
    }}>
      <Pressable onPress={onOpen} disabled={!onOpen} style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontFamily: fonts.uiSemi, fontSize: 14.5, color: colors.ink }}>{r.name}</Text>
        <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12, color: r.oldest > 30 ? colors.danger : colors.faint, marginTop: 2 }}>
          {money(r.due)} · {plural(r.bills.length, 'invoice')} · oldest {r.oldest}d
        </Text>
      </Pressable>
      <Pressable
        onPress={onRemind}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.accentSoft }}
      >
        <Icon name="share" size={14} color={colors.accent} />
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 13, color: colors.accent }}>Remind</Text>
      </Pressable>
    </View>
  );
}

/** How to send it — and that is all; the words come from the reminder settings. */
export function RemindSheet({ target, onClose }: { target: DueParty | null; onClose: () => void }) {
  const { colors } = useTheme();
  const { db, party, money } = useAppData();
  const { error, success } = useToast();
  if (!db) return null;
  const cfg = reminderSettings(db.settings.reminders);
  const pt = target ? party(target.partyId) : undefined;

  async function send(ch: Channel) {
    if (!target) return;
    const o = { partyName: target.name, bills: target.bills, firm: { name: db!.firm.name, phone: db!.firm.phone }, money };
    const template = ch === 'sms' ? cfg.sms : ch === 'email' ? cfg.email : cfg.whatsapp;
    const ok = await sendVia(ch, {
      text: fillReminder(template, o),
      phone: pt?.phone, email: pt?.email,
      subject: fillReminder(cfg.emailSubject, o),
    });
    if (!ok) { error('That app could not be opened.'); return; }
    success('Reminder ready in ' + (ch === 'whatsapp' ? 'WhatsApp' : ch === 'sms' ? 'Messages' : 'your email'));
    onClose();
  }

  const ways: { ch: Channel; l: string; sub: string; i: IconName; tint: string; off?: boolean }[] = [
    { ch: 'whatsapp', l: 'WhatsApp', sub: pt?.phone ? 'To ' + pt.phone : 'Choose the chat', i: 'phone', tint: '#25D366' },
    { ch: 'sms', l: 'SMS', sub: pt?.phone ? 'To ' + pt.phone : 'No phone number saved', i: 'mail', tint: colors.accent, off: !pt?.phone },
    { ch: 'email', l: 'Email', sub: pt?.email || 'Choose who to send it to', i: 'mail', tint: colors.warn },
  ];

  return (
    <Sheet
      visible={!!target}
      title={target ? 'Remind ' + target.name : 'Remind'}
      subtitle={target ? money(target.due) + ' due on ' + plural(target.bills.length, 'invoice') : undefined}
      icon="share"
      onClose={onClose}
    >
      {ways.map((w) => (
        <Pressable
          key={w.ch}
          disabled={w.off}
          onPress={() => void send(w.ch)}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginBottom: 8, borderRadius: 14,
            borderWidth: 1.2, borderColor: colors.line, backgroundColor: colors.surface, opacity: w.off ? 0.45 : 1,
          }}
        >
          <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: w.tint + '22', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={w.i} size={18} color={w.tint} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink }}>{w.l}</Text>
            <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint }}>{w.sub}</Text>
          </View>
          <Icon name="chev" size={14} color={colors.faint} />
        </Pressable>
      ))}
      <Text style={{ fontFamily: fonts.ui, fontSize: 12, color: colors.faint, marginTop: 2 }}>
        The message comes from Settings → Payment reminders.
      </Text>
    </Sheet>
  );
}
