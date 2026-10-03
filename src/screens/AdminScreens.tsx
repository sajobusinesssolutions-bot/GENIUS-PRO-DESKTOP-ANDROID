/**
 * The "Business" and "People" menu destinations plus Notifications:
 * Settings, Printing, Data tools, Loyalty, Instalments, Notifications.
 * Reference MENU_GROUPS 'admin' (lines 6558-6563) and SCREENS.notifications (2797).
 */
import React from 'react';
import { View, Text, ScrollView, TextInput, Switch } from 'react-native';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { Card, Cap, KV, KVNode, Button, Chip, EmptyState, IconTile } from '../components/ui';
import { Field } from '../components/form';
import { useDueReminders, ReminderRow, RemindSheet, DueParty } from '../components/Reminders';
import { Pressable } from '../components/Press';
import { Icon } from '../components/icons';
import { useGo } from '../nav/navigate';
import { ageOfDays, plural, fmtDate } from '../data/helpers';

function Input({ value, onChangeText }: any) {
  return <Field compact numeric decimal label="Value" value={value} onChangeText={onChangeText} style={{ width: 130, marginBottom: 0 }} />;
}

/** Settings moved to its own file when it was rebuilt from SCREENS.settings (6712). */
export { default as SettingsScreen } from './SettingsScreen';

export { default as DataToolsScreen } from './DataToolsScreen';

export function LoyaltyScreen() {
  const { colors } = useTheme();
  const { db, setLoyalty, money } = useAppData();
  if (!db) return null;
  const r = db.loyaltyRules;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, gap: 14 }}>
      <Card style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
        <KVNode label="Loyalty points"><Switch value={r.enabled} onValueChange={(v) => setLoyalty({ enabled: v })} /></KVNode>
        <KVNode label="Spend per point"><Input value={String(r.earnPer)} keyboardType="numeric" onChangeText={(v: string) => setLoyalty({ earnPer: Number(v) || 0 })} /></KVNode>
        <KVNode label="A point is worth"><Input value={String(r.pointValue)} keyboardType="numeric" onChangeText={(v: string) => setLoyalty({ pointValue: Number(v) || 0 })} /></KVNode>
        <KVNode label="Least points to redeem" last><Input value={String(r.redeemMin)} keyboardType="numeric" onChangeText={(v: string) => setLoyalty({ redeemMin: Number(v) || 0 })} /></KVNode>
      </Card>
      <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, lineHeight: 16 }}>
        A customer earns one point for every {money(r.earnPer)} spent, and can redeem from {r.redeemMin} points at {money(r.pointValue)} each.
      </Text>
      <View>
        <Cap style={{ marginBottom: 8 }}>Who has points</Cap>
        <Card>
          {db.parties.filter((p) => p.points > 0).length ? db.parties.filter((p) => p.points > 0).map((p, i, arr) => (
            <View key={p.id} style={{
              flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, paddingHorizontal: 16,
              borderBottomWidth: i === arr.length - 1 ? 0 : 1, borderBottomColor: colors.line,
            }}>
              <IconTile icon="gift" bg={colors.sunk} color={colors.rail} />
              <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.ink }}>{p.name}</Text>
              <Text style={{ fontFamily: fonts.monoSemi, fontSize: 12.5, color: colors.ink }}>{p.points}</Text>
            </View>
          )) : <EmptyState icon="gift" title="Nobody yet" subtitle="Points start collecting on the next sale to a named customer." />}
        </Card>
      </View>
    </ScrollView>
  );
}

/** SCREENS.notifications — what alertCount() counts, listed out. */
export function NotificationsScreen() {
  const { colors } = useTheme();
  const go = useGo();
  const { db, stockOf, dueRecurring } = useAppData();
  const reminders = useDueReminders();
  const [remind, setRemind] = React.useState<DueParty | null>(null);
  if (!db) return null;

  // each list is shown only if its alert is switched on in Settings
  const st = db.settings;
  const low = st.lowStockAlerts === false || st.notifyLowStock === false
    ? [] : db.products.filter((p) => p.active && p.kind !== 'service' && stockOf(p) <= p.reorder);
  const overdue = st.notifyOverdue === false
    ? [] : db.sales.filter((s) => s.due > 0 && s.status !== 'void' && ageOfDays(s.ts) > 30);
  const claims = db.claims.filter((c) => c.status === 'open');
  const due = dueRecurring();

  const rows: { t: string; s: string; route: string; tone: string }[] = [];
  if (low.length) rows.push({ t: plural(low.length, 'item') + ' to restock', s: 'At or below the reorder level', route: 'ItemsTab', tone: colors.warn });
  if (overdue.length) rows.push({ t: plural(overdue.length, 'sale') + ' overdue', s: 'Unpaid for more than 30 days', route: 'Sales', tone: colors.danger });
  if (claims.length) rows.push({ t: plural(claims.length, 'warranty claim') + ' open', s: 'Waiting on a decision', route: 'Warranties', tone: colors.warn });
  if (due.length) rows.push({ t: plural(due.length, 'recurring sale') + ' due', s: 'Ready to be raised', route: 'Recurring', tone: colors.accent });

  if (!rows.length && !reminders.length) return <EmptyState icon="check" title="Nothing needs you" subtitle="Stock, sales and claims are all in order." />;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
      {rows.length ? (
        <>
          <Cap style={{ marginBottom: 8 }}>Needs attention</Cap>
          <Card style={{ marginBottom: 18 }}>
            {rows.map((r, i) => (
              <Pressable
                key={r.t}
                onPress={() => go(r.route)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 12, paddingHorizontal: 16,
                  borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderBottomColor: colors.line,
                }}
              >
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: r.tone }} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 14, color: colors.ink }}>{r.t}</Text>
                  <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 1 }}>{r.s}</Text>
                </View>
                <Icon name="chev" size={14} color={colors.faint} />
              </Pressable>
            ))}
          </Card>
        </>
      ) : null}

      {reminders.length ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <Cap style={{ flex: 1 }}>Payment reminders</Cap>
            <Pressable onPress={() => go('ReminderSettings')} hitSlop={8}>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.accent }}>Settings</Text>
            </Pressable>
          </View>
          <Card>
            {reminders.map((r, i) => (
              <ReminderRow
                key={r.partyId}
                r={r}
                last={i === reminders.length - 1}
                onOpen={() => go('PartyDetail', { partyId: r.partyId })}
                onRemind={() => setRemind(r)}
              />
            ))}
          </Card>
        </>
      ) : null}

      {remind ? <RemindSheet target={remind} onClose={() => setRemind(null)} /> : null}
    </ScrollView>
  );
}
