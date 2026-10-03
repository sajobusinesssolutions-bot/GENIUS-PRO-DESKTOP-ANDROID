/**
 * LICENCE · INSTALL · UPDATE · CLOUD SYNC · ONLINE MODE · VERSIONS
 *
 * Built from the live reference definitions:
 *   SCREENS.sync        20298, with the conflict banner wrapper at 21182
 *   SCREENS.versions    20980, superseded by the body at 21432
 *   SCREENS.install     21603   (a PWA "add to home screen"; adapted below)
 *   SCREENS.licence     21930, with the guard-card wrapper at 22315
 *   SCREENS.licenceStop 22014
 *   SCREENS.online      22755
 *   SCREENS.update      23198
 *
 * Two deliberate adaptations to React Native:
 *   · The reference "Install" screen walks a browser through adding a PWA to
 *     the home screen. There is no browser here, so the screen reports how
 *     this build is installed and what running as a real app gives you,
 *     reading expo-constants rather than adding a native module.
 *   · The reference "Update" screen swaps in a waiting service worker. There
 *     is none here, so it checks the same publish feed and tells you plainly
 *     where a newer build has to come from.
 * EFRIS is deliberately not carried into this port.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TextInput, Switch, Alert, ActivityIndicator, Platform, Linking } from 'react-native';
import { Pressable } from '../components/Press';
import Constants from 'expo-constants';
import { useTheme, fonts } from '../theme';
import { useAppData } from '../data/AppDataContext';
import { useAuth } from '../data/AuthContext';
import { useSyncRun } from '../data/useSyncRun';
import { refreshSession } from '../data/authApi';
import { canFor } from '../data/perms';
import {
  Card, Cap, KV, Button, Pill, EmptyState, IconTile, Grid, Stat,
  Panel, Badge, SectionLabel, StatGrid, Sw, ListRow,
} from '../components/ui';
import { Icon, IconName } from '../components/icons';
import { useGo } from '../nav/navigate';
import { plural, fmtDate, fmtDay } from '../data/helpers';
import {
  BUILD, SCHEMA_VERSION, CHANGELOG, PLANS, LIC_WORDS, LIC_GRACE, LIC_SERVER_DEFAULT,
  SYNC_FREQ, CONFLICT_RULES, UPDATE_FEED_DEFAULT, POWERED_BY,
} from '../data/defaults';
import { verCmp, subDaysLeft, subState, access, accessDaysLeft, TRIAL_DAYS, planSummary } from '../data/logic';
import { Logo } from '../components/Logo';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../nav/types';

import { Field as FloatField } from '../components/form';
/* ---------------- shared bits ---------------- */

type Tone = 'good' | 'warn' | 'danger' | 'accent';

function toneColors(colors: ReturnType<typeof useTheme>['colors'], t: Tone): [string, string] {
  if (t === 'good') return [colors.goodSoft, colors.good];
  if (t === 'warn') return [colors.warnSoft, colors.warn];
  if (t === 'danger') return [colors.dangerSoft, colors.danger];
  return [colors.accentSoft, colors.accent];
}

/** The big tinted state card every one of these screens opens with. */
function StateCard({ tone, cap, headline, note, icon, busy, children }: {
  tone: Tone; cap: string; headline: string; note: string; icon: IconName;
  busy?: boolean; children?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const [bg, fg] = toneColors(colors, tone);
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 }}>
      <Panel style={{ borderWidth: 1.5, borderColor: bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 13 }}>
          <View style={{ width: 52, height: 52, borderRadius: 17, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
            {busy ? <ActivityIndicator color={fg} /> : <Icon name={icon} size={25} color={fg} />}
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink, letterSpacing: -0.4 }}>{headline}</Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 18, color: colors.faint, marginTop: 3 }}>{note}</Text>
          </View>
          <Badge label={cap} tone={tone === 'accent' ? 'accent' : tone} />
        </View>
        {children ? <View style={{ marginTop: 16 }}>{children}</View> : null}
      </Panel>
    </View>
  );
}

/** A tinted note card — reference `guardCard` at 22337. */
function GuardCard({ tone, title, note }: { tone: Tone; title: string; note: string }) {
  const { colors } = useTheme();
  const [bg, fg] = toneColors(colors, tone);
  return (
    <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 11, backgroundColor: bg, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 14 }}>
        <Icon name="alert" size={18} color={fg} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: fg }}>{title}</Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 18, color: fg, marginTop: 3 }}>{note}</Text>
        </View>
      </View>
    </View>
  );
}

function ToggleRow({ label, note, value, onChange, last }: {
  label: string; note?: string; value: boolean; onChange: (v: boolean) => void; last?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => onChange(!value)}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 15, minHeight: 60,
        borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.line,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{label}</Text>
        {note ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 17, color: colors.faint, marginTop: 2 }}>{note}</Text> : null}
      </View>
      <Sw on={value} onPress={() => onChange(!value)} />
    </Pressable>
  );
}

/** A row that picks one of a set — the `data-a="…Set"` rows in the reference. */
function PickRow({ label, note, on, onPress, last }: {
  label: string; note?: string; on: boolean; onPress: () => void; last?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 15, minHeight: 60,
        backgroundColor: on ? colors.accentSoft : 'transparent',
        borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.line,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{label}</Text>
        {note ? <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>{note}</Text> : null}
      </View>
      {on ? <Icon name="check" size={20} color={colors.accent} /> : null}
    </Pressable>
  );
}

/** The "what this gives you" explainer list every one of these screens carries. */
function ExplainerList({ rows }: { rows: [IconName, string, string][] }) {
  const { colors } = useTheme();
  return (
    <Card>
      {rows.map(([icon, title, sub], i) => (
        <View
          key={title}
          style={{
            flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, paddingHorizontal: 16,
            borderBottomWidth: i === rows.length - 1 ? 0 : 1, borderBottomColor: colors.line,
          }}
        >
          <IconTile icon={icon} bg={colors.sunk} color={colors.rail} size={32} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.ink }}>{title}</Text>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 17, color: colors.faint, marginTop: 1 }}>{sub}</Text>
          </View>
        </View>
      ))}
    </Card>
  );
}

function Field({ label, value, onChangeText, placeholder, autoCaps }: {
  label: string; value: string; onChangeText: (v: string) => void;
  placeholder?: string; mono?: boolean; autoCaps?: boolean;
}) {
  return <FloatField label={label} value={value} onChangeText={onChangeText} placeholder={placeholder} autoCapitalize={autoCaps ? 'characters' : 'none'} />;
}

/** The Pro wall these screens show instead of breaking — reference 18790. */
function ProWall({ what, blurb }: { what: string; blurb: string }) {
  const { colors } = useTheme();
  const go = useGo();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingTop: 18 }}>
      <View style={{ backgroundColor: colors.accentSoft, borderRadius: 13, padding: 18, alignItems: 'center' }}>
        <Icon name="lock" size={26} color={colors.accent} />
        <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink, marginTop: 8, textAlign: 'center' }}>{what} is on Pro</Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 17, color: colors.soft, marginTop: 4, textAlign: 'center' }}>{blurb}</Text>
        <View style={{ width: '100%', marginTop: 14 }}>
          <Button variant="pri" label="See the plans" onPress={() => go('Plans')} />
        </View>
      </View>
      <Card style={{ marginTop: 12, paddingVertical: 13, paddingHorizontal: 14 }}>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.ink }}>Your books are safe either way</Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 16, color: colors.faint, marginTop: 3 }}>
          Backup &amp; restore works on Starter — it writes a full copy you can move yourself.
        </Text>
        <View style={{ marginTop: 10 }}>
          <Button size="sm" label="Open backup" onPress={() => go('DataTools', { backup: true })} />
        </View>
      </Card>
    </ScrollView>
  );
}

/* ============================================================
   LICENCE — what this account has, what it opens, and the plans.

   One page answers the three questions an owner has: am I paid up, what
   am I missing, and what does it cost. The licence itself comes from the
   owner's account and is switched on by the developer; nothing is typed
   here, and the page checks the account by itself.
   ============================================================ */

export function LicenceScreen() {
  const { colors } = useTheme();
  const { db, money, refreshLicence } = useAppData();
  const { account } = useAuth();
  const [busy, setBusy] = useState(false);
  const [term, setTerm] = useState<'month' | 'quarter' | 'year'>('month');

  const checkAccount = useCallback(async (quiet = false) => {
    if (!account?.refresh) return;
    setBusy(true);
    try {
      const r = await refreshSession(account.refresh);
      if (!r.ok) { if (!quiet) Alert.alert('Licence', r.error.message); return; }
      await refreshLicence(r.value.access, account.id);
    } finally {
      setBusy(false);
    }
  }, [account?.refresh, account?.id, refreshLicence]);

  // see the newest answer each time the page opens
  useEffect(() => { void checkAccount(true); }, [checkAccount]);

  if (!db) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  const a = access(db);
  const left = accessDaysLeft(db);
  const lic = db.licence.licence;
  const planName = a === 'trial' || a === 'trialOver' ? 'Free trial'
    : lic ? (lic.planName || lic.plan) : db.subscription.plan === 'pro' ? 'Pro' : 'Starter';
  const ends = lic?.expiresAt || (db.subscription.status === 'trial' ? db.subscription.trialUntil : db.subscription.renewsAt);

  const look = {
    paid: {
      tone: colors.good, soft: colors.goodSoft, chip: 'Active', icon: 'check' as IconName,
      line: left === null ? 'Lifetime — it does not run out' : left <= 7 ? 'Renews in ' + plural(Math.max(0, left), 'day') : 'Paid up until ' + fmtDay(ends),
    },
    trial: {
      tone: colors.accent, soft: colors.accentSoft, chip: 'Trial', icon: 'gift' as IconName,
      line: plural(Math.max(0, left || 0), 'day') + ' left of your ' + TRIAL_DAYS + '-day trial',
    },
    trialOver: {
      tone: colors.danger, soft: colors.dangerSoft, chip: 'Ended', icon: 'lock' as IconName,
      line: 'Your ' + TRIAL_DAYS + '-day trial ended ' + fmtDay(ends),
    },
    lapsed: {
      tone: colors.danger, soft: colors.dangerSoft, chip: 'Expired', icon: 'lock' as IconName,
      line: 'Your plan ran out ' + fmtDay(ends),
    },
  }[a];

  const open = a === 'paid' || a === 'trial';
  const synced = a === 'paid';
  const trialPct = a === 'trial' ? Math.min(100, Math.max(4, ((TRIAL_DAYS - Math.max(0, left || 0)) / TRIAL_DAYS) * 100)) : 0;

  const rows: [IconName, string, boolean, string][] = [
    ['till', 'New sales, items and expenses', open, open ? 'Record anything' : 'Paused until a plan is chosen'],
    ['chart', 'Premium reports', open, open ? 'Profit, aging, ledgers and more' : 'Locked — everyday reports stay open'],
    ['cloud', 'Cloud sync across devices', synced, synced ? 'Your books on every device' : 'Paid plans only — not in the trial'],
    ['shield', 'Read, print, export and back up', true, 'Always — your books are never locked away'],
  ];

  const choose = (id: 'starter' | 'pro') => Alert.alert(
    PLANS[id].name + ' · ' + money(PLANS[id].prices[term]),
    'Pay for ' + PLANS[id].name + ' and the developer switches it on for ' + (account?.email || 'your account')
      + '. It reaches this phone by itself — nothing to type in.',
    [{ text: 'OK' }],
  );

  const cap = (t: string) => (
    <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, letterSpacing: 0.8, textTransform: 'uppercase', color: colors.faint, marginTop: 24, marginBottom: 8, marginLeft: 4 }}>{t}</Text>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      {/* the status, at a glance */}
      <View style={{ borderRadius: 22, padding: 20, backgroundColor: look.soft }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, backgroundColor: look.tone }}>
            <Icon name={look.icon} size={13} color="#fff" />
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: '#fff' }}>{look.chip}</Text>
          </View>
          {busy ? <ActivityIndicator color={look.tone} /> : null}
        </View>
        <Text style={{ fontFamily: fonts.uiExtra, fontSize: 30, color: colors.ink, marginTop: 14, letterSpacing: -0.6 }}>{planName}</Text>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: look.tone, marginTop: 4 }}>{look.line}</Text>
        {a === 'trial' ? (
          <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.surface, marginTop: 14, overflow: 'hidden' }}>
            <View style={{ width: (trialPct + '%') as any, height: 8, borderRadius: 4, backgroundColor: look.tone }} />
          </View>
        ) : null}
        {account?.email ? (
          <Text numberOfLines={1} style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 12 }}>
            {account.email}{lic?.devices ? ' · ' + plural(lic.devices, 'device') : ''}
          </Text>
        ) : null}
      </View>

      {/* what that means today */}
      {cap(open ? 'Included' : 'What is paused')}
      <View style={{ backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.line }}>
        {rows.map(([icon, title, on, sub], i) => (
          <View key={title} style={{ flexDirection: 'row', alignItems: 'center', gap: 13, padding: 15, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
            <View style={{ width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? colors.goodSoft : colors.sunk }}>
              <Icon name={icon} size={18} color={on ? colors.good : colors.faint} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontFamily: fonts.uiSemi, fontSize: 15, color: on ? colors.ink : colors.soft }}>{title}</Text>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>{sub}</Text>
            </View>
            <Icon name={on ? 'check' : 'lock'} size={17} color={on ? colors.good : colors.faint} />
          </View>
        ))}
      </View>

      {/* the plans */}
      {cap(a === 'paid' ? 'Plans' : 'Choose a plan')}
      <View style={{ flexDirection: 'row', padding: 4, borderRadius: 14, backgroundColor: colors.sunk, marginBottom: 12 }}>
        {(['month', 'quarter', 'year'] as const).map((t) => (
          <Pressable key={t} onPress={() => setTerm(t)} style={{
            flex: 1, paddingVertical: 10, borderRadius: 11, alignItems: 'center',
            backgroundColor: term === t ? colors.surface : 'transparent',
          }}>
            <Text style={{ fontFamily: fonts.uiBold, fontSize: 12.5, color: term === t ? colors.ink : colors.faint }}>
              {t === 'month' ? 'Monthly' : t === 'quarter' ? '3 months' : 'Yearly'}
            </Text>
          </Pressable>
        ))}
      </View>
      {(['starter', 'pro'] as const).map((id) => {
        const p = PLANS[id];
        const mine = a === 'paid' && (lic ? lic.plan === id : db.subscription.plan === id);
        const star = id === 'pro';
        return (
          <View key={id} style={{
            borderRadius: 20, padding: 18, marginBottom: 12, backgroundColor: colors.surface,
            borderWidth: star || mine ? 2 : 1, borderColor: mine ? colors.good : star ? colors.accent : colors.line,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ fontFamily: fonts.uiExtra, fontSize: 20, color: colors.ink }}>{p.name}</Text>
              {mine ? <Badge label="Your plan" tone="good" /> : star ? <Badge label="Most popular" tone="accent" /> : null}
            </View>
            <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 18, color: colors.faint, marginTop: 4 }}>{p.blurb}</Text>
            <Text style={{ fontFamily: fonts.uiExtra, fontSize: 26, color: colors.ink, marginTop: 10 }}>
              {money(p.prices[term])}
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{term === 'month' ? ' / month' : term === 'quarter' ? ' / 3 months' : ' / year'}</Text>
            </Text>
            <View style={{ gap: 6, marginTop: 10, marginBottom: 14 }}>
              {p.has.slice(0, 6).map((f) => (
                <View key={f} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Icon name="check" size={14} color={colors.good} />
                  <Text style={{ flex: 1, fontFamily: fonts.ui, fontSize: 12.5, color: colors.soft }}>{f}</Text>
                </View>
              ))}
            </View>
            <Button variant={mine ? 'default' : 'pri'} label={mine ? 'Your current plan' : 'Get ' + p.name} disabled={mine} onPress={() => choose(id)} />
          </View>
        );
      })}

      <Button
        label={busy ? 'Checking…' : 'Check my plan now'}
        icon={<Icon name="cloud" size={16} color={colors.ink} />}
        disabled={busy || !account?.refresh}
        onPress={() => void checkAccount(false)}
      />
      <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 18, color: colors.faint, textAlign: 'center', marginTop: 10, paddingHorizontal: 10 }}>
        {db.licence.checkedAt ? 'Last checked ' + fmtDate(db.licence.checkedAt) + '. ' : ''}
        A new plan reaches this phone by itself. Offline, it keeps working on the last answer for up to {LIC_GRACE} days.
      </Text>
    </ScrollView>
  );
}

/** SCREENS.licenceStop — 22014. The door a stopped till cannot open. */
export function LicenceStopScreen() {
  const { colors } = useTheme();
  const go = useGo();
  const { db, licState } = useAppData();
  if (!db) return null;
  const st = licState();
  const w = LIC_WORDS[st] || LIC_WORDS.none;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingTop: 22 }}>
      <View style={{ backgroundColor: colors.dangerSoft, borderRadius: 13, padding: 20, alignItems: 'center' }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="lock" size={26} color={colors.danger} />
        </View>
        <Text style={{ fontFamily: fonts.uiExtra, fontSize: 15, color: colors.ink, marginTop: 12, textAlign: 'center' }}>{w[0]}</Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 17, color: colors.soft, marginTop: 4, textAlign: 'center' }}>
          {db.licence.reason || w[1]}
        </Text>
        {db.licence.licence ? (
          <Text style={{ fontFamily: fonts.mono, fontSize: 12.5, color: colors.faint, marginTop: 8 }}>{db.licence.licence.no}</Text>
        ) : null}
      </View>

      <Card style={{ marginTop: 12, paddingVertical: 13, paddingHorizontal: 14 }}>
        <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.ink }}>Nothing has been lost</Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 16, color: colors.faint, marginTop: 3 }}>
          Every sale, customer and figure is still on this phone. You can read the books and take a
          backup out — you just cannot record anything new until the licence is put right.
        </Text>
      </Card>

      <View style={{ flexDirection: 'row', gap: 9, marginTop: 12 }}>
        <View style={{ flex: 1 }}><Button size="sm" label="The licence" onPress={() => go('Licence')} /></View>
        <View style={{ flex: 1 }}><Button size="sm" label="Take a backup" onPress={() => go('DataTools', { backup: true })} /></View>
      </View>
      <View style={{ marginTop: 8 }}>
        <Button size="sm" label="Read the reports" onPress={() => go('Reports')} />
      </View>

      <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, textAlign: 'center', marginTop: 14 }}>{POWERED_BY}</Text>
    </ScrollView>
  );
}

/* ============================================================
   ONLINE MODE — SCREENS.online (22755)
   ============================================================ */

export function OnlineScreen() {
  const { colors } = useTheme();
  const go = useGo();
  const { db, setSync, licFeature, toggleOnline, can } = useAppData();
  const { run } = useSyncRun();
  const [syncing, setSyncing] = useState(false);

  if (!db) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  if (!licFeature('sync')) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingTop: 18 }}>
        <View style={{ backgroundColor: colors.accentSoft, borderRadius: 13, padding: 18, alignItems: 'center' }}>
          <Icon name="cloud" size={26} color={colors.accent} />
          <Text style={{ fontFamily: fonts.uiBold, fontSize: 15, color: colors.ink, marginTop: 8 }}>Online mode needs Pro</Text>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, lineHeight: 17, color: colors.soft, marginTop: 4, textAlign: 'center' }}>
            Starter keeps everything on one device. Pro puts the books in the cloud so every till in
            the shop agrees.
          </Text>
          <View style={{ width: '100%', marginTop: 14 }}>
            <Button variant="pri" label="The licence" onPress={() => go('Licence')} />
          </View>
        </View>
      </ScrollView>
    );
  }

  const s = db.sync;
  const on = s.on;
  const online = db.session.online !== false;
  const pend = db.queue.length + s.pending.length;

  const st: { t: string; tone: Tone; n: string } = !on
    ? { t: 'Off', tone: 'warn', n: 'The books stay on this device' }
    : online
      ? { t: 'Live', tone: 'good', n: 'Every change is going straight up' }
      : { t: 'No line', tone: 'danger', n: 'This device cannot reach the cloud' };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const r = await run('manual');
      Alert.alert('Sync', r.message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 24 }}>
      <StateCard
        tone={st.tone} cap={st.t} icon="cloud" note={st.n}
        headline={on ? (pend ? plural(pend, 'change') + ' waiting' : 'Everything is up') : 'This device only'}
      >
        {on ? <Button variant="pri" label="Sync now" onPress={syncNow} loading={syncing} /> : null}
      </StateCard>

      <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
        <Card>
          <ToggleRow
            label="Keep this shop’s books in the cloud"
            note="Every device on the licence shares one set of books"
            value={on}
            onChange={(v) => {
              if (!v && pend) {
                Alert.alert(
                  'Online mode',
                  plural(pend, 'change') + ' have not reached the cloud yet.\n\nTurn online mode off anyway? They will stay on this device only.',
                  [{ text: 'Cancel', style: 'cancel' }, { text: 'Turn off', style: 'destructive', onPress: () => setSync({ on: false }) }],
                );
                return;
              }
              if (v && !canFor(db.session.role, 'settings')) { Alert.alert('Online mode', 'Only the owner can turn this on.'); return; }
              setSync({ on: v });
              // Switching on queues the backlog (see setSync), but nothing
              // sent it up yet — without this it sat waiting for the next
              // automatic tick, so the very moment a shop turns this on
              // looked like nothing had happened.
              if (v) void run('manual');
            }}
            last={!on}
          />
          {on ? (
            <ToggleRow
              label="Refuse to record anything while offline"
              note="Off, this device will queue changes instead — the tills can then disagree"
              value={s.strict}
              onChange={(v) => setSync({ strict: v })}
              last
            />
          ) : null}
        </Card>
      </View>

      <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
        <Card>
          {can('sales.toggle_offline') ? (
            <ToggleRow label="This device has a line" note="Turn it off to keep selling with no network" value={online} onChange={() => toggleOnline()} last />
          ) : (
            <ToggleRow label="This device has a line" note="Your role cannot switch the till offline" value={online} onChange={() => undefined} last />
          )}
        </Card>
      </View>

      {on ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
          <Card style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
            <KV label="Books" value={db.firm.name} />
            <KV label="This device" value={s.devices.find((x) => x.me)?.name || 'This phone'} />
            <KV label="Waiting to go up" value={plural(pend, 'change')} />
            <KV label="Last sent" value={s.lastPush ? fmtDate(s.lastPush) : 'never'} />
            <KV label="Last received" value={s.lastPull ? fmtDate(s.lastPull) : 'never'} />
            <KV label="Cloud position" value={'#' + (s.cursor || 0)} last />
          </Card>
        </View>
      ) : null}

      <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
        <Cap style={{ marginBottom: 8 }}>What online mode changes</Cap>
        <ExplainerList
          rows={[
            ['cloud', 'The cloud holds the books', 'Not a copy — the shop’s working set'],
            ['phone', 'Every device agrees', 'A sale on the counter phone is on the laptop at once'],
            ['lock', 'Nothing is written blind', 'A change that cannot be reported is not recorded'],
            ['shield', 'Your data stays yours', 'One account, one shop. No other business can see it'],
          ]}
        />
      </View>
    </ScrollView>
  );
}

/* ============================================================
   VERSIONS — SCREENS.versions, the body at 21432
   ============================================================ */

type VersionsProps = NativeStackScreenProps<RootStackParamList, 'Versions'>;

const FIELD_LABELS: Record<string, string> = {
  total: 'Total', due: 'Due', paid: 'Paid', partyId: 'Customer', method: 'Payment',
  discount: 'Discount', tax: 'Tax', status: 'Status', no: 'Number', name: 'Name',
  price: 'Price', cost: 'Cost', qty: 'Quantity', amount: 'Amount',
  accountId: 'Account', ref: 'Reference', note: 'Note', unit: 'Unit',
  sku: 'Code', phone: 'Phone', type: 'Type', warehouse: 'Store',
};
/** The fields worth showing a shopkeeper — reference SHOWN_FIELDS at 21418. */
const SHOWN_FIELDS = Object.keys(FIELD_LABELS);

export function VersionsScreen({ route }: VersionsProps) {
  const { colors } = useTheme();
  const { db, revisionsFor, user, party, product, money } = useAppData();

  const coll = route.params?.coll || 'sales';
  const id = route.params?.recordId || '';
  const rec: any = db ? ((db as any)[coll] || []).find((x: any) => x.id === id) : null;

  if (!db) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  if (!rec) return <EmptyState icon="clock" title="Not found" subtitle="That record is no longer here." />;

  const list = revisionsFor(rec.id);

  const shortVal = (v: unknown): string => {
    if (v == null || v === '') return '—';
    if (typeof v === 'number') return money(v);
    const s = String(v);
    const named = party(s)?.name || product(s)?.name || user(s)?.name || db.accounts.find((a) => a.id === s)?.name;
    const out = named || s;
    return out.length > 22 ? out.slice(0, 21) + '…' : out;
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ paddingBottom: 24 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 }}>
        <Card style={{ paddingVertical: 12, paddingHorizontal: 14 }}>
          <KV label="Record" value={String(rec.no || rec.name || rec.id)} />
          <KV label="Now at" value={'Version ' + (rec._v || 1)} />
          <KV label="Last changed" value={rec._at ? fmtDate(rec._at) : '—'} />
          <KV label="By" value={user(rec._by)?.name || '—'} last />
        </Card>
      </View>

      {list.length ? list.map((r) => {
        const current = r.v === (rec._v || 1);
        const shown = (r.changed || []).filter((c) => SHOWN_FIELDS.indexOf(c.f) > -1);
        return (
          <View key={r.id} style={{ paddingHorizontal: 16, paddingBottom: 9 }}>
            <Card style={{ paddingVertical: 12, paddingHorizontal: 14, borderColor: current ? colors.accent : colors.line }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: colors.ink }}>Version {r.v}</Text>
                  {current ? <Pill tone="a" label="Now" /> : null}
                </View>
                <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>{fmtDate(r.ts)}</Text>
              </View>
              <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 2 }}>
                {r.why || 'Changed'} · {user(r.by)?.name || ''}
              </Text>
              {shown.length ? (
                <View style={{ marginTop: 8, gap: 3 }}>
                  {shown.slice(0, 8).map((c, i) => (
                    <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 10 }}>
                      <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.soft }}>{FIELD_LABELS[c.f] || c.f}</Text>
                      <Text numberOfLines={1} style={{ flex: 1, textAlign: 'right', fontFamily: fonts.mono, fontSize: 12.5, color: colors.faint }}>
                        {shortVal(c.from)} → <Text style={{ fontFamily: fonts.monoSemi, color: colors.ink }}>{shortVal(c.to)}</Text>
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </Card>
          </View>
        );
      }) : (
        <View style={{ paddingHorizontal: 16 }}>
          <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint }}>
            Nothing has changed since it was created.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

/* ============================================================
   ABOUT — SCREENS.about (21109) with the wrapper at 21716
   ============================================================ */

export function AboutScreen() {
  const { colors } = useTheme();
  const go = useGo();
  const { db } = useAppData();
  if (!db) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  const plan = planSummary(db);
  const tone = plan.tone === 'good' ? colors.good : plan.tone === 'warn' ? colors.warn : plan.tone === 'danger' ? colors.danger : colors.accent;

  const row = (icon: IconName, label: string, value: string, onPress?: () => void, color?: string, last?: boolean) => (
    <Pressable
      key={label}
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 13, padding: 15,
        borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.line,
        backgroundColor: pressed ? colors.sunk : 'transparent',
      })}
    >
      <Icon name={icon} size={18} color={colors.faint} />
      <Text style={{ flex: 1, fontFamily: fonts.uiSemi, fontSize: 15, color: colors.ink }}>{label}</Text>
      <Text style={{ fontFamily: fonts.uiSemi, fontSize: 12.5, color: color || colors.faint }}>{value}</Text>
      {onPress ? <Icon name="chev" size={16} color={colors.lineHard} /> : null}
    </Pressable>
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      <View style={{ alignItems: 'center', paddingVertical: 26 }}>
        <Logo size={76} />
        <Text style={{ fontFamily: fonts.uiExtra, fontSize: 24, color: colors.ink, marginTop: 16, letterSpacing: -0.5 }}>Genius Pro</Text>
        <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, marginTop: 4 }}>Version {BUILD}</Text>
      </View>

      <View style={{ backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' }}>
        {row('gift', plan.name, plan.left, () => go('Licence'), tone)}
        {row('bulb', 'Help & FAQs', '', () => go('Faq'))}
        {row('doc', 'Terms and conditions', '', () => go('Legal', { doc: 'terms' }))}
        {row('shield', 'Privacy policy', '', () => go('Legal', { doc: 'privacy' }), undefined, true)}
      </View>

      <Text style={{ fontFamily: fonts.ui, fontSize: 12.5, color: colors.faint, textAlign: 'center', marginTop: 22 }}>{POWERED_BY}</Text>
    </ScrollView>
  );
}

/* Cloud sync moved to its own module when it stopped being a mock. */
export { default as SyncScreen } from './SyncScreen';
